/** Contrato que todo conector de fonte implementa. */
import type {
  ItemKind,
  MediaKind,
  MediaProvider,
  MediaSearchResultDto,
  ReleaseKind,
  ResolvedSourceDto,
  SettingsDto,
  SourceErrorCode,
  SourceType
} from '@hub/shared';
import type { Logger } from '../lib/logger';
import type { SourceRow } from '../db/types';

/** Item normalizado devolvido por qualquer conector. */
export interface RawItem {
  externalId?: string | null;
  /** Chave única global que evita duplicatas (ex.: yt:VIDEO_ID). */
  dedupeKey: string;
  kind: ItemKind;
  title: string;
  url: string;
  thumbnailUrl?: string | null;
  description?: string | null;
  author?: string | null;
  /** ISO 8601 em UTC. */
  publishedAt: string;
  meta?: Record<string, unknown> | null;
}

/** Título acompanhado (filme, série ou anime) para o calendário. */
export interface RawMedia {
  provider: MediaProvider;
  externalId: string;
  kind: MediaKind;
  title: string;
  originalTitle?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  year?: number | null;
  status?: string | null;
  totalSeasons?: number | null;
  nextEpisodeAt?: string | null;
  url?: string | null;
  imdbId?: string | null;
  raw?: unknown;
}

/** Lançamento ou episódio de um título. */
export interface RawReleaseEvent {
  /** Chave estável e global (ex.: tmdb:tv:1399:s1e3). */
  externalKey: string;
  kind: ReleaseKind;
  /** YYYY-MM-DD no fuso configurado. */
  releaseDate: string;
  releaseTime?: string | null;
  /** ISO UTC, quando a fonte informa o horário exato. */
  releaseAt?: string | null;
  timezone: string;
  region?: string | null;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  url?: string | null;
}

export interface FetchResult<TState = unknown> {
  items: RawItem[];
  /** Cursor/estado persistido na fonte para a próxima verificação. */
  state: TState;
  /** Metadados do título (fases 2+). */
  media?: RawMedia;
  /** Eventos de calendário (fases 2+). */
  releaseEvents?: RawReleaseEvent[];
  /** Lista completa da wishlist da Steam (fase 3). */
  wishlist?: RawWishlistGame[];
  /** Preços atuais por mercado (fase 3). */
  prices?: RawPriceSnapshot[];
  /** Biblioteca do Stremio (fase 3.2). */
  stremioLibrary?: RawStremioLibraryItem[];
  /** Lançamentos globais, independentes das fontes acompanhadas. */
  globalReleases?: RawGlobalRelease[];
  /** Provedores que responderam com sucesso nesta sincronização. */
  globalReleaseProviders?: Array<'tmdb' | 'anilist'>;
  /** Avisos não fatais (ex.: limite parcial da API). */
  warnings?: string[];
}

/** Jogo da wishlist já com metadados da loja. */
export interface RawWishlistGame {
  appid: number;
  name: string;
  coverUrl: string | null;
  headerUrl: string | null;
  steamBaseCents: number | null;
  steamFinalCents: number | null;
  steamDiscount: number;
  priority: number | null;
  dateAdded: string | null;
  /** false quando os metadados vieram do cache e não foram atualizados agora. */
  metadataFresh: boolean;
  metadataFetchedAt: string | null;
}

/**
 * Preços de um jogo no gg.deals.
 * A API gratuita devolve apenas o menor preço por mercado, não por loja.
 */
export interface RawPriceSnapshot {
  appid: number;
  found: boolean;
  currency: string;
  officialCents: number | null;
  keyshopCents: number | null;
  officialLowCents: number | null;
  keyshopLowCents: number | null;
  ggUrl: string | null;
}

/** Item da biblioteca do Stremio (somente leitura). */
export interface RawStremioLibraryItem {
  /** ID do Stremio; pode ser tt..., kitsu:... etc. */
  metaId: string;
  /** Preenchido apenas quando o ID é do IMDB. */
  imdbId: string | null;
  type: 'movie' | 'series';
  name: string;
  poster: string | null;
  videoId: string | null;
  season: number | null;
  episode: number | null;
  timeOffset: number | null;
  duration: number | null;
  watchedVideoId: string | null;
  lastWatchedAt: string | null;
  removed: boolean;
  temp: boolean;
  raw?: unknown;
}

/** Lançamento global exibido no calendário. */
export interface RawGlobalRelease {
  externalKey: string;
  provider: 'tmdb' | 'anilist';
  mediaKind: MediaKind;
  title: string;
  originalTitle?: string | null;
  posterUrl?: string | null;
  kind: ReleaseKind;
  releaseDate: string;
  releaseTime?: string | null;
  releaseAt?: string | null;
  timezone: string;
  region?: string | null;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  url?: string | null;
  imdbId?: string | null;
}

export interface ConnectorContext<TConfig = Record<string, unknown>, TState = unknown> {
  source: SourceRow;
  config: TConfig;
  state: TState | null;
  settings: SettingsDto;
  logger: Logger;
}

export interface Connector {
  type: SourceType;
  defaultIntervalMinutes: number;
  /** Piso rígido: nenhuma fonte deste tipo roda mais rápido que isso. */
  minIntervalMinutes: number;
  /** Transforma o que o usuário colou em configuração validada. */
  resolve?(input: string, settings: SettingsDto): Promise<ResolvedSourceDto>;
  /** Busca títulos por nome (TMDB/AniList). */
  search?(query: string, settings: SettingsDto): Promise<MediaSearchResultDto[]>;
  fetch(ctx: ConnectorContext): Promise<FetchResult>;
}

/**
 * Erro padronizado: o código define como a UI avisa e como o scheduler
 * calcula o backoff.
 */
export class ConnectorError extends Error {
  readonly code: SourceErrorCode;

  constructor(code: SourceErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
  }
}
