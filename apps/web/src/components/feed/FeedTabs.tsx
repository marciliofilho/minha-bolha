/** Abas de categoria com contador de não lidos + Favoritos/Ver depois. */
import { Fragment } from 'react';
import { Clock, Star } from 'lucide-react';
import { FAVORITES_TAB_ID, WATCH_LATER_TAB_ID, type CategoryCountDto } from '@hub/shared';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function FeedTabs({
  counts,
  active,
  onChange
}: {
  counts: CategoryCountDto[];
  active: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 py-0.5" role="tablist" aria-label={t('Categorias do feed')}>
      {counts.map((category, index) => {
        const isActive = category.id === active;
        const isFavorites = category.id === FAVORITES_TAB_ID;
        const isWatchLater = category.id === WATCH_LATER_TAB_ID;
        return (
          <Fragment key={category.id}>
            {(isFavorites || isWatchLater) && index > 0 ? (
              <span className="mx-0.5 h-4 w-px shrink-0 self-center bg-line" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(category.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                isActive
                  ? 'border-accent/40 bg-accent/10 text-fg'
                  : 'border-transparent text-muted hover:bg-elevated hover:text-fg'
              )}
            >
              {isFavorites ? (
                <Star className={cn('h-3 w-3', isActive && 'fill-current text-warning')} />
              ) : isWatchLater ? (
                <Clock className="h-3 w-3" />
              ) : null}
              <span>{t(category.label)}</span>
              {category.unread > 0 ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                    isActive ? 'bg-accent/20 text-accent' : 'bg-elevated text-faint'
                  )}
                >
                  {category.unread > 99 ? '99+' : category.unread}
                </span>
              ) : null}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
