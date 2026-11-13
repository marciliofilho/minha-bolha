/** Cliente HTTP tipado para a API local. */
import type {
  AddonCatalogGroupDto,
  AddonSearchResultDto,
  AddonCatalogPageDto,
  AddonImportResultDto,
  AddonTestSummaryDto,
  ArticleContentDto,
  BackupDocumentDto,
  BackupImportResultDto,
  BackupPreviewDto,
  BackupSection,
  CalendarResponseDto,
  CategoryCountDto,
  CategoryDefinition,
  ClearCachesResultDto,
  ClearNovelCacheResultDto,
  DatabaseOptimizeResultDto,
  FeedItemDto,
  FeedPageDto,
  GameDetailDto,
  GameSearchResultDto,
  GamesResponseDto,
  HealthDto,
  MediaSearchResultDto,
  NovelDetailsDto,
  NovelDownloadChapterDto,
  NovelDownloadAvailabilityDto,
  NovelDownloadJobDto,
  NovelOfflineBookDetailDto,
  NovelOfflineBookDto,
  NovelChapterContentDto,
  NovelProgressDto,
  PlaybackProgressDto,
  RefreshStateDto,
  ResolvedSourceDto,
  SecretId,
  SecretStatusDto,
  SettingsDto,
  SourceDto,
  SourceRunDto,
  StorageStatsDto,
  StremioAddonDto,
  StremioCardInfoDto,
  StremioEpisodesDto,
  StremioImportResultDto,
  StremioLibraryItemDto,
  StremioProbeDto,
  StremioServerStatusDto,
  StremioStatusDto,
  TitleDetailsDto,
  TitleStreamsDto,
  TitleSubtitlesDto,
  TorrentPrepareDto,
  TranslationDto,
  WishlistImportResultDto
} from '@hub/shared';
import { localizeApiMessage } from './api-errors';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface BrowserLiveState {
  url: string;
  title: string;
  screenshot: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type BrowserLiveInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; deltaY: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // A API é local e mutável; evita 304/cache intermediário em GETs.
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  });

  if (response.status === 204) return undefined as T;

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
        ? payload.code
        : undefined;
    const message =
      (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : null) ??
      (response.status === 502 || response.status === 503 || response.status === 504
        ? 'O servidor local não respondeu. Verifique se a API está rodando (npm run dev) e tente novamente.'
        : `Falha na requisição (HTTP ${response.status}).`);
    const details = payload && typeof payload === 'object' && 'details' in payload ? payload.details : undefined;
    throw new ApiError(
      localizeApiMessage(message, code, response.status),
      response.status,
      code,
      details
    );
  }

  return payload as T;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

export interface FeedParams {
  tab: string;
  sourceId?: string;
  cursor?: string;
  limit?: number;
}

export interface StatusResponse {
  refresh: RefreshStateDto;
  keys: { tmdb: boolean; steam: boolean; ggdeals: boolean };
  demo: boolean;
}

export const api = {
  // Feed
  feed: (params: FeedParams) =>
    request<FeedPageDto>(`/feed${query({ tab: params.tab, sourceId: params.sourceId, cursor: params.cursor, limit: params.limit ?? 30 })}`),
  counts: () => request<{ counts: CategoryCountDto[] }>('/feed/counts'),
  markAllRead: (body: { tab: string; sourceId?: string }) =>
    request<{ updated: number }>('/feed/mark-all-read', { method: 'POST', body: JSON.stringify(body) }),

  // Itens
  updateItem: (id: string, patch: Partial<Pick<FeedItemDto, 'isRead' | 'isFavorite' | 'isWatchLater'>>) =>
    request<FeedItemDto>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Fontes
  sources: () => request<{ sources: SourceDto[] }>('/sources'),
  resolveSource: (body: { type: string; input: string }) =>
    request<ResolvedSourceDto>('/sources/resolve', { method: 'POST', body: JSON.stringify(body) }),
  createSource: (body: {
    type: string;
    input: string;
    name?: string;
    categoryId: string;
    intervalMinutes?: number;
    imdbId?: string;
  }) => request<SourceDto>('/sources', { method: 'POST', body: JSON.stringify(body) }),
  updateSource: (
    id: string,
    body: {
      name?: string;
      categoryId?: string;
      intervalMinutes?: number;
      enabled?: boolean;
      input?: string;
      imdbId?: string;
    }
  ) => request<SourceDto>(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSource: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
  deleteSources: (ids: string[]) =>
    request<{ deleted: number }>('/sources/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids })
    }),
  refreshSource: (id: string) =>
    request<{ queued: boolean; reason?: 'cooldown'; retryAfterSeconds?: number }>(
      `/sources/${id}/refresh`,
      { method: 'POST' }
    ),
  sourceRuns: (id: string) => request<{ runs: SourceRunDto[] }>(`/sources/${id}/runs`),
  novelDetails: (id: string) => request<NovelDetailsDto>(`/sources/${id}/novel`),
  novelChapter: (url: string) =>
    request<NovelChapterContentDto>(`/novels/chapter?url=${encodeURIComponent(url)}`),
  novelChapterProgress: (url: string) =>
    request<{
      progress: {
        url: string;
        startedAt: string;
        finishedAt: string | null;
        attempts: Array<{
          label: string;
          status: 'trying' | 'ok' | 'failed';
          message: string | null;
        }>;
      } | null;
    }>(`/novels/chapter/progress?url=${encodeURIComponent(url)}`),
  startNovelDownload: (body: { title: string; chapters: NovelDownloadChapterDto[] }) =>
    request<NovelDownloadJobDto>('/novels/download', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  novelDownloadJob: (id: string) =>
    request<NovelDownloadJobDto>(`/novels/download/${encodeURIComponent(id)}`),
  novelDownloadStatus: (chapters: Array<{ url: string }>) =>
    request<NovelDownloadAvailabilityDto>('/novels/download/status', {
      method: 'POST',
      body: JSON.stringify({ chapters })
    }),
  retryNovelDownload: (id: string) =>
    request<NovelDownloadJobDto>(
      `/novels/download/${encodeURIComponent(id)}/retry`,
      { method: 'POST' }
    ),
  cancelNovelDownload: (id: string) =>
    request<NovelDownloadJobDto>(
      `/novels/download/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' }
    ),
  novelOfflineBooks: () => request<{ books: NovelOfflineBookDto[] }>('/novels/offline'),
  novelOfflineBook: (bookId: string) =>
    request<NovelOfflineBookDetailDto>(
      `/novels/offline/books/${encodeURIComponent(bookId)}`
    ),
  deleteNovelOfflineChapters: (urls: string[]) =>
    request<{ deleted: number }>('/novels/offline/delete', {
      method: 'POST',
      body: JSON.stringify({ urls })
    }),
  articleContent: (url: string) =>
    request<ArticleContentDto>(`/articles/content?url=${encodeURIComponent(url)}`),
  translate: (body: { text: string; target: string }) =>
    request<TranslationDto>('/translate', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  backupExport: (sections?: BackupSection[]) =>
    request<BackupDocumentDto>(
      `/backup/export${sections?.length ? `?include=${encodeURIComponent(sections.join(','))}` : ''}`
    ),
  backupPreview: (data: BackupDocumentDto) =>
    request<BackupPreviewDto>('/backup/preview', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  backupImport: (data: BackupDocumentDto) =>
    request<BackupImportResultDto>('/backup/import', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  setNovelProgress: (
    id: string,
    body: Pick<NovelProgressDto, 'chapterId' | 'chapterName'> & { chapterIndex?: number | null }
  ) => request<SourceDto>(`/sources/${id}/novel-progress`, { method: 'PUT', body: JSON.stringify(body) }),
  clearNovelProgress: (id: string) =>
    request<SourceDto>(`/sources/${id}/novel-progress`, { method: 'DELETE' }),

  // Categorias
  categories: () => request<{ categories: CategoryDefinition[] }>('/categories'),
  createCategory: (body: { label: string; icon?: string; color?: string }) =>
    request<CategoryDefinition>('/categories', { method: 'POST', body: JSON.stringify(body) }),

  // Mídia e calendário (fase 2)
  searchMedia: (provider: 'tmdb' | 'anilist', q: string) =>
    request<{ results: MediaSearchResultDto[] }>(`/media/search${query({ provider, q })}`),
  calendar: (params: { from: string; to: string; types?: string[]; scope?: 'global' | 'library' }) =>
    request<CalendarResponseDto>(
      `/calendar${query({
        from: params.from,
        to: params.to,
        types: params.types?.join(','),
        scope: params.scope
      })}`
    ),
  calendarSearch: (params: { q: string; scope: 'global' | 'library' }) =>
    request<CalendarResponseDto>(`/calendar/search${query(params)}`),
  refreshCalendar: () => request<{ queued: boolean }>('/calendar/refresh', { method: 'POST' }),

  // Jogos (fase 3)
  games: (params: { filter?: string; sort?: string; q?: string }) =>
    request<GamesResponseDto>(`/games${query(params)}`),
  game: (id: string) => request<GameDetailDto>(`/games/${id}`),
  gameSearch: (q: string) => request<{ results: GameSearchResultDto[] }>(`/games/search${query({ q })}`),
  importWishlist: (input: string) =>
    request<WishlistImportResultDto>('/games/import', { method: 'POST', body: JSON.stringify({ input }) }),
  addGame: (body: { appid: number; targetPriceCents?: number | null }) =>
    request<GameDetailDto>('/games', { method: 'POST', body: JSON.stringify(body) }),
  updateGame: (id: string, body: { targetPriceCents: number | null }) =>
    request<GameDetailDto>(`/games/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteGame: (id: string) => request<void>(`/games/${id}`, { method: 'DELETE' }),
  refreshGamePrice: (id: string) =>
    request<{ game: GameDetailDto; warnings: string[] }>(`/games/${id}/refresh-price`, { method: 'POST' }),

  // Configurações e sistema
  settings: () => request<SettingsDto>('/settings'),
  updateSettings: (patch: Partial<SettingsDto>) =>
    request<SettingsDto>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  storageStats: () => request<StorageStatsDto>('/system/storage'),
  clearCaches: () =>
    request<ClearCachesResultDto>('/system/storage/clear', { method: 'POST' }),
  clearNovelCache: () =>
    request<ClearNovelCacheResultDto>('/system/storage/clear-novels', { method: 'POST' }),
  optimizeDatabase: () =>
    request<DatabaseOptimizeResultDto>('/system/database/optimize', { method: 'POST' }),

  // Progresso local do player
  playbackProgress: (metaId: string, videoId: string) =>
    request<{ progress: PlaybackProgressDto | null }>(
      `/playback/progress${query({ metaId, videoId })}`
    ),
  playbackContinue: () =>
    request<{ items: PlaybackProgressDto[] }>('/playback/continue'),
  savePlaybackProgress: (body: {
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
    completed?: boolean;
  }) =>
    request<{ progress: PlaybackProgressDto }>('/playback/progress', {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
  clearPlaybackProgress: (metaId: string, videoId: string) =>
    request<void>(`/playback/progress${query({ metaId, videoId })}`, { method: 'DELETE' }),
  secrets: () => request<{ secrets: SecretStatusDto[] }>('/secrets'),
  setSecret: (id: SecretId, value: string) =>
    request<{ secrets: SecretStatusDto[] }>(`/secrets/${id}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  removeSecret: (id: SecretId) =>
    request<{ secrets: SecretStatusDto[] }>(`/secrets/${id}`, { method: 'DELETE' }),
  health: () => request<HealthDto>('/health'),
  browserCheck: (url: string) =>
    request<{ url: string; embeddable: boolean; reason: string | null; status: number | null }>(
      `/browser/check?url=${encodeURIComponent(url)}`
    ),
  browserLiveNavigate: (url: string) =>
    request<BrowserLiveState>('/browser/live/navigate', {
      method: 'POST',
      body: JSON.stringify({ url })
    }),
  browserLiveAction: (action: 'back' | 'forward' | 'reload') =>
    request<BrowserLiveState>('/browser/live/action', {
      method: 'POST',
      body: JSON.stringify({ action })
    }),
  browserLiveInput: (input: BrowserLiveInput) =>
    request<BrowserLiveState>('/browser/live/input', {
      method: 'POST',
      body: JSON.stringify(input)
    }),
  browserLiveFrame: () => request<BrowserLiveState>('/browser/live/frame'),
  browserLiveStop: () =>
    request<{ ok: boolean }>('/browser/live/stop', { method: 'POST' }),
  browserLiveReset: () =>
    request<{ ok: boolean }>('/browser/live/reset', { method: 'POST' }),
  status: () => request<StatusResponse>('/status'),
  refreshAll: () => request<{ queued: number; refresh: RefreshStateDto }>('/refresh', { method: 'POST' }),

  // Demonstração
  seedDemo: () => request<{ sources: number; items: number }>('/demo/seed', { method: 'POST' }),
  removeDemo: () => request<{ removed: number }>('/demo', { method: 'DELETE' }),

  // Stremio
  stremioStatus: () => request<StremioStatusDto>('/stremio/status'),
  stremioLibrary: (search?: string) =>
    request<{ items: StremioLibraryItemDto[]; status: StremioStatusDto }>(
      `/stremio/library${query({ search: search?.trim() || undefined })}`
    ),
  setStremioLibraryState: (
    metaId: string,
    patch: {
      isFavorite?: boolean;
      isWatchLater?: boolean;
      inLibrary?: boolean;
      type?: 'movie' | 'series';
      name?: string;
      poster?: string | null;
    }
  ) =>
    request<{
      metaId: string;
      isFavorite: boolean;
      isWatchLater: boolean;
      inLibrary: boolean;
    }>(`/stremio/library/${encodeURIComponent(metaId)}/state`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  stremioCardInfo: (items: Array<{ type: string; id: string; name?: string | null }>) =>
    request<{ items: StremioCardInfoDto[] }>('/stremio/card-info', {
      method: 'POST',
      body: JSON.stringify({ items })
    }),
  stremioTitle: (type: string, id: string, name?: string | null) =>
    request<TitleDetailsDto>(
      `/stremio/title/${encodeURIComponent(type)}/${encodeURIComponent(id)}${query({ name: name ?? undefined })}`
    ),
  stremioEpisodes: (type: string, id: string) =>
    request<StremioEpisodesDto>(
      `/stremio/title/${encodeURIComponent(type)}/${encodeURIComponent(id)}/episodes`
    ),
  stremioStreams: (params: {
    type: string;
    id: string;
    season?: number | null;
    episode?: number | null;
    videoId?: string | null;
    refresh?: boolean;
  }) =>
    request<TitleStreamsDto>(
      `/stremio/streams${query({
        type: params.type,
        id: params.id,
        season: params.season ?? undefined,
        episode: params.episode ?? undefined,
        videoId: params.videoId ?? undefined,
        refresh: params.refresh ? '1' : undefined
      })}`
    ),
  stremioServer: () => request<StremioServerStatusDto>('/stremio/server'),
  stremioSubtitles: (params: {
    type: string;
    id: string;
    season?: number | null;
    episode?: number | null;
    videoId?: string | null;
  }) =>
    request<TitleSubtitlesDto>(
      `/stremio/subtitles${query({
        type: params.type,
        id: params.id,
        season: params.season ?? undefined,
        episode: params.episode ?? undefined,
        videoId: params.videoId ?? undefined
      })}`
    ),
  stremioProbe: (url: string) =>
    request<StremioProbeDto>(`/stremio/probe${query({ url })}`),
  prepareTorrent: (body: {
    infoHash: string;
    fileIdx?: number | null;
    sources?: string[];
  }) =>
    request<TorrentPrepareDto>('/stremio/torrent/prepare', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  stremioLogin: (body: { email: string; password: string }) =>
    request<{ status: StremioStatusDto }>('/stremio/login', { method: 'POST', body: JSON.stringify(body) }),
  stremioAuthKey: (body: { authKey: string; email?: string }) =>
    request<{ status: StremioStatusDto }>('/stremio/auth-key', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  stremioDisconnect: () => request<StremioStatusDto>('/stremio/disconnect', { method: 'POST' }),
  stremioSync: () => request<{ queued: boolean }>('/stremio/sync', { method: 'POST' }),
  stremioImport: () => request<StremioImportResultDto>('/stremio/import', { method: 'POST' }),

  // Addons
  stremioAddons: () => request<{ addons: StremioAddonDto[] }>('/stremio/addons'),
  addStremioAddon: (url: string) =>
    request<{ addon: StremioAddonDto }>('/stremio/addons', {
      method: 'POST',
      body: JSON.stringify({ url })
    }),
  updateStremioAddon: (
    id: string,
    body: { url?: string; name?: string; enabled?: boolean; priority?: number }
  ) =>
    request<{ addon: StremioAddonDto }>(`/stremio/addons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    }),
  removeStremioAddon: (id: string) =>
    request<void>(`/stremio/addons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorderStremioAddons: (ids: string[]) =>
    request<{ addons: StremioAddonDto[] }>('/stremio/addons/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids })
    }),
  importStremioAddons: () =>
    request<AddonImportResultDto>('/stremio/addons/import', { method: 'POST' }),
  testStremioAddon: (id: string) =>
    request<{ summary: AddonTestSummaryDto }>(`/stremio/addons/${encodeURIComponent(id)}/test`, {
      method: 'POST'
    }),
  stremioAddonCatalogs: () =>
    request<{ catalogs: AddonCatalogGroupDto[] }>('/stremio/catalogs'),
  stremioAddonCatalog: (params: {
    addonId: string;
    type: string;
    catalogId: string;
    search?: string;
    skip?: number;
    genre?: string;
  }) => request<AddonCatalogPageDto>(`/stremio/catalog${query(params)}`),
  stremioSearch: (params: { query: string; type?: string }) =>
    request<AddonSearchResultDto>(`/stremio/search${query(params)}`)
};
