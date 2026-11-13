/** Resolve a imagem/logo de uma fonte e guarda a URL por 3 dias. */
import { fetchText } from '../connectors/http';
import { parseJson } from '../db/mappers';
import { getSourceRow, updateSource } from '../db/repositories/sources';
import { assertPublicUrl } from './ssrf';

const IMAGE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PAGE_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'CONSENT=YES+cb'
};

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/&amp;/g, '&');
  }
  return null;
}

async function fetchPage(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetchText(url, {
    accept: headers.accept ?? 'text/html,application/xhtml+xml',
    headers,
    timeoutMs: 20_000,
    maxBytes: 4 * 1024 * 1024,
    retries: 1
  });
  return response.text;
}

async function resolveImage(type: string, config: Record<string, unknown>): Promise<string | null> {
  if (typeof config.coverUrl === 'string' && config.coverUrl.trim()) {
    return config.coverUrl.trim();
  }

  if (type === 'youtube') {
    const channelId = typeof config.channelId === 'string' ? config.channelId.trim() : '';
    if (!channelId) return null;
    const page = await fetchPage(
      `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`,
      PAGE_HEADERS
    );
    return firstMatch(page, [
      /<meta property="og:image" content="([^"]+)"/i,
      /"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/i
    ]);
  }

  if (type === 'rss') {
    const input =
      (typeof config.input === 'string' && config.input) ||
      (typeof config.url === 'string' && config.url) ||
      (typeof config.feedUrl === 'string' && config.feedUrl) ||
      '';
    if (!input) return null;
    try {
      await assertPublicUrl(input);
    } catch {
      return null;
    }
    const feed = await fetchPage(input, {
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml'
    });
    const found = firstMatch(feed, [
      /<itunes:image[^>]+href="([^"]+)"/i,
      /<image>[\s\S]*?<url>([^<]+)<\/url>/i,
      /<media:thumbnail[^>]+url="([^"]+)"/i,
      /<logo>([^<]+)<\/logo>/i
    ]);
    if (found) return found;
    try {
      const host = new URL(input).hostname;
      return `https://${host}/favicon.ico`;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * URL da imagem da fonte. Revalida a cada 3 dias; o resultado é guardado no
 * config da própria fonte, então a UI não precisa buscar de novo a cada card.
 */
export async function sourceImageUrl(id: string): Promise<string | null> {
  const row = getSourceRow(id);
  if (!row) return null;
  const config = parseJson<Record<string, unknown>>(row.config, {});
  const cached = typeof config.imageUrl === 'string' ? config.imageUrl : null;
  const checkedAt = typeof config.imageCheckedAt === 'number' ? config.imageCheckedAt : 0;
  if (cached && Date.now() - checkedAt < IMAGE_TTL_MS) return cached;

  let imageUrl: string | null = null;
  try {
    imageUrl = await resolveImage(row.type, config);
  } catch {
    imageUrl = null;
  }

  updateSource(id, {
    config: {
      ...config,
      imageUrl: imageUrl ?? undefined,
      imageCheckedAt: Date.now()
    }
  });
  return imageUrl;
}
