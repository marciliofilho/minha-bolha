/**
 * Conector do YouTube.
 *
 * Estratégia: descobrir o channel_id a partir da URL do canal e ler o feed
 * RSS público (youtube.com/feeds/videos.xml) — sem API key.
 */
import { XMLParser } from 'fast-xml-parser';
import type { ResolvedSourceDto, SettingsDto } from '@hub/shared';
import type { Connector, ConnectorContext, FetchResult, RawItem } from './types';
import { ConnectorError } from './types';
import { fetchText } from './http';
import { safeIso, stripHtml, truncate, xmlText } from './util';
import { feedCutoffIso } from '../lib/dates';

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

function channelVideosUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/videos`;
}

const PAGE_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  // O feed RSS do YouTube falha (404/500) para alguns canais válidos.
  // Nesses casos lemos a página /videos, que sempre traz os últimos envios.
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'CONSENT=YES+cb'
} as const;

function normalizeChannelUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  if (/^https?:\/\//i.test(value)) {
    url = new URL(value);
  } else if (/^(www\.)?youtube\.com\//i.test(value)) {
    url = new URL(`https://${value}`);
  } else if (value.startsWith('@')) {
    url = new URL(`https://www.youtube.com/${value}`);
  } else if (/^[A-Za-z0-9._-]+$/.test(value)) {
    url = new URL(`https://www.youtube.com/@${value}`);
  } else {
    throw new ConnectorError('config', 'Não reconheci a URL. Use /@nome, /channel/ID ou /c/nome.');
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'youtube.com' && host !== 'm.youtube.com') {
    throw new ConnectorError('config', 'A URL precisa ser de um canal do YouTube (youtube.com).');
  }
  return url.toString();
}

function extractChannelId(html: string): string | null {
  const patterns = [
    /<meta[^>]+itemprop=["']identifier["'][^>]+content=["'](UC[\w-]{22})["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/(UC[\w-]{22})["']/i,
    /"channelId"\s*:\s*"(UC[\w-]{22})"/,
    /"externalId"\s*:\s*"(UC[\w-]{22})"/,
    /channel_id=(UC[\w-]{22})/,
    /youtube\.com\/channel\/(UC[\w-]{22})/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractPageTitle(html: string): string | null {
  const meta = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (meta?.[1]) return decodeText(meta[1]);
  const title = /<title>([^<]+)<\/title>/i.exec(html);
  if (title?.[1]) return decodeText(title[1].replace(/\s*-\s*YouTube\s*$/, ''));
  return null;
}

function decodeText(value: string): string {
  return stripHtml(value).trim();
}

interface ParsedFeed {
  channelTitle: string | null;
  entries: RawItem[];
}

function parseFeed(xml: string, channelId: string): ParsedFeed {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new ConnectorError('layout_changed', 'O feed do YouTube veio em formato inesperado.');
  }

  const feed = doc.feed as Record<string, unknown> | undefined;
  if (!feed) {
    throw new ConnectorError('layout_changed', 'O feed do YouTube não retornou vídeos.');
  }

  const channelTitle = xmlText(feed.title) || null;
  const rawEntries = feed.entry;
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];

  const items: RawItem[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const videoId = xmlText(entry['yt:videoId']) || extractVideoIdFromEntry(entry);
    if (!videoId) continue;

    const mediaGroup = firstObject(entry['media:group']);
    const link = pickLink(entry.link) ?? `https://www.youtube.com/watch?v=${videoId}`;
    const publishedAt = safeIso(xmlText(entry.published), new Date().toISOString());
    const thumbnail =
      pickAttribute(mediaGroup?.['media:thumbnail'], '@_url') ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const description = truncate(stripHtml(xmlText(mediaGroup?.['media:description'])), 280);
    const author = channelTitle ?? xmlText(asObject(entry.author)?.name) ?? null;

    items.push({
      externalId: videoId,
      dedupeKey: `yt:${videoId}`,
      kind: 'video',
      title: decodeText(xmlText(entry.title)) || 'Vídeo sem título',
      url: link,
      thumbnailUrl: thumbnail,
      description: description || null,
      author,
      publishedAt,
      meta: { channelId, videoId }
    });
  }

  return { channelTitle, entries: items };
}

function extractVideoIdFromEntry(entry: Record<string, unknown>): string | null {
  const id = xmlText(entry.id);
  const match = /video:([\w-]{11})/.exec(id);
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Fallback: página /videos do canal
//
// O feed Atom público às vezes devolve 404/500 mesmo para canais existentes.
// A página /videos contém o mesmo conteúdo no ytInitialData e é nossa reserva.
// ---------------------------------------------------------------------------

interface PageVideo {
  videoId: string;
  title: string;
  publishedText: string;
  thumbnailUrl: string | null;
}

function findJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function extractInitialData(html: string): Record<string, unknown> | null {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = '];
  for (const marker of markers) {
    const index = html.indexOf(marker);
    if (index === -1) continue;
    const start = html.indexOf('{', index + marker.length);
    if (start === -1) continue;
    const end = findJsonEnd(html, start);
    if (end === -1) continue;
    try {
      return JSON.parse(html.slice(start, end)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function nodeText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.runs)) {
    return node.runs
      .map((run) => (run && typeof run === 'object' ? String((run as Record<string, unknown>).text ?? '') : ''))
      .join('');
  }
  return '';
}

function lastThumbnail(thumbnails: unknown): string | null {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const last = thumbnails[thumbnails.length - 1];
  if (!last || typeof last !== 'object') return null;
  const url = (last as Record<string, unknown>).url;
  return typeof url === 'string' ? url : null;
}

function lockupMetadata(lockup: Record<string, unknown>): {
  title: string;
  publishedText: string;
  thumbnailUrl: string | null;
} {
  const metadata = (lockup.metadata as Record<string, unknown> | undefined)?.lockupMetadataViewModel as
    | Record<string, unknown>
    | undefined;
  const title = nodeText(metadata?.title);
  const rows = ((metadata?.metadata as Record<string, unknown> | undefined)?.contentMetadataViewModel as
    | Record<string, unknown>
    | undefined)?.metadataRows;
  const texts: string[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const parts = (row as Record<string, unknown>).metadataParts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (!part || typeof part !== 'object') continue;
        const text = ((part as Record<string, unknown>).text as Record<string, unknown> | undefined)?.content;
        if (typeof text === 'string') texts.push(text);
      }
    }
  }
  const publishedText = texts.find((text) => isRelativeDate(text)) ?? '';

  const image = (lockup.contentImage as Record<string, unknown> | undefined)?.thumbnailViewModel as
    | Record<string, unknown>
    | undefined;
  const sources = (image?.image as Record<string, unknown> | undefined)?.sources;
  const thumbnailUrl = Array.isArray(sources) && sources.length > 0 ? lastThumbnail(sources) : null;

  return { title, publishedText, thumbnailUrl };
}

function collectPageVideos(data: unknown): PageVideo[] {
  const found: PageVideo[] = [];
  const seen = new Set<string>();

  const push = (video: PageVideo): void => {
    if (!video.videoId || seen.has(video.videoId) || !video.title) return;
    seen.add(video.videoId);
    found.push(video);
  };

  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const node = value as Record<string, unknown>;

    const lockup = node.lockupViewModel as Record<string, unknown> | undefined;
    if (
      lockup &&
      lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' &&
      typeof lockup.contentId === 'string'
    ) {
      const meta = lockupMetadata(lockup);
      push({ videoId: lockup.contentId, ...meta });
    }

    const video = node.videoRenderer as Record<string, unknown> | undefined;
    if (video && typeof video.videoId === 'string') {
      push({
        videoId: video.videoId,
        title: nodeText(video.title),
        publishedText: nodeText(video.publishedTimeText),
        thumbnailUrl: lastThumbnail((video.thumbnail as Record<string, unknown> | undefined)?.thumbnails)
      });
    }

    for (const child of Object.values(node)) walk(child);
  };

  walk(data);
  return found;
}

const MONTH_MS = 30 * 86_400_000;
const YEAR_MS = 365 * 86_400_000;

function isRelativeDate(text: string): boolean {
  return /(\d+)\s*[a-zà-ú]+\s+ago/i.test(text) || /há\s+\d+/i.test(text) || /\d+\s*[a-zà-ú]+\s+atrás/i.test(text);
}

/** Converte "8 hours ago"/"há 8 horas" em uma data aproximada. */
function relativeToIso(text: string, now = new Date()): string {
  const match =
    /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(text) ??
    /(\d+)\s*(mo|[smhdwy])\s+ago/i.exec(text) ??
    /há\s+(\d+)\s*(segundo|segundos|seg|minuto|minutos|min|hora|horas|h|dia|dias|d|semana|semanas|sem|mês|meses|mes|ano|anos|a|s|m)\b/i.exec(
      text
    ) ??
    /(\d+)\s*(seg|min|h|dia|dias|sem|mês|meses|ano|anos)\s+atrás/i.exec(text);

  if (!match?.[1] || !match[2]) return now.toISOString();
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const factor: Record<string, number> = {
    s: 1_000,
    seg: 1_000,
    second: 1_000,
    seconds: 1_000,
    segundo: 1_000,
    segundos: 1_000,
    m: 60_000,
    min: 60_000,
    minute: 60_000,
    minutes: 60_000,
    minuto: 60_000,
    minutos: 60_000,
    h: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    hora: 3_600_000,
    horas: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
    dia: 86_400_000,
    dias: 86_400_000,
    w: 7 * 86_400_000,
    sem: 7 * 86_400_000,
    week: 7 * 86_400_000,
    weeks: 7 * 86_400_000,
    semana: 7 * 86_400_000,
    semanas: 7 * 86_400_000,
    mo: MONTH_MS,
    month: MONTH_MS,
    months: MONTH_MS,
    mês: MONTH_MS,
    mes: MONTH_MS,
    meses: MONTH_MS,
    y: YEAR_MS,
    a: YEAR_MS,
    year: YEAR_MS,
    years: YEAR_MS,
    ano: YEAR_MS,
    anos: YEAR_MS
  };
  const delta = (factor[unit] ?? 86_400_000) * amount;
  return new Date(now.getTime() - delta).toISOString();
}

function parseChannelPage(html: string, channelId: string): ParsedFeed {
  const data = extractInitialData(html);
  const channelTitle =
    nodeText(
      ((data?.metadata as Record<string, unknown> | undefined)?.channelMetadataRenderer as
        | Record<string, unknown>
        | undefined)?.title
    ) ||
    extractPageTitle(html) ||
    null;

  const videos = data ? collectPageVideos(data) : [];
  const now = new Date();
  const entries: RawItem[] = videos.map((video) => ({
    externalId: video.videoId,
    dedupeKey: `yt:${video.videoId}`,
    kind: 'video',
    title: video.title || 'Vídeo sem título',
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    thumbnailUrl: video.thumbnailUrl ?? `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    description: null,
    author: channelTitle,
    publishedAt: video.publishedText ? relativeToIso(video.publishedText, now) : now.toISOString(),
    meta: { channelId, videoId: video.videoId, via: 'channel-page' }
  }));

  return { channelTitle, entries };
}

async function fetchPageFeed(channelId: string): Promise<ParsedFeed> {
  const page = await fetchText(channelVideosUrl(channelId), PAGE_HEADERS);
  return parseChannelPage(page.text, channelId);
}

function firstObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return firstObject(value[0]);
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return firstObject(value);
}

function pickAttribute(value: unknown, attr: string): string | null {
  const item = firstObject(value);
  if (!item) return null;
  const found = item[attr];
  return typeof found === 'string' ? found : null;
}

function pickLink(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const link = pickLink(item);
      if (link) return link;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (node['@_rel'] === 'alternate' && typeof node['@_href'] === 'string') return node['@_href'];
    if (typeof node['@_href'] === 'string') return node['@_href'];
  }
  return null;
}

export async function resolveChannel(input: string, _settings: SettingsDto): Promise<ResolvedSourceDto> {
  const raw = input.trim();
  if (!raw) throw new ConnectorError('config', 'Informe a URL do canal.');

  let channelId: string | null = CHANNEL_ID_RE.test(raw) ? raw : null;
  let pageTitle: string | null = null;
  let pageUrl: string | null = null;

  if (!channelId) {
    pageUrl = normalizeChannelUrl(raw);
    const page = await fetchText(pageUrl, PAGE_HEADERS);
    channelId = extractChannelId(page.text);
    pageTitle = extractPageTitle(page.text);
    if (!channelId) {
      throw new ConnectorError(
        'not_found',
        'Não consegui identificar o canal. Tente a URL no formato youtube.com/channel/UC…'
      );
    }
  }

  let parsed: ParsedFeed | null = null;
  try {
    const feed = await fetchText(feedUrl(channelId), { accept: 'application/atom+xml,application/xml' });
    parsed = parseFeed(feed.text, channelId);
  } catch {
    // O feed público falha para alguns canais; a página /videos resolve.
  }

  if (!parsed || parsed.entries.length === 0) {
    parsed = await fetchPageFeed(channelId).catch(() => null);
    if (!parsed || parsed.entries.length === 0) {
      throw new ConnectorError(
        'not_found',
        'O canal foi encontrado, mas o YouTube não devolveu vídeos agora. Tente de novo em instantes.'
      );
    }
  }

  const name = pageTitle ?? parsed.channelTitle ?? `Canal ${channelId}`;

  return {
    name,
    categoryId: 'youtube',
    config: {
      channelId,
      channelUrl: pageUrl ?? `https://www.youtube.com/channel/${channelId}`,
      input: raw
    },
    samples: parsed.entries.slice(0, 3).map((item) => ({
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt
    }))
  };
}

export const youtubeConnector: Connector = {
  type: 'youtube',
  defaultIntervalMinutes: 30,
  minIntervalMinutes: 15,

  resolve: resolveChannel,

  async fetch(ctx: ConnectorContext): Promise<FetchResult<{ lastPublishedAt: string | null }>> {
    const channelId = typeof ctx.config.channelId === 'string' ? ctx.config.channelId : '';
    if (!CHANNEL_ID_RE.test(channelId)) {
      throw new ConnectorError('config', 'Canal do YouTube sem channel_id válido.');
    }

    let parsed: ParsedFeed | null = null;
    try {
      const response = await fetchText(feedUrl(channelId), { accept: 'application/atom+xml,application/xml' });
      parsed = parseFeed(response.text, channelId);
    } catch (error) {
      if (
        error instanceof ConnectorError &&
        (error.code === 'blocked' || error.code === 'rate_limited' || error.code === 'auth')
      ) {
        throw error;
      }
      ctx.logger.debug(`YouTube ${channelId}: feed indisponível, usando a página /videos`);
    }

    if (!parsed || parsed.entries.length === 0) {
      parsed = await fetchPageFeed(channelId);
    }
    if (!parsed.channelTitle && parsed.entries.length === 0) {
      throw new ConnectorError('not_found', 'Canal não encontrado ou sem vídeos públicos.');
    }

    const lastPublishedAt = parsed.entries.reduce<string | null>((latest, item) => {
      if (!latest) return item.publishedAt;
      return item.publishedAt > latest ? item.publishedAt : latest;
    }, null);

    // O feed guarda apenas vídeos recentes; a janela é configurável no app.
    const cutoff = feedCutoffIso(ctx.settings.feedWindowHours);
    const recent = parsed.entries.filter((item) => item.publishedAt >= cutoff);

    ctx.logger.debug(
      `YouTube ${channelId}: ${parsed.entries.length} vídeo(s) no feed, ${recent.length} dentro de ${ctx.settings.feedWindowHours}h`
    );
    return { items: recent, state: { lastPublishedAt } };
  }
};
