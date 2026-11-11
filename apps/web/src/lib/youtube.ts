/** Extrai o ID de um vídeo do YouTube a partir do item do feed. */
import type { FeedItemDto } from '@hub/shared';

function validId(value: string | null | undefined): string | null {
  return value && /^[\w-]{11}$/.test(value) ? value : null;
}

export function youtubeVideoId(item: Pick<FeedItemDto, 'sourceType' | 'url' | 'meta'>): string | null {
  if (item.sourceType !== 'youtube') return null;

  const fromMeta = item.meta?.videoId;
  if (typeof fromMeta === 'string') {
    const valid = validId(fromMeta);
    if (valid) return valid;
  }

  try {
    const url = new URL(item.url);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      return validId(url.pathname.split('/').filter(Boolean)[0]);
    }

    const queryId = validId(url.searchParams.get('v'));
    if (queryId) return queryId;

    const pathMatch = /\/(?:shorts|embed|live)\/([\w-]{11})/.exec(url.pathname);
    if (pathMatch?.[1]) return validId(pathMatch[1]);
  } catch {
    // URL inválida: não é player
  }

  return null;
}
