import { createPortal } from 'react-dom';
import { BookOpen, Clock, ExternalLink, Star, X } from 'lucide-react';
import type { FeedItemDto } from '@hub/shared';
import { Chip, Thumb } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';

/**
 * Prévia do card em popup (Android). No desktop a mesma informação aparece no
 * hover; no toque não existe hover, então usamos long-press + modal.
 */
export function ItemPreviewModal({
  item,
  onClose,
  onOpen,
  onExternal,
  onToggleFavorite,
  onToggleWatchLater
}: {
  item: FeedItemDto;
  onClose: () => void;
  onOpen: () => void;
  onExternal: () => void;
  onToggleFavorite: () => void;
  onToggleWatchLater: () => void;
}) {
  const { t } = useI18n();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative">
          <Thumb
            src={item.thumbnailUrl}
            categoryId={item.categoryId}
            kind={item.kind}
            alt=""
            className="aspect-video w-full"
          />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur"
            aria-label={t('Fechar')}
          >
            <X className="h-4 w-4" />
          </button>
          <span className="absolute left-2 top-2">
            <Chip color="#7c9cff">{item.categoryLabel}</Chip>
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-faint">
              {item.sourceName} · {formatDateTime(item.publishedAt)}
            </p>
            <h2 className="mt-1 text-lg font-semibold leading-snug text-fg">{item.title}</h2>
          </div>

          {item.description ? (
            <p className="text-sm leading-relaxed text-muted">{item.description}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {item.kind === 'chapter' || item.kind === 'article' ? t('Ler aqui') : t('Abrir')}
            </button>
            <button
              type="button"
              onClick={onExternal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('Abrir no site')}
            </button>
            <button
              type="button"
              onClick={onToggleFavorite}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted"
            >
              <Star className={item.isFavorite ? 'h-3.5 w-3.5 fill-current text-warning' : 'h-3.5 w-3.5'} />
              {item.isFavorite ? t('Favorito') : t('Favoritar')}
            </button>
            <button
              type="button"
              onClick={onToggleWatchLater}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted"
            >
              <Clock className={item.isWatchLater ? 'h-3.5 w-3.5 text-accent' : 'h-3.5 w-3.5'} />
              {item.isWatchLater ? t('Assistir depois') : t('Ver depois')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
