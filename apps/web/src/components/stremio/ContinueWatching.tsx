/** Seção "Seus Streamings" (biblioteca/continuar assistindo do Stremio). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Clapperboard,
  Clock,
  Eye,
  EyeOff,
  Play,
  Search,
  Star
} from 'lucide-react';
import type { StremioCardInfoDto, StremioLibraryItemDto } from '@hub/shared';
import { InfoBanner } from '@/components/ui';
import { HorizontalScroller } from '@/components/ui/HorizontalScroller';
import { AddonCatalogCard } from '@/components/stremio/AddonCatalogCard';
import { CardHoverPreview } from '@/components/stremio/CardHoverPreview';
import {
  useSetStremioLibraryState,
  useStremioCardInfo,
  useStremioLibrary,
  useStremioLibrarySearch,
  useStremioSearch,
  useStremioStatus
} from '@/lib/queries';
import { cn, formatRelative } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useStoredBoolean } from '@/lib/use-stored-boolean';
import { useStoredString } from '@/lib/use-stored-string';

type StreamFilter = 'all' | 'movie' | 'series' | 'anime' | 'favorites' | 'watchLater';

const FILTERS: Array<{ id: StreamFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'movie', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
  { id: 'anime', label: 'Animes' },
  { id: 'favorites', label: 'Favoritos' },
  { id: 'watchLater', label: 'Assistir depois' }
];

function sortByRecent(a: StremioLibraryItemDto, b: StremioLibraryItemDto): number {
  return (
    (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '') ||
    a.name.localeCompare(b.name, 'pt-BR')
  );
}

function ContinueCard({
  item,
  info,
  onPlay,
  onToggleFavorite,
  onToggleWatchLater,
  onAddToLibrary,
  onRemoveFromLibrary
}: {
  item: StremioLibraryItemDto;
  info?: StremioCardInfoDto | null;
  onPlay?: (item: StremioLibraryItemDto) => void;
  onToggleFavorite?: () => void;
  onToggleWatchLater?: () => void;
  onAddToLibrary?: () => void;
  onRemoveFromLibrary?: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const code =
    item.type === 'series' && item.season !== null && item.season > 0 && item.episode !== null
      ? `S${item.season}E${item.episode}`
      : item.type === 'series'
        ? t('Série')
        : t('Filme');

  const content = (
    <>
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-line bg-elevated">
        {item.poster && !failed ? (
          <img
            src={item.poster}
            alt=""
            loading="eager"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
            <Clapperboard className="h-7 w-7" />
          </div>
        )}

        {item.progress > 0.01 ? (
          <>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            </div>
            <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
              {Math.round(item.progress * 100)}%
            </span>
          </>
        ) : null}
        {info?.imdbRating ? (
          <span className="absolute bottom-2.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-current text-warning" /> IMDb {info.imdbRating}
          </span>
        ) : null}
        {onPlay ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
              <Play className="h-5 w-5 fill-current" />
            </span>
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-fg">{item.name}</p>
      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-faint">
        <span>{code}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">{formatRelative(item.lastWatchedAt)}</span>
        <ChevronRight className="ml-auto h-3 w-3 opacity-0 transition group-hover:opacity-100" />
      </p>
    </>
  );

  return (
    <CardHoverPreview
      type={item.type}
      metaId={item.metaId}
      name={item.name}
      poster={item.poster}
      info={info}
      onPlay={onPlay ? () => onPlay(item) : undefined}
      playLabel={t('Assistir')}
      inLibrary={item.inLibrary}
      isFavorite={item.isFavorite}
      isWatchLater={item.isWatchLater}
      onAddToLibrary={onAddToLibrary}
      onRemoveFromLibrary={item.isLocal && item.inLibrary ? onRemoveFromLibrary : undefined}
      onToggleFavorite={onToggleFavorite}
      onToggleWatchLater={onToggleWatchLater}
    >
      <div className="group relative w-[9.5rem] shrink-0">
        {onPlay ? (
          <button
            type="button"
            onClick={() => onPlay(item)}
            className="block w-full text-left"
            title={`${t('Assistir')} ${item.name} ${t('no destaque')}`}
          >
            {content}
          </button>
        ) : (
          <Link
            to={`/title/${item.type}/${encodeURIComponent(item.metaId)}`}
            draggable={false}
            className="block w-full"
            title={`${t('Abrir detalhes de')} ${item.name}`}
          >
            {content}
          </Link>
        )}

        {onToggleFavorite || onToggleWatchLater ? (
          <div className="absolute left-1 top-1 z-10 flex items-center gap-0.5 rounded-lg bg-black/60 p-0.5 opacity-100 backdrop-blur-sm transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            {onToggleFavorite ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleFavorite();
                }}
                aria-label={
                  item.isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')
                }
                aria-pressed={item.isFavorite}
                title={item.isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')}
                className="flex h-6 w-6 items-center justify-center rounded-md text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <Star
                  className={cn('h-3.5 w-3.5', item.isFavorite && 'fill-current text-warning')}
                />
              </button>
            ) : null}
            {onToggleWatchLater ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleWatchLater();
                }}
                aria-label={
                  item.isWatchLater
                    ? t('Remover de Assistir depois')
                    : t('Salvar para assistir depois')
                }
                aria-pressed={item.isWatchLater}
                title={
                  item.isWatchLater
                    ? t('Remover de Assistir depois')
                    : t('Salvar para assistir depois')
                }
                className="flex h-6 w-6 items-center justify-center rounded-md text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <Clock
                  className={cn('h-3.5 w-3.5', item.isWatchLater && 'text-accent')}
                />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </CardHoverPreview>
  );
}

const EMPTY_LIBRARY: StremioLibraryItemDto[] = [];

export function ContinueWatchingSection({
  showLibraryLink = true,
  onPlay,
  moveControls
}: {
  showLibraryLink?: boolean;
  onPlay?: (item: StremioLibraryItemDto) => void;
  /** Botões de mover para cima/baixo exibidos apenas no Feed. */
  moveControls?: ReactNode;
} = {}) {
  const { t } = useI18n();
  const status = useStremioStatus();
  const library = useStremioLibrary(Boolean(status.data?.connected));
  const [collapsed, toggleCollapsed] = useStoredBoolean('hub.stremio-continue.collapsed', false);
  const [accountHidden, toggleAccountHidden] = useStoredBoolean(
    'hub.stremio.account-hidden',
    false
  );
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useStoredString('hub.stremio-continue.filter', 'all') as [
    StreamFilter,
    (value: string) => void
  ];

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setDebouncedSearch('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSearch(term), 450);
    return () => window.clearTimeout(timer);
  }, [search]);

  const allItems = library.data?.items ?? EMPTY_LIBRARY;
  const searchTerm = search.trim();
  const searching = searchTerm.length > 0;
  const searchQuery = useStremioLibrarySearch(
    searchTerm,
    Boolean(status.data?.connected)
  );
  const searchResults = searchQuery.data?.items ?? EMPTY_LIBRARY;
  const baseItems = searching ? searchResults : allItems;

  const candidateItems = useMemo(() => {
    const map = new Map<string, StremioLibraryItemDto>();
    for (const item of allItems) {
      if (
        item.progress > 0.01 ||
        (item.isLocal && item.inLibrary) ||
        item.isFavorite ||
        item.isWatchLater
      ) {
        map.set(item.metaId, item);
      }
    }
    return [...map.values()];
  }, [allItems]);

  const addonSearchVisible =
    filter === 'all' || filter === 'movie' || filter === 'series' || filter === 'anime';
  const addonSearchType =
    filter === 'all' || !addonSearchVisible ? undefined : filter;
  const addonSearchQuery = useStremioSearch(
    addonSearchVisible ? debouncedSearch : '',
    addonSearchType
  );
  const addonResults = (addonSearchQuery.data?.items ?? []).slice(0, 12);

  const cardInfoItems = searching ? searchResults : candidateItems;
  const cardInfo = useStremioCardInfo(
    cardInfoItems.map((item) => ({ type: item.type, id: item.metaId, name: item.name }))
  );
  const infoByKey = new Map(
    (cardInfo.data?.items ?? []).map((info) => [`${info.type}:${info.id}`, info])
  );
  const animeKeys = useMemo(
    () =>
      new Set(
        (cardInfo.data?.items ?? [])
          .filter((info) => info.isAnime)
          .map((info) => `${info.type}:${info.id}`)
      ),
    [cardInfo.data]
  );

  // "Todos" = em andamento + títulos salvos na Minha biblioteca local.
  const todoItems = useMemo(() => {
    const map = new Map<string, StremioLibraryItemDto>();
    for (const item of allItems) {
      if (item.progress > 0.01 || (item.isLocal && item.inLibrary)) {
        map.set(item.metaId, item);
      }
    }
    return [...map.values()].sort(sortByRecent).slice(0, 24);
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const isAnimeItem = (item: StremioLibraryItemDto): boolean =>
      item.isAnime || animeKeys.has(`${item.type}:${item.metaId}`);
    const typeSource = searching ? baseItems : todoItems;
    switch (filter) {
      case 'movie':
        return typeSource.filter((item) => !isAnimeItem(item) && item.type === 'movie');
      case 'series':
        return typeSource.filter((item) => !isAnimeItem(item) && item.type === 'series');
      case 'anime':
        return typeSource.filter((item) => isAnimeItem(item));
      case 'favorites':
        return baseItems.filter((item) => item.isFavorite).sort(sortByRecent).slice(0, 24);
      case 'watchLater':
        return baseItems.filter((item) => item.isWatchLater).sort(sortByRecent).slice(0, 24);
      default:
        return searching ? baseItems.slice(0, 24) : todoItems;
    }
  }, [filter, todoItems, baseItems, searching, animeKeys]);

  const libraryKeys = new Set(
    filteredItems.map((item) => `${item.type}:${item.metaId}`)
  );
  const visibleAddonResults = addonResults.filter(
    (item) => !libraryKeys.has(`${item.type}:${item.id}`)
  );
  const addonSearchPending =
    searching &&
    searchTerm.length >= 2 &&
    addonSearchVisible &&
    debouncedSearch !== searchTerm;
  const searchBusy =
    searchQuery.isLoading ||
    (addonSearchVisible && addonSearchQuery.isLoading) ||
    addonSearchPending;
  const noResultsMessage = addonSearchVisible
    ? t('Nenhum título encontrado na sua biblioteca ou nos addons.')
    : t('Nenhum título encontrado na sua biblioteca para este filtro.');
  const setState = useSetStremioLibraryState();

  if (!status.data?.connected) return null;

  if (status.data.expired) {
    return (
      <InfoBanner
        message={t('Sessão do Stremio expirada. Reconecte para voltar a sincronizar a biblioteca.')}
        action={
          <Link
            to="/settings"
            className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
          >
            Reconectar
          </Link>
        }
      />
    );
  }

  const emptyMessage =
    filter === 'favorites'
      ? t('Nenhum favorito ainda. Passe o mouse em um card e clique na estrela.')
      : filter === 'watchLater'
        ? t('Nada em Assistir depois. Passe o mouse em um card e clique no relógio.')
        : filter === 'anime'
          ? t('Nada em andamento ou salvo em Animes.')
          : filter === 'movie'
            ? t('Nada em andamento ou salvo em Filmes.')
            : filter === 'series'
              ? t('Nada em andamento ou salvo em Séries.')
              : t('Nada em andamento ou salvo. Pesquise na sua biblioteca para encontrar um título.');

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-fg">{t('Seus Streamings')}</h2>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={
                  collapsed
                    ? `${t('Mostrar')} ${t('Seus Streamings')}`
                    : `${t('Minimizar')} ${t('Seus Streamings')}`
                }
                title={
                  collapsed
                    ? `${t('Mostrar')} ${t('Seus Streamings')}`
                    : `${t('Minimizar')} ${t('Seus Streamings')}`
                }
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
              >
                {collapsed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              {moveControls}
            </div>

            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('Filtrar Seus Streamings')}>
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={cn(
                    'h-6 rounded-md px-2 text-[10px] font-medium transition',
                    filter === option.id
                      ? 'bg-accent text-accent-fg'
                      : 'border border-line bg-elevated text-muted hover:text-fg'
                  )}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleAccountHidden}
            aria-label={
              accountHidden ? t('Mostrar conta conectada') : t('Ocultar conta conectada')
            }
            aria-pressed={accountHidden}
            title={
              accountHidden ? t('Clique para mostrar a conta') : t('Clique para ocultar a conta')
            }
            className={`mt-0.5 max-w-full truncate text-left text-[10px] text-faint transition-colors hover:text-muted ${
              accountHidden ? 'select-none opacity-70' : ''
            }`}
            style={{ filter: accountHidden ? 'blur(3px)' : 'none' }}
          >
            {status.data.email ? `Stremio · ${status.data.email}` : t('Sua biblioteca do Stremio')}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {collapsed ? null : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Buscar na biblioteca e nos addons…')}
                  aria-label={t('Buscar na biblioteca e nos addons')}
                  className="field-input h-8 w-44 py-1 pl-7 text-xs sm:w-56"
                />
              </div>
              {showLibraryLink ? (
                <Link
                  to="/library"
                  className="ml-1 text-[11px] font-medium text-muted transition hover:text-fg"
                >
                  {t('Ver biblioteca')}
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>

      {collapsed ? null : searching ? (
        <div className="space-y-3">
          {searchBusy ? (
            <p className="text-[11px] text-faint">
              {t('Buscando na sua biblioteca e nos addons…')}
            </p>
          ) : null}

          {filteredItems.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                {t('Na sua biblioteca')}
              </p>
              <HorizontalScroller>
                {filteredItems.map((item) => (
                  <ContinueCard
                    key={item.metaId}
                    item={item}
                    info={infoByKey.get(`${item.type}:${item.metaId}`)}
                    onPlay={onPlay}
                    onToggleFavorite={() =>
                      setState.mutate({
                        metaId: item.metaId,
                        patch: { isFavorite: !item.isFavorite }
                      })
                    }
                    onToggleWatchLater={() =>
                      setState.mutate({
                        metaId: item.metaId,
                        patch: { isWatchLater: !item.isWatchLater }
                      })
                    }
                    onAddToLibrary={() =>
                      setState.mutate({
                        metaId: item.metaId,
                        patch: {
                          inLibrary: true,
                          type: item.type,
                          name: item.name,
                          poster: item.poster
                        }
                      })
                    }
                    onRemoveFromLibrary={() =>
                      setState.mutate({ metaId: item.metaId, patch: { inLibrary: false } })
                    }
                  />
                ))}
              </HorizontalScroller>
            </div>
          ) : null}

          {visibleAddonResults.length > 0 ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Nos addons
                </p>
                {addonSearchQuery.data?.approximate ? (
                  <span className="text-[9px] text-faint">{t('resultados aproximados')}</span>
                ) : null}
              </div>
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(9.5rem, 45%), 1fr))'
                }}
              >
                {visibleAddonResults.map((item) => (
                  <AddonCatalogCard
                    key={`${item.addonId}:${item.type}:${item.id}`}
                    item={item}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {!searchBusy &&
          filteredItems.length === 0 &&
          visibleAddonResults.length === 0 ? (
            <p className="rounded-xl border border-line/60 bg-bg/40 px-3 py-2 text-[11px] text-muted">
              {searchQuery.isError || addonSearchQuery.isError
                ? t('Não foi possível buscar na biblioteca ou nos addons.')
                : noResultsMessage}
            </p>
          ) : null}
        </div>
      ) : library.isLoading ? (
        <p className="text-[11px] text-faint">{t('Carregando biblioteca do Stremio…')}</p>
      ) : library.isError ? (
        <p className="text-[11px] text-danger">
          {t('Não foi possível carregar a biblioteca do Stremio.')}
        </p>
      ) : filteredItems.length === 0 ? (
        <p className="rounded-xl border border-line/60 bg-bg/40 px-3 py-2 text-[11px] text-muted">
          {emptyMessage}
        </p>
      ) : (
        <HorizontalScroller>
          {filteredItems.map((item) => (
            <ContinueCard
              key={item.metaId}
              item={item}
              info={infoByKey.get(`${item.type}:${item.metaId}`)}
              onPlay={onPlay}
              onToggleFavorite={() =>
                setState.mutate({ metaId: item.metaId, patch: { isFavorite: !item.isFavorite } })
              }
              onToggleWatchLater={() =>
                setState.mutate({
                  metaId: item.metaId,
                  patch: { isWatchLater: !item.isWatchLater }
                })
              }
              onAddToLibrary={() =>
                setState.mutate({
                  metaId: item.metaId,
                  patch: {
                    inLibrary: true,
                    type: item.type,
                    name: item.name,
                    poster: item.poster
                  }
                })
              }
              onRemoveFromLibrary={() =>
                setState.mutate({ metaId: item.metaId, patch: { inLibrary: false } })
              }
            />
          ))}
        </HorizontalScroller>
      )}
    </section>
  );
}
