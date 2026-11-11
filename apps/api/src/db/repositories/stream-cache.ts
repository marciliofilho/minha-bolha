/** Cache persistente dos streams normalizados por addon/título. */
import { db } from '../database';

export interface StreamCacheRow {
  addon_key: string;
  meta_type: string;
  video_id: string;
  streams_json: string;
  cached_at: string;
  expires_at: string;
}

export function getStreamCacheRow(
  addonKey: string,
  type: string,
  videoId: string
): StreamCacheRow | null {
  const row = db
    .prepare(
      `SELECT * FROM stream_cache
       WHERE addon_key = ? AND meta_type = ? AND video_id = ?`
    )
    .get(addonKey, type, videoId) as unknown as StreamCacheRow | undefined;
  return row ?? null;
}

export function saveStreamCacheRow(input: {
  addonKey: string;
  type: string;
  videoId: string;
  streamsJson: string;
  cachedAt: string;
  expiresAt: string;
}): void {
  db.prepare(
    `INSERT INTO stream_cache (
       addon_key, meta_type, video_id, streams_json, cached_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(addon_key, meta_type, video_id) DO UPDATE SET
       streams_json = excluded.streams_json,
       cached_at = excluded.cached_at,
       expires_at = excluded.expires_at`
  ).run(
    input.addonKey,
    input.type,
    input.videoId,
    input.streamsJson,
    input.cachedAt,
    input.expiresAt
  );
}

export function deleteStreamCacheRow(addonKey: string, type: string, videoId: string): void {
  db.prepare(
    `DELETE FROM stream_cache WHERE addon_key = ? AND meta_type = ? AND video_id = ?`
  ).run(addonKey, type, videoId);
}

export function deleteOldStreamCache(cutoffIso: string): void {
  db.prepare('DELETE FROM stream_cache WHERE cached_at < ?').run(cutoffIso);
}

/** Mantém as entradas mais recentes para o cache não crescer sem limite. */
export function pruneStreamCache(maxRows = 600): void {
  db.prepare(
    `DELETE FROM stream_cache
     WHERE rowid NOT IN (
       SELECT rowid FROM stream_cache ORDER BY cached_at DESC LIMIT ?
     )`
  ).run(maxRows);
}
