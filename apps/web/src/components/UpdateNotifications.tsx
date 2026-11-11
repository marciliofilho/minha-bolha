/** Notificações de novos conteúdos detectados pelos conectores (SSE). */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Film, Rss, Tv, X, Youtube } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { formatRelative } from '@/lib/utils';
import {
  NOTIFICATION_EVENT,
  notificationAllowed,
  playNotificationSound,
  primeNotificationSound,
  type ContentNotification
} from '@/lib/notifications';

const NOTIFICATION_TTL_MS = 8_000;
const MAX_NOTIFICATIONS = 3;

function NotificationCard({
  item,
  onDismiss,
  onOpen
}: {
  item: ContentNotification;
  onDismiss: (key: string) => void;
  onOpen: (item: ContentNotification) => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.dedupeKey), NOTIFICATION_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [item.dedupeKey, onDismiss]);

  const meta = item.meta ?? {};
  const season = typeof meta.season === 'number' ? meta.season : null;
  const episode = typeof meta.episode === 'number' ? meta.episode : null;
  const chapterName = typeof meta.chapterName === 'string' ? meta.chapterName : null;
  const bookTitle = typeof meta.bookTitle === 'string' ? meta.bookTitle : null;
  const isNovel = item.kind === 'chapter' || item.categoryId === 'novel' || Boolean(chapterName);
  const isYoutube = item.sourceType === 'youtube' || item.categoryId === 'youtube';
  const isMovie =
    !isNovel &&
    !isYoutube &&
    (item.categoryId === 'movie' ||
      meta.mediaKind === 'movie' ||
      (item.kind === 'release' && meta.releaseKind === 'movie'));
  const coverUrl =
    item.thumbnailUrl ??
    (isNovel && typeof meta.coverUrl === 'string' ? meta.coverUrl : null);
  const displayTitle = isNovel && bookTitle ? bookTitle : item.title;

  const label = isNovel
    ? chapterName
      ? `${t('Capítulo:')} ${chapterName}`
      : t('Novo capítulo')
    : season !== null && episode !== null
      ? `T${season}E${episode}`
      : isYoutube
        ? t('Novo vídeo')
        : isMovie
          ? t('Novo filme')
          : t('Novo conteúdo');
  const Icon = isNovel
    ? BookOpen
    : isYoutube
      ? Youtube
      : isMovie
        ? Film
        : season !== null
          ? Tv
          : Rss;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen(item);
      }}
      aria-label={`${t('Abrir')} ${displayTitle} ${t('no player do Feed')}`}
      title={t('Abrir no player do Feed')}
      className="pointer-events-auto w-full max-w-md cursor-pointer overflow-hidden rounded-xl border border-line bg-surface/95 text-left shadow-2xl shadow-black/40 backdrop-blur-xl transition hover:border-accent/50 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="flex items-stretch gap-3 p-2.5">
        <div className="h-[74px] w-[52px] shrink-0 overflow-hidden rounded-lg border border-line/70 bg-elevated">
          {coverUrl && !failed ? (
            <img
              src={coverUrl}
              alt=""
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 py-0.5">
          <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-accent">
            <Icon className="h-3 w-3" />
            {label}
            <span className="font-normal text-faint">· {item.sourceName}</span>
          </p>
          <p className="mt-1 line-clamp-2 text-xs font-semibold leading-snug text-fg">{displayTitle}</p>
          <p className="mt-0.5 text-[10px] text-faint">{formatRelative(item.publishedAt)}</p>
        </div>

        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss(item.dedupeKey);
            }}
            aria-label={t('Fechar notificação')}
            title={t('Fechar notificação')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateNotifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ContentNotification[]>([]);

  useEffect(() => {
    const onNewItems = (event: Event) => {
      const detail = (event as CustomEvent<ContentNotification[]>).detail;
      if (!Array.isArray(detail) || detail.length === 0) return;
      const allowed = detail.filter(notificationAllowed);
      if (allowed.length === 0) return;
      playNotificationSound();
      setItems((previous) => {
        const map = new Map<string, ContentNotification>();
        for (const item of [...allowed, ...previous]) {
          if (!item || typeof item.dedupeKey !== 'string') continue;
          if (!map.has(item.dedupeKey)) map.set(item.dedupeKey, item);
        }
        return [...map.values()].slice(0, MAX_NOTIFICATIONS);
      });
    };

    // O navegador só libera áudio depois de um gesto; desbloqueia no primeiro clique.
    const unlockAudio = (): void => primeNotificationSound();
    window.addEventListener('pointerdown', unlockAudio, { once: true });

    window.addEventListener(NOTIFICATION_EVENT, onNewItems);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener(NOTIFICATION_EVENT, onNewItems);
    };
  }, []);

  const dismiss = (key: string): void => {
    setItems((previous) => previous.filter((item) => item.dedupeKey !== key));
  };

  const openNotification = (item: ContentNotification): void => {
    dismiss(item.dedupeKey);
    navigate('/', { state: { notification: item } });
  };

  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-3"
    >
      {items.map((item) => (
        <NotificationCard
          key={item.dedupeKey}
          item={item}
          onDismiss={dismiss}
          onOpen={openNotification}
        />
      ))}
    </div>
  );
}
