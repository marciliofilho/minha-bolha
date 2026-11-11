/** Modal de detalhe de um jogo: mercados, histórico e preço-alvo. */
import { useEffect, useState } from 'react';
import { ExternalLink, Gamepad2, Loader2, RefreshCw, Target } from 'lucide-react';
import type { GameDetailDto } from '@hub/shared';
import { Button, Chip, ErrorBanner, InfoBanner, Modal, SuccessNote } from '@/components/ui';
import { useDeleteGame, useGame, useRefreshGamePrice, useUpdateGame } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, formatMoney, formatRelative, parseMoneyInput } from '@/lib/utils';
import { PriceChart } from './PriceChart';

function MarketCard({
  title,
  price,
  low,
  discount,
  currency,
  href
}: {
  title: string;
  price: number | null;
  low: number | null;
  discount: number;
  currency: string;
  href: string;
}) {
  const { t } = useI18n();
  const atLow = price !== null && low !== null && price <= low + 1;
  return (
    <div className="rounded-xl border border-line/70 bg-bg/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t(title)}</p>
        {atLow ? (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">
            {t('mínima')}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-lg font-bold tracking-tight text-fg">{formatMoney(price, currency)}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-faint">
        {discount > 0 ? <span className="font-semibold text-success">-{discount}%</span> : null}
        <span>{low !== null ? `${t('mínima')} ${formatMoney(low, currency)}` : t('sem histórico')}</span>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-accent transition hover:underline"
      >
        {t('Ver oferta no gg.deals')} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function GameBody({ game, onClose }: { game: GameDetailDto; onClose: () => void }) {
  const { t } = useI18n();
  const update = useUpdateGame();
  const remove = useDeleteGame();
  const refresh = useRefreshGamePrice();

  const [target, setTarget] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setTarget(
      game.targetPriceCents !== null ? (game.targetPriceCents / 100).toFixed(2).replace('.', ',') : ''
    );
    setMessage(null);
    setError(null);
    setConfirmDelete(false);
    setImageFailed(false);
  }, [game.id]);

  const steamUrl = `https://store.steampowered.com/app/${game.appid}/`;
  const ggUrl = game.ggUrl ?? `https://gg.deals/steam/app/${game.appid}/`;

  const saveTarget = (): void => {
    setError(null);
    setMessage(null);
    const cents = target.trim() ? parseMoneyInput(target) : null;
    if (target.trim() && cents === null) {
      setError(t('Preço-alvo inválido. Use algo como 79,90.'));
      return;
    }
    update.mutate(
      { id: game.id, targetPriceCents: cents },
      {
        onSuccess: () => setMessage(t('Preço-alvo salvo.')),
        onError: (mutationError) => setError(mutationError.message)
      }
    );
  };

  const refreshPrice = (): void => {
    setError(null);
    setMessage(null);
    refresh.mutate(game.id, {
      onSuccess: (result) => {
        setMessage(
          result.warnings.length > 0
            ? `${t('Preço atualizado.')} ${result.warnings.join(' ')}`
            : t('Preço atualizado agora.')
        );
      },
      onError: (mutationError) => setError(mutationError.message)
    });
  };

  const handleDelete = (): void => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    remove.mutate(game.id, {
      onSuccess: onClose,
      onError: (mutationError) => setError(mutationError.message)
    });
  };

  return (
    <>
      <div className="relative -mx-5 -mt-4 mb-4 h-36 overflow-hidden border-b border-line/60 bg-elevated">
        {game.headerUrl && !imageFailed ? (
          <img
            src={game.headerUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
            <Gamepad2 className="h-8 w-8" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-fg drop-shadow">{game.name}</h3>
            <p className="text-[11px] text-muted">
              App {game.appid} · {t('adicionado')} {formatRelative(game.addedAt)}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {game.isDemo ? <Chip>demo</Chip> : null}
            <Chip color="#66c0f4">Steam</Chip>
            {game.inWishlist ? <Chip color="#38bdf8">{t('wishlist')}</Chip> : <Chip>{t('manual')}</Chip>}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <MarketCard
            title="Lojas oficiais"
            price={game.currentOfficialCents}
            low={game.officialLowCents}
            discount={game.officialDiscount}
            currency={game.currency}
            href={ggUrl}
          />
          <MarketCard
            title="Keyshops"
            price={game.currentKeyshopCents}
            low={game.keyshopLowCents}
            discount={game.keyshopDiscount}
            currency={game.currency}
            href={ggUrl}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-faint">
          <span>
            {game.lastPriceCheckAt
              ? `${t('Preço verificado')} ${formatRelative(game.lastPriceCheckAt)}`
              : t('Preço ainda não verificado')}
          </span>
          {game.isDemo ? (
            <span className="rounded-md bg-elevated px-2 py-1 text-[10px] text-muted">
              {t('Jogo demo · preços fictícios')}
            </span>
          ) : (
            <Button
              variant="subtle"
              size="sm"
              onClick={refreshPrice}
              loading={refresh.isPending}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('Atualizar preço')}
            </Button>
          )}
        </div>

        <ErrorBanner message={error} />
        <SuccessNote message={message} />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('Histórico de preços')}</h4>
            <span className="text-[10px] text-faint">{t('menor preço oficial por dia')}</span>
          </div>
          <PriceChart points={game.history} currency={game.currency} />
        </section>

        <section className="rounded-xl border border-line/70 bg-bg/40 p-3">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-accent" />
            <h4 className="text-xs font-semibold text-fg">{t('Preço-alvo')}</h4>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
            {t('Avisamos no feed quando o menor preço em lojas oficiais ficar abaixo do alvo.')}
          </p>
          <div className="mt-2 flex items-end gap-2">
            <input
              id="game-target"
              className="field-input w-40"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={t('Ex.: 79,90')}
              inputMode="decimal"
              aria-label={t('Preço-alvo')}
            />
            <Button variant="subtle" onClick={saveTarget} loading={update.isPending}>
              {t('Salvar alvo')}
            </Button>
            {game.targetPriceCents !== null ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setTarget('');
                  update.mutate(
                    { id: game.id, targetPriceCents: null },
                    { onSuccess: () => setMessage(t('Preço-alvo removido.')) }
                  );
                }}
              >
                {t('Limpar')}
              </Button>
            ) : null}
          </div>
        </section>

        <InfoBanner
          message={
            <>
              {t('Todos os preços são para')} <strong className="text-fg">Steam</strong> (appid {game.appid}).{' '}
              {t('A API gratuita do gg.deals informa o')}{' '}
              <strong className="text-fg">{t('menor preço por mercado')}</strong>{' '}
              {t(
                '(oficiais e keyshops), não ofertas por loja. Os links abrem a página do jogo no gg.deals, onde a oferta é exibida.'
              )}
            </>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3">
          <div className="flex items-center gap-3 text-[11px]">
            <a
              href={steamUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted transition hover:text-fg"
            >
              Steam <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={ggUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted transition hover:text-fg"
            >
              {t('Preços por gg.deals')} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={remove.isPending}
              className={cn(confirmDelete && 'ring-1 ring-danger/50')}
            >
              {confirmDelete ? t('Confirmar remoção') : t('Remover')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function GameDetailModal({ gameId, onClose }: { gameId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const gameQuery = useGame(gameId);

  return (
    <Modal
      open={Boolean(gameId)}
      onClose={onClose}
      wide
      title={t('Detalhes do jogo')}
      description={t('Preços, histórico e alertas desta biblioteca.')}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('Fechar')}
        </Button>
      }
    >
      {gameQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-faint">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('Carregando…')}
        </div>
      ) : null}

      {gameQuery.isError ? (
        <ErrorBanner
          message={gameQuery.error instanceof Error ? gameQuery.error.message : t('Não foi possível carregar o jogo.')}
        />
      ) : null}

      {gameQuery.data ? <GameBody game={gameQuery.data} onClose={onClose} /> : null}
    </Modal>
  );
}
