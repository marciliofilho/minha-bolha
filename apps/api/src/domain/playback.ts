import type { PlaybackProgressDto } from '@hub/shared';
import type { StremioPlaybackRow } from '../db/types';

export function toPlaybackProgressDto(row: StremioPlaybackRow): PlaybackProgressDto {
  const durationMs = row.duration_ms && row.duration_ms > 0 ? row.duration_ms : null;
  const progress = durationMs
    ? Math.min(1, Math.max(0, row.position_ms / durationMs))
    : 0;

  return {
    metaId: row.meta_id,
    type: row.meta_type === 'series' ? 'series' : 'movie',
    videoId: row.video_id,
    season: row.season,
    episode: row.episode,
    positionMs: row.position_ms,
    durationMs,
    addonId: row.addon_id,
    streamSignature: row.stream_signature,
    name: row.name ?? row.meta_id,
    poster: row.poster,
    backdrop: row.backdrop,
    year: row.year,
    progress,
    completed: row.completed === 1,
    updatedAt: row.updated_at
  };
}
