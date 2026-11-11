/** Linhas do banco (snake_case) e mapeadores para DTOs (camelCase). */
import type { SourceErrorCode, SourceType } from '@hub/shared';

export interface SourceRow {
  id: string;
  type: SourceType;
  name: string;
  category_id: string;
  config: string;
  state: string | null;
  enabled: number;
  interval_minutes: number;
  next_run_at: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  label: string;
  icon: string;
  color: string;
  sort_order: number;
  is_system: number;
}

export interface ItemRow {
  id: string;
  source_id: string;
  external_id: string | null;
  dedupe_key: string;
  category_id: string;
  kind: string;
  title: string;
  url: string;
  thumbnail_url: string | null;
  description: string | null;
  author: string | null;
  published_at: string;
  discovered_at: string;
  is_read: number;
  read_at: string | null;
  is_favorite: number;
  is_watch_later: number;
  is_hidden: number;
  meta: string | null;
}

export interface ItemWithSourceRow extends ItemRow {
  source_name: string;
  source_type: SourceType;
  category_label: string;
  media_imdb_id: string | null;
  media_kind: string | null;
  in_stremio_library: number;
}

export interface SourceRunRow {
  id: number;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  ok: number;
  items_found: number;
  items_new: number;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

export interface SourceStatusUpdate {
  lastCheckedAt: string;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: SourceErrorCode | null;
  lastErrorMessage?: string | null;
  consecutiveFailures: number;
  nextRunAt: string;
  state?: string | null;
}

export interface MediaRow {
  id: string;
  source_id: string;
  provider: string;
  external_id: string;
  kind: string;
  title: string;
  original_title: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  year: number | null;
  status: string | null;
  total_seasons: number | null;
  next_episode_at: string | null;
  url: string | null;
  imdb_id: string | null;
  raw: string | null;
  fetched_at: string;
}

export interface ReleaseEventRow {
  id: string;
  media_id: string;
  external_key: string;
  kind: string;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  release_date: string;
  release_time: string | null;
  release_at: string | null;
  timezone: string;
  region: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventRow extends ReleaseEventRow {
  source_id: string;
  source_name: string;
  provider: string;
  media_kind: string;
  media_title: string;
  media_original_title: string | null;
  media_poster_url: string | null;
  media_url: string | null;
  media_imdb_id: string | null;
  in_stremio_library: number;
}

export interface StremioAccountRow {
  id: number;
  email: string | null;
  auth_key: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  expired: number;
  updated_at: string;
}

export interface StremioLibraryRow {
  meta_id: string;
  imdb_id: string | null;
  type: string;
  name: string;
  poster: string | null;
  video_id: string | null;
  season: number | null;
  episode: number | null;
  time_offset: number | null;
  duration: number | null;
  watched_video_id: string | null;
  last_watched_at: string | null;
  removed: number;
  temp: number;
  raw: string | null;
  updated_at: string;
}

export interface StremioLibraryStateRow {
  meta_id: string;
  is_favorite: number;
  is_watch_later: number;
  in_library: number;
  meta_type: string | null;
  name: string | null;
  poster: string | null;
  added_at: string | null;
  updated_at: string;
}

export interface StremioPlaybackRow {
  id: string;
  meta_id: string;
  meta_type: string;
  video_id: string;
  season: number | null;
  episode: number | null;
  position_ms: number;
  duration_ms: number | null;
  addon_id: string | null;
  stream_signature: string | null;
  name: string | null;
  poster: string | null;
  backdrop: string | null;
  year: number | null;
  completed: number;
  updated_at: string;
}

export interface StremioAddonRow {
  id: string;
  url_hash: string;
  transport_url_enc: string;
  addon_id: string | null;
  name: string;
  version: string | null;
  description: string | null;
  manifest_json: string;
  enabled: number;
  priority: number;
  last_test_at: string | null;
  last_test_ok: number | null;
  last_test_error: string | null;
  last_test_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface GlobalReleaseRow {
  id: string;
  external_key: string;
  provider: string;
  media_kind: string;
  title: string;
  original_title: string | null;
  poster_url: string | null;
  kind: string;
  release_date: string;
  release_time: string | null;
  release_at: string | null;
  timezone: string;
  region: string | null;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  url: string | null;
  imdb_id: string | null;
  updated_at: string;
}

export interface GameRow {
  id: string;
  appid: number;
  name: string;
  cover_url: string | null;
  header_url: string | null;
  currency: string;
  target_price_cents: number | null;
  steam_base_cents: number | null;
  steam_final_cents: number | null;
  steam_discount: number;
  current_official_cents: number | null;
  current_keyshop_cents: number | null;
  official_low_cents: number | null;
  keyshop_low_cents: number | null;
  is_at_low: number;
  in_wishlist: number;
  origin: string;
  priority: number | null;
  gg_url: string | null;
  is_demo: number;
  added_at: string;
  removed_at: string | null;
  metadata_fetched_at: string | null;
  last_price_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceHistoryRow {
  id: number;
  game_id: string;
  day: string;
  official_cents: number | null;
  keyshop_cents: number | null;
  currency: string | null;
}
