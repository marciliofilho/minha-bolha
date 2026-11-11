/**
 * Conector AniList (animes) via GraphQL público.
 * Traz o próximo episódio com horário exato e a agenda futura.
 */
import type {
  MediaSearchResultDto,
  ResolvedSourceDto,
  SettingsDto
} from '@hub/shared';
import type {
  Connector,
  ConnectorContext,
  FetchResult,
  RawGlobalRelease,
  RawMedia,
  RawReleaseEvent
} from './types';
import { ConnectorError } from './types';
import { fetchText } from './http';
import { stripHtml, truncate } from './util';
import { dateInZone, timeInZone } from '../lib/dates';
import { getMediaBySource } from '../db/repositories/media';
import { findImdbIdByTitle } from './tmdb';

const API = 'https://graphql.anilist.co';
const SITE = 'https://anilist.co';

interface AnilistTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

interface AnilistMedia {
  id: number;
  title: AnilistTitle;
  coverImage?: { large?: string | null; extraLarge?: string | null } | null;
  bannerImage?: string | null;
  description?: string | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null } | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  airingSchedule?: { nodes?: Array<{ episode: number; airingAt: number }> | null } | null;
  trailer?: { id?: string | null; site?: string | null } | null;
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; status?: number }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function anilistQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetchText(API, {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
    contentType: 'application/json',
    accept: 'application/json'
  });

  let payload: GraphqlResponse<T>;
  try {
    payload = JSON.parse(response.text) as GraphqlResponse<T>;
  } catch {
    throw new ConnectorError('layout_changed', 'O AniList devolveu uma resposta que não é JSON.');
  }

  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).join('; ');
    if (/rate.?limit/i.test(message)) {
      throw new ConnectorError('rate_limited', 'O AniList limitou as requisições. Tente mais tarde.');
    }
    if (/not found|404/i.test(message)) {
      throw new ConnectorError('not_found', 'Anime não encontrado no AniList.');
    }
    throw new ConnectorError('layout_changed', `AniList: ${message}`);
  }

  if (!payload.data) throw new ConnectorError('layout_changed', 'Resposta vazia do AniList.');
  return payload.data;
}

function titleOf(media: AnilistMedia): string {
  return media.title.english ?? media.title.romaji ?? media.title.native ?? `Anime ${media.id}`;
}

function imageUrl(media: AnilistMedia): string | null {
  return media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
}

function yearOf(media: AnilistMedia): number | null {
  const year = media.seasonYear ?? media.startDate?.year ?? null;
  return year && Number.isFinite(year) ? year : null;
}

function formatBr(date: string): string {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

const SEARCH_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
        id
        title { romaji english native }
        coverImage { large extraLarge }
        description(asHtml: false)
        format
        status
        episodes
        seasonYear
        startDate { year }
        nextAiringEpisode { episode airingAt }
      }
    }
  }
`;

const DETAILS_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { romaji english native }
      coverImage { large extraLarge }
      bannerImage
      description(asHtml: false)
      format
      status
      episodes
      seasonYear
      startDate { year }
      nextAiringEpisode { episode airingAt }
      airingSchedule(notYetAired: true, perPage: 50) {
        nodes { episode airingAt }
      }
    }
  }
`;

async function searchMedia(query: string): Promise<AnilistMedia[]> {
  const data = await anilistQuery<{ Page?: { media?: AnilistMedia[] } }>(SEARCH_QUERY, { search: query });
  return data.Page?.media ?? [];
}

async function getMedia(id: number): Promise<AnilistMedia> {
  const data = await anilistQuery<{ Media?: AnilistMedia | null }>(DETAILS_QUERY, { id });
  if (!data.Media) throw new ConnectorError('not_found', 'Anime não encontrado no AniList.');
  return data.Media;
}

// ---------------------------------------------------------------------------
// Trailer (fallback para animes que o TMDB/addon não cobrem)
// ---------------------------------------------------------------------------

const TRAILER_QUERY = `
  query ($search: String) {
    Media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
      trailer { id site }
    }
  }
`;

const trailerCache = new Map<string, { expiresAt: number; ytId: string | null }>();

export async function fetchAniListTrailer(title: string): Promise<string | null> {
  const key = title.trim().toLowerCase();
  if (!key) return null;

  const cached = trailerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.ytId;

  try {
    const data = await anilistQuery<{ Media?: { trailer?: { id?: string | null; site?: string | null } | null } | null }>(
      TRAILER_QUERY,
      { search: title.trim() }
    );
    const trailer = data.Media?.trailer;
    const ytId =
      trailer?.site === 'youtube' &&
      typeof trailer.id === 'string' &&
      /^[A-Za-z0-9_-]{11}$/.test(trailer.id)
        ? trailer.id
        : null;
    trailerCache.set(key, { expiresAt: Date.now() + 6 * 60 * 60_000, ytId });
    return ytId;
  } catch {
    trailerCache.set(key, { expiresAt: Date.now() + 10 * 60_000, ytId: null });
    return null;
  }
}

function mapSearchItem(media: AnilistMedia): MediaSearchResultDto {
  return {
    provider: 'anilist',
    ref: `anilist:${media.id}`,
    mediaType: 'anime',
    title: titleOf(media),
    originalTitle: media.title.native ?? null,
    year: yearOf(media),
    posterUrl: imageUrl(media),
    overview: media.description ? truncate(stripHtml(media.description), 220) : null
  };
}

async function resolveInput(input: string): Promise<number> {
  const value = input.trim();

  const ref = /^anilist:(\d+)$/i.exec(value);
  if (ref?.[1]) return Number(ref[1]);

  const url = /anilist\.co\/anime\/(\d+)/i.exec(value);
  if (url?.[1]) return Number(url[1]);

  if (/^\d+$/.test(value)) return Number(value);

  const results = await searchMedia(value);
  const first = results[0];
  if (!first) {
    throw new ConnectorError('not_found', 'Nenhum anime encontrado. Tente outro nome.');
  }
  return first.id;
}

function mediaOf(media: AnilistMedia, imdbId: string | null): RawMedia {
  return {
    provider: 'anilist',
    externalId: String(media.id),
    kind: 'anime',
    title: titleOf(media),
    originalTitle: media.title.native ?? null,
    posterUrl: imageUrl(media),
    backdropUrl: media.bannerImage ?? null,
    year: yearOf(media),
    status: media.status ?? null,
    totalSeasons: null,
    nextEpisodeAt: media.nextAiringEpisode ? new Date(media.nextAiringEpisode.airingAt * 1000).toISOString() : null,
    url: `${SITE}/anime/${media.id}`,
    imdbId,
    raw: media
  };
}

function eventsOf(media: AnilistMedia, settings: SettingsDto): RawReleaseEvent[] {
  const nodes = media.airingSchedule?.nodes ?? [];
  const events: RawReleaseEvent[] = [];

  for (const node of nodes) {
    if (!node.airingAt || !node.episode) continue;
    const date = new Date(node.airingAt * 1000);
    events.push({
      externalKey: `anilist:${media.id}:ep:${node.episode}`,
      kind: 'airing',
      releaseDate: dateInZone(date, settings.timezone),
      releaseTime: timeInZone(date, settings.timezone),
      releaseAt: date.toISOString(),
      timezone: settings.timezone,
      episode: node.episode,
      episodeTitle: null,
      url: `${SITE}/anime/${media.id}`
    });
  }

  return events.sort((a, b) => (a.releaseAt ?? '').localeCompare(b.releaseAt ?? ''));
}

// ---------------------------------------------------------------------------
// Agenda global (calendário independente da biblioteca)
// ---------------------------------------------------------------------------

interface GlobalAiringMedia {
  id: number;
  isAdult?: boolean | null;
  title: AnilistTitle;
  coverImage?: { large?: string | null; extraLarge?: string | null } | null;
  siteUrl?: string | null;
}

interface GlobalAiringNode {
  airingAt: number;
  episode: number;
  media: GlobalAiringMedia;
}

interface GlobalAiringPage {
  Page?: {
    pageInfo?: { hasNextPage?: boolean };
    airingSchedules?: GlobalAiringNode[];
  };
}

const GLOBAL_AIRING_QUERY = `
  query ($page: Int, $from: Int, $to: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
        airingAt
        episode
        media {
          id
          isAdult
          title { romaji english native }
          coverImage { large extraLarge }
          siteUrl
        }
      }
    }
  }
`;

/** Todos os episódios de anime no intervalo, sem depender de fontes seguidas. */
export async function fetchGlobalAnimeReleases(
  fromDate: string,
  toDate: string,
  timezone: string
): Promise<RawGlobalRelease[]> {
  const from = Math.floor(Date.parse(`${fromDate}T00:00:00.000Z`) / 1000);
  const to = Math.floor(Date.parse(`${toDate}T23:59:59.000Z`) / 1000);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];

  const releases: RawGlobalRelease[] = [];
  for (let page = 1; page <= 12; page += 1) {
    if (page > 1) await sleep(3000);
    let data: GlobalAiringPage;
    try {
      data = await anilistQuery<GlobalAiringPage>(GLOBAL_AIRING_QUERY, { page, from, to });
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'rate_limited') {
        await sleep(15_000);
        data = await anilistQuery<GlobalAiringPage>(GLOBAL_AIRING_QUERY, { page, from, to });
      } else {
        throw error;
      }
    }

    const nodes = data.Page?.airingSchedules ?? [];
    for (const node of nodes) {
      if (!node.media || node.media.isAdult) continue;
      if (!node.airingAt || !node.episode) continue;
      const date = new Date(node.airingAt * 1000);
      const media = node.media;
      const title = titleOf({
        id: media.id,
        title: media.title,
        coverImage: media.coverImage
      });
      releases.push({
        externalKey: `anilist:${media.id}:ep:${node.episode}`,
        provider: 'anilist',
        mediaKind: 'anime',
        title,
        originalTitle: media.title.native ?? null,
        posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
        kind: 'airing',
        releaseDate: dateInZone(date, timezone),
        releaseTime: timeInZone(date, timezone),
        releaseAt: date.toISOString(),
        timezone,
        region: null,
        season: null,
        episode: node.episode,
        episodeTitle: null,
        url: media.siteUrl ?? `${SITE}/anime/${media.id}`,
        imdbId: null
      });
    }

    if (!data.Page?.pageInfo?.hasNextPage) break;
  }

  return releases;
}

export const anilistConnector: Connector = {
  type: 'anilist',
  defaultIntervalMinutes: 180,
  minIntervalMinutes: 60,

  async search(query: string, _settings: SettingsDto): Promise<MediaSearchResultDto[]> {
    const results = await searchMedia(query);
    return results.slice(0, 10).map(mapSearchItem);
  },

  async resolve(input: string, settings: SettingsDto): Promise<ResolvedSourceDto> {
    const id = await resolveInput(input);
    const media = await getMedia(id);
    const events = eventsOf(media, settings);

    return {
      name: titleOf(media),
      categoryId: 'anime',
      config: {
        provider: 'anilist',
        externalId: String(media.id),
        anilistId: media.id,
        title: titleOf(media),
        input
      },
      samples: events.slice(0, 3).map((event) => ({
        title: `Episódio ${event.episode} — ${formatBr(event.releaseDate)}${
          event.releaseTime ? ` às ${event.releaseTime}` : ''
        }`,
        url: event.url ?? `${SITE}/anime/${media.id}`,
        publishedAt: event.releaseAt ?? null
      }))
    };
  },

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ lastSyncAt: string; imdbTriedAt: string | null }>> {
    const id = Number(ctx.config.anilistId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ConnectorError('config', 'Fonte AniList sem anilistId válido.');
    }

    const media = await getMedia(id);
    const events = eventsOf(media, ctx.settings);

    // IMDB: override manual > cache da mídia > busca no TMDB (best-effort).
    const override =
      typeof ctx.config.imdbIdOverride === 'string' && /^tt\d{7,10}$/i.test(ctx.config.imdbIdOverride)
        ? ctx.config.imdbIdOverride
        : null;
    const cached = getMediaBySource(ctx.source.id);
    const previousState = (ctx.state as { imdbTriedAt?: string } | null) ?? null;
    let imdbId = override ?? cached?.imdb_id ?? null;
    let imdbTriedAt = previousState?.imdbTriedAt ?? null;

    if (!imdbId) {
      const lastTry = imdbTriedAt ? new Date(imdbTriedAt).getTime() : 0;
      if (Date.now() - lastTry > 7 * 24 * 60 * 60_000) {
        imdbId = await findImdbIdByTitle(titleOf(media), 'tv');
        imdbTriedAt = new Date().toISOString();
      }
    }

    ctx.logger.debug(`AniList ${id}: ${events.length} episódio(s) futuro(s)`);

    return {
      items: [],
      state: { lastSyncAt: new Date().toISOString(), imdbTriedAt },
      media: mediaOf(media, imdbId),
      releaseEvents: events
    };
  }
};
