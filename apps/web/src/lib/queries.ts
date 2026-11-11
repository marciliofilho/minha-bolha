/** Hooks de dados (TanStack Query) compartilhados pelas telas. */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
  type InfiniteData,
  type QueryKey
} from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { FAVORITES_TAB_ID, WATCH_LATER_TAB_ID } from '@hub/shared';
import type {
  AddonCatalogGroupDto,
  AddonCatalogPageDto,
  AddonSearchResultDto,
  CategoryDefinition,
  FeedItemDto,
  FeedPageDto,
  GameDto,
  GameFilter,
  GameSort,
  MediaKind,
  NovelDownloadJobDto,
  NovelOfflineBookDetailDto,
  NovelOfflineBookDto,
  PlaybackProgressDto,
  SecretId,
  SettingsDto,
  StremioCardInfoDto,
  StremioLibraryItemDto,
  StremioProbeDto,
  StremioStatusDto,
  TitleDetailsDto
} from '@hub/shared';
import { api, type StatusResponse } from './api';
import type { BridgeCookie } from '@/types/electron';

export const FALLBACK_SETTINGS: SettingsDto = {
  theme: 'dark',
  language: 'pt',
  introEnabled: true,
  introAudio: true,
  defaultIntervalMinutes: 30,
  feedRefreshSeconds: 300,
  hoverPreviewSeconds: 3,
  feedWindowHours: 48,
  novelCacheRetentionHours: 168,
  novelCacheCleanupHours: 6,
  novelChaptersOffline: true,
  novelOfflineRetentionDays: 7,
  timezone: 'America/Sao_Paulo',
  region: 'BR',
  currency: 'BRL',
  streamCacheTtlHours: 24,
  torrentCacheRetentionDays: 7,
  autoMaintenanceEnabled: true,
  playerSkipSeconds: 10,
  subtitleLanguage: 'por',
  subtitleFontSize: 22,
  subtitleColor: '#ffffff',
  subtitleBackgroundColor: '#000000',
  subtitleBackgroundOpacity: 65,
  subtitleLineHeight: 1.32,
  subtitlePosition: 85
};

export type FeedData = InfiniteData<FeedPageDto, string | null>;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function useFeed(tab: string, sourceId?: string) {
  return useInfiniteQuery({
    queryKey: ['feed', tab, sourceId ?? 'all'],
    queryFn: ({ pageParam }) =>
      api.feed({ tab, sourceId, cursor: pageParam ?? undefined, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 20_000,
    // Evita reler todas as páginas carregadas só porque a janela ganhou foco.
    refetchOnWindowFocus: false
  });
}

export function useCounts() {
  return useQuery({
    queryKey: ['counts'],
    queryFn: async () => (await api.counts()).counts,
    staleTime: 30_000
  });
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: async () => (await api.sources()).sources,
    staleTime: 20_000
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.categories()).categories,
    staleTime: 5 * 60_000
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings(),
    staleTime: 60_000
  });
}

export function usePlaybackContinue() {
  return useQuery({
    queryKey: ['playback-continue'],
    queryFn: () => api.playbackContinue(),
    staleTime: 15_000
  });
}

/** Remove um item de "Continuar assistindo" (apaga só o progresso local). */
export function useClearPlaybackProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { metaId: string; videoId: string }) =>
      api.clearPlaybackProgress(input.metaId, input.videoId),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['playback-continue'] });
      const previous = queryClient.getQueryData<{ items: PlaybackProgressDto[] }>([
        'playback-continue'
      ]);
      queryClient.setQueryData<{ items: PlaybackProgressDto[] }>(
        ['playback-continue'],
        (data) =>
          data
            ? {
                ...data,
                items: data.items.filter(
                  (item) =>
                    item.metaId !== input.metaId || item.videoId !== input.videoId
                )
              }
            : data
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['playback-continue'], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['playback-continue'] });
    }
  });
}

export function useStorageStats(enabled = true) {
  return useQuery({
    queryKey: ['storage-stats'],
    queryFn: () => api.storageStats(),
    enabled,
    staleTime: 30_000,
    retry: false
  });
}

export function useClearCaches() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearCaches(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['playback-continue'] });
    }
  });
}

const NOVEL_DOWNLOAD_JOB_KEY = 'hub.novelDownload.jobId';
let novelDownloadJobId: string | null = null;
let novelDownloadInitialized = false;
const novelDownloadListeners = new Set<() => void>();

function readNovelDownloadJobId(): string | null {
  try {
    return window.localStorage.getItem(NOVEL_DOWNLOAD_JOB_KEY);
  } catch {
    return null;
  }
}

function novelDownloadSnapshot(): string | null {
  if (!novelDownloadInitialized) {
    novelDownloadJobId = readNovelDownloadJobId();
    novelDownloadInitialized = true;
  }
  return novelDownloadJobId;
}

function subscribeNovelDownload(listener: () => void): () => void {
  novelDownloadListeners.add(listener);
  return () => novelDownloadListeners.delete(listener);
}

export function setNovelDownloadJobId(id: string | null): void {
  novelDownloadJobId = id;
  novelDownloadInitialized = true;
  try {
    if (id) window.localStorage.setItem(NOVEL_DOWNLOAD_JOB_KEY, id);
    else window.localStorage.removeItem(NOVEL_DOWNLOAD_JOB_KEY);
  } catch {
    // Armazenamento indisponível.
  }
  for (const listener of novelDownloadListeners) listener();
}

export function useNovelDownloadJobId(): string | null {
  return useSyncExternalStore(
    subscribeNovelDownload,
    novelDownloadSnapshot,
    () => null
  );
}

export function useNovelDownloadJob() {
  const jobId = useNovelDownloadJobId();
  return useQuery({
    queryKey: ['novel-download-job', jobId],
    queryFn: () => api.novelDownloadJob(jobId as string),
    enabled: Boolean(jobId),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 1000 : false
  });
}

export function useStartNovelDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      chapters: Array<{ url: string; name?: string; index?: number | null }>;
    }) => api.startNovelDownload(body),
    onSuccess: (job) => {
      queryClient.setQueryData<NovelDownloadJobDto>(
        ['novel-download-job', job.id],
        job
      );
      setNovelDownloadJobId(job.id);
      void queryClient.invalidateQueries({ queryKey: ['storage-stats'] });
    }
  });
}

export function useRetryNovelDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.retryNovelDownload(id),
    onSuccess: (job) => {
      queryClient.setQueryData<NovelDownloadJobDto>(
        ['novel-download-job', job.id],
        job
      );
      setNovelDownloadJobId(job.id);
    }
  });
}

export function clearNovelDownloadJob(): void {
  setNovelDownloadJobId(null);
}

export function useCancelNovelDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelNovelDownload(id),
    onSuccess: (job) => {
      queryClient.setQueryData<NovelDownloadJobDto>(
        ['novel-download-job', job.id],
        job
      );
    }
  });
}

export function useNovelOfflineBooks(enabled = true) {
  return useQuery({
    queryKey: ['novel-offline-books'],
    queryFn: () => api.novelOfflineBooks(),
    enabled,
    staleTime: 15_000
  });
}

export function useNovelOfflineBook(bookId: string | null) {
  return useQuery({
    queryKey: ['novel-offline-book', bookId],
    queryFn: () => api.novelOfflineBook(bookId as string),
    enabled: Boolean(bookId),
    staleTime: 15_000
  });
}

export function useDeleteNovelOfflineChapters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (urls: string[]) => api.deleteNovelOfflineChapters(urls),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['novel-offline-books'] });
      void queryClient.invalidateQueries({ queryKey: ['novel-offline-book'] });
      void queryClient.invalidateQueries({ queryKey: ['novel-download-status'] });
      void queryClient.invalidateQueries({ queryKey: ['storage-stats'] });
    }
  });
}

export function useClearNovelCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearNovelCache(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage-stats'] });
    }
  });
}

export function useOptimizeDatabase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.optimizeDatabase(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage-stats'] });
    }
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    staleTime: 30_000
  });
}

export function useRefreshState() {
  return useQuery({
    queryKey: ['refresh-state'],
    queryFn: async () => (await api.status()).refresh,
    initialData: { active: 0, queued: 0 },
    staleTime: 10_000,
    refetchOnWindowFocus: true
  });
}

export function useStatus() {
  return useQuery<StatusResponse>({
    queryKey: ['status'],
    queryFn: () => api.status(),
    staleTime: 60_000
  });
}

export function useSecrets() {
  return useQuery({
    queryKey: ['secrets'],
    queryFn: async () => (await api.secrets()).secrets,
    staleTime: 60_000
  });
}

function invalidateKeyConsumers(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['status'] });
  void queryClient.invalidateQueries({ queryKey: ['health'] });
  void queryClient.invalidateQueries({ queryKey: ['sources'] });
  void queryClient.invalidateQueries({ queryKey: ['games'] });
}

export function useSetSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: SecretId; value: string }) => api.setSecret(id, value),
    onSuccess: (data) => {
      queryClient.setQueryData(['secrets'], data.secrets);
      invalidateKeyConsumers(queryClient);
    }
  });
}

export function useDeleteSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: SecretId) => api.removeSecret(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['secrets'], data.secrets);
      invalidateKeyConsumers(queryClient);
    }
  });
}

export function useStremioStatus() {
  return useQuery({
    queryKey: ['stremio-status'],
    queryFn: () => api.stremioStatus(),
    staleTime: 30_000
  });
}

export function useStremioLibrary(enabled = true) {
  return useQuery({
    queryKey: ['stremio-library'],
    queryFn: () => api.stremioLibrary(),
    enabled,
    staleTime: 30_000
  });
}

export function useStremioLibrarySearch(query: string, enabled = true) {
  const normalized = query.trim();
  return useQuery({
    queryKey: ['stremio-library-search', normalized],
    queryFn: () => api.stremioLibrary(normalized),
    enabled: enabled && normalized.length > 0,
    staleTime: 60_000,
    retry: false
  });
}

export interface StremioLibraryStatePatch {
  isFavorite?: boolean;
  isWatchLater?: boolean;
  inLibrary?: boolean;
  type?: 'movie' | 'series';
  name?: string;
  poster?: string | null;
}

/** Favoritar/ver depois/salvar na biblioteca local, sem alterar o Stremio. */
export function useSetStremioLibraryState() {
  const queryClient = useQueryClient();
  type LibraryData = { items: StremioLibraryItemDto[]; status: StremioStatusDto };
  const update = (
    data: LibraryData | undefined,
    input: { metaId: string; patch: StremioLibraryStatePatch }
  ): LibraryData | undefined => {
    if (!data) return data;
    return {
      ...data,
      items: data.items.map((item) =>
        item.metaId === input.metaId
          ? {
              ...item,
              isFavorite: input.patch.isFavorite ?? item.isFavorite,
              isWatchLater: input.patch.isWatchLater ?? item.isWatchLater,
              inLibrary: input.patch.inLibrary ?? item.inLibrary
            }
          : item
      )
    };
  };

  return useMutation({
    mutationFn: (input: { metaId: string; patch: StremioLibraryStatePatch }) =>
      api.setStremioLibraryState(input.metaId, input.patch),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['stremio-library'] });
      await queryClient.cancelQueries({ queryKey: ['stremio-library-search'] });
      queryClient.setQueriesData<LibraryData>({ queryKey: ['stremio-library'] }, (data) =>
        update(data, input)
      );
      queryClient.setQueriesData<LibraryData>(
        { queryKey: ['stremio-library-search'] },
        (data) => update(data, input)
      );
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: ['stremio-library'] });
      void queryClient.invalidateQueries({ queryKey: ['stremio-library-search'] });
      if (input.patch.inLibrary !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ['feed'] });
        void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      }
    }
  });
}

/** Nota IMDb, sinopse e trailer dos cards visíveis (cache de 30 min no cliente). */
export function useStremioCardInfo(
  items: Array<{ type: string; id: string; name?: string | null }>
) {
  const key = items
    .map((item) => `${item.type}:${item.id}:${item.name ?? ''}`)
    .sort()
    .join('|');
  return useQuery<{ items: StremioCardInfoDto[] }>({
    queryKey: ['stremio-card-info', key],
    queryFn: () => api.stremioCardInfo(items),
    enabled: items.length > 0,
    staleTime: 30 * 60_000,
    retry: false
  });
}

export function useStremioTitle(
  type: string | undefined,
  metaId: string | undefined,
  nameHint?: string | null
) {
  return useQuery<TitleDetailsDto>({
    queryKey: ['stremio-title', type, metaId, nameHint ?? null],
    queryFn: () => api.stremioTitle(type as string, metaId as string, nameHint),
    enabled: Boolean(metaId && type),
    staleTime: 5 * 60_000,
    retry: false
  });
}

export interface StremioStreamParams {
  type: string;
  id: string;
  season?: number | null;
  episode?: number | null;
  videoId?: string | null;
  /** Incrementado pelo botão Atualizar para ignorar o cache do backend. */
  refreshToken?: number;
}

export function useStremioEpisodes(
  type: string | undefined,
  metaId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: ['stremio-episodes', type ?? null, metaId ?? null],
    queryFn: () => api.stremioEpisodes(type as string, metaId as string),
    enabled: enabled && Boolean(type && metaId),
    staleTime: 10 * 60_000,
    retry: false
  });
}

export function useStremioStreams(params: StremioStreamParams | null, enabled = true) {
  return useQuery({
    queryKey: [
      'stremio-streams',
      params?.type ?? null,
      params?.id ?? null,
      params?.season ?? null,
      params?.episode ?? null,
      params?.videoId ?? null,
      params?.refreshToken ?? 0
    ],
    queryFn: () =>
      api.stremioStreams({
        type: params!.type,
        id: params!.id,
        season: params!.season,
        episode: params!.episode,
        videoId: params!.videoId,
        refresh: (params!.refreshToken ?? 0) > 0
      }),
    enabled: enabled && Boolean(params?.id && params?.type),
    staleTime: 2 * 60_000,
    retry: false
  });
}

export function useStremioServerStatus(enabled = true) {
  return useQuery({
    queryKey: ['stremio-server'],
    queryFn: () => api.stremioServer(),
    enabled,
    staleTime: 15_000,
    retry: false
  });
}

export function useStremioSubtitles(params: StremioStreamParams | null, enabled = true) {
  return useQuery({
    queryKey: [
      'stremio-subtitles',
      params?.type ?? null,
      params?.id ?? null,
      params?.season ?? null,
      params?.episode ?? null,
      params?.videoId ?? null
    ],
    queryFn: () => api.stremioSubtitles(params as StremioStreamParams),
    enabled: enabled && Boolean(params?.id && params?.type),
    staleTime: 5 * 60_000,
    retry: false
  });
}

const probeCache = new Map<string, { expiresAt: number; promise: Promise<StremioProbeDto> }>();

/** Evita repetir o ffprobe do Stremio Server ao trocar de tela/player. */
export function probeStremioStream(url: string): Promise<StremioProbeDto> {
  const cached = probeCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    expiresAt: Date.now() + 10 * 60_000,
    promise: api.stremioProbe(url).catch((error: unknown) => ({
      available: false,
      audioTracks: [],
      videoCodec: null,
      container: null,
      hlsUrl: null,
      error: error instanceof Error ? error.message : 'Falha ao analisar a mídia.'
    }))
  };
  // Uma falha pode ser só o torrent ainda frio; tenta de novo em 30 s.
  void entry.promise.then((result) => {
    if (!result.available || result.error) entry.expiresAt = Date.now() + 30_000;
  });
  probeCache.set(url, entry);
  return entry.promise;
}

export function useStremioAddons() {
  return useQuery({
    queryKey: ['stremio-addons'],
    queryFn: () => api.stremioAddons(),
    staleTime: 30_000
  });
}

export function useStremioAddonCatalogs() {
  return useQuery({
    queryKey: ['stremio-catalogs'],
    queryFn: () => api.stremioAddonCatalogs(),
    staleTime: 60_000
  });
}

export function useStremioCatalog(
  params: {
    addonId?: string;
    type?: string;
    catalogId?: string;
    search?: string;
  },
  enabled = true
) {
  return useInfiniteQuery<AddonCatalogPageDto>({
    queryKey: [
      'stremio-catalog',
      params.addonId ?? '',
      params.type ?? '',
      params.catalogId ?? '',
      params.search ?? ''
    ],
    queryFn: ({ pageParam }) =>
      api.stremioAddonCatalog({
        addonId: params.addonId as string,
        type: params.type as string,
        catalogId: params.catalogId as string,
        search: params.search,
        skip: pageParam as number
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextSkip ?? undefined,
    enabled: enabled && Boolean(params.addonId && params.type && params.catalogId),
    staleTime: 60_000
  });
}

export function useStremioSearch(query: string, type?: string) {
  const normalized = query.trim();
  return useQuery<AddonSearchResultDto>({
    queryKey: ['stremio-search', normalized, type ?? ''],
    queryFn: () => api.stremioSearch({ query: normalized, type }),
    enabled: normalized.length >= 2,
    staleTime: 5 * 60_000,
    retry: false
  });
}

export function useSourceRuns(sourceId: string | null) {
  return useQuery({
    queryKey: ['source-runs', sourceId],
    queryFn: async () => (await api.sourceRuns(sourceId as string)).runs,
    enabled: Boolean(sourceId),
    staleTime: 15_000
  });
}

export function useCalendar(
  from: string,
  to: string,
  types: MediaKind[],
  scope: 'global' | 'library',
  enabled = true
) {
  return useQuery({
    queryKey: ['calendar', from, to, types.join(','), scope],
    queryFn: () => api.calendar({ from, to, types, scope }),
    enabled,
    staleTime: 15_000
  });
}

export function useCalendarSearch(query: string, scope: 'global' | 'library') {
  const term = query.trim();
  return useQuery({
    queryKey: ['calendar-search', term, scope],
    queryFn: () => api.calendarSearch({ q: term, scope }),
    enabled: term.length >= 2,
    staleTime: 30_000,
    retry: false
  });
}

export function useMediaSearch() {
  return useMutation({
    mutationFn: ({ provider, q }: { provider: 'tmdb' | 'anilist'; q: string }) => api.searchMedia(provider, q)
  });
}

// ---------------------------------------------------------------------------
// Jogos (fase 3)
// ---------------------------------------------------------------------------

export function useGames(filter: GameFilter, sort: GameSort) {
  return useQuery({
    queryKey: ['games', filter, sort],
    queryFn: () => api.games({ filter, sort }),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
}

export function useGame(id: string | null) {
  return useQuery({
    queryKey: ['game', id],
    queryFn: () => api.game(id as string),
    enabled: Boolean(id),
    staleTime: 20_000
  });
}

export function useGameSearch() {
  return useMutation({
    mutationFn: (q: string) => api.gameSearch(q)
  });
}

export function useImportWishlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string) => api.importWishlist(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['games'] });
    }
  });
}

export function useAddGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { appid: number; targetPriceCents?: number | null }) => api.addGame(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    }
  });
}

export function useUpdateGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetPriceCents }: { id: string; targetPriceCents: number | null }) =>
      api.updateGame(id, { targetPriceCents }),
    onSuccess: (game) => {
      queryClient.setQueryData(['game', game.id], game);
      void queryClient.invalidateQueries({ queryKey: ['games'] });
    }
  });
}

export function useDeleteGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteGame(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    }
  });
}

export function useRefreshGamePrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.refreshGamePrice(id),
    onSuccess: (result) => {
      queryClient.setQueryData(['game', result.game.id], result.game);
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
    }
  });
}

export function pickGamePrice(game: GameDto, officialOnly: boolean): {
  cents: number | null;
  market: 'official' | 'keyshop' | 'steam' | null;
  lowCents: number | null;
  discount: number;
} {
  const official = game.currentOfficialCents;
  const keyshop = game.currentKeyshopCents;

  if (officialOnly) {
    return {
      cents: official ?? game.steamFinalCents,
      market: official !== null ? 'official' : game.steamFinalCents !== null ? 'steam' : null,
      lowCents: game.officialLowCents,
      discount: official !== null ? game.officialDiscount : game.steamDiscount
    };
  }

  if (official !== null && keyshop !== null) {
    return official <= keyshop
      ? { cents: official, market: 'official', lowCents: game.officialLowCents, discount: game.officialDiscount }
      : { cents: keyshop, market: 'keyshop', lowCents: game.keyshopLowCents, discount: game.keyshopDiscount };
  }
  if (official !== null) {
    return { cents: official, market: 'official', lowCents: game.officialLowCents, discount: game.officialDiscount };
  }
  if (keyshop !== null) {
    return { cents: keyshop, market: 'keyshop', lowCents: game.keyshopLowCents, discount: game.keyshopDiscount };
  }
  return {
    cents: game.steamFinalCents,
    market: game.steamFinalCents !== null ? 'steam' : null,
    lowCents: null,
    discount: game.steamDiscount
  };
}

// ---------------------------------------------------------------------------
// Mutações
// ---------------------------------------------------------------------------

type ItemPatch = Partial<Pick<FeedItemDto, 'isRead' | 'isFavorite' | 'isWatchLater'>>;

export function useUpdateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ItemPatch }) => api.updateItem(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      const previous = queryClient.getQueriesData<FeedData>({ queryKey: ['feed'] });

      queryClient.setQueriesData<FeedData>({ queryKey: ['feed'] }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
          }))
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const [key, data] of context.previous as Array<[QueryKey, FeedData | undefined]>) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      // Favoritos/Ver depois têm abas próprias: ao desmarcar, o item precisa
      // sair da lista. As demais abas já são atualizadas de forma otimista.
      if (
        variables.patch.isFavorite !== undefined ||
        variables.patch.isWatchLater !== undefined
      ) {
        for (const query of queryClient.getQueryCache().findAll({ queryKey: ['feed'] })) {
          const tab = String(query.queryKey[1] ?? '');
          if (tab !== FAVORITES_TAB_ID && tab !== WATCH_LATER_TAB_ID) continue;
          void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
        }
      }
    }
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { tab: string; sourceId?: string }) => api.markAllRead(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    }
  });
}

export function useRefreshAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.refreshAll(),
    onSuccess: (data) => {
      queryClient.setQueryData(['refresh-state'], data.refresh);
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    }
  });
}

export function useRefreshSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.refreshSource(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    }
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsDto>) => api.updateSettings(patch),
    onSuccess: (settings) => {
      queryClient.setQueryData(['settings'], settings);
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
    }
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string; icon?: string; color?: string }) => api.createCategory(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
    }
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: string;
      input: string;
      name?: string;
      categoryId: string;
      intervalMinutes?: number;
      imdbId?: string;
    }) => api.createSource(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    }
  });
}

export function useUpdateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body
    }: {
      id: string;
      body: {
        name?: string;
        categoryId?: string;
        intervalMinutes?: number;
        enabled?: boolean;
        input?: string;
        imdbId?: string;
      };
    }) => api.updateSource(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    }
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSource(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    }
  });
}

export function useDeleteSources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.deleteSources(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    }
  });
}

export function useResolveSource() {
  return useMutation({
    mutationFn: (body: { type: string; input: string }) => api.resolveSource(body)
  });
}

export function useNovelDetails(sourceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['novel-details', sourceId],
    queryFn: () => api.novelDetails(sourceId as string),
    enabled: enabled && Boolean(sourceId),
    staleTime: 60_000,
    retry: false
  });
}

export function useNovelChapter(url: string | null, enabled = true) {
  return useQuery({
    queryKey: ['novel-chapter', url],
    queryFn: () => api.novelChapter(url as string),
    enabled: enabled && Boolean(url),
    staleTime: 30 * 60_000,
    retry: false
  });
}

export function useNovelChapterProgress(
  url: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['novel-chapter-progress', url],
    queryFn: () => api.novelChapterProgress(url as string),
    enabled: enabled && Boolean(url),
    refetchInterval: 700,
    retry: false,
    staleTime: 0
  });
}

export function useShowNovelVerification() {
  return useMutation({
    mutationFn: (url: string) => api.showNovelVerification(url)
  });
}

export function useHideNovelVerification() {
  return useMutation({
    mutationFn: () => api.hideNovelVerification()
  });
}

export function useImportNovelCookies() {
  return useMutation({
    mutationFn: (input: { url: string; cookies: BridgeCookie[] }) =>
      api.importNovelCookies(input.url, input.cookies)
  });
}

export function useArticleContent(url: string | null, enabled = true) {
  return useQuery({
    queryKey: ['article-content', url],
    queryFn: () => api.articleContent(url as string),
    enabled: enabled && Boolean(url),
    staleTime: 30 * 60_000,
    retry: false
  });
}

export function useTranslatedText(
  text: string | null,
  language: string,
  enabled = true
) {
  return useQuery({
    queryKey: ['translate', language, text],
    queryFn: () => api.translate({ text: text as string, target: language }),
    enabled: enabled && Boolean(text) && Boolean(language),
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    retry: false
  });
}

export function useSetNovelProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body
    }: {
      id: string;
      body: { chapterId: string; chapterName: string; chapterIndex?: number | null };
    }) => api.setNovelProgress(id, body),
    onSuccess: (source) => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['novel-details', source.id] });
    }
  });
}

export function useClearNovelProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.clearNovelProgress(id),
    onSuccess: (source) => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['novel-details', source.id] });
    }
  });
}

export function useSeedDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.seedDemo(),
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function useRemoveDemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.removeDemo(),
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function categoryLabel(categories: CategoryDefinition[] | undefined, id: string): string {
  return categories?.find((category) => category.id === id)?.label ?? id;
}
