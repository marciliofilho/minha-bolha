/**
 * Ação de "Minha biblioteca" para cards e prévias de filmes/séries/animes.
 * Usa a biblioteca local do Hub e também reconhece títulos já salvos no Stremio.
 */
import { BookmarkCheck, BookmarkPlus, Check } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useSetStremioLibraryState, useStremioLibrary } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function useLibraryEntry({
  type,
  metaId,
  name,
  poster
}: {
  type: 'movie' | 'series';
  metaId: string | null | undefined;
  name: string;
  poster?: string | null;
}) {
  const library = useStremioLibrary();
  const setState = useSetStremioLibraryState();
  const id = metaId?.trim() ?? '';
  const entry = id
    ? library.data?.items.find(
        (item) => item.metaId === id || (item.imdbId !== null && item.imdbId === id)
      )
    : undefined;
  const inLibrary = entry?.inLibrary ?? false;
  const canRemove = inLibrary && entry?.isLocal === true;
  const isFavorite = entry?.isFavorite ?? false;
  const isWatchLater = entry?.isWatchLater ?? false;

  const patch = (values: {
    inLibrary?: boolean;
    isFavorite?: boolean;
    isWatchLater?: boolean;
  }): void => {
    if (!id) return;
    setState.mutate({
      metaId: id,
      patch: { ...values, type, name, poster: poster ?? null }
    });
  };

  const add = (): void => patch({ inLibrary: true });
  const remove = (): void => {
    if (!id || !canRemove) return;
    patch({ inLibrary: false });
  };
  const toggleFavorite = (): void => patch({ isFavorite: !isFavorite });
  const toggleWatchLater = (): void => patch({ isWatchLater: !isWatchLater });

  return {
    available: Boolean(id),
    inLibrary,
    canRemove,
    isFavorite,
    isWatchLater,
    add,
    remove,
    toggleFavorite,
    toggleWatchLater,
    pending: setState.isPending
  };
}

export function LibraryToggleButton({
  type,
  metaId,
  name,
  poster,
  variant = 'icon',
  tone = 'default',
  className
}: {
  type: 'movie' | 'series';
  metaId: string | null | undefined;
  name: string;
  poster?: string | null;
  variant?: 'icon' | 'button';
  tone?: 'default' | 'overlay';
  className?: string;
}) {
  const { t } = useI18n();
  const entry = useLibraryEntry({ type, metaId, name, poster });
  if (!entry.available) return null;

  if (variant === 'icon') {
    const label = entry.inLibrary
      ? entry.canRemove
        ? t('Remover da Minha biblioteca')
        : t('Já está na biblioteca')
      : t('Adicionar à Minha biblioteca');
    return (
      <IconButton
        label={label}
        onClick={(event) => {
          event.stopPropagation();
          if (entry.inLibrary) {
            if (entry.canRemove) entry.remove();
          } else {
            entry.add();
          }
        }}
        active={entry.inLibrary}
        tone="accent"
        disabled={entry.pending || (entry.inLibrary && !entry.canRemove)}
        className={className}
      >
        {entry.inLibrary ? (
          <BookmarkCheck className="h-4 w-4" />
        ) : (
          <BookmarkPlus className="h-4 w-4" />
        )}
      </IconButton>
    );
  }

  if (entry.inLibrary && !entry.canRemove) {
    return (
      <span
        title={t('Já está na biblioteca')}
        className={cn(
          'inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg border px-3 text-xs font-medium',
          tone === 'overlay'
            ? 'border-white/20 bg-white/15 text-white/80'
            : 'border-line bg-elevated text-muted',
          className
        )}
      >
        <Check className="h-3.5 w-3.5" /> {t('Na biblioteca')}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={entry.inLibrary ? entry.remove : entry.add}
      disabled={entry.pending}
      title={entry.inLibrary ? t('Remover da Minha biblioteca') : t('Adicionar à Minha biblioteca')}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition disabled:opacity-60',
        tone === 'overlay'
          ? entry.inLibrary
            ? 'border-white/25 bg-white/20 text-white hover:bg-white/30'
            : 'border-white/20 bg-white/15 text-white hover:bg-white/25'
          : entry.inLibrary
            ? 'border-accent/40 bg-accent/10 text-fg hover:border-accent/60'
            : 'border-line bg-elevated text-fg hover:border-accent/40',
        className
      )}
    >
      {entry.inLibrary ? <Check className="h-3.5 w-3.5 text-accent" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
      {entry.inLibrary ? t('Na biblioteca') : t('Minha biblioteca')}
    </button>
  );
}
