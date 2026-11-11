/**
 * Conector do calendário global.
 * Junta lançamentos de filmes/séries (TMDB) e a agenda global de animes
 * (AniList), sem depender das fontes que o usuário acompanha.
 */
import type { SettingsDto } from '@hub/shared';
import type {
  Connector,
  ConnectorContext,
  FetchResult,
  RawGlobalRelease
} from './types';
import { ConnectorError } from './types';
import { tmdbGet, imageUrl } from './tmdb';
import { fetchGlobalAnimeReleases } from './anilist';
import { addDaysToDate, todayInZone } from '../lib/dates';
import { hasSecret } from '../lib/secrets';

const TMDB_SITE = 'https://www.themoviedb.org';
const WINDOW_PAST_DAYS = 45;
const WINDOW_FUTURE_DAYS = 75;
const ANIME_FUTURE_DAYS = 30;
const TMDB_MOVIE_PAGES = 8;
const TMDB_TV_PAGES = 2;
const TMDB_SERIES_DETAIL_LIMIT = 40;

interface DiscoverMovie {
  id: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  release_date?: string;
}

interface DiscoverTv {
  id: number;
  name?: string;
  original_name?: string;
  poster_path?: string | null;
  first_air_date?: string;
}

interface TvDetails {
  id: number;
  name?: string;
  original_name?: string;
  poster_path?: string | null;
  external_ids?: { imdb_id?: string | null };
  next_episode_to_air?: {
    air_date?: string | null;
    season_number: number;
    episode_number: number;
    name?: string | null;
  } | null;
}

interface PageResponse<T> {
  page?: number;
  total_pages?: number;
  results?: T[];
}

function inRange(date: string | null | undefined, from: string, to: string): date is string {
  return Boolean(date && date >= from && date <= to);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let index = 0;

  async function run(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await worker(items[current]!);
      } catch {
        results[current] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function fetchMovies(
  settings: SettingsDto,
  from: string,
  to: string
): Promise<RawGlobalRelease[]> {
  const releases: RawGlobalRelease[] = [];

  for (let page = 1; page <= TMDB_MOVIE_PAGES; page += 1) {
    const data = await tmdbGet<PageResponse<DiscoverMovie>>('/discover/movie', {
      sort_by: 'popularity.desc',
      'primary_release_date.gte': from,
      'primary_release_date.lte': to,
      with_release_type: '2|3|4',
      region: settings.region,
      include_adult: 'false',
      page
    });

    const results = data.results ?? [];
    for (const movie of results) {
      if (!inRange(movie.release_date, from, to)) continue;
      releases.push({
        externalKey: `tmdb:movie:${movie.id}:cinema:${settings.region}`,
        provider: 'tmdb',
        mediaKind: 'movie',
        title: movie.title ?? 'Sem título',
        originalTitle: movie.original_title ?? null,
        posterUrl: imageUrl(movie.poster_path),
        kind: 'cinema',
        releaseDate: movie.release_date,
        releaseTime: null,
        releaseAt: null,
        timezone: settings.timezone,
        region: settings.region,
        season: null,
        episode: null,
        episodeTitle: null,
        url: `${TMDB_SITE}/movie/${movie.id}?language=pt-BR`,
        imdbId: null
      });
    }

    if (!data.total_pages || page >= data.total_pages) break;
  }

  return releases;
}

async function fetchSeries(
  settings: SettingsDto,
  from: string,
  to: string
): Promise<RawGlobalRelease[]> {
  const releases: RawGlobalRelease[] = [];
  const seen = new Set<number>();
  const candidates: DiscoverTv[] = [];

  for (let page = 1; page <= TMDB_TV_PAGES; page += 1) {
    const data = await tmdbGet<PageResponse<DiscoverTv>>('/tv/on_the_air', {
      page,
      region: settings.region
    });
    for (const show of data.results ?? []) {
      if (seen.has(show.id)) continue;
      seen.add(show.id);
      candidates.push(show);
    }
    if (!data.total_pages || page >= data.total_pages) break;
  }

  const details = await mapLimit(
    candidates.slice(0, TMDB_SERIES_DETAIL_LIMIT),
    4,
    (show) => tmdbGet<TvDetails>(`/tv/${show.id}`, { append_to_response: 'external_ids' })
  );

  for (const value of details) {
    if (!value) continue;
    const next = value.next_episode_to_air;
    if (!next || !inRange(next.air_date, from, to)) continue;
    releases.push({
      externalKey: `tmdb:tv:${value.id}:s${next.season_number}e${next.episode_number}`,
      provider: 'tmdb',
      mediaKind: 'series',
      title: value.name ?? 'Sem título',
      originalTitle: value.original_name ?? null,
      posterUrl: imageUrl(value.poster_path),
      kind: 'episode',
      releaseDate: next.air_date,
      releaseTime: null,
      releaseAt: null,
      timezone: settings.timezone,
      region: settings.region,
      season: next.season_number,
      episode: next.episode_number,
      episodeTitle: next.name ?? null,
      url: `${TMDB_SITE}/tv/${value.id}?language=pt-BR`,
      imdbId: value.external_ids?.imdb_id ?? null
    });
  }

  // Estreias de séries no período (temporada 1, episódio 1).
  for (let page = 1; page <= 2; page += 1) {
    const data = await tmdbGet<PageResponse<DiscoverTv>>('/discover/tv', {
      sort_by: 'popularity.desc',
      'first_air_date.gte': from,
      'first_air_date.lte': to,
      include_adult: 'false',
      page
    });

    for (const show of data.results ?? []) {
      if (!inRange(show.first_air_date, from, to)) continue;
      releases.push({
        externalKey: `tmdb:tv:${show.id}:s1e1`,
        provider: 'tmdb',
        mediaKind: 'series',
        title: show.name ?? 'Sem título',
        originalTitle: show.original_name ?? null,
        posterUrl: imageUrl(show.poster_path),
        kind: 'episode',
        releaseDate: show.first_air_date,
        releaseTime: null,
        releaseAt: null,
        timezone: settings.timezone,
        region: settings.region,
        season: 1,
        episode: 1,
        episodeTitle: show.name ?? null,
        url: `${TMDB_SITE}/tv/${show.id}?language=pt-BR`,
        imdbId: null
      });
    }

    if (!data.total_pages || page >= data.total_pages) break;
  }

  return releases;
}

export const globalReleasesConnector: Connector = {
  type: 'global-releases',
  defaultIntervalMinutes: 360,
  minIntervalMinutes: 60,

  async fetch(
    ctx: ConnectorContext
  ): Promise<FetchResult<{ lastSyncAt: string; count: number; providers: string[] }>> {
    const settings = ctx.settings;
    const today = todayInZone(settings.timezone);
    const from = addDaysToDate(today, -WINDOW_PAST_DAYS);
    const to = addDaysToDate(today, WINDOW_FUTURE_DAYS);
    // A agenda de animes prioriza o futuro próximo (a API limita muitas páginas
    // em sequência); filmes/séries usam a janela maior.
    const animeFrom = addDaysToDate(today, -7);
    const animeTo = addDaysToDate(today, ANIME_FUTURE_DAYS);
    const warnings: string[] = [];
    const providers: Array<'tmdb' | 'anilist'> = [];
    const releases: RawGlobalRelease[] = [];

    const tmdbTask = hasSecret('tmdb')
      ? Promise.all([fetchMovies(settings, from, to), fetchSeries(settings, from, to)]).then(
          ([movies, series]) => [...movies, ...series]
        )
      : Promise.reject(
          new ConnectorError(
            'config',
            'Chave do TMDB não configurada; filmes e séries globais não serão atualizados.'
          )
        );

    const [tmdbResult, anilistResult] = await Promise.allSettled([
      tmdbTask,
      fetchGlobalAnimeReleases(animeFrom, animeTo, settings.timezone)
    ]);

    if (tmdbResult.status === 'fulfilled') {
      releases.push(...tmdbResult.value);
      providers.push('tmdb');
      ctx.logger.info(`calendário global TMDB: ${tmdbResult.value.length} lançamento(s)`);
    } else {
      warnings.push(
        `TMDB: ${tmdbResult.reason instanceof Error ? tmdbResult.reason.message : 'falha ao buscar lançamentos.'}`
      );
    }

    if (anilistResult.status === 'fulfilled') {
      releases.push(...anilistResult.value);
      providers.push('anilist');
      ctx.logger.info(`calendário global AniList: ${anilistResult.value.length} episódio(s)`);
    } else {
      warnings.push(
        `AniList: ${anilistResult.reason instanceof Error ? anilistResult.reason.message : 'falha ao buscar a agenda.'}`
      );
    }

    if (providers.length === 0) {
      throw new ConnectorError('network', warnings.join(' ') || 'Nenhum provedor do calendário respondeu.');
    }

    // Deduplica por chave (estreia de temporada 2, por exemplo, pode aparecer
    // também como episódio em exibição).
    const unique = new Map<string, RawGlobalRelease>();
    for (const release of releases) unique.set(release.externalKey, release);

    return {
      items: [],
      state: {
        lastSyncAt: new Date().toISOString(),
        count: unique.size,
        providers
      },
      globalReleases: [...unique.values()],
      globalReleaseProviders: providers,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
};
