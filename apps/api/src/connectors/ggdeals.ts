/**
 * Conector de preços do gg.deals.
 *
 * A API gratuita devolve o MENOR preço por mercado (lojas oficiais e keyshops),
 * não ofertas por loja. Limites: 100 registros/min e 1000/h.
 * Estratégia: lotes de até 100 IDs, pausa entre lotes e teto por execução.
 */
import type { SettingsDto } from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawPriceSnapshot } from './types';
import { ConnectorError } from './types';
import { fetchText } from './http';
import { listGamesForPriceCheck } from '../db/repositories/games';
import { nowIso } from '../lib/dates';
import { secretValue } from '../lib/secrets';
import type { Logger } from '../lib/logger';

const MAX_IDS_PER_REQUEST = 100;
const MAX_PER_RUN = 400;
const DEFAULT_CHUNK_DELAY_MS = 61_000;

interface GgPrices {
  currentRetail?: string | number | null;
  currentKeyshops?: string | number | null;
  historicalRetail?: string | number | null;
  historicalKeyshops?: string | number | null;
  currency?: string;
}

interface GgEntry {
  title?: string;
  url?: string;
  prices?: GgPrices;
}

interface GgResponse {
  success?: boolean;
  data?: Record<string, GgEntry | null>;
}

const REGION_MAP: Record<string, string> = {
  BR: 'br',
  US: 'us',
  GB: 'gb',
  DE: 'de',
  FR: 'fr',
  PT: 'eu',
  JP: 'us'
};

function ggRegion(settings: SettingsDto): string {
  return REGION_MAP[settings.region.toUpperCase()] ?? 'us';
}

function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export interface GgFetchResult {
  snapshots: RawPriceSnapshot[];
  warnings: string[];
}

/** Busca preços de uma lista de appids respeitando os limites da API. */
export async function fetchGgdealsPrices(
  appids: number[],
  settings: SettingsDto,
  logger?: Logger
): Promise<GgFetchResult> {
  const key = secretValue('ggdeals');
  if (!key) {
    throw new ConnectorError(
      'auth',
      'Chave do gg.deals não configurada. Adicione em Configurações → Chaves de API (ou no .env).'
    );
  }

  const unique = [...new Set(appids.filter((appid) => Number.isInteger(appid)))];
  if (unique.length === 0) return { snapshots: [], warnings: [] };

  const base = process.env.GGDEALS_BASE_URL ?? 'https://api.gg.deals/v1';
  const delayMs = Number(process.env.GGDEALS_CHUNK_DELAY_MS ?? DEFAULT_CHUNK_DELAY_MS);
  const batches = chunk(unique, MAX_IDS_PER_REQUEST);

  const snapshots: RawPriceSnapshot[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index] as number[];
    const url = new URL(`${base}/prices/by-steam-app-id/`);
    url.searchParams.set('ids', batch.join(','));
    url.searchParams.set('key', key);
    url.searchParams.set('region', ggRegion(settings));

    try {
      const response = await fetchText(url.toString(), { accept: 'application/json', timeoutMs: 30_000 });
      let payload: GgResponse;
      try {
        payload = JSON.parse(response.text) as GgResponse;
      } catch {
        throw new ConnectorError('layout_changed', 'O gg.deals devolveu uma resposta que não é JSON.');
      }

      if (payload.success === false) {
        throw new ConnectorError('layout_changed', 'O gg.deals recusou a requisição.');
      }

      for (const appid of batch) {
        const entry = payload.data?.[String(appid)] ?? null;
        const prices = entry?.prices;
        snapshots.push({
          appid,
          found: Boolean(entry),
          currency: prices?.currency ?? settings.currency,
          officialCents: toCents(prices?.currentRetail),
          keyshopCents: toCents(prices?.currentKeyshops),
          officialLowCents: toCents(prices?.historicalRetail),
          keyshopLowCents: toCents(prices?.historicalKeyshops),
          ggUrl: entry?.url ?? null
        });
      }

      logger?.debug(`gg.deals: lote ${index + 1}/${batches.length} com ${batch.length} jogo(s)`);
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (error.code === 'blocked' || error.code === 'auth') {
          throw new ConnectorError(
            'auth',
            'Chave do gg.deals inválida ou sem permissão. Confira em Configurações → Chaves de API.'
          );
        }
        if (error.code === 'rate_limited' && snapshots.length > 0) {
          warnings.push('Limite do gg.deals atingido; parte dos preços ficou para a próxima execução.');
          break;
        }
      }
      throw error;
    }

    if (index < batches.length - 1 && delayMs > 0) {
      logger?.debug(`gg.deals: aguardando ${delayMs}ms para respeitar o limite`);
      await sleep(delayMs);
    }
  }

  return { snapshots, warnings };
}

export const ggdealsConnector: Connector = {
  type: 'ggdeals',
  defaultIntervalMinutes: 360,
  minIntervalMinutes: 360,

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ checked: number; lastSyncAt: string }>> {
    const games = listGamesForPriceCheck(MAX_PER_RUN);
    if (games.length === 0) {
      return { items: [], state: { checked: 0, lastSyncAt: nowIso() } };
    }

    const { snapshots, warnings } = await fetchGgdealsPrices(
      games.map((game) => game.appid),
      ctx.settings,
      ctx.logger
    );

    ctx.logger.info(`gg.deals: ${snapshots.length} preço(s) verificado(s)`);
    return {
      items: [],
      state: { checked: snapshots.length, lastSyncAt: nowIso() },
      prices: snapshots,
      warnings
    };
  }
};
