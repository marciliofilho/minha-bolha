/** Card vertical usado nas visualizações em grade e "Netflix". */
import type { MouseEvent } from 'react';
import { CheckCheck, Clock, Mail, MailOpen, Star } from 'lucide-react';
import type { FeedItemDto } from '@hub/shared';
import { useI18n } from '@/lib/i18n';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { Chip, IconButton, Thumb } from '@/components/ui';
import { StremioBadge } from '@/components/stremio/StremioBadge';
import { LibraryToggleButton } from '@/components/stremio/LibraryToggleButton';

interface ItemTileProps {
  item: FeedItemDto;
  variant: 'grid' | 'row';
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
  onToggleRead: () => void;
  onToggleFavorite: () => void;
  onToggleWatchLater: () => void;
  /** Para capítulos de novel: salva este capítulo como último lido. */
  onSetNovelProgress?: () => void;
}

export function ItemTile({
  item,
  variant,
  onOpen,
  onToggleRead,
  onToggleFavorite,
  onToggleWatchLater,
  onSetNovelProgress
}: ItemTileProps) {
  const { t } = useI18n();
  const isChapter = item.kind === 'chapter';
  const libraryType: 'movie' | 'series' | null = item.mediaKind
    ? item.mediaKind === 'movie'
      ? 'movie'
      : 'series'
    : null;

  return (
    <article
      className={cn(
        'group flex flex-col',
        variant === 'row' && (isChapter ? 'w-[10.5rem] shrink-0' : 'w-[15rem] shrink-0')
      )}
    >
      <div className="relative overflow-hidden rounded-xl border border-line/70 bg-elevated">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          onClick={onOpen}
          className={cn('block w-full', isChapter ? 'aspect-[3/4]' : 'aspect-video')}
          aria-label={`Abrir: ${item.title}`}
        >
          <Thumb
            src={item.thumbnailUrl}
            categoryId={item.categoryId}
            kind={item.kind}
            alt=""
            className="h-full w-full rounded-none border-0"
          />
        </a>

        {!item.isRead ? (
          <span
            className="pointer-events-none absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface"
            aria-label={t('Não lido')}
          />
        ) : null}

        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-black/45 p-0.5 backdrop-blur-sm transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <IconButton
            label={item.isRead ? t('Marcar como não lido') : t('Marcar como lido')}
            onClick={onToggleRead}
            active={item.isRead}
            className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
          >
            {item.isRead ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton
            label={item.isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')}
            onClick={onToggleFavorite}
            active={item.isFavorite}
            className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <Star className={cn('h-3.5 w-3.5', item.isFavorite && 'fill-current text-warning')} />
          </IconButton>
          {libraryType && item.imdbId ? (
            <LibraryToggleButton
              type={libraryType}
              metaId={item.imdbId}
              name={item.sourceName}
              poster={item.thumbnailUrl}
              className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
            />
          ) : null}
          <IconButton
            label={item.isWatchLater ? t('Remover de ver depois') : t('Salvar para ver depois')}
            onClick={onToggleWatchLater}
            active={item.isWatchLater}
            tone="accent"
            className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <Clock className="h-3.5 w-3.5" />
          </IconButton>
        </div>

        {variant === 'row' ? (
          <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {item.categoryLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 flex min-w-0 flex-1 flex-col">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          onClick={onOpen}
          className="min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <h3
            className={cn(
              'line-clamp-2 text-xs font-semibold leading-snug sm:text-[13px]',
              item.isRead ? 'text-muted' : 'text-fg'
            )}
          >
            {item.title}
          </h3>
        </a>

        {variant === 'grid' && item.description ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-faint">{item.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1.5 text-[10px] text-faint">
          {variant === 'grid' ? <Chip>{t(item.categoryLabel)}</Chip> : null}
          <span className="max-w-[9rem] truncate">{item.sourceName}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.publishedAt} title={formatRelative(item.publishedAt)}>
            {isChapter ? formatDateTime(item.publishedAt) : formatRelative(item.publishedAt)}
          </time>
          {isChapter && onSetNovelProgress ? (
            <button
              type="button"
              onClick={onSetNovelProgress}
              title={t('Lembrar este capítulo como o último lido')}
              className="inline-flex items-center gap-1 rounded border border-line bg-elevated px-1 py-0.5 font-medium text-accent transition hover:border-accent/40"
            >
              <CheckCheck className="h-2.5 w-2.5" />
              {t('Lido até aqui')}
            </button>
          ) : null}
          {item.isFavorite ? <Star className="h-2.5 w-2.5 fill-current text-warning" aria-label={t('Favorito')} /> : null}
          {item.isWatchLater ? <Clock className="h-2.5 w-2.5 text-accent" aria-label={t('Ver depois')} /> : null}
          {item.inStremioLibrary ? <StremioBadge /> : null}
        </div>
      </div>
    </article>
  );
}

