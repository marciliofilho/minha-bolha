/** Card da grade da Wishlist. */
import { useState } from 'react';
import type { GameDto } from '@hub/shared';
import { ExternalLink, Gamepad2, Target } from 'lucide-react';
import { pickGamePrice } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
import { Sparkline } from './Sparkline';

const MARKET_LABELS: Record<string, string> = {
  official: 'oficial',
  keyshop: 'keyshop',
  steam: 'Steam'
};

export function GameCard({
  game,
  officialOnly,
  onOpen
}: {
  game: GameDto;
  officialOnly: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const price = pickGamePrice(game, officialOnly);
  const atLow = price.cents !== null && price.lowCents !== null && price.cents <= price.lowCents + 1;
  const targetReached =
    game.targetPriceCents !== null && price.cents !== null && price.cents <= game.targetPriceCents;
  const imageUrl =
    game.headerUrl ??
    game.coverUrl ??
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  const showImage = failedSrc !== imageUrl;
  const ggUrl = game.ggUrl ?? `https://gg.deals/steam/app/${game.appid}/`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${t('Abrir detalhes de')} ${game.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="card group flex cursor-pointer flex-col overflow-hidden text-left transition duration-200 hover:border-accent/35 hover:bg-elevated/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="relative aspect-[460/215] w-full overflow-hidden border-b border-line/60 bg-elevated">
        {showImage ? (
          <img
            src={imageUrl}
            alt=""
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(imageUrl)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 via-transparent to-accent-2/10 text-accent/70">
            <Gamepad2 className="h-7 w-7" />
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {price.discount > 0 ? (
            <span className="rounded-md bg-success px-1.5 py-0.5 text-[10px] font-bold text-[#04120c] shadow">
              -{price.discount}%
            </span>
          ) : null}
          {game.isDemo ? (
            <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
              demo
            </span>
          ) : null}
        </div>

        {atLow ? (
          <span className="absolute right-2 top-2 rounded-md bg-warning/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#1a1200] shadow">
            {t('mínima')}
          </span>
        ) : null}

        {game.targetPriceCents !== null ? (
          <span
            className={cn(
              'absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm',
              targetReached ? 'bg-success/90 text-[#04120c]' : 'bg-black/55 text-white'
            )}
          >
            <Target className="h-3 w-3" />
            {formatMoney(game.targetPriceCents, game.currency)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-fg">{game.name}</h3>

        <div className="mt-1.5 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <a
              href={ggUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              title={t('Ver esta oferta no gg.deals')}
              className="group/price inline-flex items-baseline gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <span className="text-base font-bold tracking-tight text-fg">
                {formatMoney(price.cents, game.currency)}
              </span>
              {price.market ? (
                <span className="text-[9px] font-medium uppercase tracking-wide text-faint">
                  {t(MARKET_LABELS[price.market])}
                </span>
              ) : null}
              <ExternalLink className="h-3 w-3 text-faint opacity-0 transition group-hover/price:opacity-100" />
            </a>
            {price.cents !== null && game.steamBaseCents !== null && price.cents < game.steamBaseCents ? (
              <p className="text-[10px] text-faint line-through">{formatMoney(game.steamBaseCents, game.currency)}</p>
            ) : null}
          </div>
          <Sparkline
            points={game.sparkline}
            className={cn('shrink-0', atLow ? 'text-warning' : 'text-accent/70')}
          />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[10px] text-faint">
          <span className="truncate">
            {price.lowCents !== null
              ? `${t('Mínima:')} ${formatMoney(price.lowCents, game.currency)}`
              : t('Sem histórico ainda')}
          </span>
          <span className="shrink-0">
            Steam · {game.isDemo ? t('Demo') : game.inWishlist ? t('Na wishlist') : t('Manual')}
          </span>
        </div>
      </div>
    </div>
  );
}
