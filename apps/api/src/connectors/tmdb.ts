/**
 * Conector TMDB (filmes e séries).
 *
 * - Aceita link do IMDB, referência `tmdb:movie:603` / `tmdb:tv:1399` ou busca por nome.
 * - Nunca faz scraping do IMDB: usa /find?external_source=imdb_id.
 * - Filmes: datas de cinema e digital na região configurada.
 * - Séries: episódios futuros da temporada atual (e da próxima, se anunciada).
 */
import type { MediaSearchResultDto, ResolvedSourceDto, SettingsDto, TitleSeasonDto } from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawMedia, RawReleaseEvent } from './types';
import { ConnectorError } from './types';
import { fetchText } from './http';
import { stripHtml, truncate } from './util';
import { addDaysToDate, dateToIso, todayInZone } from '../lib/dates';
import { secretValue } from '../lib/secrets';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const SITE = 'https://www.themoviedb.org';

// ---------------------------------------------------------------------------
// Tipos parciais da API (apenas o que usamos)
// ---------------------------------------------------------------------------

interface TmdbSearchItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string;
}

interface TmdbFindResponse {
  movie_results?: TmdbSearchItem[];
  tv_results?: TmdbSearchItem[];
}

interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title?: string;
  original_language?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  status?: string;
  runtime?: number | null;
  genres?: Array<{ id: number; name: string }>;
  production_countries?: Array<{ iso_3166_1: string }>;
  external_ids?: { imdb_id?: string | null };
  release_dates?: {
    results?: Array<{
      iso_3166_1: string;
      release_dates?: Array<{ type: number; release_date: string; note?: string }>;
    }>;
  };
}

interface TmdbEpisode {
  air_date?: string | null;
  episode_number: number;
  season_number: number;
  name?: string;
}

interface TmdbSeasonDetails {
  episodes?: TmdbEpisode[];
}

interface TmdbTvDetails {
  id: number;
  name: string;
  original_name?: string;
  original_language?: string;
  origin_country?: string[];
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  status?: string;
  number_of_seasons?: number;
  episode_run_time?: number[];
  genres?: Array<{ id: number; name: string }>;
  external_ids?: { imdb_id?: string | null };
  seasons?: Array<{
    season_number: number;
    name?: string;
    episode_count?: number;
    air_date?: string | null;
    poster_path?: string | null;
    overview?: string;
  }>;
  next_episode_to_air?: {
    air_date?: string | null;
    season_number: number;
    episode_number: number;
    name?: string | null;
  } | null;
}

type MediaType = 'movie' | 'tv';

interface Target {
  kind: MediaType;
  id: number;
  imdbId?: string;
}

// ---------------------------------------------------------------------------
// Cliente HTTP do TMDB
// ---------------------------------------------------------------------------

function apiKey(): string {
  const key = secretValue('tmdb');
  if (!key) {
    throw new ConnectorError(
      'auth',
      'Chave do TMDB não configurada. Adicione em Configurações → Chaves de API (ou no .env).'
    );
  }
  return key;
}

export async function tmdbGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const key = apiKey();
  const base = process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3';
  const url = new URL(base + path);
  const bearer = key.startsWith('eyJ'); // token v4 (Read Access Token)

  if (!bearer) url.searchParams.set('api_key', key);
  url.searchParams.set('language', 'pt-BR');
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
  }

  const response = await fetchText(url.toString(), {
    accept: 'application/json',
    headers: bearer ? { authorization: `Bearer ${key}` } : undefined
  });

  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new ConnectorError('layout_changed', 'O TMDB devolveu uma resposta que não é JSON.');
  }
}

export function imageUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${IMAGE_BASE}${path}`;
}

function yearOf(date?: string | null): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function formatBr(date: string): string {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function sampleLabel(event: RawReleaseEvent): string {
  const date = formatBr(event.releaseDate);
  if (event.kind === 'cinema') return `Estreia nos cinemas — ${date}`;
  if (event.kind === 'digital') return `Lançamento digital — ${date}`;
  const code = `S${event.season ?? '?'}E${event.episode ?? '?'}`;
  return event.episodeTitle
    ? `${code} · ${event.episodeTitle} — ${date}`
    : `Episódio ${code} — ${date}`;
}

// ---------------------------------------------------------------------------
// Busca e resolução
// ---------------------------------------------------------------------------

async function searchMulti(query: string): Promise<TmdbSearchItem[]> {
  const data = await tmdbGet<{ results?: TmdbSearchItem[] }>('/search/multi', {
    query,
    include_adult: 'false'
  });
  return (data.results ?? []).filter((item) => item.media_type === 'movie' || item.media_type === 'tv');
}

function mapSearchItem(item: TmdbSearchItem): MediaSearchResultDto | null {
  if (item.media_type !== 'movie' && item.media_type !== 'tv') return null;
  const isMovie = item.media_type === 'movie';
  const title = (isMovie ? item.title : item.name) ?? 'Sem título';
  const date = isMovie ? item.release_date : item.first_air_date;

  return {
    provider: 'tmdb',
    ref: `tmdb:${isMovie ? 'movie' : 'tv'}:${item.id}`,
    mediaType: isMovie ? 'movie' : 'series',
    title,
    originalTitle: (isMovie ? item.original_title : item.original_name) ?? null,
    year: yearOf(date),
    posterUrl: imageUrl(item.poster_path),
    overview: item.overview ? truncate(stripHtml(item.overview), 220) : null
  };
}

async function resolveTarget(input: string): Promise<Target> {
  const value = input.trim();

  const imdbId = /tt\d{7,10}/i.exec(value)?.[0];
  if (imdbId) {
    const data = await tmdbGet<TmdbFindResponse>(`/find/${imdbId}`, { external_source: 'imdb_id' });
    const movie = data.movie_results?.[0];
    if (movie) return { kind: 'movie', id: movie.id, imdbId };
    const tv = data.tv_results?.[0];
    if (tv) return { kind: 'tv', id: tv.id, imdbId };
    throw new ConnectorError('not_found', `O IMDB ${imdbId} não foi encontrado no TMDB.`);
  }

  const ref = /^tmdb:(movie|tv|series):(\d+)$/i.exec(value);
  if (ref) {
    const kind = ref[1]?.toLowerCase() === 'movie' ? 'movie' : 'tv';
    const id = Number(ref[2]);
    if (!Number.isInteger(id) || id <= 0) throw new ConnectorError('config', 'ID do TMDB inválido.');
    return { kind, id };
  }

  if (/^\d+$/.test(value)) {
    // Ambíguo: preferimos filme, que é o uso mais comum.
    return { kind: 'movie', id: Number(value) };
  }

  const results = await searchMulti(value);
  const first = results[0];
  if (!first) {
    throw new ConnectorError(
      'not_found',
      'Nenhum filme ou série encontrado. Tente outro nome ou cole o link do IMDB.'
    );
  }
  return { kind: first.media_type === 'tv' ? 'tv' : 'movie', id: first.id };
}

// ---------------------------------------------------------------------------
// Detalhes → mídia + eventos
// ---------------------------------------------------------------------------

function movieEvents(details: TmdbMovieDetails, settings: SettingsDto): RawReleaseEvent[] {
  const results = details.release_dates?.results ?? [];
  const region =
    results.find((entry) => entry.iso_3166_1 === settings.region) ??
    results.find((entry) => entry.iso_3166_1 === 'US') ??
    results.find((entry) => (entry.release_dates?.length ?? 0) > 0);

  if (!region) return [];

  const pick = (types: number[]): { type: number; release_date: string } | null => {
    const candidates = (region.release_dates ?? [])
      .filter((entry) => types.includes(entry.type) && entry.release_date)
      .sort((a, b) => a.release_date.localeCompare(b.release_date));
    return candidates[0] ?? null;
  };

  const events: RawReleaseEvent[] = [];
  const cinema = pick([3, 2, 1]);
  const digital = pick([4]);
  const url = `${SITE}/movie/${details.id}?language=pt-BR`;

  const push = (kind: 'cinema' | 'digital', date: string): void => {
    const releaseDate = date.slice(0, 10);
    events.push({
      externalKey: `tmdb:movie:${details.id}:${kind}:${region.iso_3166_1}`,
      kind,
      releaseDate,
      releaseTime: null,
      releaseAt: null,
      timezone: settings.timezone,
      region: region.iso_3166_1,
      url
    });
  };

  if (cinema) push('cinema', cinema.release_date);
  if (digital) push('digital', digital.release_date);

  return events;
}

async function seriesEvents(details: TmdbTvDetails, settings: SettingsDto): Promise<RawReleaseEvent[]> {
  const today = todayInZone(settings.timezone);
  const from = addDaysToDate(today, -14);
  const to = addDaysToDate(today, 120);

  const seasons = (details.seasons ?? []).filter((season) => season.season_number > 0);
  const next = details.next_episode_to_air;
  const numbers = new Set<number>();

  if (next?.season_number) {
    numbers.add(next.season_number);
    const upcomingSeason = seasons.find((season) => season.season_number === next.season_number + 1);
    if (upcomingSeason?.air_date && upcomingSeason.air_date <= to) {
      numbers.add(upcomingSeason.season_number);
    }
  } else {
    // Série sem próximo episódio: buscamos a temporada mais recente para pegar
    // episódios recém-exibidos (importante se o app ficou offline).
    const latest = [...seasons]
      .filter((season) => season.air_date)
      .sort((a, b) => (b.air_date ?? '').localeCompare(a.air_date ?? ''))[0];
    if (latest) numbers.add(latest.season_number);
  }

  const events: RawReleaseEvent[] = [];
  for (const seasonNumber of numbers) {
    let season: TmdbSeasonDetails;
    try {
      season = await tmdbGet<TmdbSeasonDetails>(`/tv/${details.id}/season/${seasonNumber}`);
    } catch (error) {
      // Temporada ainda sem detalhes publicados não deve derrubar a fonte.
      if (error instanceof ConnectorError && error.code === 'not_found') continue;
      throw error;
    }

    for (const episode of season.episodes ?? []) {
      if (!episode.air_date) continue;
      const date = episode.air_date.slice(0, 10);
      if (date < from || date > to) continue;

      events.push({
        externalKey: `tmdb:tv:${details.id}:s${seasonNumber}e${episode.episode_number}`,
        kind: 'episode',
        releaseDate: date,
        releaseTime: null,
        releaseAt: null,
        timezone: settings.timezone,
        season: seasonNumber,
        episode: episode.episode_number,
        episodeTitle: episode.name ?? null,
        url: `${SITE}/tv/${details.id}/season/${seasonNumber}/episode/${episode.episode_number}?language=pt-BR`
      });
    }
  }

  return events;
}

async function buildMovieBundle(details: TmdbMovieDetails, settings: SettingsDto): Promise<{
  media: RawMedia;
  events: RawReleaseEvent[];
}> {
  const events = movieEvents(details, settings);
  const media: RawMedia = {
    provider: 'tmdb',
    externalId: `movie:${details.id}`,
    kind: 'movie',
    title: details.title,
    originalTitle: details.original_title ?? null,
    posterUrl: imageUrl(details.poster_path),
    backdropUrl: imageUrl(details.backdrop_path),
    year: yearOf(details.release_date),
    status: details.status ?? null,
    totalSeasons: null,
    nextEpisodeAt: null,
    url: `${SITE}/movie/${details.id}?language=pt-BR`,
    imdbId: details.external_ids?.imdb_id ?? null,
    raw: details
  };
  return { media, events };
}

async function buildSeriesBundle(details: TmdbTvDetails, settings: SettingsDto): Promise<{
  media: RawMedia;
  events: RawReleaseEvent[];
}> {
  const events = await seriesEvents(details, settings);
  const next = details.next_episode_to_air;
  const media: RawMedia = {
    provider: 'tmdb',
    externalId: `tv:${details.id}`,
    kind: 'series',
    title: details.name,
    originalTitle: details.original_name ?? null,
    posterUrl: imageUrl(details.poster_path),
    backdropUrl: imageUrl(details.backdrop_path),
    year: yearOf(details.first_air_date),
    status: details.status ?? null,
    totalSeasons: details.number_of_seasons ?? null,
    nextEpisodeAt: next?.air_date ? dateToIso(next.air_date.slice(0, 10)) : null,
    url: `${SITE}/tv/${details.id}?language=pt-BR`,
    imdbId: details.external_ids?.imdb_id ?? null,
    raw: details
  };
  return { media, events };
}

async function getBundle(kind: MediaType, id: number, settings: SettingsDto) {
  if (kind === 'movie') {
    const details = await tmdbGet<TmdbMovieDetails>(`/movie/${id}`, {
      append_to_response: 'release_dates,external_ids'
    });
    return buildMovieBundle(details, settings);
  }
  const details = await tmdbGet<TmdbTvDetails>(`/tv/${id}`, { append_to_response: 'external_ids' });
  return buildSeriesBundle(details, settings);
}

/**
 * Tenta descobrir o IMDB de um título (usado por animes do AniList, que não
 * têm esse ID). É best-effort: retorna null se não houver chave ou match.
 */
export async function findImdbIdByTitle(query: string, prefer: 'movie' | 'tv' = 'tv'): Promise<string | null> {
  if (!secretValue('tmdb')) return null;
  try {
    const results = await searchMulti(query);
    const ordered = [...results].sort((a, b) => {
      const aPreferred = a.media_type === prefer ? 0 : 1;
      const bPreferred = b.media_type === prefer ? 0 : 1;
      return aPreferred - bPreferred;
    });

    for (const item of ordered.slice(0, 4)) {
      const kind: MediaType = item.media_type === 'tv' ? 'tv' : 'movie';
      const details = await tmdbGet<{ external_ids?: { imdb_id?: string | null } }>(`/${kind}/${item.id}`, {
        append_to_response: 'external_ids'
      });
      const imdb = details.external_ids?.imdb_id;
      if (imdb && /^tt\d{7,10}$/i.test(imdb)) return imdb;
    }
  } catch {
    // melhor esforço: o usuário ainda pode corrigir manualmente
  }
  return null;
}

/** Detalhes básicos usados pela tela de título do Hub. */
export interface TmdbTitleDetails {
  tmdbId: number;
  type: 'movie' | 'series';
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
  trailerYtId: string | null;
  originalLanguage: string | null;
  originCountry: string[];
  seasons: TitleSeasonDto[];
}

interface TmdbVideo {
  key?: string;
  site?: string;
  type?: string;
  official?: boolean;
  iso_639_1?: string;
}

interface TmdbVideosResponse {
  results?: TmdbVideo[];
}

function trailerRank(video: TmdbVideo): number {
  const type = (video.type ?? '').toLowerCase();
  if (type === 'trailer') return 0;
  if (type === 'teaser') return 1;
  if (type === 'clip') return 2;
  if (type === 'featurette') return 3;
  return 4;
}

function pickTrailer(videos: TmdbVideo[]): string | null {
  const candidates = videos.filter(
    (video) =>
      video.site === 'YouTube' &&
      typeof video.key === 'string' &&
      /^[A-Za-z0-9_-]{11}$/.test(video.key)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const language = (value: TmdbVideo): number => {
      if (value.iso_639_1 === 'pt') return 0;
      if (value.iso_639_1 === 'en') return 1;
      return 2;
    };
    return (
      trailerRank(a) - trailerRank(b) ||
      language(a) - language(b) ||
      Number(Boolean(b.official)) - Number(Boolean(a.official))
    );
  });
  return candidates[0]?.key ?? null;
}

/** Busca o melhor trailer no TMDB, tentando português e inglês. */
async function fetchTmdbTrailer(kind: 'movie' | 'tv', id: number): Promise<string | null> {
  const [pt, en] = await Promise.allSettled([
    tmdbGet<TmdbVideosResponse>(`/${kind}/${id}/videos`, { language: 'pt-BR' }),
    tmdbGet<TmdbVideosResponse>(`/${kind}/${id}/videos`, { language: 'en-US' })
  ]);
  const videos: TmdbVideo[] = [];
  if (pt.status === 'fulfilled') videos.push(...(pt.value.results ?? []));
  if (en.status === 'fulfilled') videos.push(...(en.value.results ?? []));
  return pickTrailer(videos);
}

async function resolveDetailsTarget(
  input: string,
  prefer: 'movie' | 'series',
  nameHint?: string
): Promise<Target> {
  const value = input.trim();

  const imdbId = /tt\d{7,10}/i.exec(value)?.[0];
  if (imdbId) {
    const data = await tmdbGet<TmdbFindResponse>(`/find/${imdbId}`, { external_source: 'imdb_id' });
    const movie = data.movie_results?.[0];
    const tv = data.tv_results?.[0];
    if (prefer === 'series' && tv) return { kind: 'tv', id: tv.id, imdbId };
    if (prefer === 'movie' && movie) return { kind: 'movie', id: movie.id, imdbId };
    if (movie) return { kind: 'movie', id: movie.id, imdbId };
    if (tv) return { kind: 'tv', id: tv.id, imdbId };
    throw new ConnectorError('not_found', `O IMDB ${imdbId} não foi encontrado no TMDB.`);
  }

  const ref = /^tmdb:(movie|tv|series):(\d+)$/i.exec(value);
  if (ref) {
    const kind = ref[1]?.toLowerCase() === 'movie' ? 'movie' : 'tv';
    const id = Number(ref[2]);
    if (!Number.isInteger(id) || id <= 0) throw new ConnectorError('config', 'ID do TMDB inválido.');
    return { kind, id };
  }

  if (/^\d+$/.test(value)) {
    return { kind: prefer === 'series' ? 'tv' : 'movie', id: Number(value) };
  }

  // IDs que não são do TMDB/IMDB (ex.: kitsu:123) são resolvidos pelo nome.
  const query = nameHint?.trim() || value;
  const results = await searchMulti(query);
  const ordered = [...results].sort((a, b) => {
    const aPreferred = (prefer === 'series' ? a.media_type === 'tv' : a.media_type === 'movie') ? 0 : 1;
    const bPreferred = (prefer === 'series' ? b.media_type === 'tv' : b.media_type === 'movie') ? 0 : 1;
    return aPreferred - bPreferred;
  });
  const first = ordered[0];
  if (!first) {
    throw new ConnectorError('not_found', 'Nenhum título correspondente encontrado no TMDB.');
  }
  return { kind: first.media_type === 'tv' ? 'tv' : 'movie', id: first.id };
}

/**
 * Busca detalhes de um título para a tela de detalhes do Hub.
 * Aceita IMDB (tt...), referência tmdb:... ou nome (para IDs de outros addons).
 */
export async function fetchTitleDetails(
  input: string,
  type: 'movie' | 'series',
  nameHint?: string | null,
  options: { withTrailer?: boolean } = {}
): Promise<TmdbTitleDetails> {
  const target = await resolveDetailsTarget(input, type, nameHint ?? undefined);

  if (target.kind === 'movie') {
    const details = await tmdbGet<TmdbMovieDetails>(`/movie/${target.id}`, {
      append_to_response: 'external_ids'
    });
    const trailerYtId = options.withTrailer ? await fetchTmdbTrailer('movie', details.id) : null;
    return {
      tmdbId: details.id,
      type: 'movie',
      name: details.title,
      originalName: details.original_title ?? null,
      overview: details.overview ?? null,
      posterUrl: imageUrl(details.poster_path),
      backdropUrl: imageUrl(details.backdrop_path),
      year: yearOf(details.release_date),
      genres: (details.genres ?? []).map((genre) => genre.name),
      runtimeMinutes: details.runtime ?? null,
      status: details.status ?? null,
      imdbId: details.external_ids?.imdb_id ?? target.imdbId ?? null,
      trailerYtId,
      originalLanguage: details.original_language ?? null,
      originCountry: (details.production_countries ?? []).map(
        (country) => country.iso_3166_1
      ),
      seasons: []
    };
  }

  const details = await tmdbGet<TmdbTvDetails>(`/tv/${target.id}`, { append_to_response: 'external_ids' });
  const trailerYtId = options.withTrailer ? await fetchTmdbTrailer('tv', details.id) : null;
  return {
    tmdbId: details.id,
    type: 'series',
    name: details.name,
    originalName: details.original_name ?? null,
    overview: details.overview ?? null,
    posterUrl: imageUrl(details.poster_path),
    backdropUrl: imageUrl(details.backdrop_path),
    year: yearOf(details.first_air_date),
    genres: (details.genres ?? []).map((genre) => genre.name),
    runtimeMinutes: details.episode_run_time?.[0] ?? null,
    status: details.status ?? null,
    imdbId: details.external_ids?.imdb_id ?? target.imdbId ?? null,
    trailerYtId,
    originalLanguage: details.original_language ?? null,
    originCountry: details.origin_country ?? [],
    seasons: (details.seasons ?? [])
      .filter((season) => season.season_number > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .map((season) => ({
        season: season.season_number,
        name: season.name ?? `Temporada ${season.season_number}`,
        episodeCount: season.episode_count ?? 0,
        airDate: season.air_date ?? null,
        posterUrl: imageUrl(season.poster_path),
        overview: season.overview ?? null
      }))
  };
}

function buildConfig(target: Target, title: string, input: string): Record<string, unknown> {
  return {
    provider: 'tmdb',
    externalId: `${target.kind}:${target.id}`,
    tmdbId: target.id,
    mediaType: target.kind,
    imdbId: target.imdbId ?? null,
    title,
    input
  };
}

// ---------------------------------------------------------------------------
// Conector
// ---------------------------------------------------------------------------

/** Gêneros que indicam animação, em pt-BR/inglês ("Animação", "Animation"). */
function isAnimationDetails(raw: unknown): boolean {
  const genres = (raw as { genres?: Array<{ name?: string | null }> } | null)?.genres ?? [];
  return genres.some((genre) => /anima[cç]/i.test(genre.name ?? ''));
}

/** Categoria do feed: animações (filmes ou séries) vão para Animação/Anime. */
function categoryOf(media: { kind: 'movie' | 'series' | 'anime'; raw?: unknown }): string {
  if (isAnimationDetails(media.raw)) return 'anime';
  return media.kind === 'movie' ? 'movie' : 'series';
}

export const tmdbConnector: Connector = {
  type: 'tmdb',
  defaultIntervalMinutes: 360,
  minIntervalMinutes: 60,

  async search(query: string, _settings: SettingsDto): Promise<MediaSearchResultDto[]> {
    const results = await searchMulti(query);
    return results.slice(0, 10).map(mapSearchItem).filter((item): item is MediaSearchResultDto => Boolean(item));
  },

  async resolve(input: string, settings: SettingsDto): Promise<ResolvedSourceDto> {
    const target = await resolveTarget(input);
    const { media, events } = await getBundle(target.kind, target.id, settings);

    const today = todayInZone(settings.timezone);
    const samples = events
      .filter((event) => event.releaseDate >= today)
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
      .slice(0, 3)
      .map((event) => ({
        title: sampleLabel(event),
        url: event.url ?? media.url ?? SITE,
        publishedAt: dateToIso(event.releaseDate)
      }));

    return {
      name: media.title,
      categoryId: categoryOf(media),
      config: buildConfig(target, media.title, input),
      samples
    };
  },

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ lastSyncAt: string }>> {
    const tmdbId = Number(ctx.config.tmdbId);
    const mediaType: MediaType = ctx.config.mediaType === 'tv' ? 'tv' : 'movie';
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new ConnectorError('config', 'Fonte TMDB sem tmdbId válido.');
    }

    const { media, events } = await getBundle(mediaType, tmdbId, ctx.settings);
    ctx.logger.debug(`TMDB ${mediaType} ${tmdbId}: ${events.length} evento(s)`);

    return {
      items: [],
      state: { lastSyncAt: new Date().toISOString() },
      media,
      releaseEvents: events
    };
  }
};
