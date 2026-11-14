/**
 * Tipos, constantes e contratos compartilhados entre API e frontend.
 * Nada aqui pode depender de Node (o frontend importa este pacote).
 */

// ---------------------------------------------------------------------------
// Categorias (abas do feed)
// ---------------------------------------------------------------------------

export interface CategoryDefinition {
  id: string;
  label: string;
  /** Nome do ícone lucide usado no frontend. */
  icon: string;
  /** Cor base usada em destaques e placeholders. */
  color: string;
  sortOrder: number;
  isSystem: boolean;
}

/** Categorias criadas automaticamente no primeiro boot. */
export const SYSTEM_CATEGORIES: CategoryDefinition[] = [
  { id: 'youtube', label: 'YouTube', icon: 'youtube', color: '#ef4444', sortOrder: 10, isSystem: true },
  { id: 'novel', label: 'Novels', icon: 'book-open', color: '#a855f7', sortOrder: 20, isSystem: true },
  { id: 'anime', label: 'Animação/Anime', icon: 'sparkles', color: '#f472b6', sortOrder: 30, isSystem: true },
  { id: 'movie', label: 'Filmes', icon: 'film', color: '#f59e0b', sortOrder: 40, isSystem: true },
  { id: 'series', label: 'Séries', icon: 'monitor-play', color: '#38bdf8', sortOrder: 50, isSystem: true },
  { id: 'game', label: 'Jogos', icon: 'gamepad-2', color: '#22c55e', sortOrder: 60, isSystem: true },
  { id: 'news', label: 'Notícias', icon: 'newspaper', color: '#60a5fa', sortOrder: 70, isSystem: true },
  { id: 'other', label: 'Outros', icon: 'link', color: '#94a3b8', sortOrder: 80, isSystem: true }
];

export const ALL_TAB_ID = 'all';
/** Abas especiais do Feed (não são categorias). */
export const FAVORITES_TAB_ID = '__favorites';
export const WATCH_LATER_TAB_ID = '__watch_later';

// ---------------------------------------------------------------------------
// Tipos de fonte
// ---------------------------------------------------------------------------

export type SourceType =
  | 'youtube'
  | 'rss'
  | 'tmdb'
  | 'anilist'
  | 'steam-wishlist'
  | 'ggdeals'
  | 'webnovel'
  | 'custom'
  | 'stremio-library'
  | 'global-releases';

export interface SourceTypeMeta {
  label: string;
  shortLabel: string;
  description: string;
  /** Categoria sugerida ao criar a fonte. */
  categoryId: string;
  /** Tipos ainda não implementados ficam visíveis, porém desabilitados. */
  available: boolean;
  /** Criado/sincronizado pelo app, não aparece no formulário de nova fonte. */
  autoManaged?: boolean;
  /** Fase em que o tipo é entregue (para a UI). */
  phase: number;
  /** Dica exibida no campo de URL. */
  hint: string;
}

export const SOURCE_TYPES: Record<SourceType, SourceTypeMeta> = {
  youtube: {
    label: 'Canal do YouTube',
    shortLabel: 'YouTube',
    description: 'Últimos vídeos do canal via feed RSS público, sem API key.',
    categoryId: 'youtube',
    available: true,
    phase: 1,
    hint: 'Cole a URL do canal: youtube.com/@nome, /channel/UC… ou /c/nome.'
  },
  rss: {
    label: 'Feed RSS / Atom',
    shortLabel: 'RSS',
    description: 'Qualquer feed de notícias, blog ou podcast.',
    categoryId: 'news',
    available: true,
    phase: 1,
    hint: 'Cole a URL do feed, ex.: https://site.com/feed.xml'
  },
  tmdb: {
    label: 'Filme ou série (TMDB)',
    shortLabel: 'Filme/Série',
    description: 'Acompanha lançamentos e episódios a partir de um link do IMDB ou por busca.',
    categoryId: 'movie',
    available: true,
    phase: 2,
    hint: 'Busque pelo nome ou cole um link do IMDB (imdb.com/title/tt1234567).'
  },
  anilist: {
    label: 'Anime (AniList)',
    shortLabel: 'Anime',
    description: 'Próximos episódios e horários exatos via API do AniList.',
    categoryId: 'anime',
    available: true,
    phase: 2,
    hint: 'Busque pelo nome ou cole o link anilist.co/anime/123.'
  },
  'steam-wishlist': {
    label: 'Wishlist da Steam',
    shortLabel: 'Steam',
    description: 'Importa os jogos da sua wishlist e mantém a lista sincronizada.',
    categoryId: 'game',
    available: true,
    phase: 3,
    hint: 'Cole seu SteamID64 ou o link do perfil (steamcommunity.com/id/nome).'
  },
  ggdeals: {
    label: 'Preços (gg.deals)',
    shortLabel: 'gg.deals',
    description: 'Monitora o menor preço em lojas oficiais e keyshops.',
    categoryId: 'game',
    available: true,
    phase: 3,
    autoManaged: true,
    hint: 'Criado automaticamente quando a chave do gg.deals está configurada.'
  },
  webnovel: {
    label: 'Novel (página do site)',
    shortLabel: 'Novel',
    description: 'Acompanha capa, último capítulo e progresso de leitura de novels na Webnovel e em outros sites.',
    categoryId: 'novel',
    available: true,
    phase: 4,
    hint: 'Cole a página principal da novel (Webnovel, Royal Road, Scribble Hub etc.).'
  },
  custom: {
    label: 'Link personalizado',
    shortLabel: 'Link',
    description: 'Acompanha uma página comum e avisa no Feed quando o conteúdo mudar.',
    categoryId: 'other',
    available: true,
    phase: 5,
    hint: 'Cole a URL da página que você quer acompanhar (notícia, blog, loja, documentação etc.).'
  },
  'stremio-library': {
    label: 'Biblioteca Stremio',
    shortLabel: 'Stremio',
    description: 'Sincroniza a biblioteca e o progresso da sua conta Stremio (somente leitura).',
    categoryId: 'other',
    available: true,
    autoManaged: true,
    phase: 3,
    hint: 'Criado automaticamente ao conectar sua conta em Configurações → Stremio.'
  },
  'global-releases': {
    label: 'Calendário global',
    shortLabel: 'Global',
    description: 'Lançamentos de filmes, séries e animes de todo o catálogo, independente das suas fontes.',
    categoryId: 'other',
    available: true,
    autoManaged: true,
    phase: 3,
    hint: 'Criado automaticamente. Atualiza a cada 6 horas.'
  }
};

// ---------------------------------------------------------------------------
// Itens e feed
// ---------------------------------------------------------------------------

export type ItemKind = 'video' | 'chapter' | 'episode' | 'release' | 'article' | 'price_drop' | 'other';

export type SourceErrorCode =
  | 'blocked'
  | 'rate_limited'
  | 'private'
  | 'layout_changed'
  | 'auth'
  | 'not_found'
  | 'network'
  | 'config'
  | 'unknown';

export const ERROR_LABELS: Record<SourceErrorCode, string> = {
  blocked: 'Bloqueado pelo site',
  rate_limited: 'Limite de requisições atingido',
  private: 'Conteúdo privado',
  layout_changed: 'O layout do site mudou',
  auth: 'Chave ou autenticação inválida',
  not_found: 'Fonte não encontrada',
  network: 'Falha de rede',
  config: 'Configuração inválida',
  unknown: 'Erro inesperado'
};

export interface FeedItemDto {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  categoryId: string;
  categoryLabel: string;
  kind: ItemKind;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  description: string | null;
  author: string | null;
  publishedAt: string;
  isRead: boolean;
  isFavorite: boolean;
  isWatchLater: boolean;
  meta: Record<string, unknown> | null;
  /** Preenchido quando o item é um lançamento de filme/série/anime. */
  imdbId: string | null;
  mediaKind: MediaKind | null;
  inStremioLibrary: boolean;
}

export interface FeedPageDto {
  items: FeedItemDto[];
  nextCursor: string | null;
}

export interface CategoryCountDto {
  id: string;
  label: string;
  unread: number;
  total: number;
}

/** Versão leve usada para acompanhar o término de um refresh em lote. */
export interface SourceStatusDto {
  id: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  nextRunAt: string | null;
  lastErrorCode: SourceErrorCode | null;
}

export interface SourceDto {
  id: string;
  type: SourceType;
  name: string;
  categoryId: string;
  config: Record<string, unknown>;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: SourceErrorCode | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  isDemo: boolean;
  createdAt: string;
  unreadCount: number;
  itemCount: number;
  /** Título do item mais recente da fonte (útil para novels). */
  latestItemTitle: string | null;
  latestItemPublishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Novels (Webnovel)
// ---------------------------------------------------------------------------

export interface NovelChapterDto {
  id: string;
  index: number | null;
  name: string;
  /** Pode ser nulo quando o site não informa a data do capítulo. */
  publishedAt: string | null;
  isVip: boolean;
  /** URL absoluta do capítulo, quando o conector consegue montá-la. */
  url: string | null;
}

export interface NovelProgressDto {
  chapterId: string;
  chapterIndex: number | null;
  chapterName: string;
  updatedAt: string;
}

export interface NovelBookDto {
  bookId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  chapterCount: number;
  latestChapter: NovelChapterDto | null;
  url: string;
}

export interface NovelDetailsDto {
  book: NovelBookDto;
  chapters: NovelChapterDto[];
  progress: NovelProgressDto | null;
}

export interface NovelChapterContentDto {
  url: string;
  title: string;
  text: string;
  /** Texto original com os contadores de comentários (quando o site os injeta). */
  textWithComments?: string | null;
  /** Tradução salva antecipadamente para leitura offline. */
  translatedText?: string | null;
  translatedLanguage?: string | null;
  fetchedAt: string;
}

export interface NovelDownloadChapterDto {
  url: string;
  name?: string;
  index?: number | null;
}

export interface NovelDownloadChapterStateDto {
  url: string;
  name: string;
  index: number | null;
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'canceled';
  error: string | null;
}

export interface NovelDownloadJobDto {
  id: string;
  title: string;
  status: 'running' | 'done' | 'canceled';
  language: string;
  total: number;
  completed: number;
  failed: number;
  /** Nome do capítulo processado no momento. */
  current: string | null;
  chapters: NovelDownloadChapterStateDto[];
  errors: string[];
  startedAt: string;
  finishedAt: string | null;
}

export interface NovelDownloadResultDto {
  downloaded: number;
  failed: number;
  errors: string[];
}

export interface NovelDownloadAvailabilityDto {
  chapters: Array<{
    url: string;
    downloaded: boolean;
    translated: boolean;
  }>;
}

export interface NovelOfflineBookDto {
  bookId: string;
  title: string;
  coverUrl: string | null;
  url: string | null;
  /** Quantidade e tamanho dos capítulos salvos. */
  count: number;
  bytes: number;
}

export interface NovelOfflineChapterDto {
  url: string;
  title: string;
  index: number | null;
  bytes: number;
  fetchedAt: string;
  translatedLanguage: string | null;
}

export interface NovelOfflineBookDetailDto {
  book: NovelOfflineBookDto;
  chapters: NovelOfflineChapterDto[];
}

export interface ArticleContentDto {
  url: string;
  title: string;
  siteName: string | null;
  text: string;
  fetchedAt: string;
}

export interface BackupSourceDto {
  id: string;
  type: SourceType;
  name: string;
  categoryId: string;
  config: Record<string, unknown>;
  enabled: boolean;
  intervalMinutes: number;
}

export interface BackupCategoryDto {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export const BACKUP_SECTIONS = [
  'settings',
  'categories',
  'sources',
  'addons',
  'localLibrary',
  'playback',
  'games',
  'calendar',
  'novels',
  'feed',
  'stremioLibrary',
  'apiKeys',
  'stremioAccount'
] as const;

export type BackupSection = (typeof BACKUP_SECTIONS)[number];

export interface BackupAddonDto {
  transportUrl: string;
  manifest: Record<string, unknown>;
  name?: string;
  enabled: boolean;
  priority: number;
}

export interface BackupStremioAccountDto {
  email: string | null;
  authKey: string;
}

export type BackupRows = Array<Record<string, unknown>>;

export interface BackupDocumentDto {
  format: 'hub-backup';
  /** v1 = settings/categories/sources; v2 = seções opcionais. */
  version: 1 | 2;
  exportedAt: string;
  /** Presente na v2; na v1 o padrão é settings/categories/sources. */
  sections?: BackupSection[];
  settings?: SettingsDto;
  categories?: BackupCategoryDto[];
  sources?: BackupSourceDto[];
  addons?: BackupAddonDto[];
  localLibrary?: BackupRows;
  playback?: BackupRows;
  games?: BackupRows;
  priceHistory?: BackupRows;
  media?: BackupRows;
  releaseEvents?: BackupRows;
  globalReleases?: BackupRows;
  novelCache?: BackupRows;
  items?: BackupRows;
  stremioLibrary?: BackupRows;
  apiKeys?: BackupRows;
  stremioAccount?: BackupStremioAccountDto | null;
}

export interface BackupSectionPreviewDto {
  id: BackupSection;
  count: number;
  sensitive: boolean;
}

export interface BackupPreviewDto {
  exportedAt: string;
  sources: { total: number; new: number; existing: number };
  categories: { total: number; new: number; existing: number };
  settingsFields: number;
  sections: BackupSectionPreviewDto[];
}

export interface BackupImportResultDto {
  sourcesCreated: number;
  sourcesUpdated: number;
  categoriesImported: number;
  settingsUpdated: boolean;
  sections?: Record<string, number>;
}

export interface TranslationDto {
  text: string;
  target: string;
  source: string | null;
}

export interface SourceRunDto {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  itemsFound: number;
  itemsNew: number;
  errorCode: SourceErrorCode | null;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface ResolvedSourceDto {
  name: string;
  config: Record<string, unknown>;
  categoryId: string;
  samples: Array<{ title: string; url: string; publishedAt: string | null }>;
}

export const APP_LANGUAGES = [
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' }
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number]['value'];

export interface SettingsDto {
  theme: 'dark' | 'light' | 'system';
  /** Idioma da interface do Hub. */
  language: AppLanguage;
  /** Exibe a animação de abertura ao iniciar o app desktop. */
  introEnabled: boolean;
  /** Reproduz o áudio da animação de abertura. */
  introAudio: boolean;
  defaultIntervalMinutes: number;
  /** Intervalo global de atualização dos feeds (YouTube, RSS e fontes personalizadas), em segundos. */
  feedRefreshSeconds: number;
  /** Intervalo de atualização das novels, em minutos. Separado do feed geral. */
  novelRefreshMinutes: number;
  /** Segundos de espera com o mouse sobre um card antes de abrir a prévia. */
  hoverPreviewSeconds: number;
  /** Janela de exibição de vídeos do YouTube e notícias no feed, em horas. */
  feedWindowHours: number;
  /** Horas que o cache de novels (lista de capítulos e conteúdos) é mantido. */
  novelCacheRetentionHours: number;
  /** Intervalo, em horas, da limpeza automática do cache de novels. */
  novelCacheCleanupHours: number;
  /** Salva no cache os capítulos abertos no leitor para leitura offline. */
  novelChaptersOffline: boolean;
  /** Dias que os capítulos offline são mantidos antes da limpeza automática. */
  novelOfflineRetentionDays: number;
  timezone: string;
  region: string;
  currency: string;
  /** TTL do cache persistente de streams, em horas. */
  streamCacheTtlHours: number;
  /** Dias sem uso para limpar automaticamente o cache de torrents (0 = desativado). */
  torrentCacheRetentionDays: number;
  /** Executa limpeza automática de caches em segundo plano. */
  autoMaintenanceEnabled: boolean;
  /** Segundos usados pelos botões/atalhos de avançar e retroceder. */
  playerSkipSeconds: number;
  /** Idioma padrão das legendas (código do addon ou "off"). */
  subtitleLanguage: string;
  /** Tamanho da fonte da legenda, em pixels. */
  subtitleFontSize: number;
  /** Cor do texto da legenda (#rrggbb). */
  subtitleColor: string;
  /** Cor de fundo da legenda (#rrggbb). */
  subtitleBackgroundColor: string;
  /** Opacidade do fundo da legenda (0–100; 0 remove o fundo). */
  subtitleBackgroundOpacity: number;
  /** Espaçamento entre as linhas da legenda (multiplicador). */
  subtitleLineHeight: number;
  /** Posição vertical do texto (porcentagem a partir do topo; menor = mais alto). */
  subtitlePosition: number;
}

// ---------------------------------------------------------------------------
// Stremio (fase 3.2)
// ---------------------------------------------------------------------------

export interface StremioStatusDto {
  connected: boolean;
  email: string | null;
  expired: boolean;
  lastSyncAt: string | null;
  libraryCount: number;
  appSecretConfigured: boolean;
}

export interface StremioLibraryItemDto {
  /** ID do item no Stremio (pode ser tt..., kitsu:... etc.). */
  metaId: string;
  /** Preenchido apenas quando o ID é do IMDB. */
  imdbId: string | null;
  videoId: string | null;
  type: 'movie' | 'series';
  name: string;
  poster: string | null;
  season: number | null;
  episode: number | null;
  /** 0 a 1, calculado a partir de timeOffset/duration. */
  progress: number;
  timeOffsetMs: number | null;
  durationMs: number | null;
  /** Último vídeo marcado como assistido na conta (somente leitura). */
  watchedVideoId: string | null;
  lastWatchedAt: string | null;
  /** Marcado localmente no Hub (nunca gravado na conta do Stremio). */
  isFavorite: boolean;
  /** Marcado localmente no Hub (nunca gravado na conta do Stremio). */
  isWatchLater: boolean;
  /** Presente na biblioteca (Stremio ou Minha biblioteca local do Hub). */
  inLibrary: boolean;
  /** Título salvo apenas no Hub (não veio da conta do Stremio). */
  isLocal: boolean;
  /** ID de addon de anime (kitsu:, anilist:, mal:...). */
  isAnime: boolean;
}

/** Metadados leves usados nos cards (nota, sinopse e trailer). */
export interface StremioCardInfoDto {
  type: string;
  id: string;
  imdbRating: string | null;
  overview: string | null;
  trailerYtId: string | null;
  backdropUrl: string | null;
  /** Anime japonês (ID de addon de anime ou animação com origem JP). */
  isAnime: boolean;
}

export interface TitleSeasonDto {
  season: number;
  name: string;
  episodeCount: number;
  airDate: string | null;
  posterUrl: string | null;
  overview: string | null;
}

export interface TitleDetailsDto {
  /** ID usado na URL e nas consultas (tt..., kitsu:..., tmdb:...). */
  id: string;
  /** Tipo normalizado para a interface. */
  type: 'movie' | 'series';
  /** Tipo original no Stremio/addon (movie, series, anime, tv...). */
  metaType: string;
  name: string;
  originalName: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: number | null;
  genres: string[];
  runtimeMinutes: number | null;
  status: string | null;
  imdbId: string | null;
  tmdbId: number | null;
  source: 'addon' | 'tmdb' | 'library';
  addonId: string | null;
  addonName: string | null;
  tmdbConfigured: boolean;
  /** Preenchido quando a chave do TMDB existe, mas a consulta falhou. */
  tmdbError: string | null;
  seasons: TitleSeasonDto[];
  inStremioLibrary: boolean;
  progress: {
    season: number | null;
    episode: number | null;
    positionMs: number | null;
    durationMs: number | null;
    watchedVideoId: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Addons do Stremio (integração)
// ---------------------------------------------------------------------------

export interface AddonResourceDto {
  name: string;
  types: string[];
  idPrefixes: string[];
}

export interface AddonCatalogDto {
  type: string;
  id: string;
  name: string;
  extraSupported: string[];
  extraRequired: string[];
  canSearch: boolean;
}

export interface AddonStreamSummaryDto {
  sampleTitle: string | null;
  sampleId: string | null;
  sampleType: string | null;
  count: number;
  kinds: {
    direct: number;
    torrent: number;
    external: number;
    unknown: number;
  };
  qualities: string[];
  maxSeeds: number | null;
  totalBytes: number | null;
  largestBytes: number | null;
  elapsedMs: number;
  error: string | null;
}

export interface AddonTestSummaryDto {
  ok: boolean;
  elapsedMs: number;
  manifestMs: number;
  catalogsDeclared: number;
  catalogsTested: number;
  streams: AddonStreamSummaryDto | null;
  warnings: string[];
}

export interface StremioAddonDto {
  id: string;
  addonId: string | null;
  name: string;
  version: string | null;
  description: string | null;
  logo: string | null;
  background: string | null;
  /** URL completa nunca sai do backend. */
  maskedUrl: string;
  resources: AddonResourceDto[];
  types: string[];
  idPrefixes: string[];
  catalogs: AddonCatalogDto[];
  enabled: boolean;
  priority: number;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestSummary: AddonTestSummaryDto | null;
  createdAt: string;
}

export interface AddonImportResultDto {
  created: number;
  skipped: number;
  errors: string[];
}

export interface AddonCatalogGroupDto {
  addonId: string;
  addonName: string;
  type: string;
  catalogId: string;
  name: string;
  canSearch: boolean;
  extraSupported: string[];
  extraRequired: string[];
  priority: number;
}

export interface AddonCatalogItemDto {
  addonId: string;
  addonName: string;
  type: string;
  id: string;
  name: string;
  poster: string | null;
  year: number | null;
  imdbRating: string | null;
  description: string | null;
}

export interface AddonCatalogPageDto {
  items: AddonCatalogItemDto[];
  nextSkip: number | null;
  elapsedMs: number;
}

export interface AddonSearchResultDto {
  items: AddonCatalogItemDto[];
  errors: Array<{ addonName: string; message: string }>;
  /** true quando nenhum título bateu com o termo e os resultados são aproximados. */
  approximate?: boolean;
}

// ---------------------------------------------------------------------------
// Streams e player (Etapa 3)
// ---------------------------------------------------------------------------

export type TitleStreamKind = 'direct' | 'torrent' | 'external' | 'unknown';

export interface TitleStreamDto {
  id: string;
  addonId: string;
  addonName: string;
  name: string | null;
  title: string | null;
  description: string | null;
  kind: TitleStreamKind;
  /** URL original informada pelo addon (direta, externa etc.). */
  url: string | null;
  /** URL pronta para o player: direta ou torrent via Stremio Server. */
  playbackUrl: string | null;
  externalUrl: string | null;
  ytId: string | null;
  infoHash: string | null;
  fileIdx: number | null;
  sources: string[];
  quality: string | null;
  sizeBytes: number | null;
  seeds: number | null;
  behaviorHints: Record<string, unknown> | null;
}

export interface TitleStreamsDto {
  type: string;
  id: string;
  videoId: string;
  streams: TitleStreamDto[];
  errors: Array<{ addonId: string; addonName: string; message: string; helpUrl?: string | null }>;
  /** Resultados vieram do cache local (e podem estar atualizando em segundo plano). */
  cache: { used: boolean; refreshing: boolean };
  elapsedMs: number;
}

export interface StremioEpisodeDto {
  id: string;
  season: number;
  episode: number;
  name: string | null;
  released: string | null;
  thumbnail: string | null;
  overview: string | null;
}

export interface StremioSeasonEpisodesDto {
  season: number;
  name: string;
  episodes: StremioEpisodeDto[];
}

export interface StremioEpisodesDto {
  id: string;
  type: string;
  seasons: StremioSeasonEpisodesDto[];
  sourceAddonName: string | null;
  error: string | null;
}

export interface PlaybackProgressDto {
  metaId: string;
  type: 'movie' | 'series';
  videoId: string;
  season: number | null;
  episode: number | null;
  positionMs: number;
  durationMs: number | null;
  addonId: string | null;
  streamSignature: string | null;
  name: string;
  poster: string | null;
  backdrop: string | null;
  year: number | null;
  /** 0..1; 0 quando a duração ainda é desconhecida. */
  progress: number;
  completed: boolean;
  updatedAt: string;
}

export interface StremioServerStatusDto {
  available: boolean;
  baseUrl: string;
  version: string | null;
}

export interface TitleSubtitleDto {
  id: string;
  addonId: string;
  addonName: string;
  /** Código informado pelo addon (ex.: pob, por, eng). */
  lang: string;
  /** Nome amigável do idioma (ex.: Português (Brasil)). */
  language: string;
  /** URL original da legenda no addon. */
  url: string;
  /** URL same-origin usada no <track>; o backend converte SRT para WebVTT. */
  proxyUrl: string;
}

export interface TitleSubtitlesDto {
  type: string;
  id: string;
  videoId: string;
  subtitles: TitleSubtitleDto[];
  errors: Array<{ addonId: string; addonName: string; message: string }>;
  elapsedMs: number;
}

export interface StremioAudioTrackDto {
  index: number;
  language: string | null;
  languageLabel: string | null;
  title: string | null;
  codec: string | null;
  channels: number | null;
}

export interface StremioProbeDto {
  available: boolean;
  audioTracks: StremioAudioTrackDto[];
  videoCodec: string | null;
  container: string | null;
  /** Master HLS de transcodificação (áudio/legendas e fallback de codec). */
  hlsUrl: string | null;
  error: string | null;
}

export interface TorrentPrepareDto {
  sessionId: string;
  infoHash: string;
  fileIdx: number;
  fileName: string;
  fileLength: number;
  durationSec: number | null;
  container: string | null;
  videoCodec: string | null;
  audioTracks: StremioAudioTrackDto[];
  /** URL same-origin do arquivo bruto (com Range). */
  directUrl: string;
  directPlayable: boolean;
  /** Playlist HLS inicial (áudio preferido). */
  hlsUrl: string | null;
  /** Uma playlist HLS por faixa de áudio; trocar de áudio recarrega a URL. */
  audioHlsUrls: string[];
  /** Falha do ffprobe, quando o arquivo bruto ainda pode ser tentado. */
  error: string | null;
}

export interface StremioImportResultDto {
  created: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Chaves de API (fase 3.1)
// ---------------------------------------------------------------------------

export type SecretId = 'tmdb' | 'steam' | 'ggdeals';

export interface SecretStatusDto {
  id: SecretId;
  label: string;
  envVar: string;
  configured: boolean;
  /** 'app' = salva pela UI; 'env' = veio do .env. */
  source: 'app' | 'env' | null;
  /** Ex.: "••••a1b2" — o valor completo nunca sai do backend. */
  masked: string | null;
  /** null quando não configurada; false para formato reconhecidamente inválido. */
  formatValid: boolean | null;
}

export interface HealthDto {
  ok: boolean;
  version: string;
  phase: number;
  keys: { tmdb: boolean; steam: boolean; ggdeals: boolean };
  demo: boolean;
  counts: { sources: number; items: number; unread: number; games: number };
}

export interface StorageDirectoryStatsDto {
  bytes: number;
  files: number;
  dirs: number;
}

export interface StorageStatsDto {
  torrentCache: StorageDirectoryStatsDto & { path: string };
  browserTemp: StorageDirectoryStatsDto;
  database: { bytes: number; path: string };
  novelCache: {
    entries: number;
    bytes: number;
    details: number;
    chapters: number;
  };
  novelOfflineCache: {
    entries: number;
    bytes: number;
  };
  totalCacheBytes: number;
  updatedAt: string;
}

export interface ClearNovelCacheResultDto {
  entries: number;
  bytes: number;
}

export interface ClearCachesResultDto {
  freedBytes: number;
  freedFiles: number;
  torrentCache: { freedBytes: number; freedFiles: number };
  browserTemp: StorageDirectoryStatsDto;
  updatedAt: string;
}

export interface DatabaseOptimizeResultDto {
  beforeBytes: number;
  afterBytes: number;
  freedBytes: number;
  elapsedMs: number;
}

export interface RefreshStateDto {
  active: number;
  queued: number;
}

export interface ApiErrorDto {
  error: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Calendário e mídia (fase 2)
// ---------------------------------------------------------------------------

export type MediaProvider = 'tmdb' | 'anilist';
export type MediaKind = 'movie' | 'series' | 'anime';
export type ReleaseKind = 'cinema' | 'digital' | 'episode' | 'airing';

export interface MediaSearchResultDto {
  provider: MediaProvider;
  /** Valor pronto para usar como input da fonte (ex.: tmdb:movie:603). */
  ref: string;
  mediaType: MediaKind;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
}

export interface ReleaseEventDto {
  id: string;
  mediaId: string;
  sourceId: string;
  sourceName: string;
  provider: MediaProvider;
  mediaKind: MediaKind;
  title: string;
  originalTitle: string | null;
  posterUrl: string | null;
  episodeTitle: string | null;
  kind: ReleaseKind;
  season: number | null;
  episode: number | null;
  /** Data local no fuso configurado (YYYY-MM-DD). */
  releaseDate: string;
  /** HH:mm no fuso configurado, quando a fonte informa. */
  releaseTime: string | null;
  /** Instante exato em UTC, quando disponível. */
  releaseAt: string | null;
  timezone: string;
  region: string | null;
  url: string | null;
  imdbId: string | null;
  inStremioLibrary: boolean;
}

export interface CalendarResponseDto {
  from: string;
  to: string;
  events: ReleaseEventDto[];
}

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  movie: 'Filme',
  series: 'Série',
  anime: 'Anime'
};

// ---------------------------------------------------------------------------
// Jogos e preços (fase 3)
// ---------------------------------------------------------------------------

export type GameOrigin = 'wishlist' | 'manual' | 'demo';
export type GameFilter = 'all' | 'wishlist' | 'outside' | 'deals' | 'low';
export type GameSort = 'discount' | 'price' | 'name' | 'recent';

export interface PricePointDto {
  day: string;
  officialCents: number | null;
  keyshopCents: number | null;
}

export interface GameDto {
  id: string;
  appid: number;
  name: string;
  coverUrl: string | null;
  headerUrl: string | null;
  currency: string;
  targetPriceCents: number | null;
  /** Preço base da Steam (referência para o desconto). */
  steamBaseCents: number | null;
  steamFinalCents: number | null;
  steamDiscount: number;
  currentOfficialCents: number | null;
  currentKeyshopCents: number | null;
  /** Desconto calculado sobre o preço base da Steam. */
  officialDiscount: number;
  keyshopDiscount: number;
  officialLowCents: number | null;
  keyshopLowCents: number | null;
  isAtLow: boolean;
  inWishlist: boolean;
  origin: GameOrigin;
  priority: number | null;
  isDemo: boolean;
  ggUrl: string | null;
  lastPriceCheckAt: string | null;
  addedAt: string;
  removedAt: string | null;
  sparkline: PricePointDto[];
}

export interface GameDetailDto extends GameDto {
  history: PricePointDto[];
}

export interface GameSearchResultDto {
  appid: number;
  name: string;
  imageUrl: string | null;
  priceLabel: string | null;
}

export interface GamesStatsDto {
  total: number;
  wishlist: number;
  deals: number;
  atLow: number;
}

export interface GamesResponseDto {
  games: GameDto[];
  stats: GamesStatsDto;
}

export interface WishlistImportResultDto {
  queued: boolean;
  sourceId: string;
  name: string;
}

export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  cinema: 'Cinema',
  digital: 'Digital',
  episode: 'Episódio',
  airing: 'Exibição'
};

// ---------------------------------------------------------------------------
// Mapa de opções para formulários
// ---------------------------------------------------------------------------

export const INTERVAL_OPTIONS = [15, 30, 60, 120, 180, 240, 360, 720, 1440];

export const REGION_OPTIONS = [
  { value: 'BR', label: 'Brasil (BR)' },
  { value: 'US', label: 'Estados Unidos (US)' },
  { value: 'PT', label: 'Portugal (PT)' },
  { value: 'GB', label: 'Reino Unido (GB)' },
  { value: 'DE', label: 'Alemanha (DE)' },
  { value: 'JP', label: 'Japão (JP)' }
];

export const CURRENCY_OPTIONS = ['BRL', 'USD', 'EUR', 'GBP', 'JPY'];

// Schemas de validação (Zod) usados pela API e pelos formulários.
export * from './schemas';
