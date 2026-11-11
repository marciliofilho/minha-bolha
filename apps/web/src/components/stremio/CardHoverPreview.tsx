/**
 * Prévia que se abre ao lado do card depois de alguns segundos de hover.
 * Mostra capa, nota IMDb, sinopse e trailer (mudo). Renderizada num portal
 * para não ser cortada pelo overflow do carrossel horizontal.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, Clock, ExternalLink, Play, Plus, Star } from 'lucide-react';
import type { StremioCardInfoDto } from '@hub/shared';
import { useI18n } from '@/lib/i18n';
import { useSettings, useStremioCardInfo } from '@/lib/queries';

const DEFAULT_HOVER_DELAY_MS = 3000;
const PREFETCH_DELAY_MS = 400;
const CLOSE_DELAY_MS = 220;
const PANEL_WIDTH = 360;

function canHover(): boolean {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

export function CardHoverPreview({
  type,
  metaId,
  name,
  poster,
  info,
  onPlay,
  playLabel = 'Assistir',
  inLibrary = false,
  isFavorite = false,
  isWatchLater = false,
  onAddToLibrary,
  onRemoveFromLibrary,
  onToggleFavorite,
  onToggleWatchLater,
  children
}: {
  type: 'movie' | 'series';
  metaId: string;
  name: string;
  poster: string | null;
  info?: StremioCardInfoDto | null;
  onPlay?: () => void;
  playLabel?: string;
  /** Já está na biblioteca do Stremio ou na Minha biblioteca do Hub. */
  inLibrary?: boolean;
  isFavorite?: boolean;
  isWatchLater?: boolean;
  onAddToLibrary?: () => void;
  /** Só para títulos salvos apenas no Hub (permite remover da Minha biblioteca). */
  onRemoveFromLibrary?: () => void;
  onToggleFavorite?: () => void;
  onToggleWatchLater?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const settings = useSettings();
  const hoverDelayMs =
    (settings.data?.hoverPreviewSeconds ?? DEFAULT_HOVER_DELAY_MS / 1000) * 1000;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const expandTimer = useRef<number | null>(null);
  const prefetchTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [prefetch, setPrefetch] = useState(false);
  const selfInfo = useStremioCardInfo(
    info || !prefetch ? [] : [{ type, id: metaId, name }]
  );
  const effectiveInfo = info ?? selfInfo.data?.items[0] ?? null;

  const clearPrefetch = (): void => {
    if (prefetchTimer.current !== null) {
      window.clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  };

  const clearExpand = (): void => {
    if (expandTimer.current !== null) {
      window.clearTimeout(expandTimer.current);
      expandTimer.current = null;
    }
  };

  const clearClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const close = (): void => {
    clearClose();
    setPosition(null);
  };

  useEffect(() => {
    return () => {
      clearExpand();
      clearPrefetch();
      clearClose();
    };
  }, []);

  useEffect(() => {
    if (!position) return;
    const onScrollOrResize = () => close();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [position]);

  const open = (): void => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    let left = rect.right + 12;
    if (left + width > window.innerWidth - 8) {
      left = rect.left - width - 12;
    }
    if (left < 8) left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, rect.top - 32), Math.max(8, window.innerHeight - 460));
    setPosition({ left, top });
  };

  const onMouseEnter = (): void => {
    if (!canHover()) return;
    clearClose();
    clearExpand();
    clearPrefetch();
    if (!info && !prefetch) {
      prefetchTimer.current = window.setTimeout(() => {
        prefetchTimer.current = null;
        setPrefetch(true);
      }, PREFETCH_DELAY_MS);
    }
    if (position) return;
    expandTimer.current = window.setTimeout(() => {
      expandTimer.current = null;
      open();
    }, hoverDelayMs);
  };

  const onMouseLeave = (): void => {
    clearExpand();
    clearPrefetch();
    if (!position) return;
    clearClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPosition(null);
    }, CLOSE_DELAY_MS);
  };

  return (
    <div ref={anchorRef} className="relative shrink-0" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}

      {position
        ? createPortal(
            <div
              role="complementary"
              aria-label={`${t('Prévia de')} ${name}`}
              className="fixed z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/50"
              style={{ left: position.left, top: position.top, width: Math.min(PANEL_WIDTH, window.innerWidth - 16) }}
              onMouseEnter={clearClose}
              onMouseLeave={onMouseLeave}
            >
              <div className="relative aspect-video w-full bg-black">
                {effectiveInfo?.trailerYtId ? (
                  <iframe
                    key={effectiveInfo.trailerYtId}
                    src={`https://www.youtube-nocookie.com/embed/${effectiveInfo.trailerYtId}?autoplay=1&mute=1&controls=1&rel=0&modestbranding=1&playsinline=1`}
                    title={`${t('Trailer de')} ${name}`}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                ) : effectiveInfo?.backdropUrl || poster ? (
                  <img
                    src={(effectiveInfo?.backdropUrl ?? poster) as string}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
                    <Play className="h-7 w-7" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
              </div>

              <div className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-fg">{name}</p>
                  {effectiveInfo?.imdbRating ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                      <Star className="h-3 w-3 fill-current" /> IMDb {effectiveInfo.imdbRating}
                    </span>
                  ) : null}
                </div>

                <p className="line-clamp-5 text-[11px] leading-relaxed text-muted">
                  {effectiveInfo?.overview ?? t('Sinopse indisponível para este título.')}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {onPlay ? (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        onPlay();
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg transition hover:brightness-110"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" /> {t(playLabel)}
                    </button>
                  ) : null}

                  {inLibrary ? (
                    onRemoveFromLibrary ? (
                      <button
                        type="button"
                        onClick={onRemoveFromLibrary}
                        title={t('Remover da Minha biblioteca')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-fg transition hover:border-accent/60"
                      >
                        <Check className="h-3.5 w-3.5 text-accent" /> {t('Na biblioteca')}
                      </button>
                    ) : (
                      <span
                        title={t('Já está na biblioteca')}
                        className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-medium text-muted"
                      >
                        <Check className="h-3.5 w-3.5" /> {t('Na biblioteca')}
                      </span>
                    )
                  ) : onAddToLibrary ? (
                    <button
                      type="button"
                      onClick={onAddToLibrary}
                      title={t('Adicionar à Minha biblioteca')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-medium text-fg transition hover:border-accent/40"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t('Minha biblioteca')}
                    </button>
                  ) : null}

                  {onToggleFavorite ? (
                    <button
                      type="button"
                      onClick={onToggleFavorite}
                      aria-pressed={isFavorite}
                      title={isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')}
                      className={
                        isFavorite
                          ? 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 text-xs font-medium text-warning transition'
                          : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-medium text-fg transition hover:border-warning/40'
                      }
                    >
                      <Star className={isFavorite ? 'h-3.5 w-3.5 fill-current' : 'h-3.5 w-3.5'} />
                      {isFavorite ? t('Favorito') : t('Favoritos')}
                    </button>
                  ) : null}

                  {onToggleWatchLater ? (
                    <button
                      type="button"
                      onClick={onToggleWatchLater}
                      aria-pressed={isWatchLater}
                      title={isWatchLater ? t('Remover de ver depois') : t('Salvar para ver depois')}
                      className={
                        isWatchLater
                          ? 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-accent transition'
                          : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-medium text-fg transition hover:border-accent/40'
                      }
                    >
                      <Clock className="h-3.5 w-3.5" />
                      {t('Ver depois')}
                    </button>
                  ) : null}

                  <Link
                    to={`/title/${type}/${encodeURIComponent(metaId)}`}
                    onClick={close}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-medium text-fg transition hover:border-accent/40"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> {t('Detalhes')}
                  </Link>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
