/** "Continuar assistindo" com o progresso local do player do Hub. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clapperboard, Eye, EyeOff, Play, Star, Trash2 } from 'lucide-react';
import type { PlaybackProgressDto, StremioCardInfoDto } from '@hub/shared';
import { HorizontalScroller } from '@/components/ui/HorizontalScroller';
import { CardHoverPreview } from '@/components/stremio/CardHoverPreview';
import { useClearPlaybackProgress, usePlaybackContinue, useSetStremioLibraryState, useStremioCardInfo, useStremioLibrary } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { formatRelative } from '@/lib/utils';
import { useStoredBoolean } from '@/lib/use-stored-boolean';

function LocalContinueCard({
  item,
  info,
  inLibrary,
  isFavorite,
  isWatchLater,
  onPlay,
  onRemove,
  onAddToLibrary,
  onRemoveFromLibrary,
  onToggleFavorite,
  onToggleWatchLater
}: {
  item: PlaybackProgressDto;
  info?: StremioCardInfoDto | null;
  inLibrary: boolean;
  isFavorite: boolean;
  isWatchLater: boolean;
  onPlay?: (item: PlaybackProgressDto) => void;
  onRemove?: () => void;
  onAddToLibrary?: () => void;
  onRemoveFromLibrary?: () => void;
  onToggleFavorite?: () => void;
  onToggleWatchLater?: () => void;
}) {
  const { t } = useI18n();
  const code =
    item.type === 'series' && item.season !== null && item.season > 0 && item.episode !== null
      ? `S${item.season}E${item.episode}`
      : item.type === 'series'
        ? t('Série')
        : t('Filme');

  const content = (
    <>
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-line bg-elevated">
        {item.poster ? (
          <img
            src={item.poster}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
            <Clapperboard className="h-7 w-7" />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </div>
        <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
          {Math.round(item.progress * 100)}%
        </span>
        {info?.imdbRating ? (
          <span className="absolute bottom-2.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-current text-warning" /> IMDb {info.imdbRating}
          </span>
        ) : null}
        {onPlay ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-fg">
        {item.name}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-faint">
        <span>{code}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{formatRelative(item.updatedAt)}</span>
        <ChevronRight className="ml-auto h-3 w-3 opacity-0 transition group-hover:opacity-100" />
      </p>
    </>
  );

  return (
    <CardHoverPreview
      type={item.type}
      metaId={item.metaId}
      name={item.name}
      poster={item.poster}
      info={info}
      onPlay={onPlay ? () => onPlay(item) : undefined}
      playLabel={t('Continuar')}
      inLibrary={inLibrary}
      isFavorite={isFavorite}
      isWatchLater={isWatchLater}
      onAddToLibrary={onAddToLibrary}
      onRemoveFromLibrary={onRemoveFromLibrary}
      onToggleFavorite={onToggleFavorite}
      onToggleWatchLater={onToggleWatchLater}
    >
      <div className="group relative w-[9.5rem] shrink-0">
        {onPlay ? (
          <button
            type="button"
            onClick={() => onPlay(item)}
            className="block w-full text-left"
            title={`${t('Continuar')} ${item.name}`}
          >
            {content}
          </button>
        ) : (
          <Link
            to={`/title/${item.type}/${encodeURIComponent(item.metaId)}`}
            draggable={false}
            className="block w-full"
            title={`${t('Abrir detalhes de')} ${item.name}`}
          >
            {content}
          </Link>
        )}

        {onRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
            aria-label={`${t('Remover')} ${item.name} · ${t('Continuar assistindo')}`}
            title={t('Remover de Continuar assistindo')}
            className="absolute left-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/90 opacity-100 backdrop-blur-sm transition hover:bg-danger hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </CardHoverPreview>
  );
}

export function LocalContinueWatchingSection({
  onPlay,
  moveControls
}: {
  onPlay?: (item: PlaybackProgressDto) => void;
  /** Botões de mover para cima/baixo exibidos apenas no Feed. */
  moveControls?: ReactNode;
} = {}) {
  const { t } = useI18n();
  const query = usePlaybackContinue();
  const [collapsed, toggleCollapsed] = useStoredBoolean('hub.local-continue.collapsed', false);
  const items = query.data?.items ?? [];
  const library = useStremioLibrary();
  const setState = useSetStremioLibraryState();
  const knownByMetaId = new Map(
    (library.data?.items ?? []).map((item) => [item.metaId, item])
  );
  const cardInfo = useStremioCardInfo(
    items.map((item) => ({ type: item.type, id: item.metaId, name: item.name }))
  );
  const infoByKey = new Map(
    (cardInfo.data?.items ?? []).map((info) => [`${info.type}:${info.id}`, info])
  );
  const clearProgress = useClearPlaybackProgress();

  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="text-sm font-semibold text-fg">{t('Continuar assistindo')}</h2>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={
              collapsed
                ? `${t('Mostrar')} ${t('Continuar assistindo')}`
                : `${t('Minimizar')} ${t('Continuar assistindo')}`
            }
            title={
              collapsed
                ? `${t('Mostrar')} ${t('Continuar assistindo')}`
                : `${t('Minimizar')} ${t('Continuar assistindo')}`
            }
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
          >
            {collapsed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          {moveControls}
        </div>
        <p className="text-[10px] text-faint">{t('Reproduzido no Hub')}</p>
      </div>
      {collapsed ? null : (
        <HorizontalScroller>
          {items.map((item) => {
            const known = knownByMetaId.get(item.metaId);
            const inLibrary = known?.inLibrary ?? false;
            const isFavorite = known?.isFavorite ?? false;
            const isWatchLater = known?.isWatchLater ?? false;
            return (
              <LocalContinueCard
                key={`${item.metaId}:${item.videoId}`}
                item={item}
                info={infoByKey.get(`${item.type}:${item.metaId}`)}
                inLibrary={inLibrary}
                isFavorite={isFavorite}
                isWatchLater={isWatchLater}
                onPlay={onPlay}
                onRemove={() =>
                  clearProgress.mutate({ metaId: item.metaId, videoId: item.videoId })
                }
                onAddToLibrary={() =>
                  setState.mutate({
                    metaId: item.metaId,
                    patch: {
                      inLibrary: true,
                      type: item.type,
                      name: item.name,
                      poster: item.poster
                    }
                  })
                }
                onRemoveFromLibrary={
                  known?.isLocal
                    ? () =>
                        setState.mutate({
                          metaId: item.metaId,
                          patch: { inLibrary: false }
                        })
                    : undefined
                }
                onToggleFavorite={() =>
                  setState.mutate({
                    metaId: item.metaId,
                    patch: {
                      isFavorite: !isFavorite,
                      type: item.type,
                      name: item.name,
                      poster: item.poster
                    }
                  })
                }
                onToggleWatchLater={() =>
                  setState.mutate({
                    metaId: item.metaId,
                    patch: {
                      isWatchLater: !isWatchLater,
                      type: item.type,
                      name: item.name,
                      poster: item.poster
                    }
                  })
                }
              />
            );
          })}
        </HorizontalScroller>
      )}
    </section>
  );
}
