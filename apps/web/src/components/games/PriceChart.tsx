/** Gráfico de histórico de preços do modal de detalhe. */
import { format, parseISO } from 'date-fns';
import { enUS, es, ptBR } from 'date-fns/locale';
import type { PricePointDto } from '@hub/shared';
import { formatMoney } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export function PriceChart({ points, currency }: { points: PricePointDto[]; currency: string }) {
  const { t, language } = useI18n();
  const locale = language === 'en' ? enUS : language === 'es' ? es : ptBR;
  const values = points
    .map((point) => ({
      day: point.day,
      value: point.officialCents ?? point.keyshopCents
    }))
    .filter((point): point is { day: string; value: number } => typeof point.value === 'number');

  if (values.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-line/60 bg-bg/40 text-xs text-faint">
        {t('O histórico começa a ser registrado a partir da primeira verificação de preço.')}
      </div>
    );
  }

  const width = 640;
  const height = 210;
  const padX = 58;
  const padY = 22;
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const range = max - min || 1;

  const xOf = (index: number): number => padX + (index / (values.length - 1)) * (width - padX - 12);
  const yOf = (value: number): number => padY + (1 - (value - min) / range) * (height - padY * 2);

  const line = values
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)}`)
    .join(' ');

  const area = `${line} L ${xOf(values.length - 1).toFixed(1)},${height - padY} L ${xOf(0).toFixed(1)},${height - padY} Z`;

  const gridValues = [max, min + range * 0.66, min + range * 0.33, min];
  const first = values[0];
  const last = values[values.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={t('Histórico de preços')}>
      <defs>
        <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridValues.map((value, index) => (
        <g key={index}>
          <line
            x1={padX}
            x2={width - 12}
            y1={yOf(value)}
            y2={yOf(value)}
            stroke="var(--c-line)"
            strokeWidth="1"
            strokeDasharray={index === gridValues.length - 1 ? undefined : '3 4'}
          />
          <text x={padX - 8} y={yOf(value) + 3} textAnchor="end" fontSize="10" fill="var(--c-faint)">
            {formatMoney(Math.round(value), currency)}
          </text>
        </g>
      ))}

      <path d={area} fill="url(#price-area)" />
      <path
        d={line}
        fill="none"
        stroke="var(--c-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={xOf(values.length - 1)} cy={yOf(last.value)} r="3.5" fill="var(--c-accent)" />

      {first ? (
        <text x={xOf(0)} y={height - 4} textAnchor="start" fontSize="10" fill="var(--c-faint)">
          {format(parseISO(first.day), 'dd MMM', { locale })}
        </text>
      ) : null}
      {last ? (
        <text x={xOf(values.length - 1)} y={height - 4} textAnchor="end" fontSize="10" fill="var(--c-faint)">
          {format(parseISO(last.day), 'dd MMM', { locale })}
        </text>
      ) : null}
    </svg>
  );
}
