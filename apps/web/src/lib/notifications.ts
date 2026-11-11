/** Notificações de novos conteúdos: dados, abertura no Feed e som. */
import type { FeedItemDto, ItemKind, MediaKind, SourceType } from '@hub/shared';
import type { StreamTarget } from '@/components/stremio/StreamPicker';
import { youtubeVideoId } from '@/lib/youtube';

export interface ContentNotification {
  dedupeKey: string;
  id?: string | null;
  title: string;
  kind: ItemKind;
  thumbnailUrl: string | null;
  meta: Record<string, unknown> | null;
  sourceName: string;
  sourceType: SourceType;
  categoryId: string;
  url: string;
  publishedAt: string;
  imdbId?: string | null;
  mediaKind?: MediaKind | null;
  /** Notificação gerada pelo botão de teste; ignora os filtros. */
  test?: boolean;
}

export const NOTIFICATION_EVENT = 'hub:items-new';
export const NOTIFICATION_PREFS_KEY = 'hub.notifications.categories';

/** null = todos os feeds; array = somente as categorias listadas. */
export function readNotificationCategories(): string[] | null {
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return null;
  }
}

export function writeNotificationCategories(categories: string[] | null): void {
  try {
    if (categories === null) {
      window.localStorage.removeItem(NOTIFICATION_PREFS_KEY);
    } else {
      window.localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(categories));
    }
  } catch {
    // Armazenamento indisponível.
  }
}

export function notificationAllowed(item: ContentNotification): boolean {
  if (item.test) return true;
  const categories = readNotificationCategories();
  if (categories === null) return true;
  if (categories.length === 0) return false;
  return categories.includes(item.categoryId);
}

/** Converte a notificação em item do Feed (para tocar vídeos do YouTube no destaque). */
export function feedItemFromNotification(item: ContentNotification): FeedItemDto {
  return {
    id: item.id ?? item.dedupeKey,
    sourceId: '',
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    categoryId: item.categoryId,
    categoryLabel: '',
    kind: item.kind,
    title: item.title,
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    description: null,
    author: null,
    publishedAt: item.publishedAt,
    isRead: true,
    isFavorite: false,
    isWatchLater: false,
    meta: item.meta,
    imdbId: item.imdbId ?? null,
    mediaKind: item.mediaKind ?? null,
    inStremioLibrary: false
  };
}

/** Alvo do player para o clique na notificação de filme/série/anime. */
export function notificationStreamTarget(item: ContentNotification): StreamTarget | null {
  const imdbId = item.imdbId ?? null;
  if (!imdbId) return null;

  const isMovie = item.mediaKind === 'movie' || item.categoryId === 'movie';
  const isSeries =
    !isMovie &&
    (item.mediaKind === 'series' ||
      item.mediaKind === 'anime' ||
      item.categoryId === 'series' ||
      item.categoryId === 'anime');
  if (!isMovie && !isSeries) return null;

  const type: 'movie' | 'series' = isMovie ? 'movie' : 'series';
  const meta = item.meta ?? {};
  const season = type === 'series' && typeof meta.season === 'number' ? meta.season : null;
  const episode = type === 'series' && typeof meta.episode === 'number' ? meta.episode : null;

  return {
    title: type === 'series' ? item.sourceName || item.title : item.title,
    type,
    metaId: imdbId,
    imdbId,
    poster: item.thumbnailUrl,
    backdrop: null,
    description: null,
    year: null,
    season: type === 'series' ? (season && season > 0 ? season : 1) : null,
    episode: type === 'series' ? (episode && episode > 0 ? episode : 1) : null
  };
}

/** Notificação focável: vídeo do YouTube, filme ou série. */
export function notificationVideoId(item: ContentNotification): string | null {
  return youtubeVideoId(item);
}

// ---------------------------------------------------------------------------
// Som de notificação (Web Audio, sem arquivo externo)
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

function playTone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

/** Cria/retoma o contexto durante um gesto do usuário (botão de teste). */
export function primeNotificationSound(): void {
  const context = getAudioContext();
  if (context && context.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }
}

/** Toque leve de duas notas, usado quando uma notificação chega. */
export function playNotificationSound(): void {
  const context = getAudioContext();
  if (!context) return;

  const play = (): void => {
    const start = context.currentTime + 0.02;
    playTone(context, 783.99, start, 0.2, 0.045);
    playTone(context, 1046.5, start + 0.13, 0.28, 0.038);
  };

  if (context.state === 'suspended') {
    void context.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
}
