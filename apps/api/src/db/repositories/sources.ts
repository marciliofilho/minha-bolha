/** Repositório de fontes + histórico de execuções. */
import { randomUUID } from 'node:crypto';
import { db } from '../database';
import type {
  SourceDto,
  SourceErrorCode,
  SourceRunDto,
  SourceStatusDto,
  SourceType
} from '@hub/shared';
import type { SourceRow, SourceRunRow } from '../types';
import { toRunDto, toSourceDto } from '../mappers';
import { nowIso, youtubeFeedCutoffIso } from '../../lib/dates';

interface SourceWithStatsRow extends SourceRow {
  item_count: number;
  unread_count: number;
  latest_item_title: string | null;
  latest_item_published_at: string | null;
}

/** Conta apenas itens visíveis no feed; YouTube fica limitado às últimas 48h. */
const VISIBLE_ITEM_FILTER = "i.is_hidden = 0 AND (s.type <> 'youtube' OR i.published_at >= ?)";

export interface CreateSourceRecord {
  type: SourceType;
  name: string;
  categoryId: string;
  config: Record<string, unknown>;
  intervalMinutes: number;
  isDemo?: boolean;
}

export function listSources(): SourceDto[] {
  const cutoff = youtubeFeedCutoffIso();
  const rows = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND ${VISIBLE_ITEM_FILTER}) AS item_count,
        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.is_read = 0 AND ${VISIBLE_ITEM_FILTER}) AS unread_count,
        (SELECT i.title FROM items i WHERE i.source_id = s.id AND ${VISIBLE_ITEM_FILTER}
          ORDER BY i.published_at DESC, i.id DESC LIMIT 1) AS latest_item_title,
        (SELECT i.published_at FROM items i WHERE i.source_id = s.id AND ${VISIBLE_ITEM_FILTER}
          ORDER BY i.published_at DESC, i.id DESC LIMIT 1) AS latest_item_published_at
       FROM sources s
       ORDER BY s.is_demo ASC, s.name ASC`
    )
    .all(cutoff, cutoff, cutoff, cutoff) as unknown as SourceWithStatsRow[];

  return rows.map((row) =>
    toSourceDto(row, { itemCount: Number(row.item_count), unreadCount: Number(row.unread_count) })
  );
}

export function getSource(id: string): SourceDto | null {
  const cutoff = youtubeFeedCutoffIso();
  const row = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND ${VISIBLE_ITEM_FILTER}) AS item_count,
        (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.is_read = 0 AND ${VISIBLE_ITEM_FILTER}) AS unread_count,
        (SELECT i.title FROM items i WHERE i.source_id = s.id AND ${VISIBLE_ITEM_FILTER}
          ORDER BY i.published_at DESC, i.id DESC LIMIT 1) AS latest_item_title,
        (SELECT i.published_at FROM items i WHERE i.source_id = s.id AND ${VISIBLE_ITEM_FILTER}
          ORDER BY i.published_at DESC, i.id DESC LIMIT 1) AS latest_item_published_at
       FROM sources s WHERE s.id = ?`
    )
    .get(cutoff, cutoff, cutoff, cutoff, id) as unknown as SourceWithStatsRow | undefined;

  if (!row) return null;
  return toSourceDto(row, { itemCount: Number(row.item_count), unreadCount: Number(row.unread_count) });
}

/** Lista mínima para acompanhar o refresh sem baixar o config de cada fonte. */
export function listSourceStatuses(): SourceStatusDto[] {
  const rows = db
    .prepare(
      `SELECT id, enabled, last_checked_at, next_run_at, last_error_code
       FROM sources
       ORDER BY name ASC`
    )
    .all() as unknown as Array<{
    id: string;
    enabled: number;
    last_checked_at: string | null;
    next_run_at: string | null;
    last_error_code: SourceErrorCode | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    enabled: row.enabled === 1,
    lastCheckedAt: row.last_checked_at,
    nextRunAt: row.next_run_at,
    lastErrorCode: row.last_error_code
  }));
}

export function getSourceRow(id: string): SourceRow | null {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as unknown as SourceRow | undefined;
  return row ?? null;
}

/** Localiza uma fonte já vinculada a um IMDB (para não duplicar na importação). */
export function findSourceByImdb(imdbId: string): SourceRow | null {
  const row = db
    .prepare(
      `SELECT * FROM sources
       WHERE json_extract(config, '$.imdbId') = ?
          OR json_extract(config, '$.imdbIdOverride') = ?
       LIMIT 1`
    )
    .get(imdbId, imdbId) as unknown as SourceRow | undefined;
  return row ?? null;
}

export function createSource(record: CreateSourceRecord): SourceDto {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO sources (id, type, name, category_id, config, state, enabled, interval_minutes,
       next_run_at, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?)`
  ).run(
    id,
    record.type,
    record.name,
    record.categoryId,
    JSON.stringify(record.config),
    record.intervalMinutes,
    now,
    record.isDemo ? 1 : 0,
    now,
    now
  );
  return getSource(id) as SourceDto;
}

export interface UpdateSourceRecord {
  name?: string;
  categoryId?: string;
  intervalMinutes?: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** Importa uma fonte de backup preservando o ID e o progresso salvo no config. */
export function importSource(record: {
  id: string;
  type: SourceType;
  name: string;
  categoryId: string;
  config: Record<string, unknown>;
  enabled: boolean;
  intervalMinutes: number;
}): { created: boolean } {
  const existing = getSourceRow(record.id);
  if (existing) {
    updateSource(record.id, {
      name: record.name,
      categoryId: record.categoryId,
      intervalMinutes: record.intervalMinutes,
      enabled: record.enabled,
      config: record.config
    });
    return { created: false };
  }

  const now = nowIso();
  db.prepare(
    `INSERT INTO sources (id, type, name, category_id, config, state, enabled, interval_minutes,
       next_run_at, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0, ?, ?)`
  ).run(
    record.id,
    record.type,
    record.name,
    record.categoryId,
    JSON.stringify(record.config),
    record.enabled ? 1 : 0,
    record.intervalMinutes,
    now,
    now
  );
  return { created: true };
}

export function updateSource(id: string, record: UpdateSourceRecord): SourceDto | null {
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (record.name !== undefined) {
    sets.push('name = ?');
    params.push(record.name);
  }
  if (record.categoryId !== undefined) {
    sets.push('category_id = ?');
    params.push(record.categoryId);
  }
  if (record.intervalMinutes !== undefined) {
    sets.push('interval_minutes = ?');
    params.push(record.intervalMinutes);
  }
  if (record.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(record.enabled ? 1 : 0);
  }
  if (record.config !== undefined) {
    sets.push('config = ?');
    params.push(JSON.stringify(record.config));
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(nowIso());
    db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }

  return getSource(id);
}

export function deleteSource(id: string): boolean {
  const result = db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

/** Remove várias fontes em uma única operação. */
export function deleteSources(ids: string[]): number {
  if (ids.length === 0) return 0;
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(', ');
  const result = db.prepare(`DELETE FROM sources WHERE id IN (${placeholders})`).run(...unique);
  return Number(result.changes);
}

/** Fontes habilitadas cujo horário já venceu. */
export function listDueSources(limit = 20): SourceRow[] {
  return db
    .prepare(
      `SELECT * FROM sources
       WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY next_run_at ASC
       LIMIT ?`
    )
    .all(nowIso(), limit) as unknown as SourceRow[];
}

export function listAllSourceRows(): SourceRow[] {
  return db.prepare('SELECT * FROM sources WHERE enabled = 1').all() as unknown as SourceRow[];
}

export function setNextRun(id: string, nextRunAt: string): void {
  db.prepare('UPDATE sources SET next_run_at = ?, updated_at = ? WHERE id = ?').run(nextRunAt, nowIso(), id);
}

export interface SuccessRecord {
  state: string;
  nextRunAt: string;
  checkedAt: string;
}

export function recordSuccess(id: string, record: SuccessRecord): void {
  db.prepare(
    `UPDATE sources SET
       state = ?, last_checked_at = ?, last_success_at = ?,
       last_error_at = NULL, last_error_code = NULL, last_error_message = NULL,
       consecutive_failures = 0, next_run_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(record.state, record.checkedAt, record.checkedAt, record.nextRunAt, nowIso(), id);
}

export interface FailureRecord {
  code: SourceErrorCode;
  message: string;
  nextRunAt: string;
  checkedAt: string;
  consecutiveFailures: number;
}

export function recordFailure(id: string, record: FailureRecord): void {
  db.prepare(
    `UPDATE sources SET
       last_checked_at = ?, last_error_at = ?, last_error_code = ?, last_error_message = ?,
       consecutive_failures = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    record.checkedAt,
    record.checkedAt,
    record.code,
    record.message.slice(0, 500),
    record.consecutiveFailures,
    record.nextRunAt,
    nowIso(),
    id
  );
}

export function startRun(sourceId: string, startedAt: string): number {
  const result = db
    .prepare('INSERT INTO source_runs (source_id, started_at, ok) VALUES (?, ?, 0)')
    .run(sourceId, startedAt);
  return Number(result.lastInsertRowid);
}

export function finishRun(
  id: number,
  data: {
    ok: boolean;
    itemsFound: number;
    itemsNew: number;
    errorCode?: SourceErrorCode | null;
    errorMessage?: string | null;
    durationMs: number;
  }
): void {
  db.prepare(
    `UPDATE source_runs SET finished_at = ?, ok = ?, items_found = ?, items_new = ?,
       error_code = ?, error_message = ?, duration_ms = ?
     WHERE id = ?`
  ).run(
    nowIso(),
    data.ok ? 1 : 0,
    data.itemsFound,
    data.itemsNew,
    data.errorCode ?? null,
    data.errorMessage ?? null,
    data.durationMs,
    id
  );
}

export function listRuns(sourceId: string, limit = 8): SourceRunDto[] {
  const rows = db
    .prepare('SELECT * FROM source_runs WHERE source_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(sourceId, limit) as unknown as SourceRunRow[];
  return rows.map(toRunDto);
}

export function countSources(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM sources').get() as { total: number };
  return Number(row.total);
}

export function countDemoSources(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM sources WHERE is_demo = 1').get() as { total: number };
  return Number(row.total);
}

export function deleteDemoSources(): number {
  const result = db.prepare('DELETE FROM sources WHERE is_demo = 1').run();
  return Number(result.changes);
}
