/** Cache persistente de novels: listas de capítulos e conteúdos. */
import { createHash } from 'node:crypto';
import { db } from '../database';
import { nowIso } from '../../lib/dates';

export type NovelCacheKind = 'details' | 'chapter';

export interface NovelCacheHit<T> {
  data: T;
  fetchedAt: string;
  expiresAt: string;
  expired: boolean;
}

export function novelDetailsCacheKey(sourceId: string, input: string): string {
  const hash = createHash('sha1').update(input).digest('hex').slice(0, 16);
  return `details:${sourceId}:${hash}`;
}

export function novelChapterCacheKey(url: string): string {
  return `chapter:${url}`;
}

export function getNovelCache<T>(cacheKey: string): NovelCacheHit<T> | null {
  const row = db
    .prepare('SELECT data, fetched_at, expires_at FROM novel_cache WHERE cache_key = ?')
    .get(cacheKey) as
    | { data: string; fetched_at: string; expires_at: string }
    | undefined;
  if (!row) return null;
  try {
    return {
      data: JSON.parse(row.data) as T,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      expired: Date.parse(row.expires_at) <= Date.now()
    };
  } catch {
    return null;
  }
}

export function setNovelCache(
  cacheKey: string,
  kind: NovelCacheKind,
  data: unknown,
  freshnessMs: number
): void {
  const fetchedAt = nowIso();
  const expiresAt = new Date(Date.now() + freshnessMs).toISOString();
  db.prepare(
    `INSERT INTO novel_cache (cache_key, kind, data, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       kind = excluded.kind,
       data = excluded.data,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`
  ).run(cacheKey, kind, JSON.stringify(data), fetchedAt, expiresAt);
}

export function getNovelCacheStats(): {
  entries: number;
  bytes: number;
  details: number;
  chapters: number;
} {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS entries,
              COALESCE(SUM(LENGTH(data)), 0) AS bytes,
              COALESCE(SUM(CASE WHEN kind = 'details' THEN 1 ELSE 0 END), 0) AS details,
              COALESCE(SUM(CASE WHEN kind = 'chapter' THEN 1 ELSE 0 END), 0) AS chapters
       FROM novel_cache`
    )
    .get() as { entries: number; bytes: number; details: number; chapters: number };
  return {
    entries: Number(row.entries),
    bytes: Number(row.bytes),
    details: Number(row.details),
    chapters: Number(row.chapters)
  };
}

export function getNovelChapterCacheStats(): { entries: number; bytes: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS entries, COALESCE(SUM(LENGTH(data)), 0) AS bytes
       FROM novel_cache WHERE kind = 'chapter'`
    )
    .get() as { entries: number; bytes: number };
  return { entries: Number(row.entries), bytes: Number(row.bytes) };
}

export function getNovelDetailsCacheStats(): { entries: number; bytes: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS entries, COALESCE(SUM(LENGTH(data)), 0) AS bytes
       FROM novel_cache WHERE kind = 'details'`
    )
    .get() as { entries: number; bytes: number };
  return { entries: Number(row.entries), bytes: Number(row.bytes) };
}

export function clearNovelCache(): { entries: number; bytes: number } {
  const before = getNovelCacheStats();
  db.prepare('DELETE FROM novel_cache').run();
  return { entries: before.entries, bytes: before.bytes };
}

export function clearNovelChapterCache(): { entries: number; bytes: number } {
  const before = getNovelChapterCacheStats();
  db.prepare("DELETE FROM novel_cache WHERE kind = 'chapter'").run();
  return before;
}

export function deleteNovelCache(cacheKey: string): void {
  db.prepare('DELETE FROM novel_cache WHERE cache_key = ?').run(cacheKey);
}

/** Atualiza um capítulo já cacheado (ex.: tradução antecipada). */
export function updateNovelChapterCache(
  cacheKey: string,
  patch: Record<string, unknown>,
  freshnessMs = 30 * 60_000
): boolean {
  const hit = getNovelCache<Record<string, unknown>>(cacheKey);
  if (!hit) return false;
  setNovelCache(cacheKey, 'chapter', { ...hit.data, ...patch }, freshnessMs);
  return true;
}

/** Remove entradas mais antigas que o período de retenção configurado. */
export function cleanupNovelCacheOlderThan(hours: number): number {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const result = db.prepare('DELETE FROM novel_cache WHERE fetched_at < ?').run(cutoff);
  return Number(result.changes);
}

/** Limpeza separada dos capítulos offline (retenção em dias). */
export function cleanupNovelChaptersOlderThan(days: number): number {
  const cutoff = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const result = db
    .prepare("DELETE FROM novel_cache WHERE kind = 'chapter' AND fetched_at < ?")
    .run(cutoff);
  return Number(result.changes);
}

/** Limpeza separada dos metadados/prévias (retenção em horas). */
export function cleanupNovelDetailsOlderThan(hours: number): number {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const result = db
    .prepare("DELETE FROM novel_cache WHERE kind = 'details' AND fetched_at < ?")
    .run(cutoff);
  return Number(result.changes);
}

export interface OfflineChapterRow {
  url: string;
  title: string;
  bookId: string | null;
  bytes: number;
  fetchedAt: string;
  translatedLanguage: string | null;
}

/** Todos os capítulos salvos no cache, com o livro deduzido da URL. */
export function listOfflineChapters(): OfflineChapterRow[] {
  const rows = db
    .prepare(
      `SELECT data, fetched_at, LENGTH(data) AS bytes
       FROM novel_cache WHERE kind = 'chapter'`
    )
    .all() as Array<{ data: string; fetched_at: string; bytes: number }>;

  const chapters: OfflineChapterRow[] = [];
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as {
        url?: string;
        title?: string;
        translatedLanguage?: string | null;
      };
      const url = data.url?.trim();
      if (!url) continue;
      chapters.push({
        url,
        title: data.title?.trim() || url,
        bookId: bookIdFromUrl(url),
        bytes: Number(row.bytes) || 0,
        fetchedAt: row.fetched_at,
        translatedLanguage: data.translatedLanguage ?? null
      });
    } catch {
      // entrada corrompida: ignora
    }
  }
  return chapters;
}

/** Índice/nome dos capítulos a partir das prévias salvas (para ordenar). */
export function offlineChapterIndex(): Map<string, { index: number | null; name: string | null }> {
  const map = new Map<string, { index: number | null; name: string | null }>();
  const rows = db
    .prepare("SELECT data FROM novel_cache WHERE kind = 'details'")
    .all() as Array<{ data: string }>;
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as {
        chapters?: Array<{ url?: string; name?: string; index?: number | null }>;
      };
      for (const chapter of data.chapters ?? []) {
        if (!chapter?.url) continue;
        map.set(chapter.url, {
          index: typeof chapter.index === 'number' ? chapter.index : null,
          name: chapter.name?.trim() || null
        });
      }
    } catch {
      // prévia inválida
    }
  }
  return map;
}

export function bookIdFromUrl(url: string): string | null {
  try {
    const match = /\/book\/(\d+)/i.exec(url);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Slug do livro em URLs como /book/<slug>_<id> ou /novel/<slug>. */
export function novelSlugFromUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => part === 'book' || part === 'novel');
    const slug = index >= 0 ? parts[index + 1] : null;
    return slug ? slug.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Chave que agrupa capítulos e fontes da mesma novel. */
export function novelBookKey(url: string): string {
  const bookId = bookIdFromUrl(url);
  if (bookId) return `book:${bookId}`;
  const slug = novelSlugFromUrl(url);
  if (slug) return `slug:${slug}`;
  try {
    return `host:${new URL(url).hostname}`;
  } catch {
    return 'outros';
  }
}

/** Apaga o cache de capítulos e a prévia de uma fonte removida. */
export function deleteNovelCacheForSource(sourceId: string, rawUrl: string): number {
  let deleted = 0;
  const details = db
    .prepare('DELETE FROM novel_cache WHERE cache_key LIKE ?')
    .run(`details:${sourceId}:%`);
  deleted += Number(details.changes);

  const key = rawUrl ? novelBookKey(rawUrl) : null;
  if (key) {
    const statement = db.prepare('DELETE FROM novel_cache WHERE cache_key = ?');
    for (const chapter of listOfflineChapters()) {
      if (novelBookKey(chapter.url) === key) {
        deleted += Number(statement.run(novelChapterCacheKey(chapter.url)).changes);
      }
    }
  }
  return deleted;
}

/** Remove capítulos cuja novel não existe mais entre as fontes. */
export function pruneOrphanNovelChapters(validKeys: Set<string>): number {
  let deleted = 0;
  const statement = db.prepare('DELETE FROM novel_cache WHERE cache_key = ?');
  for (const chapter of listOfflineChapters()) {
    if (validKeys.has(novelBookKey(chapter.url))) continue;
    deleted += Number(statement.run(novelChapterCacheKey(chapter.url)).changes);
  }
  return deleted;
}

export function deleteNovelChapters(urls: string[]): number {
  let deleted = 0;
  const statement = db.prepare('DELETE FROM novel_cache WHERE cache_key = ?');
  for (const url of urls) {
    if (!url) continue;
    const result = statement.run(novelChapterCacheKey(url));
    deleted += Number(result.changes);
  }
  return deleted;
}
