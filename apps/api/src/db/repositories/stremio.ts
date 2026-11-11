/** Repositório da conta e da biblioteca do Stremio. */
import { db } from '../database';
import type { StremioAccountRow, StremioLibraryRow, StremioLibraryStateRow } from '../types';
import type { RawStremioLibraryItem } from '../../connectors/types';
import { nowIso } from '../../lib/dates';

// ---------------------------------------------------------------------------
// Conta (token criptografado)
// ---------------------------------------------------------------------------

export function getStremioAccount(): StremioAccountRow | null {
  const row = db.prepare('SELECT * FROM stremio_account WHERE id = 1').get() as
    | StremioAccountRow
    | undefined;
  return row ?? null;
}

export function saveStremioAccount(email: string | null, authKeyEncrypted: string): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO stremio_account (id, email, auth_key, connected_at, last_sync_at, expired, updated_at)
     VALUES (1, ?, ?, ?, NULL, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       auth_key = excluded.auth_key,
       connected_at = excluded.connected_at,
       last_sync_at = NULL,
       expired = 0,
       updated_at = excluded.updated_at`
  ).run(email, authKeyEncrypted, now, now);
}

export function deleteStremioAccount(): void {
  db.prepare('DELETE FROM stremio_account WHERE id = 1').run();
}

export function markStremioExpired(): void {
  db.prepare('UPDATE stremio_account SET expired = 1, updated_at = ? WHERE id = 1').run(nowIso());
}

export function updateStremioLastSync(at: string): void {
  db.prepare('UPDATE stremio_account SET last_sync_at = ?, expired = 0, updated_at = ? WHERE id = 1').run(
    at,
    nowIso()
  );
}

// ---------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------

export function countStremioLibrary(): number {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM stremio_library WHERE removed = 0 AND temp = 0')
    .get() as { total: number };
  return Number(row.total);
}

/** Remove a biblioteca sincronizada (usado ao desconectar a conta). */
export function clearStremioLibrary(): void {
  db.prepare('DELETE FROM stremio_library').run();
  try {
    db.prepare('DELETE FROM stremio_library_state').run();
  } catch {
    // tabela criada pela migração 010; em instalações antigas pode não existir
  }
  // A cópia de rollback da migração 006 também contém dados pessoais.
  try {
    db.prepare('DELETE FROM stremio_library_legacy').run();
  } catch {
    // tabela legada pode não existir em instalações muito antigas
  }
}

export function listStremioLibraryRows(limit = 500): StremioLibraryRow[] {
  return db
    .prepare(
      `SELECT * FROM stremio_library
       WHERE removed = 0
       ORDER BY COALESCE(last_watched_at, '') DESC, name ASC
       LIMIT ?`
    )
    .all(limit) as unknown as StremioLibraryRow[];
}

export function searchStremioLibraryRows(query: string, limit = 60): StremioLibraryRow[] {
  const escaped = query.trim().replace(/[\\%_]/g, '\\$&');
  if (!escaped) return [];
  return db
    .prepare(
      `SELECT * FROM stremio_library
       WHERE removed = 0 AND temp = 0 AND name LIKE ? ESCAPE '\\'
       ORDER BY COALESCE(last_watched_at, '') DESC, name ASC
       LIMIT ?`
    )
    .all(`%${escaped}%`, limit) as unknown as StremioLibraryRow[];
}

export function getStremioLibraryRow(metaId: string): StremioLibraryRow | null {
  const row = db
    .prepare('SELECT * FROM stremio_library WHERE meta_id = ? AND removed = 0')
    .get(metaId) as unknown as StremioLibraryRow | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Estado local (favoritos e assistir depois)
// ---------------------------------------------------------------------------

export function listStremioLibraryStates(): StremioLibraryStateRow[] {
  return db
    .prepare('SELECT * FROM stremio_library_state')
    .all() as unknown as StremioLibraryStateRow[];
}

export function getStremioLibraryState(metaId: string): StremioLibraryStateRow | null {
  const row = db
    .prepare('SELECT * FROM stremio_library_state WHERE meta_id = ?')
    .get(metaId) as unknown as StremioLibraryStateRow | undefined;
  return row ?? null;
}

export interface StremioLibraryStatePatch {
  isFavorite?: boolean;
  isWatchLater?: boolean;
  inLibrary?: boolean;
  metaType?: string | null;
  name?: string | null;
  poster?: string | null;
}

/** Cria/atualiza as marcações locais sem tocar na conta do Stremio. */
export function setStremioLibraryState(
  metaId: string,
  patch: StremioLibraryStatePatch
): StremioLibraryStateRow {
  const flag = (value: boolean | undefined): number | null =>
    value === undefined ? null : value ? 1 : 0;
  const favorite = flag(patch.isFavorite);
  const watchLater = flag(patch.isWatchLater);
  const inLibrary = flag(patch.inLibrary);
  const metaType = patch.metaType ?? null;
  const name = patch.name ?? null;
  const poster = patch.poster ?? null;
  const now = nowIso();
  const addedAt = patch.inLibrary === true ? now : null;

  db.prepare(
    `INSERT INTO stremio_library_state (
       meta_id, is_favorite, is_watch_later, in_library, meta_type, name, poster,
       added_at, updated_at
     ) VALUES (?, COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0), ?, ?, ?, ?, ?)
     ON CONFLICT(meta_id) DO UPDATE SET
       is_favorite = COALESCE(?, is_favorite),
       is_watch_later = COALESCE(?, is_watch_later),
       in_library = COALESCE(?, in_library),
       meta_type = COALESCE(?, meta_type),
       name = COALESCE(?, name),
       poster = COALESCE(?, poster),
       added_at = COALESCE(?, added_at),
       updated_at = excluded.updated_at`
  ).run(
    metaId,
    favorite,
    watchLater,
    inLibrary,
    metaType,
    name,
    poster,
    addedAt,
    now,
    favorite,
    watchLater,
    inLibrary,
    metaType,
    name,
    poster,
    addedAt
  );

  return getStremioLibraryState(metaId) as StremioLibraryStateRow;
}

export function deleteStremioLibraryState(metaId: string): void {
  db.prepare('DELETE FROM stremio_library_state WHERE meta_id = ?').run(metaId);
}

export function syncStremioLibraryRows(items: RawStremioLibraryItem[]): { saved: number } {
  const now = nowIso();
  const statement = db.prepare(
    `INSERT INTO stremio_library (
       meta_id, imdb_id, type, name, poster, video_id, season, episode,
       time_offset, duration, watched_video_id, last_watched_at, removed, temp,
       raw, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(meta_id) DO UPDATE SET
       imdb_id = excluded.imdb_id,
       type = excluded.type,
       name = excluded.name,
       poster = excluded.poster,
       video_id = excluded.video_id,
       season = excluded.season,
       episode = excluded.episode,
       time_offset = excluded.time_offset,
       duration = excluded.duration,
       watched_video_id = excluded.watched_video_id,
       last_watched_at = excluded.last_watched_at,
       removed = excluded.removed,
       temp = excluded.temp,
       raw = excluded.raw,
       updated_at = excluded.updated_at`
  );

  db.exec('BEGIN');
  try {
    for (const item of items) {
      statement.run(
        item.metaId,
        item.imdbId,
        item.type,
        item.name,
        item.poster ?? null,
        item.videoId ?? null,
        item.season ?? null,
        item.episode ?? null,
        item.timeOffset ?? null,
        item.duration ?? null,
        item.watchedVideoId ?? null,
        item.lastWatchedAt ?? null,
        item.removed ? 1 : 0,
        item.temp ? 1 : 0,
        item.raw === undefined ? null : JSON.stringify(item.raw),
        now
      );
    }

    const ids = items.map((item) => item.metaId);
    if (ids.length === 0) {
      db.prepare('UPDATE stremio_library SET removed = 1, updated_at = ?').run(now);
    } else {
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(
        `UPDATE stremio_library SET removed = 1, updated_at = ?
         WHERE meta_id NOT IN (${placeholders})`
      ).run(now, ...ids);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { saved: items.length };
}
