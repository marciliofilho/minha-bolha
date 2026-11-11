/** Wishlist: biblioteca de jogos, preços e alertas. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  ExternalLink,
  Gamepad2,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Target,
  Trash2
} from 'lucide-react';
import type { GameFilter, GameSort } from '@hub/shared';
import {
  Button,
  EmptyState,
  ErrorBanner,
  InfoBanner,
  Modal,
  PageHeader,
  Switch
} from '@/components/ui';
import { GameCard } from '@/components/games/GameCard';
import { GameDetailModal } from '@/components/games/GameDetailModal';
import { AddGameModal } from '@/components/games/AddGameModal';
import { ImportWishlistModal } from '@/components/games/ImportWishlistModal';
import {
  useDeleteSource,
  useGames,
  useRefreshSource,
  useSources,
  useStatus,
  useUpdateSource
} from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, formatRelative } from '@/lib/utils';

const FILTERS: Array<{ id: GameFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'wishlist', label: 'Na wishlist' },
  { id: 'outside', label: 'Fora da wishlist' },
  { id: 'deals', label: 'Em promoção' },
  { id: 'low', label: 'Na mínima' }
];

const SORTS: Array<{ id: GameSort; label: string }> = [
  { id: 'discount', label: 'Maior desconto' },
  { id: 'price', label: 'Menor preço' },
  { id: 'name', label: 'Nome' },
  { id: 'recent', label: 'Adicionados recentemente' }
];

export function WishlistPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<GameFilter>('all');
  const [sort, setSort] = useState<GameSort>('discount');
  const [officialOnly, setOfficialOnly] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileInput, setProfileInput] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const gamesQuery = useGames(filter, sort);
  const sourcesQuery = useSources();
  const statusQuery = useStatus();
  const refreshSource = useRefreshSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();

  const games = gamesQuery.data?.games ?? [];
  const stats = gamesQuery.data?.stats ?? { total: 0, wishlist: 0, deals: 0, atLow: 0 };
  const keys = statusQuery.data?.keys;
  const wishlistSource = sourcesQuery.data?.find((source) => source.type === 'steam-wishlist');
  const priceSource = sourcesQuery.data?.find((source) => source.type === 'ggdeals');
  const steamConfig = wishlistSource?.config ?? {};
  const steamId64 = typeof steamConfig.steamId64 === 'string' ? steamConfig.steamId64 : null;
  const personaName = typeof steamConfig.personaName === 'string' ? steamConfig.personaName : null;
  const profileInputValue =
    typeof steamConfig.input === 'string' && steamConfig.input.trim() ? steamConfig.input.trim() : null;
  const profileUrl = profileInputValue?.startsWith('http')
    ? profileInputValue
    : steamId64
      ? `https://steamcommunity.com/profiles/${steamId64}`
      : null;
  const syncing =
    Boolean(wishlistSource && wishlistSource.enabled && !wishlistSource.lastCheckedAt) || refreshSource.isPending;

  const filterCount: Record<GameFilter, number | undefined> = {
    all: stats.total,
    wishlist: stats.wishlist,
    outside: stats.total - stats.wishlist,
    deals: stats.deals,
    low: stats.atLow
  };

  const syncNow = (): void => {
    setNotice(null);
    if (wishlistSource) refreshSource.mutate(wishlistSource.id);
    if (priceSource) refreshSource.mutate(priceSource.id);
  };

  const openProfileEditor = (): void => {
    setProfileInput(profileInputValue ?? profileUrl ?? '');
    setProfileError(null);
    setProfileOpen(true);
  };

  const saveProfile = async (): Promise<void> => {
    if (!wishlistSource) return;
    if (!profileInput.trim()) {
      setProfileError(t('Cole o link do perfil ou o SteamID64.'));
      return;
    }

    setProfileError(null);
    try {
      await updateSource.mutateAsync({
        id: wishlistSource.id,
        body: { input: profileInput.trim() }
      });
      setProfileOpen(false);
      setNotice(t('Perfil atualizado. A wishlist será sincronizada em instantes.'));
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : t('Não foi possível atualizar o perfil.')
      );
    }
  };

  const removeProfile = async (): Promise<void> => {
    if (!wishlistSource) return;
    setProfileError(null);
    try {
      await deleteSource.mutateAsync(wishlistSource.id);
      setRemoveOpen(false);
      setNotice(
        t(
          'Perfil removido. Os jogos já importados permanecem na biblioteca e continuam com o monitoramento de preços.'
        )
      );
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : t('Não foi possível remover o perfil.')
      );
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('Biblioteca')}
        title={t('Wishlist')}
        description={
          <>
            <span className="font-medium text-fg">{stats.total}</span> {t('jogos')} ·{' '}
            {stats.wishlist} {t('na wishlist')} · {stats.deals} {t('em promoção')}
            {stats.atLow > 0 ? ` · ${stats.atLow} ${t('na mínima')}` : ''}
          </>
        }
        actions={
          <>
            {wishlistSource ? (
              <Button
                variant="subtle"
                size="sm"
                onClick={syncNow}
                loading={refreshSource.isPending}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                title={t('Sincronizar wishlist e preços')}
              >
                {t('Sincronizar')}
              </Button>
            ) : null}
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setImportOpen(true)}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              {t('Importar')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddOpen(true)}
              icon={<Plus className="h-4 w-4" />}
            >
              {t('Adicionar')}
            </Button>
          </>
        }
      />

      {wishlistSource ? (
        <div className="mb-4 rounded-xl border border-line/70 bg-bg/40 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <Link2 className="h-3.5 w-3.5 text-accent" /> {t('Perfil da Steam conectado')}
              </p>
              {profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate font-mono text-[11px] text-accent hover:underline"
                  title={t('Abrir perfil na Steam')}
                >
                  {profileInputValue ?? profileUrl}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <p className="mt-0.5 text-[11px] text-muted">SteamID64 {steamId64 ?? '—'}</p>
              )}
              <p className="mt-1 text-[10px] leading-relaxed text-faint">
                {personaName ? `${personaName} · ` : ''}
                {wishlistSource.lastCheckedAt
                  ? `${t('última sincronização')} ${formatRelative(wishlistSource.lastCheckedAt)}`
                  : t('aguardando a primeira sincronização')}
                {' · '}
                {t('A chave da Steam não é necessária para ler a wishlist pública.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="subtle"
                size="sm"
                onClick={openProfileEditor}
                icon={<Pencil className="h-3.5 w-3.5" />}
              >
                {t('Editar link')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setProfileError(null);
                  setRemoveOpen(true);
                }}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                {t('Remover')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-line/70 bg-bg/40 p-3 text-[11px] leading-relaxed text-muted">
          <p className="flex items-center gap-1.5 font-semibold text-fg">
            <Link2 className="h-3.5 w-3.5 text-accent" /> {t('Nenhum perfil da Steam conectado')}
          </p>
          <p className="mt-0.5">
            {t(
              'Importe sua wishlist informando o link do perfil ou o SteamID64. A chave da Steam não é necessária.'
            )}
          </p>
          <Button
            variant="subtle"
            size="sm"
            className="mt-2"
            onClick={() => setImportOpen(true)}
            icon={<Download className="h-3.5 w-3.5" />}
          >
            {t('Importar wishlist')}
          </Button>
        </div>
      )}

      <div className="mb-4 space-y-2">
        {wishlistSource?.lastErrorCode ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <ErrorBanner message={wishlistSource.lastErrorMessage ?? t('Falha ao sincronizar a wishlist.')} />
            </div>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => refreshSource.mutate(wishlistSource.id)}
              loading={refreshSource.isPending}
            >
              {t('Tentar de novo')}
            </Button>
          </div>
        ) : null}

        {notice ? <InfoBanner message={notice} /> : null}

        {syncing && !wishlistSource?.lastErrorCode ? (
          <InfoBanner
            message={
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                {t('Sincronizando wishlist e preços… os jogos aparecem automaticamente.')}
              </span>
            }
          />
        ) : null}

        {!keys?.ggdeals && stats.total > 0 ? (
          <InfoBanner
            message={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-warning" />
                {t(
                  'Configure a chave do gg.deals em Configurações → Chaves de API para monitorar preços de lojas oficiais e keyshops.'
                )}
              </span>
            }
            action={
              <Link
                to="/settings"
                className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
              >
                {t('Abrir configurações')}
              </Link>
            }
          />
        ) : null}

        {gamesQuery.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <ErrorBanner
                message={gamesQuery.error instanceof Error ? gamesQuery.error.message : t('Não foi possível carregar a biblioteca.')}
              />
            </div>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void gamesQuery.refetch()}
              loading={gamesQuery.isFetching}
            >
              {t('Tentar novamente')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 py-0.5">
          {FILTERS.map((item) => {
            const active = filter === item.id;
            const count = filterCount[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                  active
                    ? 'border-accent/40 bg-accent/10 text-fg'
                    : 'border-transparent text-muted hover:bg-elevated hover:text-fg'
                )}
                aria-pressed={active}
              >
                {t(item.label)}
                {typeof count === 'number' && count > 0 ? (
                  <span className={cn('text-[10px] font-semibold', active ? 'text-accent' : 'text-faint')}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] font-medium text-muted">
            <Switch checked={officialOnly} onChange={setOfficialOnly} label={t('Apenas lojas oficiais')} />
            {t('Apenas oficiais')}
          </label>
          <select
            className="field-input h-8 w-auto py-1 text-xs"
            value={sort}
            onChange={(event) => setSort(event.target.value as GameSort)}
            aria-label={t('Ordenar jogos')}
          >
            {SORTS.map((item) => (
              <option key={item.id} value={item.id}>
                {t(item.label)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {gamesQuery.isLoading ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(21rem, 1fr))' }}
        >
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="card overflow-hidden">
              <div className="aspect-[460/215] w-full animate-pulse bg-elevated" />
              <div className="space-y-2 p-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-elevated" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-elevated" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!gamesQuery.isLoading && stats.total === 0 ? (
        <EmptyState
          icon={<Gamepad2 className="h-5 w-5" />}
          title={t('Sua wishlist começa aqui')}
          description={t(
            'Importe a wishlist da Steam ou adicione jogos manualmente. Monitoramos lojas oficiais e keyshops e avisamos quando o preço cair.'
          )}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                onClick={() => setImportOpen(true)}
                icon={<Download className="h-4 w-4" />}
              >
                {t('Importar wishlist')}
              </Button>
              <Button variant="subtle" onClick={() => setAddOpen(true)} icon={<Plus className="h-4 w-4" />}>
                {t('Adicionar jogo')}
              </Button>
            </div>
          }
        />
      ) : null}

      {!gamesQuery.isLoading && stats.total > 0 && games.length === 0 ? (
        <EmptyState
          icon={<Target className="h-5 w-5" />}
          title={t('Nenhum jogo neste filtro')}
          description={t('Troque o filtro ou sincronize novamente para atualizar os preços.')}
          action={
            <Button variant="subtle" size="sm" onClick={syncNow} loading={refreshSource.isPending}>
              {t('Sincronizar agora')}
            </Button>
          }
        />
      ) : null}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(21rem, 1fr))' }}
      >
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            officialOnly={officialOnly}
            onOpen={() => setDetailId(game.id)}
          />
        ))}
      </div>

      {games.some((game) => game.isDemo) ? (
        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          {t('Os jogos marcados como demo são fictícios. Remova em Configurações → Dados de demonstração.')}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col items-center gap-1 text-center text-[11px] leading-relaxed text-faint">
        <p>
          {t('Preços por')}{' '}
          <a
            href="https://gg.deals/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            gg.deals <ExternalLink className="h-3 w-3" />
          </a>{' '}
          · {t('uso pessoal')}
        </p>
        <p>{t('A API gratuita informa o menor preço por mercado, não ofertas por loja.')}</p>
        <p>
          {t(
            'Todos os jogos são do catálogo Steam (appid). O clique no preço abre a página do jogo no gg.deals, onde a oferta é exibida.'
          )}
        </p>
        {wishlistSource?.lastCheckedAt ? (
          <p>{t('Última sincronização da wishlist')} {formatRelative(wishlistSource.lastCheckedAt)}.</p>
        ) : null}
      </div>

      <GameDetailModal gameId={detailId} onClose={() => setDetailId(null)} />
      <AddGameModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => setNotice(t('Jogo adicionado. O preço é atualizado na próxima verificação.'))}
      />
      <ImportWishlistModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(name) => {
          setNotice(
            t(
              'Importação iniciada para “{name}”. Os jogos aparecem em instantes; se a lista estiver privada, o motivo aparece aqui.',
              { name }
            )
          );
        }}
      />

      <Modal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title={t('Editar perfil da Steam')}
        description={t(
          'Cole o link do perfil ou o SteamID64 usado para buscar a wishlist. A chave da Steam não é necessária.'
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setProfileOpen(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={updateSource.isPending} onClick={() => void saveProfile()}>
              {t('Salvar')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <input
            className="field-input"
            value={profileInput}
            onChange={(event) => setProfileInput(event.target.value)}
            placeholder="https://steamcommunity.com/id/nome ou 7656119..."
            spellCheck={false}
            aria-label={t('Link do perfil da Steam')}
          />
          <p className="text-[11px] leading-relaxed text-faint">
            {t('Aceita link do perfil, link /id/nome ou SteamID64. A lista precisa estar pública.')}
          </p>
          <ErrorBanner message={profileError} />
        </div>
      </Modal>

      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title={t('Remover perfil da Steam?')}
        description={t(
          'A sincronização da wishlist será interrompida. Os jogos já importados permanecem na biblioteca e continuam com o monitoramento de preços.'
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveOpen(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" loading={deleteSource.isPending} onClick={() => void removeProfile()}>
              {t('Remover perfil')}
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          {profileInputValue ?? profileUrl ?? 'Perfil da Steam'}
        </p>
        <div className="mt-2">
          <ErrorBanner message={profileError} />
        </div>
      </Modal>
    </div>
  );
}
