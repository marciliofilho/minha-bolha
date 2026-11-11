/** Card do feed. */
import type { MouseEvent } from 'react';
import { CheckCheck, Clock, ExternalLink, Mail, MailOpen, Star } from 'lucide-react';
import type { FeedItemDto } from '@hub/shared';
import { useI18n } from '@/lib/i18n';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { Chip, IconButton, Thumb } from '@/components/ui';
import { StremioBadge } from '@/components/stremio/StremioBadge';
import { LibraryToggleButton } from '@/components/stremio/LibraryToggleButton';

interface ItemCardProps {
  item: FeedItemDto;
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Abre o link original sem acionar o player do hero. */
  onExternal?: () => void;
  onToggleRead: () => void;
  onToggleFavorite: () => void;
  onToggleWatchLater: () => void;
  /** Para capítulos de novel: salva este capítulo como último lido. */
  onSetNovelProgress?: () => void;
}

export function ItemCard({
  item,
  onToggleRead,
  onToggleFavorite,
  onToggleWatchLater,
  onOpen,
  onExternal,
  onSetNovelProgress
}: ItemCardProps) {
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
        'group card relative flex gap-3 p-3 transition duration-200 hover:border-accent/30 hover:bg-elevated/40 sm:gap-4 sm:p-4',
        !item.isRead && 'border-line/90'
      )}
    >
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        onClick={onOpen}
        className={cn('relative shrink-0', isChapter ? 'w-[84px] sm:w-[112px]' : 'w-[104px] sm:w-[150px]')}
        aria-label={`Abrir: ${item.title}`}
      >
        <Thumb
          src={item.thumbnailUrl}
          categoryId={item.categoryId}
          kind={item.kind}
          alt=""
          className={cn('w-full', isChapter ? 'aspect-[3/4]' : 'aspect-video')}
        />
        {!item.isRead ? (
          <span
            className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface"
            aria-label={t('Não lido')}
          />
        ) : null}
      </a>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1.5">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            onClick={onOpen}
            className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <h3
              className={cn(
                'line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.01em] sm:text-[15px]',
                item.isRead ? 'text-muted' : 'text-fg'
              )}
            >
              {item.title}
            </h3>
          </a>

          <div className="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <IconButton
              label={item.isRead ? t('Marcar como não lido') : t('Marcar como lido')}
              onClick={onToggleRead}
              active={item.isRead}
            >
              {item.isRead ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            </IconButton>
            <IconButton
              label={item.isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')}
              onClick={onToggleFavorite}
              active={item.isFavorite}
            >
              <Star className={cn('h-4 w-4', item.isFavorite && 'fill-current')} />
            </IconButton>
            {libraryType && item.imdbId ? (
              <LibraryToggleButton
                type={libraryType}
                metaId={item.imdbId}
                name={item.sourceName}
                poster={item.thumbnailUrl}
              />
            ) : null}
            <IconButton
              label={item.isWatchLater ? t('Remover de ver depois') : t('Salvar para ver depois')}
              onClick={onToggleWatchLater}
              active={item.isWatchLater}
              tone="accent"
            >
              <Clock className="h-4 w-4" />
            </IconButton>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              title={t('Abrir link original')}
              aria-label={t('Abrir link original')}
              onClick={onExternal}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg sm:inline-flex"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>

        {item.description ? (
          <p className="mt-1 hidden line-clamp-2 text-xs leading-relaxed text-muted sm:block">{item.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[11px] text-faint">
          <Chip color={undefined}>{t(item.categoryLabel)}</Chip>
          <span className="max-w-[42%] truncate">{item.sourceName}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.publishedAt} title={formatRelative(item.publishedAt)}>
            {isChapter ? formatDateTime(item.publishedAt) : formatRelative(item.publishedAt)}
          </time>
          {isChapter && onSetNovelProgress ? (
            <button
              type="button"
              onClick={onSetNovelProgress}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-1.5 py-0.5 font-medium text-accent transition hover:border-accent/40"
              title={t('Lembrar este capítulo como o último lido')}
            >
              <CheckCheck className="h-3 w-3" />
              {t('Lido até aqui')}
            </button>
          ) : null}
          {item.isFavorite ? <Star className="h-3 w-3 fill-current text-warning" aria-label={t('Favorito')} /> : null}
          {item.isWatchLater ? <Clock className="h-3 w-3 text-accent" aria-label={t('Ver depois')} /> : null}
          {item.inStremioLibrary ? <StremioBadge /> : null}
        </div>
      </div>
    </article>
  );
}

