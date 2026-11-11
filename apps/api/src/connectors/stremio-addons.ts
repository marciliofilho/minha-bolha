/**
 * Conector isolado de addons do Stremio.
 * Implementa o protocolo HTTP oficial (catalog/meta/stream/subtitles) e
 * normaliza os resultados. Nenhuma falha de addon afeta os demais.
 */
import type { AddonCatalogDto, AddonCatalogItemDto } from '@hub/shared';
import { AddonHttpError, fetchAddonJson } from '../lib/stremio/addons/http';
import {
  manifestBaseUrl,
  parseAddonManifest,
  supportsResource,
  type AddonManifest
} from '../lib/stremio/addons/manifest';

export interface LoadedManifest {
  manifest: AddonManifest;
  elapsedMs: number;
}

export async function loadAddonManifest(
  transportUrl: string,
  timeoutMs?: number
): Promise<LoadedManifest> {
  const result = await fetchAddonJson(transportUrl, timeoutMs);
  return { manifest: parseAddonManifest(result.data), elapsedMs: result.elapsedMs };
}

function extraSegment(extra: Record<string, string | number | undefined>): string {
  return Object.entries(extra)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export function buildResourceUrl(
  transportUrl: string,
  resource: string,
  type: string,
  id: string,
  extra: Record<string, string | number | undefined> = {}
): string {
  const url = new URL(transportUrl);
  url.hash = '';
  const basePath = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
  const suffix = extraSegment(extra);
  const path = `${basePath}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${
    suffix ? `/${suffix}` : ''
  }.json`;
  url.pathname = path.startsWith('/') ? path : `/${path}`;
  return url.toString();
}

function absolute(value: unknown, base: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value, `${base}/`).toString();
  } catch {
    return value;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function yearFrom(value: unknown, releaseInfo: unknown): number | null {
  const direct = numberOrNull(value);
  if (direct) return direct;
  if (typeof releaseInfo === 'string') {
    const match = /(19|20)\d{2}/.exec(releaseInfo);
    if (match) return Number(match[0]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Metadados
// ---------------------------------------------------------------------------

export interface NormalizedVideo {
  id: string;
  name: string | null;
  season: number | null;
  episode: number | null;
  released: string | null;
  thumbnail: string | null;
  overview: string | null;
}

export interface NormalizedMeta {
  id: string;
  type: string;
  name: string;
  poster: string | null;
  background: string | null;
  logo: string | null;
  description: string | null;
  releaseInfo: string | null;
  year: number | null;
  imdbRating: string | null;
  genres: string[];
  runtime: string | null;
  videos: NormalizedVideo[];
  /** ID de um trailer do YouTube, quando o addon informa. */
  trailerYtId: string | null;
}

function youTubeIdFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const match =
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(text);
  return match?.[1] ?? null;
}

function trailerFromMeta(raw: Record<string, unknown>): string | null {
  if (Array.isArray(raw.trailers)) {
    for (const trailer of raw.trailers) {
      if (typeof trailer !== 'object' || trailer === null) continue;
      const id = youTubeIdFrom((trailer as Record<string, unknown>).source);
      if (id) return id;
    }
  }
  if (Array.isArray(raw.trailerStreams)) {
    for (const trailer of raw.trailerStreams) {
      if (typeof trailer !== 'object' || trailer === null) continue;
      const id = youTubeIdFrom((trailer as Record<string, unknown>).ytId);
      if (id) return id;
    }
  }
  return youTubeIdFrom(raw.trailer);
}

function normalizeMeta(raw: Record<string, unknown>, base: string): NormalizedMeta | null {
  const id = stringOrNull(raw.id);
  if (!id) return null;

  const videos: NormalizedVideo[] = [];
  if (Array.isArray(raw.videos)) {
    for (const video of raw.videos) {
      if (typeof video !== 'object' || video === null) continue;
      const entry = video as Record<string, unknown>;
      const videoId = stringOrNull(entry.id);
      if (!videoId) continue;
      videos.push({
        id: videoId,
        name: stringOrNull(entry.title) ?? stringOrNull(entry.name),
        season: numberOrNull(entry.season),
        episode: numberOrNull(entry.episode),
        released: stringOrNull(entry.released) ?? stringOrNull(entry.airDate),
        thumbnail: absolute(entry.thumbnail, base),
        overview: stringOrNull(entry.overview)
      });
    }
  }

  const genres = Array.isArray(raw.genres)
    ? raw.genres.filter((genre): genre is string => typeof genre === 'string' && Boolean(genre.trim()))
    : typeof raw.genre === 'string'
      ? raw.genre
          .split(',')
          .map((genre) => genre.trim())
          .filter(Boolean)
      : [];

  const releaseInfo = stringOrNull(raw.releaseInfo);

  return {
    id,
    type: stringOrNull(raw.type) ?? 'movie',
    name: stringOrNull(raw.name) ?? id,
    poster: absolute(raw.poster, base),
    background: absolute(raw.background, base),
    logo: absolute(raw.logo, base),
    description: stringOrNull(raw.description),
    releaseInfo,
    year: yearFrom(raw.year, releaseInfo),
    imdbRating: stringOrNull(raw.imdbRating),
    genres,
    runtime: typeof raw.runtime === 'string' ? raw.runtime : null,
    videos,
    trailerYtId: trailerFromMeta(raw)
  };
}

export async function fetchAddonMeta(
  transportUrl: string,
  type: string,
  id: string
): Promise<NormalizedMeta | null> {
  const result = await fetchAddonJson(buildResourceUrl(transportUrl, 'meta', type, id));
  const data = result.data as Record<string, unknown> | null;
  const raw = data && typeof data === 'object' ? (data.meta ?? data) : null;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeMeta(raw as Record<string, unknown>, manifestBaseUrl(transportUrl));
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

export interface NormalizedCatalogItem {
  id: string;
  type: string;
  name: string;
  poster: string | null;
  year: number | null;
  imdbRating: string | null;
  description: string | null;
}

export interface CatalogResult {
  items: NormalizedCatalogItem[];
  elapsedMs: number;
}

function normalizeCatalogItem(
  raw: Record<string, unknown>,
  fallbackType: string,
  base: string
): NormalizedCatalogItem | null {
  const id = stringOrNull(raw.id);
  if (!id) return null;
  const name = stringOrNull(raw.name) ?? id;
  const poster = absolute(raw.poster, base);
  const placeholderName =
    /^(error loading content|no content|erro ao carregar conte[uú]do|conte[uú]do indispon[ií]vel|sem conte[uú]do)$/i;
  if (
    id === 'tmdb:no-content' ||
    placeholderName.test(name.trim()) ||
    (poster !== null && /\/no-content(?:\.|\/|$)/i.test(poster))
  ) {
    return null;
  }

  const releaseInfo = stringOrNull(raw.releaseInfo);
  return {
    id,
    type: stringOrNull(raw.type) ?? fallbackType,
    name,
    poster,
    year: yearFrom(raw.year, releaseInfo),
    imdbRating: stringOrNull(raw.imdbRating),
    description: stringOrNull(raw.description)
  };
}

export async function fetchAddonCatalog(
  transportUrl: string,
  catalog: AddonCatalogDto,
  extra: Record<string, string | number | undefined> = {}
): Promise<CatalogResult> {
  const result = await fetchAddonJson(
    buildResourceUrl(transportUrl, 'catalog', catalog.type, catalog.id, extra)
  );
  const data = result.data as { metas?: unknown } | null;
  const metas = Array.isArray(data?.metas) ? data.metas : [];
  const base = manifestBaseUrl(transportUrl);
  const items: NormalizedCatalogItem[] = [];
  for (const meta of metas) {
    if (typeof meta !== 'object' || meta === null) continue;
    const normalized = normalizeCatalogItem(meta as Record<string, unknown>, catalog.type, base);
    if (normalized) items.push(normalized);
  }
  return { items, elapsedMs: result.elapsedMs };
}

export function toCatalogItemDto(
  item: NormalizedCatalogItem,
  addonId: string,
  addonName: string
): AddonCatalogItemDto {
  return {
    addonId,
    addonName,
    type: item.type,
    id: item.id,
    name: item.name,
    poster: item.poster,
    year: item.year,
    imdbRating: item.imdbRating,
    description: item.description
  };
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

export type StreamKind = 'direct' | 'torrent' | 'external' | 'unknown';

export interface NormalizedStream {
  name: string | null;
  title: string | null;
  description: string | null;
  kind: StreamKind;
  url: string | null;
  externalUrl: string | null;
  ytId: string | null;
  infoHash: string | null;
  fileIdx: number | null;
  sources: string[];
  behaviorHints: Record<string, unknown> | null;
  quality: string | null;
  sizeBytes: number | null;
  seeds: number | null;
}

function streamText(stream: Record<string, unknown>): string {
  const parts = [stream.name, stream.title, stream.description, stream.detail]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const tags = Array.isArray(stream.tags)
    ? stream.tags.filter((tag): tag is string => typeof tag === 'string').join(' ')
    : '';
  return `${parts} ${tags}`.trim();
}

function parseQuality(text: string): string | null {
  const match = /(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hdr|dv|bluray|web[- ]?dl|webrip|hdtv|dvdrip|cam|ts)/i.exec(
    text
  );
  if (!match) return null;
  const value = match[1]!.toLowerCase();
  if (value === '4k' || value === 'uhd') return '2160p';
  return value;
}

function parseSize(text: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(gb|gib|mb|mib|tb|tib)/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const unit = match[2]!.toLowerCase();
  const multiplier = unit.startsWith('t')
    ? 1024 ** 4
    : unit.startsWith('g')
      ? 1024 ** 3
      : 1024 ** 2;
  return Math.round(value * multiplier);
}

function parseSeeds(text: string): number | null {
  const patterns = [
    /(?:👤|👥)\s*(\d+)/,
    /(?:seeds?|seeders?|semeadores?)[:\s]+(\d+)/i,
    /(\d+)\s*(?:seeds?|seeders?)/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function normalizeStream(raw: Record<string, unknown>): NormalizedStream {
  const text = streamText(raw);
  const externalUrl = stringOrNull(raw.externalUrl);
  const ytId = stringOrNull(raw.ytId) ?? stringOrNull(raw.yt_id) ?? stringOrNull(raw.youtubeId);
  const url = stringOrNull(raw.url);
  const infoHash = stringOrNull(raw.infoHash) ?? stringOrNull(raw.info_hash);
  const fileIdx = numberOrNull(raw.fileIdx ?? raw.file_index ?? raw.mapIdx);
  const behaviorHints =
    typeof raw.behaviorHints === 'object' && raw.behaviorHints !== null
      ? (raw.behaviorHints as Record<string, unknown>)
      : null;

  let kind: StreamKind = 'unknown';
  if (externalUrl || ytId) kind = 'external';
  else if (url) kind = 'direct';
  else if (infoHash) kind = 'torrent';

  const sizeFromHints = numberOrNull(behaviorHints?.videoSize);
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((source): source is string => typeof source === 'string')
    : [];

  return {
    name: stringOrNull(raw.name),
    title: stringOrNull(raw.title),
    description: stringOrNull(raw.description) ?? stringOrNull(raw.detail),
    kind,
    url,
    externalUrl,
    ytId,
    infoHash,
    fileIdx,
    sources,
    behaviorHints,
    quality: parseQuality(text),
    sizeBytes: sizeFromHints ?? parseSize(text),
    seeds: parseSeeds(text)
  };
}

export interface StreamsResult {
  streams: NormalizedStream[];
  elapsedMs: number;
}

export async function fetchAddonStreams(
  transportUrl: string,
  type: string,
  videoId: string,
  timeoutMs?: number
): Promise<StreamsResult> {
  const result = await fetchAddonJson(buildResourceUrl(transportUrl, 'stream', type, videoId), timeoutMs);
  const data = result.data as { streams?: unknown } | null;
  const rawStreams = Array.isArray(data?.streams) ? data.streams : [];
  const streams: NormalizedStream[] = [];
  for (const stream of rawStreams) {
    if (typeof stream !== 'object' || stream === null) continue;
    streams.push(normalizeStream(stream as Record<string, unknown>));
  }
  return { streams, elapsedMs: result.elapsedMs };
}

// ---------------------------------------------------------------------------
// Legendas (usadas na Etapa 3)
// ---------------------------------------------------------------------------

export async function fetchAddonSubtitles(
  transportUrl: string,
  type: string,
  id: string,
  extra: Record<string, string | number | undefined> = {}
): Promise<{ subtitles: Array<{ id: string | null; url: string; lang: string }>; elapsedMs: number }> {
  const result = await fetchAddonJson(
    buildResourceUrl(transportUrl, 'subtitles', type, id, extra)
  );
  const data = result.data as { subtitles?: unknown } | null;
  const rawSubtitles = Array.isArray(data?.subtitles) ? data.subtitles : [];
  const subtitles: Array<{ id: string | null; url: string; lang: string }> = [];
  for (const entry of rawSubtitles) {
    if (typeof entry !== 'object' || entry === null) continue;
    const subtitle = entry as Record<string, unknown>;
    const url = stringOrNull(subtitle.url);
    const lang = stringOrNull(subtitle.lang);
    if (!url || !lang) continue;
    subtitles.push({ id: stringOrNull(subtitle.id), url, lang });
  }
  return { subtitles, elapsedMs: result.elapsedMs };
}

export { supportsResource, AddonHttpError };
export type { AddonManifest };
