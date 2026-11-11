/** Card de jogo no Feed: um por jogo, com o menor preço atual e acesso ao modal. */
import type { KeyboardEvent, MouseEvent } from 'react';
import { Clock, ExternalLink, Gamepad2, Mail, MailOpen, Star } from 'lucide-react';
import type { FeedItemDto, GameDto } from '@hub/shared';
import { IconButton } from '@/components/ui';
import { pickGamePrice } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, formatMoney, formatRelative } from '@/lib/utils';

const MARKET_LABELS: Record<string, string> = {
  official: 'oficial',
  keyshop: 'keyshop',
  steam: 'Steam'
};

export function GameFeedCard({
  game,
  item,
  variant,
  onOpen,
  onToggleRead,
  onToggleFavorite,
  onToggleWatchLater
}: {
  game: GameDto;
  item: FeedItemDto;
  variant: 'list' | 'grid' | 'row';
  onOpen: () => void;
  onToggleRead: () => void;
  onToggleFavorite: () => void;
  onToggleWatchLater: () => void;
}) {
  const { t } = useI18n();
  const price = pickGamePrice(game, false);
  const atLow = price.cents !== null && price.lowCents !== null && price.cents <= price.lowCents + 1;
  const imageUrl =
    game.headerUrl ??
    game.coverUrl ??
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  const ggUrl = game.ggUrl ?? `https://gg.deals/steam/app/${game.appid}/`;
  const targetReached =
    game.targetPriceCents !== null && price.cents !== null && price.cents <= game.targetPriceCents;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  const actions = (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-lg bg-black/45 p-0.5 backdrop-blur-sm',
        variant === 'list' ? 'sm:opacity-0 sm:transition sm:group-hover:opacity-100' : ''
      )}
    >
      <IconButton
        label={item.isRead ? t('Marcar como não lido') : t('Marcar como lido')}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onToggleRead();
        }}
        active={item.isRead}
        className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
      >
        {item.isRead ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
      </IconButton>
      <IconButton
        label={item.isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        active={item.isFavorite}
        className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
      >
        <Star className={cn('h-3.5 w-3.5', item.isFavorite && 'fill-current text-warning')} />
      </IconButton>
      <IconButton
        label={item.isWatchLater ? t('Remover de ver depois') : t('Salvar para ver depois')}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onToggleWatchLater();
        }}
        active={item.isWatchLater}
        tone="accent"
        className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
      >
        <Clock className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );

  const body = (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-2">
        <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug text-fg">
          {game.name}
        </h3>
        {atLow ? (
          <span className="shrink-0 rounded bg-warning/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#1a1200]">
            {t('mínima')}
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-bold tracking-tight text-fg">
          {formatMoney(price.cents, game.currency)}
        </span>
        {price.market ? (
          <span className="text-[9px] font-medium uppercase tracking-wide text-faint">
            {t(MARKET_LABELS[price.market])}
          </span>
        ) : null}
        {price.discount > 0 ? (
          <span className="text-[10px] font-semibold text-success">-{price.discount}%</span>
        ) : null}
        {price.cents !== null && game.steamBaseCents !== null && price.cents < game.steamBaseCents ? (
          <span className="text-[10px] text-faint line-through">
            {formatMoney(game.steamBaseCents, game.currency)}
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 text-[10px] text-faint">
        <span>
          {price.lowCents !== null
            ? `${t('Mínima:')} ${formatMoney(price.lowCents, game.currency)}`
            : t('Sem histórico ainda')}
        </span>
        {game.targetPriceCents !== null ? (
          <span className={cn(targetReached && 'font-semibold text-success')}>
            · {t('Alvo:')} {formatMoney(game.targetPriceCents, game.currency)}
          </span>
        ) : null}
        <span className="truncate">· {item.sourceName}</span>
        <time dateTime={item.publishedAt} title={formatRelative(item.publishedAt)}>
          · {formatRelative(item.publishedAt)}
        </time>
        <a
          href={ggUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-accent transition hover:underline"
        >
          gg.deals <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );

  if (variant === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={onKeyDown}
        aria-label={`${t('Abrir detalhes de')} ${game.name}`}
        className="card group relative flex cursor-pointer gap-3 p-3 text-left transition hover:border-accent/35 hover:bg-elevated/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:gap-4 sm:p-4"
      >
        <div className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded-xl border border-line bg-elevated sm:w-[150px]">
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
          <Gamepad2 className="pointer-events-none absolute inset-0 m-auto h-6 w-6 text-white/30" />
        </div>
        <div className="min-w-0 flex-1">{body}</div>
        <div className="absolute right-2 top-2">{actions}</div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={`${t('Abrir detalhes de')} ${game.name}`}
      className={cn(
        'group flex cursor-pointer flex-col text-left focus-visible:outline-none',
        variant === 'row' && 'w-[15rem] shrink-0'
      )}
    >
      <div className="relative aspect-[460/215] w-full overflow-hidden rounded-xl border border-line/70 bg-elevated">
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
        <Gamepad2 className="pointer-events-none absolute inset-0 m-auto h-7 w-7 text-white/30" />
        {price.discount > 0 ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-success px-1.5 py-0.5 text-[10px] font-bold text-[#04120c] shadow">
            -{price.discount}%
          </span>
        ) : null}
        <div className="absolute right-1.5 top-1.5">{actions}</div>
      </div>
      <div className="mt-1.5 flex min-w-0 flex-1 flex-col">{body}</div>
    </div>
  );
}
