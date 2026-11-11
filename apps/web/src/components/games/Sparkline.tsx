/** Mini gráfico de preços usado nos cards (SVG puro, zero dependências). */
import type { PricePointDto } from '@hub/shared';
import { cn } from '@/lib/utils';

export function Sparkline({ points, className }: { points: PricePointDto[]; className?: string }) {
  const values = points
    .map((point) => point.officialCents ?? point.keyshopCents)
    .filter((value): value is number => typeof value === 'number');

  if (values.length < 2) {
    return <div className={cn('h-7 w-20', className)} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const padding = 2;
  const step = width / (values.length - 1);

  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-7 w-20', className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
