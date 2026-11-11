/** Repositório dos títulos acompanhados (TMDB/AniList). */
import { randomUUID } from 'node:crypto';
import { db } from '../database';
import type { MediaRow } from '../types';
import type { RawMedia } from '../../connectors/types';
import { nowIso } from '../../lib/dates';

export function findMediaByExternal(provider: string, externalId: string): MediaRow | null {
  const row = db
    .prepare('SELECT * FROM media WHERE provider = ? AND external_id = ?')
    .get(provider, externalId) as unknown as MediaRow | undefined;
  return row ?? null;
}

export function getMediaBySource(sourceId: string): MediaRow | null {
  const row = db.prepare('SELECT * FROM media WHERE source_id = ?').get(sourceId) as unknown as MediaRow | undefined;
  return row ?? null;
}

export function findMediaByImdb(imdbId: string): MediaRow | null {
  const row = db.prepare('SELECT * FROM media WHERE imdb_id = ? LIMIT 1').get(imdbId) as unknown as
    | MediaRow
    | undefined;
  return row ?? null;
}

export function getMediaById(id: string): MediaRow | null {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow | undefined;
  return row ?? null;
}

/** Cria ou atualiza o título vinculado a uma fonte (1:1). */
export function upsertMedia(sourceId: string, raw: RawMedia): MediaRow {
  const now = nowIso();
  const existing = getMediaBySource(sourceId);
  const imdbId = raw.imdbId ?? existing?.imdb_id ?? null;

  const values = [
    raw.provider,
    raw.externalId,
    raw.kind,
    raw.title,
    raw.originalTitle ?? null,
    raw.posterUrl ?? null,
    raw.backdropUrl ?? null,
    raw.year ?? null,
    raw.status ?? null,
    raw.totalSeasons ?? null,
    raw.nextEpisodeAt ?? null,
    raw.url ?? null,
    imdbId,
    raw.raw === undefined ? null : JSON.stringify(raw.raw),
    now
  ] as const;

  if (existing) {
    db.prepare(
      `UPDATE media SET provider = ?, external_id = ?, kind = ?, title = ?, original_title = ?,
         poster_url = ?, backdrop_url = ?, year = ?, status = ?, total_seasons = ?,
         next_episode_at = ?, url = ?, imdb_id = ?, raw = ?, fetched_at = ?
       WHERE id = ?`
    ).run(...values, existing.id);
    return getMediaBySource(sourceId) as MediaRow;
  }

  // A constraint UNIQUE(provider, external_id) impede acompanhar o mesmo título
  // duas vezes; a rota de criação já valida isso com uma mensagem amigável.
  db.prepare(
    `INSERT INTO media (id, source_id, provider, external_id, kind, title, original_title,
       poster_url, backdrop_url, year, status, total_seasons, next_episode_at, url,
       imdb_id, raw, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), sourceId, ...values);

  return getMediaBySource(sourceId) as MediaRow;
}
