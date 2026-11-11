/** Repositório do feed: inserção com dedupe, paginação keyset e contadores. */
import { randomUUID } from 'node:crypto';
import { db } from '../database';
import {
  FAVORITES_TAB_ID,
  WATCH_LATER_TAB_ID,
  type CategoryCountDto,
  type FeedItemDto,
  type FeedPageDto
} from '@hub/shared';
import type { ItemWithSourceRow } from '../types';
import { toFeedItem, emptyCategoryCount } from '../mappers';
import { nowIso, feedCutoffIso } from '../../lib/dates';
import { getSettings } from './settings';
import type { RawItem } from '../../connectors/types';

export interface FeedQuery {
  tab?: string;
  sourceId?: string;
  cursor?: string;
  limit?: number;
}

interface CursorValue {
  publishedAt: string;
  id: string;
}

export function encodeCursor(publishedAt: string, id: string): string {
  return Buffer.from(`${publishedAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorValue | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator <= 0) return null;
    return { publishedAt: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

const insertStatement = db.prepare(`
  INSERT INTO items (
    id, source_id, external_id, dedupe_key, category_id, kind, title, url,
    thumbnail_url, description, author, published_at, discovered_at, meta
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(dedupe_key) DO NOTHING
`);

/**
 * Alertas de preço usam um item por jogo: quando o preço muda, o mesmo card é
 * atualizado (título, preço, data) em vez de criar duplicatas no feed.
 */
const upsertPriceStatement = db.prepare(`
  INSERT INTO items (
    id, source_id, external_id, dedupe_key, category_id, kind, title, url,
    thumbnail_url, description, author, published_at, discovered_at, meta
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(dedupe_key) DO UPDATE SET
    source_id = excluded.source_id,
    external_id = excluded.external_id,
    category_id = excluded.category_id,
    kind = excluded.kind,
    title = excluded.title,
    url = excluded.url,
    thumbnail_url = excluded.thumbnail_url,
    description = excluded.description,
    author = excluded.author,
    published_at = excluded.published_at,
    discovered_at = excluded.discovered_at,
    meta = excluded.meta,
    is_read = 0,
    read_at = NULL
`);

const selectIdByDedupe = db.prepare('SELECT id FROM items WHERE dedupe_key = ?');

/** Insere itens ignorando duplicatas; devolve os realmente novos. */
export interface InsertItemsResult {
  inserted: number;
  newItems: RawItem[];
  newItemIds: string[];
}

export function insertItems(
  sourceId: string,
  categoryId: string,
  items: RawItem[]
): InsertItemsResult {
  if (items.length === 0) return { inserted: 0, newItems: [], newItemIds: [] };
  const discoveredAt = nowIso();
  let inserted = 0;
  const newItems: RawItem[] = [];
  const newItemIds: string[] = [];

  db.exec('BEGIN');
  try {
    for (const item of items) {
      const id = randomUUID();
      const statement = item.kind === 'price_drop' ? upsertPriceStatement : insertStatement;
      const result = statement.run(
        id,
        sourceId,
        item.externalId ?? null,
        item.dedupeKey,
        categoryId,
        item.kind,
        item.title,
        item.url,
        item.thumbnailUrl ?? null,
        item.description ?? null,
        item.author ?? null,
        item.publishedAt,
        discoveredAt,
        item.meta ? JSON.stringify(item.meta) : null
      );
      if (Number(result.changes) > 0) {
        inserted++;
        newItems.push(item);
        const storedId =
          item.kind === 'price_drop'
            ? ((selectIdByDedupe.get(item.dedupeKey) as { id: string } | undefined)?.id ?? id)
            : id;
        newItemIds.push(storedId);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { inserted, newItems, newItemIds };
}

/** Payload das notificações SSE: item do feed + dados para abrir no player. */
export interface NewItemNotification {
  dedupeKey: string;
  id: string;
  title: string;
  kind: FeedItemDto['kind'];
  thumbnailUrl: string | null;
  meta: Record<string, unknown> | null;
  sourceName: string;
  sourceType: FeedItemDto['sourceType'];
  categoryId: string;
  url: string;
  publishedAt: string;
  imdbId: string | null;
  mediaKind: FeedItemDto['mediaKind'];
}

export function buildNewItemNotifications(
  result: InsertItemsResult,
  limit = 5
): NewItemNotification[] {
  const notifications: NewItemNotification[] = [];
  for (let index = 0; index < result.newItemIds.length && notifications.length < limit; index++) {
    const raw = result.newItems[index];
    const item = getItemWithSource(result.newItemIds[index]);
    if (!raw || !item) continue;
    notifications.push({
      dedupeKey: raw.dedupeKey,
      id: item.id,
      title: item.title,
      kind: item.kind,
      thumbnailUrl: item.thumbnailUrl,
      meta: item.meta,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      categoryId: item.categoryId,
      url: item.url,
      publishedAt: item.publishedAt,
      imdbId: item.imdbId,
      mediaKind: item.mediaKind
    });
  }
  return notifications;
}

interface NovelSourceRow {
  id: string;
  name: string;
  type: string;
  config: string;
  created_at: string;
  last_success_at: string | null;
  category_label: string;
}

/**
 * O Feed de Novels mostra uma card por novel, mesmo quando a novel ainda não
 * tem itens na página atual (ou ainda não sincronizou). Assim todas aparecem
 * já na primeira resposta, sem depender de outra consulta no cliente.
 */
function appendNovelSourceItems(items: FeedItemDto[]): FeedItemDto[] {
  const known = new Set(items.map((item) => item.sourceId));
  const sources = db
    .prepare(
      `SELECT s.id, s.name, s.type, s.config, s.created_at, s.last_success_at,
              c.label AS category_label
       FROM sources s
       JOIN categories c ON c.id = s.category_id
       WHERE s.category_id = 'novel' AND s.enabled = 1`
    )
    .all() as unknown as NovelSourceRow[];
  if (sources.length === 0) return [];

  // Último capítulo real de cada novel (uma linha por fonte, sem carregar
  // milhares de capítulos a cada abertura do Feed).
  const latestRows = db
    .prepare(
      `SELECT * FROM (
         SELECT i.*, s.name AS source_name, s.type AS source_type,
                c.label AS category_label,
                m.imdb_id AS media_imdb_id, m.kind AS media_kind,
                0 AS in_stremio_library,
                ROW_NUMBER() OVER (
                  PARTITION BY i.source_id
                  ORDER BY i.published_at DESC, i.id DESC
                ) AS row_number
         FROM items i
         JOIN sources s ON s.id = i.source_id
         JOIN categories c ON c.id = i.category_id
         LEFT JOIN media m ON m.id = json_extract(i.meta, '$.mediaId')
         WHERE i.category_id = 'novel' AND i.kind = 'chapter' AND i.is_hidden = 0
       )
       WHERE row_number = 1`
    )
    .all() as unknown as ItemWithSourceRow[];
  const latestBySource = new Map<string, ItemWithSourceRow>();
  for (const row of latestRows) {
    if (!latestBySource.has(row.source_id)) latestBySource.set(row.source_id, row);
  }

  const extra: FeedItemDto[] = [];
  for (const source of sources) {
    if (known.has(source.id)) continue;
    const latestRow = latestBySource.get(source.id);
    if (latestRow) {
      extra.push(toFeedItem(latestRow));
      continue;
    }

    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(source.config) as Record<string, unknown>;
    } catch {
      config = {};
    }
    const latest = config.latestChapter as
      | { id?: string; name?: string; index?: number | null; url?: string }
      | null
      | undefined;
    if (!latest?.url) continue;
    const title =
      typeof config.title === 'string' && config.title.trim()
        ? config.title.trim()
        : source.name;
    const coverUrl = typeof config.coverUrl === 'string' ? config.coverUrl : null;
    extra.push({
      id: `novel-source:${source.id}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type as FeedItemDto['sourceType'],
      categoryId: 'novel',
      categoryLabel: source.category_label,
      kind: 'chapter',
      title: latest.name || title,
      url: latest.url,
      thumbnailUrl: coverUrl,
      description: null,
      author: null,
      publishedAt: source.last_success_at ?? source.created_at,
      isRead: true,
      isFavorite: false,
      isWatchLater: false,
      meta: {
        bookId: config.bookId ?? null,
        bookTitle: title,
        chapterId: latest.id ?? null,
        chapterName: latest.name ?? null,
        chapterIndex: latest.index ?? null,
        chapterCount:
          typeof config.chapterCount === 'number' ? config.chapterCount : null,
        coverUrl
      },
      imdbId: null,
      mediaKind: null,
      inStremioLibrary: false
    });
  }
  return extra;
}

export function listFeed(query: FeedQuery): FeedPageDto {
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const cutoff = feedCutoffIso(getSettings().feedWindowHours);
  const where: string[] = [
    'i.is_hidden = 0',
    // YouTube e notícias: somente itens dentro da janela configurada.
    "((s.type <> 'youtube' AND i.category_id <> 'news') OR i.published_at >= ?)"
  ];
  const params: Array<string | number> = [cutoff];

  if (query.tab === FAVORITES_TAB_ID) {
    where.push('i.is_favorite = 1');
  } else if (query.tab === WATCH_LATER_TAB_ID) {
    where.push('i.is_watch_later = 1');
  } else if (query.tab && query.tab !== 'all') {
    where.push('i.category_id = ?');
    params.push(query.tab);
  }
  if (query.sourceId) {
    where.push('i.source_id = ?');
    params.push(query.sourceId);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      where.push('(i.published_at < ? OR (i.published_at = ? AND i.id < ?))');
      params.push(cursor.publishedAt, cursor.publishedAt, cursor.id);
    }
  }

  const sql = `
    SELECT i.*, s.name AS source_name, s.type AS source_type, c.label AS category_label,
           m.imdb_id AS media_imdb_id, m.kind AS media_kind,
           EXISTS (
             SELECT 1 FROM stremio_library l
             WHERE l.removed = 0 AND l.imdb_id = m.imdb_id
           ) OR EXISTS (
             SELECT 1 FROM stremio_library_state st
             WHERE st.in_library = 1 AND m.imdb_id IS NOT NULL AND st.meta_id = m.imdb_id
           ) AS in_stremio_library
    FROM items i
    JOIN sources s ON s.id = i.source_id
    JOIN categories c ON c.id = i.category_id
    LEFT JOIN media m ON m.id = json_extract(i.meta, '$.mediaId')
    WHERE ${where.join(' AND ')}
    ORDER BY i.published_at DESC, i.id DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params, limit + 1) as unknown as ItemWithSourceRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const feedItems = page.map(toFeedItem);
  const withNovels =
    (query.tab === 'novel' || query.tab === 'all') &&
    !query.cursor &&
    !query.sourceId
      ? [...feedItems, ...appendNovelSourceItems(feedItems)]
      : feedItems;

  return {
    items: withNovels,
    nextCursor: hasMore && last ? encodeCursor(last.published_at, last.id) : null
  };
}

/** Contadores de não lidos por aba, incluindo "Todos" e categorias vazias. */
export function getCategoryCounts(): CategoryCountDto[] {
  const cutoff = feedCutoffIso(getSettings().feedWindowHours);
  const grouped = db
    .prepare(
      `SELECT i.category_id, COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN i.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread,
              COALESCE(SUM(i.is_favorite), 0) AS favorites,
              COALESCE(SUM(CASE WHEN i.is_favorite = 1 AND i.is_read = 0 THEN 1 ELSE 0 END), 0) AS favorites_unread,
              COALESCE(SUM(i.is_watch_later), 0) AS later,
              COALESCE(SUM(CASE WHEN i.is_watch_later = 1 AND i.is_read = 0 THEN 1 ELSE 0 END), 0) AS later_unread
       FROM items i
       JOIN sources s ON s.id = i.source_id
       WHERE i.is_hidden = 0
         AND ((s.type <> 'youtube' AND i.category_id <> 'news') OR i.published_at >= ?)
       GROUP BY i.category_id`
    )
    .all(cutoff) as unknown as Array<{
    category_id: string;
    total: number;
    unread: number;
    favorites: number;
    favorites_unread: number;
    later: number;
    later_unread: number;
  }>;

  const map = new Map(grouped.map((row) => [row.category_id, row]));
  const categories = db
    .prepare('SELECT id, label FROM categories ORDER BY sort_order ASC, label ASC')
    .all() as unknown as Array<{ id: string; label: string }>;

  const counts: CategoryCountDto[] = categories.map((category) => {
    const row = map.get(category.id);
    if (!row) return emptyCategoryCount(category.id, category.label);
    return { id: category.id, label: category.label, unread: Number(row.unread), total: Number(row.total) };
  });

  const all: CategoryCountDto = {
    id: 'all',
    label: 'Todos',
    unread: counts.reduce((sum, item) => sum + item.unread, 0),
    total: counts.reduce((sum, item) => sum + item.total, 0)
  };

  const special = grouped.reduce(
    (totals, row) => ({
      favorites: totals.favorites + Number(row.favorites),
      favoritesUnread: totals.favoritesUnread + Number(row.favorites_unread),
      later: totals.later + Number(row.later),
      laterUnread: totals.laterUnread + Number(row.later_unread)
    }),
    { favorites: 0, favoritesUnread: 0, later: 0, laterUnread: 0 }
  );

  counts.push(
    {
      id: FAVORITES_TAB_ID,
      label: 'Favoritos',
      unread: special.favoritesUnread,
      total: special.favorites
    },
    {
      id: WATCH_LATER_TAB_ID,
      label: 'Ver depois',
      unread: special.laterUnread,
      total: special.later
    }
  );

  return [all, ...counts];
}

export function getItemWithSource(id: string): FeedItemDto | null {
  const row = db
    .prepare(
      `SELECT i.*, s.name AS source_name, s.type AS source_type, c.label AS category_label,
              m.imdb_id AS media_imdb_id, m.kind AS media_kind,
              EXISTS (
                SELECT 1 FROM stremio_library l
                WHERE l.removed = 0 AND l.imdb_id = m.imdb_id
              ) AS in_stremio_library
       FROM items i
       JOIN sources s ON s.id = i.source_id
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN media m ON m.id = json_extract(i.meta, '$.mediaId')
       WHERE i.id = ?`
    )
    .get(id) as unknown as ItemWithSourceRow | undefined;
  return row ? toFeedItem(row) : null;
}

export interface ItemFlags {
  isRead?: boolean;
  isFavorite?: boolean;
  isWatchLater?: boolean;
}

export function updateItemFlags(id: string, flags: ItemFlags): FeedItemDto | null {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];

  if (flags.isRead !== undefined) {
    sets.push('is_read = ?', 'read_at = ?');
    params.push(flags.isRead ? 1 : 0, flags.isRead ? nowIso() : null);
  }
  if (flags.isFavorite !== undefined) {
    sets.push('is_favorite = ?');
    params.push(flags.isFavorite ? 1 : 0);
  }
  if (flags.isWatchLater !== undefined) {
    sets.push('is_watch_later = ?');
    params.push(flags.isWatchLater ? 1 : 0);
  }

  if (sets.length === 0) return getItemWithSource(id);

  db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getItemWithSource(id);
}

export function markAllRead(tab: string, sourceId?: string): number {
  const where: string[] = ['is_read = 0', 'is_hidden = 0'];
  const params: string[] = [];

  if (tab === FAVORITES_TAB_ID) {
    where.push('is_favorite = 1');
  } else if (tab === WATCH_LATER_TAB_ID) {
    where.push('is_watch_later = 1');
  } else if (tab && tab !== 'all') {
    where.push('category_id = ?');
    params.push(tab);
  }
  if (sourceId) {
    where.push('source_id = ?');
    params.push(sourceId);
  }

  const result = db
    .prepare(`UPDATE items SET is_read = 1, read_at = ? WHERE ${where.join(' AND ')}`)
    .run(nowIso(), ...params);
  return Number(result.changes);
}

export function countItems(): { total: number; unread: number } {
  const row = db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM items')
    .get() as { total: number; unread: number };
  return { total: Number(row.total), unread: Number(row.unread) };
}
