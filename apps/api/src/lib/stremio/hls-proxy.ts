/**
 * Proxy same-origin do HLS do Stremio Server.
 * O servidor local não envia CORS para o Hub, então o hls.js não consegue
 * buscar master/playlists/segmentos diretamente. Aqui reescrevemos as URIs
 * das playlists para voltarem por esta rota.
 */
import { getStremioServerUrl } from './server';

const HLS_TIMEOUT_MS = 30_000;
const HLS_MAX_BYTES = 64 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

export interface HlsProxyResult {
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string | Buffer;
}

function assertStremioServerUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL de HLS inválida.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('O HLS precisa usar http ou https.');
  }
  const base = new URL(getStremioServerUrl());
  if (parsed.origin !== base.origin) {
    throw new Error('Só é permitido proxiar HLS do Stremio Server configurado.');
  }
  return parsed;
}

function proxyUrl(absolute: string): string {
  return `/api/stremio/hls?url=${encodeURIComponent(absolute)}`;
}

/** Reescreve URIs de master/media playlist para o proxy local. */
export function rewriteHlsPlaylist(text: string, baseUrl: string): string {
  const rewrite = (value: string): string => {
    try {
      return proxyUrl(new URL(value, baseUrl).toString());
    } catch {
      return value;
    }
  };

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${rewrite(uri)}"`);
      }
      return rewrite(trimmed);
    })
    .join('\n');
}

export async function proxyStremioHls(
  url: string,
  rangeHeader?: string | undefined
): Promise<HlsProxyResult> {
  const parsed = assertStremioServerUrl(url);

  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HLS_TIMEOUT_MS),
      headers: {
        accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, video/*, */*;q=0.5',
        'user-agent': USER_AGENT,
        ...(rangeHeader ? { range: rangeHeader } : {})
      }
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new Error(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'O Stremio Server demorou demais para responder.'
        : 'Não foi possível falar com o Stremio Server.'
    );
  }

  if (!response.ok && response.status !== 206) {
    throw new Error(`O Stremio Server respondeu HTTP ${response.status}.`);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > HLS_MAX_BYTES) throw new Error('O segmento de HLS é grande demais.');

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const isPlaylist =
    /mpegurl/i.test(contentType) || /\.m3u8$/i.test(new URL(response.url || parsed).pathname);

  const headers: Record<string, string> = {
    'cache-control': 'private, max-age=5'
  };
  const acceptRanges = response.headers.get('accept-ranges');
  if (acceptRanges) headers['accept-ranges'] = acceptRanges;
  const contentRange = response.headers.get('content-range');
  if (contentRange) headers['content-range'] = contentRange;

  if (isPlaylist) {
    const text = await response.text();
    headers['content-type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
    headers['cache-control'] = 'private, max-age=2';
    return {
      status: 200,
      contentType: headers['content-type'],
      headers,
      body: rewriteHlsPlaylist(text, response.url || parsed.toString())
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > HLS_MAX_BYTES) throw new Error('O segmento de HLS é grande demais.');
  headers['content-type'] = contentType;
  return {
    status: response.status === 206 ? 206 : 200,
    contentType,
    headers,
    body: buffer
  };
}
