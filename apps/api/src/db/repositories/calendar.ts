/** Repositório de eventos de lançamento/episódio usados pelo calendário. */
import { randomUUID } from 'node:crypto';
import { db } from '../database';
import type { CalendarEventRow, ReleaseEventRow } from '../types';
import type { RawReleaseEvent } from '../../connectors/types';
import { nowIso } from '../../lib/dates';

export interface CalendarQuery {
  from: string;
  to: string;
  kinds?: string[];
}

/**
 * Insere/atualiza eventos com chave estável e remove eventos futuros que
 * deixaram de existir na fonte (episódio remarcado, temporada adiada etc.).
 */
export function upsertReleaseEvents(mediaId: string, events: RawReleaseEvent[], today: string): number {
  const now = nowIso();
  const statement = db.prepare(
    `INSERT INTO release_events (
       id, media_id, external_key, kind, season, episode, episode_title,
       release_date, release_time, release_at, timezone, region, url, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_key) DO UPDATE SET
       media_id = excluded.media_id,
       kind = excluded.kind,
       season = excluded.season,
       episode = excluded.episode,
       episode_title = excluded.episode_title,
       release_date = excluded.release_date,
       release_time = excluded.release_time,
       release_at = excluded.release_at,
       timezone = excluded.timezone,
       region = excluded.region,
       url = excluded.url,
       updated_at = excluded.updated_at`
  );

  db.exec('BEGIN');
  try {
    for (const event of events) {
      statement.run(
        randomUUID(),
        mediaId,
        event.externalKey,
        event.kind,
        event.season ?? null,
        event.episode ?? null,
        event.episodeTitle ?? null,
        event.releaseDate,
        event.releaseTime ?? null,
        event.releaseAt ?? null,
        event.timezone,
        event.region ?? null,
        event.url ?? null,
        now,
        now
      );
    }

    // Só apaga eventos estritamente futuros: o histórico e o dia de hoje ficam.
    const keys = events.map((event) => event.externalKey);
    if (keys.length === 0) {
      db.prepare('DELETE FROM release_events WHERE media_id = ? AND release_date > ?').run(mediaId, today);
    } else {
      const placeholders = keys.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM release_events
         WHERE media_id = ? AND release_date > ? AND external_key NOT IN (${placeholders})`
      ).run(mediaId, today, ...keys);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return events.length;
}

export function listEventsForMedia(mediaId: string, from: string, to: string): ReleaseEventRow[] {
  return db
    .prepare(
      `SELECT * FROM release_events
       WHERE media_id = ? AND release_date >= ? AND release_date <= ?
       ORDER BY release_date ASC, COALESCE(release_time, '99:99') ASC`
    )
    .all(mediaId, from, to) as unknown as ReleaseEventRow[];
}

export function listCalendarEvents(query: CalendarQuery): CalendarEventRow[] {
  const where = ['e.release_date >= ?', 'e.release_date <= ?'];
  const params: string[] = [query.from, query.to];

  if (query.kinds && query.kinds.length > 0) {
    where.push(`m.kind IN (${query.kinds.map(() => '?').join(', ')})`);
    params.push(...query.kinds);
  }

  return db
    .prepare(
      `SELECT e.*, m.source_id, s.name AS source_name, m.provider, m.kind AS media_kind,
              m.title AS media_title, m.original_title AS media_original_title,
              m.poster_url AS media_poster_url, m.url AS media_url, m.imdb_id AS media_imdb_id,
              EXISTS (
                SELECT 1 FROM stremio_library l
                WHERE l.removed = 0 AND l.imdb_id = m.imdb_id
              ) OR EXISTS (
                SELECT 1 FROM stremio_library_state st
                WHERE st.in_library = 1 AND m.imdb_id IS NOT NULL AND st.meta_id = m.imdb_id
              ) AS in_stremio_library
       FROM release_events e
       JOIN media m ON m.id = e.media_id
       JOIN sources s ON s.id = m.source_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.release_date ASC, COALESCE(e.release_time, '99:99') ASC, m.title ASC`
    )
    .all(...params) as unknown as CalendarEventRow[];
}

export function countReleaseEvents(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM release_events').get() as { total: number };
  return Number(row.total);
}
