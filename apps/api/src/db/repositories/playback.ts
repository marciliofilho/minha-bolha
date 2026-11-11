/** Progresso local de reprodução (nunca gravado na conta do Stremio). */
import { db } from '../database';
import type { StremioPlaybackRow } from '../types';
import { nowIso } from '../../lib/dates';

function playbackId(metaId: string, videoId: string): string {
  return `${metaId}::${videoId}`;
}

export function getPlaybackRow(metaId: string, videoId: string): StremioPlaybackRow | null {
  const row = db
    .prepare('SELECT * FROM stremio_playback WHERE meta_id = ? AND video_id = ?')
    .get(metaId, videoId) as unknown as StremioPlaybackRow | undefined;
  return row ?? null;
}

export function listPlaybackRows(limit = 20): StremioPlaybackRow[] {
  return db
    .prepare(
      `SELECT * FROM stremio_playback
       WHERE completed = 0 AND position_ms > 5000
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit) as unknown as StremioPlaybackRow[];
}

export interface PlaybackUpsertInput {
  metaId: string;
  type: 'movie' | 'series';
  videoId: string;
  season?: number | null;
  episode?: number | null;
  positionMs: number;
  durationMs?: number | null;
  addonId?: string | null;
  streamSignature?: string | null;
  name: string;
  poster?: string | null;
  backdrop?: string | null;
  year?: number | null;
  completed: boolean;
}

export function upsertPlaybackRow(input: PlaybackUpsertInput): StremioPlaybackRow {
  const now = nowIso();
  db.prepare(
    `INSERT INTO stremio_playback (
       id, meta_id, meta_type, video_id, season, episode, position_ms, duration_ms,
       addon_id, stream_signature, name, poster, backdrop, year, completed, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(meta_id, video_id) DO UPDATE SET
       meta_type = excluded.meta_type,
       season = excluded.season,
       episode = excluded.episode,
       position_ms = excluded.position_ms,
       duration_ms = excluded.duration_ms,
       addon_id = excluded.addon_id,
       stream_signature = excluded.stream_signature,
       name = excluded.name,
       poster = excluded.poster,
       backdrop = excluded.backdrop,
       year = excluded.year,
       completed = excluded.completed,
       updated_at = excluded.updated_at`
  ).run(
    playbackId(input.metaId, input.videoId),
    input.metaId,
    input.type,
    input.videoId,
    input.season ?? null,
    input.episode ?? null,
    Math.max(0, Math.round(input.positionMs)),
    input.durationMs && input.durationMs > 0 ? Math.round(input.durationMs) : null,
    input.addonId ?? null,
    input.streamSignature ?? null,
    input.name,
    input.poster ?? null,
    input.backdrop ?? null,
    input.year ?? null,
    input.completed ? 1 : 0,
    now
  );

  const row = getPlaybackRow(input.metaId, input.videoId);
  if (!row) throw new Error('Não foi possível salvar o progresso.');
  return row;
}

export function deletePlaybackRow(metaId: string, videoId: string): void {
  db.prepare('DELETE FROM stremio_playback WHERE meta_id = ? AND video_id = ?').run(
    metaId,
    videoId
  );
}
