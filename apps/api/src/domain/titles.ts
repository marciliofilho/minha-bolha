/**
 * Detalhes de um título exibidos dentro do Hub.
 * Ordem de prioridade: meta do addon → TMDB → dados da biblioteca.
 */
import type {
  TitleDetailsDto,
  TitleSeasonDto,
  StremioEpisodeDto,
  StremioEpisodesDto
} from '@hub/shared';
import { fetchTitleDetails } from '../connectors/tmdb';
import { ConnectorError } from '../connectors/types';
import { getStremioLibraryRow } from '../db/repositories/stremio';
import { hasSecret } from '../lib/secrets';
import { getAddonMetaForTitle } from './stremio-addons';

function seasonsFromVideos(
  videos: Array<{
    season: number | null;
    episode: number | null;
    name: string | null;
    released: string | null;
    thumbnail: string | null;
    overview: string | null;
  }>
): TitleSeasonDto[] {
  const map = new Map<
    number,
    { count: number; name: string; airDate: string | null; posterUrl: string | null; overview: string | null }
  >();

  for (const video of videos) {
    if (!video.season || video.season <= 0) continue;
    const entry = map.get(video.season) ?? {
      count: 0,
      name: `Temporada ${video.season}`,
      airDate: null,
      posterUrl: null,
      overview: null
    };
    if (video.episode !== null) entry.count += 1;
    if (video.released && (!entry.airDate || video.released < entry.airDate)) {
      entry.airDate = video.released;
    }
    if (!entry.posterUrl && video.thumbnail) entry.posterUrl = video.thumbnail;
    if (!entry.overview && video.overview) entry.overview = video.overview;
    map.set(video.season, entry);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, entry]) => ({
      season,
      name: entry.name,
      episodeCount: entry.count,
      airDate: entry.airDate,
      posterUrl: entry.posterUrl,
      overview: entry.overview
    }));
}

function parseRuntime(value: string | null): number | null {
  if (!value) return null;
  const match = /(\d{1,4})\s*(?:min|m)\b/i.exec(value);
  if (match) return Number(match[1]);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export async function getTitleDetails(
  metaType: string,
  metaId: string,
  nameHint?: string | null
): Promise<TitleDetailsDto> {
  const row = getStremioLibraryRow(metaId);
  const displayType: 'movie' | 'series' =
    metaType === 'movie' ? 'movie' : row?.type === 'movie' ? 'movie' : 'series';
  const tmdbConfigured = hasSecret('tmdb');

  const [addonResult, tmdbResult] = await Promise.allSettled([
    getAddonMetaForTitle(metaType, metaId),
    tmdbConfigured
      ? fetchTitleDetails(metaId, displayType, nameHint ?? row?.name ?? null)
      : Promise.resolve(null)
  ]);

  const addonMeta = addonResult.status === 'fulfilled' ? addonResult.value : null;
  const tmdb = tmdbResult.status === 'fulfilled' ? tmdbResult.value : null;
  let tmdbError: string | null = null;
  if (tmdbResult.status === 'rejected') {
    const error = tmdbResult.reason;
    tmdbError =
      error instanceof ConnectorError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Não foi possível consultar o TMDB.';
  }

  if (!row && !addonMeta && !tmdb) {
    throw new ConnectorError(
      'not_found',
      tmdbError ?? 'Título não encontrado nos addons, na biblioteca ou no TMDB.'
    );
  }

  const addonVideos = addonMeta?.meta.videos ?? [];
  const addonSeasons = seasonsFromVideos(addonVideos);
  const effectiveType: 'movie' | 'series' =
    displayType === 'movie' && addonMeta?.meta.type !== 'series' && tmdb?.type !== 'series'
      ? 'movie'
      : 'series';

  const base = addonMeta?.meta;
  const imdbId =
    row?.imdb_id ??
    (metaId.startsWith('tt') ? metaId : null) ??
    tmdb?.imdbId ??
    null;

  return {
    id: metaId,
    type: effectiveType,
    metaType,
    name: base?.name ?? tmdb?.name ?? row?.name ?? 'Sem título',
    originalName: tmdb?.originalName ?? null,
    overview: base?.description ?? tmdb?.overview ?? null,
    posterUrl: base?.poster ?? tmdb?.posterUrl ?? row?.poster ?? null,
    backdropUrl: base?.background ?? tmdb?.backdropUrl ?? null,
    year: base?.year ?? tmdb?.year ?? null,
    genres: base?.genres.length ? base.genres : (tmdb?.genres ?? []),
    runtimeMinutes: parseRuntime(base?.runtime ?? null) ?? tmdb?.runtimeMinutes ?? null,
    status: tmdb?.status ?? null,
    imdbId,
    tmdbId: tmdb?.tmdbId ?? null,
    source: addonMeta ? 'addon' : tmdb ? 'tmdb' : 'library',
    addonId: addonMeta?.addonId ?? null,
    addonName: addonMeta?.addonName ?? null,
    tmdbConfigured,
    tmdbError,
    seasons: addonSeasons.length > 0 ? addonSeasons : (tmdb?.seasons ?? []),
    inStremioLibrary: Boolean(row),
    progress: row
      ? {
          season: row.season,
          episode: row.episode,
          positionMs: row.time_offset,
          durationMs: row.duration,
          watchedVideoId: row.watched_video_id
        }
      : null
  };
}

/** Temporadas e episódios reais informados pelos addons (usado pelo seletor de streams). */
export async function getEpisodesForTitle(type: string, id: string): Promise<StremioEpisodesDto> {
  const result = await getAddonMetaForTitle(type, id);
  if (!result) {
    return {
      id,
      type,
      seasons: [],
      sourceAddonName: null,
      error: 'Nenhum addon retornou a lista de episódios para este título.'
    };
  }

  const map = new Map<number, StremioEpisodeDto[]>();
  for (const video of result.meta.videos) {
    if (video.season === null || video.episode === null || video.season < 0) continue;
    const season = video.season;
    const episodes = map.get(season) ?? [];
    if (episodes.some((episode) => episode.episode === video.episode)) continue;
    episodes.push({
      id: video.id || `${id}:${season}:${video.episode}`,
      season,
      episode: video.episode,
      name: video.name,
      released: video.released,
      thumbnail: video.thumbnail,
      overview: video.overview
    });
    map.set(season, episodes);
  }

  const seasons = [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, episodes]) => ({
      season,
      name: season === 0 ? 'Especiais' : `Temporada ${season}`,
      episodes: episodes.sort((a, b) => a.episode - b.episode)
    }));

  return {
    id,
    type,
    seasons,
    sourceAddonName: result.addonName,
    error: seasons.length === 0 ? 'O addon não informou episódios para este título.' : null
  };
}
