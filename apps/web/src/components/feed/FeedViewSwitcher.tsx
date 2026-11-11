/** Seletor de layout do feed: estilo Flix, lista ou grade. */
import { LayoutGrid, LayoutList, MonitorPlay } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type FeedView = 'list' | 'grid' | 'netflix';

const OPTIONS: Array<{ id: FeedView; label: string; icon: typeof LayoutList }> = [
  { id: 'netflix', label: 'Estilo Flix', icon: MonitorPlay },
  { id: 'list', label: 'Lista', icon: LayoutList },
  { id: 'grid', label: 'Grade', icon: LayoutGrid }
];

export function FeedViewSwitcher({ view, onChange }: { view: FeedView; onChange: (view: FeedView) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex shrink-0 rounded-xl border border-line bg-bg/50 p-0.5" role="group" aria-label={t('Formato do feed')}>
      {OPTIONS.map((option) => {
        const active = view === option.id;
        return (
          <button
            key={option.id}
            type="button"
            title={t(option.label)}
            aria-label={t(option.label)}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg transition',
              active ? 'bg-elevated text-fg shadow-sm' : 'text-faint hover:text-muted'
            )}
          >
            <option.icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
