/** Utilitários de mapeamento banco → DTO. */
import type {
  CategoryCountDto,
  CategoryDefinition,
  FeedItemDto,
  GameDto,
  GameDetailDto,
  MediaKind,
  PricePointDto,
  ReleaseEventDto,
  SourceDto,
  SourceErrorCode,
  SourceRunDto,
  SourceType
} from '@hub/shared';
import type {
  CalendarEventRow,
  CategoryRow,
  GameRow,
  GlobalReleaseRow,
  ItemWithSourceRow,
  PriceHistoryRow,
  SourceRow,
  SourceRunRow
} from './types';
import { discountPercent } from '../lib/money';

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toFeedItem(row: ItemWithSourceRow): FeedItemDto {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceType: row.source_type,
    categoryId: row.category_id,
    categoryLabel: row.category_label,
    kind: row.kind as FeedItemDto['kind'],
    title: row.title,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    description: row.description,
    author: row.author,
    publishedAt: row.published_at,
    isRead: row.is_read === 1,
    isFavorite: row.is_favorite === 1,
    isWatchLater: row.is_watch_later === 1,
    meta: parseJson<Record<string, unknown> | null>(row.meta, null),
    imdbId: row.media_imdb_id ?? null,
    mediaKind: (row.media_kind as MediaKind | null) ?? null,
    inStremioLibrary: row.in_stremio_library === 1
  };
}

export function toSourceDto(
  row: SourceRow & { latest_item_title?: string | null; latest_item_published_at?: string | null },
  stats: { unreadCount: number; itemCount: number } = { unreadCount: 0, itemCount: 0 }
): SourceDto {
  return {
    id: row.id,
    type: row.type as SourceType,
    name: row.name,
    categoryId: row.category_id,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    nextRunAt: row.next_run_at,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastErrorAt: row.last_error_at,
    lastErrorCode: (row.last_error_code as SourceErrorCode | null) ?? null,
    lastErrorMessage: row.last_error_message,
    consecutiveFailures: row.consecutive_failures,
    isDemo: row.is_demo === 1,
    createdAt: row.created_at,
    unreadCount: stats.unreadCount,
    itemCount: stats.itemCount,
    latestItemTitle: row.latest_item_title ?? null,
    latestItemPublishedAt: row.latest_item_published_at ?? null
  };
}

export function toRunDto(row: SourceRunRow): SourceRunDto {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: row.ok === 1,
    itemsFound: row.items_found,
    itemsNew: row.items_new,
    errorCode: (row.error_code as SourceErrorCode | null) ?? null,
    errorMessage: row.error_message,
    durationMs: row.duration_ms
  };
}

export function toReleaseEventDto(row: CalendarEventRow): ReleaseEventDto {
  return {
    id: row.id,
    mediaId: row.media_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provider: row.provider as ReleaseEventDto['provider'],
    mediaKind: row.media_kind as ReleaseEventDto['mediaKind'],
    title: row.media_title,
    originalTitle: row.media_original_title,
    posterUrl: row.media_poster_url,
    episodeTitle: row.episode_title,
    kind: row.kind as ReleaseEventDto['kind'],
    season: row.season,
    episode: row.episode,
    releaseDate: row.release_date,
    releaseTime: row.release_time,
    releaseAt: row.release_at,
    timezone: row.timezone,
    region: row.region,
    url: row.url ?? row.media_url,
    imdbId: row.media_imdb_id ?? null,
    inStremioLibrary: row.in_stremio_library === 1
  };
}

export function toGlobalReleaseEventDto(row: GlobalReleaseRow): ReleaseEventDto {
  return {
    id: row.id,
    mediaId: row.id,
    sourceId: `global:${row.provider}`,
    sourceName: row.provider === 'anilist' ? 'AniList · exibições' : 'TMDB · lançamentos',
    provider: row.provider as ReleaseEventDto['provider'],
    mediaKind: row.media_kind as ReleaseEventDto['mediaKind'],
    title: row.title,
    originalTitle: row.original_title,
    posterUrl: row.poster_url,
    episodeTitle: row.episode_title,
    kind: row.kind as ReleaseEventDto['kind'],
    season: row.season,
    episode: row.episode,
    releaseDate: row.release_date,
    releaseTime: row.release_time,
    releaseAt: row.release_at,
    timezone: row.timezone,
    region: row.region,
    url: row.url,
    imdbId: row.imdb_id,
    inStremioLibrary: false
  };
}

export function toCategoryDto(row: CategoryRow): CategoryDefinition {
  return {
    id: row.id,
    label: row.label,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    isSystem: row.is_system === 1
  };
}

export function emptyCategoryCount(id: string, label: string): CategoryCountDto {
  return { id, label, unread: 0, total: 0 };
}

// ---------------------------------------------------------------------------
// Jogos (fase 3)
// ---------------------------------------------------------------------------

export function toPricePointDto(row: PriceHistoryRow): PricePointDto {
  return {
    day: row.day,
    officialCents: row.official_cents,
    keyshopCents: row.keyshop_cents
  };
}

export function toGameDto(row: GameRow, sparkline: PricePointDto[] = []): GameDto {
  return {
    id: row.id,
    appid: row.appid,
    name: row.name,
    coverUrl: row.cover_url,
    headerUrl: row.header_url,
    currency: row.currency,
    targetPriceCents: row.target_price_cents,
    steamBaseCents: row.steam_base_cents,
    steamFinalCents: row.steam_final_cents,
    steamDiscount: row.steam_discount,
    currentOfficialCents: row.current_official_cents,
    currentKeyshopCents: row.current_keyshop_cents,
    officialDiscount: discountPercent(row.current_official_cents, row.steam_base_cents),
    keyshopDiscount: discountPercent(row.current_keyshop_cents, row.steam_base_cents),
    officialLowCents: row.official_low_cents,
    keyshopLowCents: row.keyshop_low_cents,
    isAtLow: row.is_at_low === 1,
    inWishlist: row.in_wishlist === 1,
    origin: row.origin as GameDto['origin'],
    priority: row.priority,
    isDemo: row.is_demo === 1,
    ggUrl: row.gg_url,
    lastPriceCheckAt: row.last_price_check_at,
    addedAt: row.added_at,
    removedAt: row.removed_at,
    sparkline
  };
}

export function toGameDetailDto(row: GameRow, history: PricePointDto[]): GameDetailDto {
  return { ...toGameDto(row, history), history };
}
