/** Indicador "na biblioteca" do Stremio. */
import { Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StremioBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded bg-accent/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent',
        className
      )}
    >
      <Clapperboard className="h-2.5 w-2.5" /> Na biblioteca
    </span>
  );
}
