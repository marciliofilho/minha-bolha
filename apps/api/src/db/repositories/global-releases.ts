/** Repositório do calendário global (lançamentos independentes das fontes). */
import { randomUUID } from 'node:crypto';
import { db } from '../database';
import type { GlobalReleaseRow } from '../types';
import type { RawGlobalRelease } from '../../connectors/types';
import { nowIso } from '../../lib/dates';

export interface GlobalReleaseQuery {
  from: string;
  to: string;
  kinds?: string[];
}

/**
 * Substitui os lançamentos dos provedores que responderam com sucesso.
 * Se um provedor falhou, mantém os dados anteriores dele.
 */
export function replaceGlobalReleases(
  items: RawGlobalRelease[],
  providers: Array<'tmdb' | 'anilist'>
): { saved: number } {
  if (providers.length === 0) return { saved: 0 };
  const now = nowIso();
  const placeholders = providers.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO global_releases (
       id, external_key, provider, media_kind, title, original_title, poster_url,
       kind, release_date, release_time, release_at, timezone, region,
       season, episode, episode_title, url, imdb_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_key) DO UPDATE SET
       provider = excluded.provider,
       media_kind = excluded.media_kind,
       title = excluded.title,
       original_title = excluded.original_title,
       poster_url = excluded.poster_url,
       kind = excluded.kind,
       release_date = excluded.release_date,
       release_time = excluded.release_time,
       release_at = excluded.release_at,
       timezone = excluded.timezone,
       region = excluded.region,
       season = excluded.season,
       episode = excluded.episode,
       episode_title = excluded.episode_title,
       url = excluded.url,
       imdb_id = excluded.imdb_id,
       updated_at = excluded.updated_at`
  );

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM global_releases WHERE provider IN (${placeholders})`).run(...providers);
    let saved = 0;
    for (const item of items) {
      if (!providers.includes(item.provider)) continue;
      insert.run(
        randomUUID(),
        item.externalKey,
        item.provider,
        item.mediaKind,
        item.title,
        item.originalTitle ?? null,
        item.posterUrl ?? null,
        item.kind,
        item.releaseDate,
        item.releaseTime ?? null,
        item.releaseAt ?? null,
        item.timezone,
        item.region ?? null,
        item.season ?? null,
        item.episode ?? null,
        item.episodeTitle ?? null,
        item.url ?? null,
        item.imdbId ?? null,
        now
      );
      saved += 1;
    }
    db.exec('COMMIT');
    return { saved };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listGlobalReleases(query: GlobalReleaseQuery): GlobalReleaseRow[] {
  const where = ['release_date >= ?', 'release_date <= ?'];
  const params: string[] = [query.from, query.to];

  if (query.kinds && query.kinds.length > 0) {
    where.push(`media_kind IN (${query.kinds.map(() => '?').join(', ')})`);
    params.push(...query.kinds);
  }

  return db
    .prepare(
      `SELECT * FROM global_releases
       WHERE ${where.join(' AND ')}
       ORDER BY release_date ASC, COALESCE(release_time, '99:99') ASC, title ASC`
    )
    .all(...params) as unknown as GlobalReleaseRow[];
}

export function countGlobalReleases(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM global_releases').get() as { total: number };
  return Number(row.total);
}
