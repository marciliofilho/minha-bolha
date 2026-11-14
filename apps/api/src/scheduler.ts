/**
 * Scheduler próprio (em vez de cron):
 * - tick a cada 30s procurando fontes vencidas;
 * - concorrência limitada (2 por vez na Fase 1);
 * - jitter para não bater tudo no mesmo segundo;
 * - backoff exponencial em caso de falha;
 * - intervalo mínimo por tipo de conector.
 */
import type { RefreshStateDto, SourceErrorCode } from '@hub/shared';
import { createLogger } from './lib/logger';
import { nowIso } from './lib/dates';
import { buildNewItemNotifications, insertItems } from './db/repositories/items';
import {
  finishRun,
  getSourceRow,
  listAllSourceRows,
  listDueSources,
  recordFailure,
  recordSuccess,
  setNextRun,
  startRun,
  updateSource
} from './db/repositories/sources';
import { getSettings } from './db/repositories/settings';
import { parseJson } from './db/mappers';
import { upsertMedia } from './db/repositories/media';
import { upsertReleaseEvents } from './db/repositories/calendar';
import { buildReleaseItems } from './domain/releases';
import { applyPriceSnapshots, getGgdealsSource, syncWishlist } from './domain/games';
import { syncStremioLibrary } from './domain/stremio';
import { markStremioExpired } from './db/repositories/stremio';
import { replaceGlobalReleases } from './db/repositories/global-releases';
import { getConnector } from './connectors/registry';
import { ConnectorError } from './connectors/types';
import type { Connector } from './connectors/types';
import type { SourceRow } from './db/types';
import { todayInZone } from './lib/dates';
import { broadcast } from './sse';
import { runAutomaticMaintenance } from './lib/storage';
import {
  canStartNovel,
  nextNovelStartAfter,
  novelCooldownRemainingMs
} from './lib/novel-schedule';

export { novelCooldownRemainingMs as novelManualCooldownRemainingMs } from './lib/novel-schedule';

const log = createLogger('scheduler');
const MAX_CONCURRENT = 2;
const TICK_MS = 30_000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

const running = new Set<string>();
const queue: Array<{ sourceId: string; manual: boolean }> = [];
let active = 0;
let timer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let pumpTimer: NodeJS.Timeout | null = null;
let nextNovelStartAt = 0;
let started = false;

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

export function getRefreshState(): RefreshStateDto {
  return { active, queued: queue.length };
}

function emitState(): void {
  broadcast('refresh:state', getRefreshState() as unknown as Record<string, unknown>);
}

export function enqueueSource(sourceId: string, manual = false): boolean {
  if (running.has(sourceId) || queue.some((job) => job.sourceId === sourceId)) return false;
  queue.push({ sourceId, manual });
  emitState();
  pump();
  return true;
}

export function enqueueAll(manual = true): number {
  let count = 0;
  for (const source of listAllSourceRows()) {
    // Fontes de demonstração não entram no "atualizar tudo": são fictícias e
    // não devem poluir o feed com conteúdo real. O botão individual continua.
    if (source.is_demo === 1) continue;
    // O "atualizar tudo" também é manual: respeita o cooldown das novels.
    if (manual && novelCooldownRemainingMs(source.type, source.last_checked_at) > 0) {
      continue;
    }
    if (enqueueSource(source.id, manual)) count++;
  }
  return count;
}

function schedulePump(delayMs: number): void {
  if (pumpTimer !== null) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, Math.max(50, delayMs));
  pumpTimer.unref?.();
}

function pump(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    // Espera 2s entre novels, mesmo quando várias vencem no mesmo tick.
    // Os demais tipos não entram nesse espaçamento.
    const now = Date.now();
    const index = queue.findIndex((job) => {
      if (canStartNovel(now, nextNovelStartAt)) return true;
      const row = getSourceRow(job.sourceId);
      return !row || row.type !== 'webnovel';
    });

    if (index < 0) {
      schedulePump(nextNovelStartAt - now);
      return;
    }

    const [job] = queue.splice(index, 1);
    if (!job) return;
    if (running.has(job.sourceId)) continue;

    const row = getSourceRow(job.sourceId);
    if (row?.type === 'webnovel') {
      nextNovelStartAt = nextNovelStartAfter(Date.now());
    }

    active++;
    running.add(job.sourceId);
    emitState();

    void runSource(job.sourceId, job.manual)
      .catch((error) => log.error('erro não tratado no job', error))
      .finally(() => {
        running.delete(job.sourceId);
        active--;
        emitState();
        pump();
      });
  }
}

// ---------------------------------------------------------------------------
// Execução de uma fonte
// ---------------------------------------------------------------------------

function effectiveInterval(row: SourceRow, connector: Connector): number {
  return Math.max(row.interval_minutes || connector.defaultIntervalMinutes, connector.minIntervalMinutes, 5);
}

const FEED_REFRESH_TYPES = new Set(['youtube', 'rss', 'custom']);
const NOVEL_REFRESH_TYPES = new Set(['webnovel']);

/** Intervalo efetivo em ms; feeds usam o ajuste global em segundos. */
function effectiveIntervalMs(
  row: SourceRow,
  connector: Connector,
  settings: { feedRefreshSeconds: number; novelRefreshMinutes: number }
): number {
  // Novels têm um ritmo próprio: consultar a Webnovel a cada minuto
  // aumenta muito o risco de bloqueio por bot.
  if (NOVEL_REFRESH_TYPES.has(row.type)) {
    return Math.max(settings.novelRefreshMinutes, 5) * 60_000;
  }
  if (FEED_REFRESH_TYPES.has(row.type)) {
    return Math.max(settings.feedRefreshSeconds, 60) * 1000;
  }
  return effectiveInterval(row, connector) * 60_000;
}

function jitteredNextRun(intervalMs: number, extraDelayMs = 0): string {
  const jitter = 0.9 + Math.random() * 0.2;
  const initialSpread = extraDelayMs + Math.random() * Math.min(120_000, intervalMs * 0.2);
  return new Date(Date.now() + intervalMs * jitter + initialSpread).toISOString();
}

function failureNextRun(intervalMs: number, failures: number, code: SourceErrorCode): string {
  const exponent = Math.min(Math.max(failures - 1, 0), 5);
  let delay = intervalMs * 2 ** exponent;
  if (code === 'blocked' || code === 'private' || code === 'layout_changed') {
    delay = Math.max(delay, 6 * 60 * 60_000);
  }
  delay = Math.min(delay, MAX_BACKOFF_MS);
  return new Date(Date.now() + delay + Math.random() * 60_000).toISOString();
}

async function runSource(sourceId: string, manual: boolean): Promise<void> {
  const row = getSourceRow(sourceId);
  if (!row) return;
  if (row.enabled !== 1 && !manual) return;

  const connector = getConnector(row.type);
  const settings = getSettings();
  const startedAt = nowIso();
  const startMs = Date.now();
  const runId = startRun(sourceId, startedAt);
  const intervalMs = effectiveIntervalMs(row, connector, settings);

  try {
    const result = await connector.fetch({
      source: row,
      config: parseJson<Record<string, unknown>>(row.config, {}),
      state: parseJson<unknown>(row.state, null),
      settings,
      logger: log
    });

    // Conectores de mídia (TMDB/AniList) alimentam o calendário e podem gerar
    // itens de feed quando um lançamento/episódio acontece.
    const generated = [...result.items];
    if (result.media) {
      const media = upsertMedia(row.id, result.media);
      if (result.releaseEvents) {
        upsertReleaseEvents(media.id, result.releaseEvents, todayInZone(settings.timezone));
        generated.push(
          ...buildReleaseItems({
            source: row,
            media,
            settings,
            firstSync: !row.last_success_at
          })
        );
      }
    }

    // Wishlist da Steam: atualiza a biblioteca.
    if (result.wishlist) {
      const stats = syncWishlist(result.wishlist);
      broadcast('games:changed', { ...stats, sourceId: row.id });
      log.info(`wishlist: ${stats.added} adicionado(s), ${stats.updated} atualizado(s)`);

      // Só agora existem jogos para consultar; dispara a fonte de preços.
      const priceSource = getGgdealsSource();
      if (priceSource) enqueueSource(priceSource.id, true);
    }

    // Preços do gg.deals: atualiza a biblioteca e gera alertas.
    if (result.prices) {
      const priceItems = applyPriceSnapshots(result.prices, settings);
      generated.push(...priceItems);
      broadcast('games:changed', { updated: result.prices.length, sourceId: row.id });
    }

    // Biblioteca do Stremio: somente leitura, persiste progresso e itens.
    if (result.stremioLibrary) {
      const stats = syncStremioLibrary(result.stremioLibrary);
      broadcast('stremio:changed', { saved: stats.saved, sourceId: row.id });
    }

    // Calendário global: substitui apenas os provedores que responderam.
    if (result.globalReleases && result.globalReleaseProviders?.length) {
      const stats = replaceGlobalReleases(result.globalReleases, result.globalReleaseProviders);
      broadcast('calendar:changed', { saved: stats.saved, sourceId: row.id });
      log.info(`calendário global: ${stats.saved} lançamento(s)`);
    }

    if (result.warnings && result.warnings.length > 0) {
      log.warn(`${row.name}: avisos`, result.warnings);
    }

    const insertResult = insertItems(row.id, row.category_id, generated);
    const itemsNew = insertResult.inserted;
    const checkedAt = nowIso();
    const nextRunAt = jitteredNextRun(intervalMs);
    recordSuccess(row.id, {
      state: JSON.stringify(result.state ?? {}),
      nextRunAt,
      checkedAt
    });
    finishRun(runId, {
      ok: true,
      itemsFound: generated.length,
      itemsNew,
      durationMs: Date.now() - startMs
    });

    broadcast('source:status', {
      sourceId: row.id,
      ok: true,
      itemsNew,
      lastCheckedAt: checkedAt,
      nextRunAt
    });
    if (itemsNew > 0) {
      broadcast('items:new', {
        sourceId: row.id,
        count: itemsNew,
        items: buildNewItemNotifications(insertResult)
      });
    }

    log.info(`${row.name}: ${result.items.length} item(ns), ${itemsNew} novo(s)`);
  } catch (error) {
    const code: SourceErrorCode = error instanceof ConnectorError ? error.code : 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    const failures = row.consecutive_failures + 1;
    const checkedAt = nowIso();
    const nextRunAt = failureNextRun(intervalMs, failures, code);

    recordFailure(row.id, {
      code,
      message,
      consecutiveFailures: failures,
      nextRunAt,
      checkedAt
    });
    finishRun(runId, {
      ok: false,
      itemsFound: 0,
      itemsNew: 0,
      errorCode: code,
      errorMessage: message,
      durationMs: Date.now() - startMs
    });

    broadcast('source:status', {
      sourceId: row.id,
      ok: false,
      errorCode: code,
      errorMessage: message,
      lastCheckedAt: checkedAt,
      nextRunAt
    });

    if (code === 'auth' && row.type === 'stremio-library') {
      markStremioExpired();
      updateSource(row.id, { enabled: false });
      broadcast('stremio:changed', { expired: true, sourceId: row.id });
    }

    log.warn(`${row.name}: ${code} — ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

/** Ao iniciar, espalha as fontes atrasadas para evitar uma rajada de requisições. */
function spreadInitialSchedule(): void {
  const now = Date.now();
  for (const row of listAllSourceRows()) {
    const due = !row.next_run_at || new Date(row.next_run_at).getTime() <= now;
    if (!due) continue;
    const delay = 5_000 + Math.random() * 120_000;
    setNextRun(row.id, new Date(now + delay).toISOString());
  }
}

function tick(): void {
  try {
    for (const row of listDueSources(10)) {
      enqueueSource(row.id, false);
    }
  } catch (error) {
    log.error('falha no tick do scheduler', error);
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;
  spreadInitialSchedule();
  tick();

  const runMaintenance = (): void => {
    void runAutomaticMaintenance()
      .then((result) => {
        if (!result.enabled) return;
        if (result.torrent.removed) {
          log.info(
            `cache de torrents limpo automaticamente: ${Math.round(result.torrent.freedBytes / 1024)} KB`
          );
        }
        if (result.browserTemp.files > 0) {
          log.info(`temporários antigos do navegador removidos: ${result.browserTemp.files} arquivo(s)`);
        }
        if (result.novelCache.removed > 0) {
          log.info(`cache de novels limpo automaticamente: ${result.novelCache.removed} entrada(s)`);
        }
        if (result.databaseBackup.created) {
          log.info('backup automático do banco criado');
        }
      })
      .catch((error) => {
        log.warn(
          `manutenção automática falhou: ${error instanceof Error ? error.message : String(error)}`
        );
      });
  };

  // Primeira passada após 1 min; depois a cada 30 min (a limpeza de novels
  // respeita o intervalo configurado pelo usuário).
  setTimeout(runMaintenance, 60_000).unref?.();
  maintenanceTimer = setInterval(runMaintenance, 30 * 60_000);
  maintenanceTimer.unref?.();

  timer = setInterval(tick, TICK_MS);
  log.info(`scheduler ativo (tick ${TICK_MS / 1000}s, concorrência ${MAX_CONCURRENT})`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  if (pumpTimer) clearTimeout(pumpTimer);
  timer = null;
  maintenanceTimer = null;
  pumpTimer = null;
  started = false;
}

export function isSourceRunning(sourceId: string): boolean {
  return running.has(sourceId) || queue.some((job) => job.sourceId === sourceId);
}

/** Reagenda as fontes de feed para aplicar um novo intervalo em segundos. */
export function rescheduleFeedSources(): void {
  const now = Date.now();
  for (const row of listAllSourceRows()) {
    if (!FEED_REFRESH_TYPES.has(row.type)) continue;
    setNextRun(row.id, new Date(now + Math.random() * 5_000).toISOString());
  }
}

/** Reagenda as novels para aplicar um novo intervalo em minutos. */
export function rescheduleNovelSources(): void {
  const intervalMs = Math.max(getSettings().novelRefreshMinutes, 5) * 60_000;
  const now = Date.now();
  for (const row of listAllSourceRows()) {
    if (!NOVEL_REFRESH_TYPES.has(row.type)) continue;
    // Mantém o ritmo a partir da última verificação em vez de disparar
    // uma rajada de requisições só porque a configuração mudou.
    const last = row.last_checked_at ? Date.parse(row.last_checked_at) : NaN;
    const base = Number.isFinite(last)
      ? Math.max(now + 30_000, last + intervalMs)
      : now + intervalMs;
    const spread = Math.random() * Math.min(120_000, intervalMs * 0.2);
    setNextRun(row.id, new Date(base + spread).toISOString());
  }
}
