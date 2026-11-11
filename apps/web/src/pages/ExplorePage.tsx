/** Explorar: busca global nos addons + catálogos dos addons ativos. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Search, X } from 'lucide-react';
import type { AddonCatalogGroupDto, AddonCatalogItemDto } from '@hub/shared';
import { EmptyState, ErrorBanner, InfoBanner, PageHeader } from '@/components/ui';
import { AddonCatalogCard } from '@/components/stremio/AddonCatalogCard';
import {
  useStremioAddonCatalogs,
  useStremioAddons,
  useStremioCatalog,
  useStremioSearch
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const TYPE_LABELS: Record<string, string> = {
  movie: 'Filmes',
  series: 'Séries',
  anime: 'Animes',
  tv: 'TV',
  channel: 'Canais'
};

const BASE_TYPES = ['movie', 'series', 'anime'] as const;

const CATALOG_LIMITS = [25, 50, 100] as const;
type CatalogLimit = (typeof CATALOG_LIMITS)[number];
const CATALOG_LIMIT_KEY = 'hub.explore.limit';

function readCatalogLimit(): CatalogLimit {
  try {
    const value = Number(window.localStorage.getItem(CATALOG_LIMIT_KEY));
    return CATALOG_LIMITS.includes(value as CatalogLimit) ? (value as CatalogLimit) : 25;
  } catch {
    return 25;
  }
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function catalogKey(group: AddonCatalogGroupDto): string {
  return `${group.addonId}|${group.type}|${group.catalogId}`;
}

function unsupportedRequired(group: AddonCatalogGroupDto): string[] {
  return group.extraRequired.filter((extra) => extra !== 'search' && extra !== 'skip');
}

function requiresSearch(group: AddonCatalogGroupDto): boolean {
  return group.extraRequired.includes('search');
}

function CardSkeletonGrid() {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(9.5rem, 45%), 1fr))' }}
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => (
        <div key={index} className="space-y-2">
          <div className="aspect-[2/3] animate-pulse rounded-xl bg-elevated" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-elevated" />
        </div>
      ))}
    </div>
  );
}

export function ExplorePage() {
  const { t } = useI18n();
  const catalogsQuery = useStremioAddonCatalogs();
  const addonsQuery = useStremioAddons();
  const groups = catalogsQuery.data?.catalogs ?? [];

  const [addonFilter, setAddonFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState<CatalogLimit>(readCatalogLimit);
  const [extraCount, setExtraCount] = useState(0);
  const autoLoadRef = useRef(false);

  const addons = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) map.set(group.addonId, group.addonName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [groups]);

  const types = useMemo(() => {
    const extras = [...new Set(groups.map((group) => group.type))].filter(
      (type) => !(BASE_TYPES as readonly string[]).includes(type)
    );
    return [...BASE_TYPES, ...extras];
  }, [groups]);

  const filtered = useMemo(
    () =>
      groups.filter(
        (group) =>
          (addonFilter === 'all' || group.addonId === addonFilter) &&
          (typeFilter === 'all' || group.type === typeFilter)
      ),
    [groups, addonFilter, typeFilter]
  );

  const usable = useMemo(
    () => filtered.filter((group) => unsupportedRequired(group).length === 0),
    [filtered]
  );

  useEffect(() => {
    if (usable.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !usable.some((group) => catalogKey(group) === selectedKey)) {
      const preferred = usable.find((group) => !requiresSearch(group)) ?? usable[0];
      setSelectedKey(catalogKey(preferred!));
    }
  }, [usable, selectedKey]);

  const selected = useMemo(
    () => filtered.find((group) => catalogKey(group) === selectedKey) ?? null,
    [filtered, selectedKey]
  );

  const needSearch = Boolean(selected && requiresSearch(selected));
  const searchActive = search.trim().length >= 2;

  const catalogQuery = useStremioCatalog(
    {
      addonId: selected?.addonId,
      type: selected?.type,
      catalogId: selected?.catalogId
    },
    Boolean(selected) && !needSearch && !searchActive
  );

  const uniqueItems = useMemo(() => {
    const map = new Map<string, AddonCatalogItemDto>();
    for (const page of catalogQuery.data?.pages ?? []) {
      for (const item of page.items) {
        map.set(`${item.addonId}:${item.type}:${item.id}`, item);
      }
    }
    return [...map.values()];
  }, [catalogQuery.data]);

  const targetLimit = limit + extraCount;
  const visibleItems = uniqueItems.slice(0, targetLimit);

  useEffect(() => {
    setExtraCount(0);
  }, [selectedKey, limit]);

  // Completa automaticamente o valor escolhido em "Mostrar" (25/50/100).
  useEffect(() => {
    if (autoLoadRef.current) return;
    if (!selected || needSearch || searchActive) return;
    if (catalogQuery.isLoading || catalogQuery.isError || catalogQuery.isFetchingNextPage) return;
    if (!catalogQuery.hasNextPage) return;
    if (uniqueItems.length >= limit) return;
    autoLoadRef.current = true;
    void catalogQuery.fetchNextPage().finally(() => {
      autoLoadRef.current = false;
    });
  }, [
    selected,
    needSearch,
    searchActive,
    catalogQuery.isLoading,
    catalogQuery.isError,
    catalogQuery.isFetchingNextPage,
    catalogQuery.hasNextPage,
    catalogQuery.fetchNextPage,
    uniqueItems.length,
    limit
  ]);

  const hasHiddenItems = uniqueItems.length > visibleItems.length;
  const canLoadMore = catalogQuery.hasNextPage || hasHiddenItems;
  const initialLoading = uniqueItems.length < limit && catalogQuery.hasNextPage;

  // "Carregar mais" mostra os itens já baixados ou busca uma página extra.
  const loadMore = (): void => {
    const hidden = uniqueItems.length > visibleItems.length;
    setExtraCount((count) => count + 25);
    if (
      !hidden &&
      catalogQuery.hasNextPage &&
      !catalogQuery.isFetchingNextPage &&
      !autoLoadRef.current
    ) {
      autoLoadRef.current = true;
      void catalogQuery.fetchNextPage().finally(() => {
        autoLoadRef.current = false;
      });
    }
  };

  const searchQuery = useStremioSearch(
    search,
    typeFilter === 'all' ? undefined : typeFilter
  );
  const searchItems = searchQuery.data?.items ?? [];
  const visibleSearchItems = searchItems.slice(0, limit);
  const searchErrors = searchQuery.data?.errors ?? [];

  const updateLimit = (value: CatalogLimit): void => {
    setLimit(value);
    try {
      window.localStorage.setItem(CATALOG_LIMIT_KEY, String(value));
    } catch {
      // Armazenamento indisponível.
    }
  };

  const clearSearch = (): void => {
    setSearchInput('');
    setSearch('');
  };

  const hasAddons = (addonsQuery.data?.addons ?? []).some((addon) => addon.enabled);
  const searchLabel = search.trim();

  return (
    <div>
      <PageHeader
        eyebrow="Stremio"
        title={t('Explorar')}
        description={t(
          'Busque filmes, séries e animes em todos os addons ou navegue pelos catálogos. Os títulos abrem a tela de detalhes do Hub.'
        )}
        actions={
          <Link
            to="/settings"
            className="inline-flex h-8 items-center rounded-lg border border-line bg-elevated px-2.5 text-xs font-medium text-fg transition hover:border-accent/40"
          >
            {t('Gerenciar addons')}
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchInput.trim().length >= 2) setSearch(searchInput.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="field-input h-10 pl-9 pr-24 text-sm"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('Buscar filmes, séries e animes em todos os addons…')}
            aria-label={t('Buscar conteúdo em todos os addons')}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {searchInput || search ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label={t('Limpar busca')}
                title={t('Limpar busca')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="submit"
              className="h-7 rounded-md bg-elevated px-2.5 text-[11px] font-semibold text-muted transition hover:text-fg"
            >
              {t('Buscar')}
            </button>
          </div>
        </form>

        <label className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-faint">
          {t('Mostrar')}
          <select
            className="field-input h-10 w-auto py-1 text-xs"
            value={limit}
            onChange={(event) => updateLimit(Number(event.target.value) as CatalogLimit)}
            aria-label={t('Quantidade de cards')}
          >
            {CATALOG_LIMITS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTypeFilter('all')}
          className={cn(
            'h-8 rounded-lg border px-2.5 text-xs font-medium transition',
            typeFilter === 'all'
              ? 'border-accent/40 bg-accent/10 text-fg'
              : 'border-line bg-bg/40 text-muted hover:bg-elevated hover:text-fg'
          )}
          aria-pressed={typeFilter === 'all'}
        >
          {t('Todos')}
        </button>
        {types.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setTypeFilter(type)}
            className={cn(
              'h-8 rounded-lg border px-2.5 text-xs font-medium transition',
              typeFilter === type
                ? 'border-accent/40 bg-accent/10 text-fg'
                : 'border-line bg-bg/40 text-muted hover:bg-elevated hover:text-fg'
            )}
            aria-pressed={typeFilter === type}
          >
            {t(typeLabel(type))}
          </button>
        ))}

        {searchActive ? (
          <span className="ml-auto text-[10px] text-faint">{t('Busca em todos os addons')}</span>
        ) : groups.length > 0 ? (
          <div className="ml-auto">
            <select
              className="field-input h-8 w-auto max-w-[16rem] py-1 text-xs"
              value={addonFilter}
              onChange={(event) => setAddonFilter(event.target.value)}
              aria-label={t('Filtrar catálogos por addon')}
            >
              <option value="all">{t('Todos os addons')}</option>
              {addons.map((addon) => (
                <option key={addon.id} value={addon.id}>
                  {addon.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {searchActive ? (
        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg">{t('Resultados da busca')}</h2>
              <p className="text-[10px] text-faint">
                “{searchLabel}” {t('em todos os addons')} · {visibleSearchItems.length}{' '}
                {t(visibleSearchItems.length === 1 ? 'card' : 'cards')}
                {searchItems.length > visibleSearchItems.length
                  ? ` ${t('de')} ${searchItems.length}`
                  : ''}
                {searchQuery.data?.approximate ? ` · ${t('aproximados')}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 text-xs font-medium text-muted transition hover:text-fg"
            >
              <X className="h-3.5 w-3.5" /> {t('Limpar busca')}
            </button>
          </div>

          {searchQuery.isLoading ? (
            <div className="space-y-2">
              <p className="text-[11px] text-faint">{t('Buscando em todos os addons…')}</p>
              <CardSkeletonGrid />
            </div>
          ) : searchQuery.isError ? (
            <ErrorBanner
              message={
                searchQuery.error instanceof Error
                  ? searchQuery.error.message
                  : t('Não foi possível buscar nos addons.')
              }
            />
          ) : visibleSearchItems.length === 0 ? (
            <EmptyState
              icon={<Compass className="h-5 w-5" />}
              title={t('Nenhum resultado')}
              description={t(
                'Tente o nome original (em inglês), outro termo ou confira os addons ativos. A busca consulta todos os addons, Cinemeta e Kitsu.'
              )}
            />
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(9.5rem, 45%), 1fr))' }}
            >
              {visibleSearchItems.map((item) => (
                <AddonCatalogCard
                  key={`${item.addonId}:${item.type}:${item.id}`}
                  item={item}
                />
              ))}
            </div>
          )}

          {searchErrors.length > 0 && visibleSearchItems.length === 0 ? (
            <p className="mt-3 text-[10px] text-faint">
              {t('Sem resposta de:')} {searchErrors.map((error) => error.addonName).join(', ')}.
            </p>
          ) : null}
        </section>
      ) : catalogsQuery.isError ? (
        <ErrorBanner
          message={
            catalogsQuery.error instanceof Error
              ? catalogsQuery.error.message
              : t('Não foi possível listar os catálogos.')
          }
        />
      ) : !catalogsQuery.isLoading && groups.length === 0 ? (
        hasAddons ? (
          <EmptyState
            icon={<Compass className="h-5 w-5" />}
            title={t('Nenhum catálogo disponível')}
            description={t(
              'Seus addons ativos não declaram o recurso de catálogo. Use a busca global acima (ela consulta Cinemeta e Kitsu) ou cadastre um addon de catálogo.'
            )}
            action={
              <Link
                to="/settings"
                className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition hover:brightness-110"
              >
                {t('Configurar addons')}
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Compass className="h-5 w-5" />}
            title={t('Busque sem precisar de addons')}
            description={t(
              'A busca global usa Cinemeta e Kitsu mesmo sem addons instalados. Para navegar por catálogos, cadastre um addon em Configurações → Addons.'
            )}
            action={
              <Link
                to="/settings"
                className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition hover:brightness-110"
              >
                {t('Ir para Configurações')}
              </Link>
            }
          />
        )
      ) : groups.length > 0 ? (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <InfoBanner message={t('Nenhum catálogo corresponde a esses filtros. Troque o addon ou o tipo; a busca global acima continua disponível.')} />
          ) : null}

          {filtered.length > 0 && usable.length === 0 ? (
            <InfoBanner message={t('Todos os catálogos filtrados exigem configuração extra (ex.: gênero/IDs). Escolha outro addon ou tipo.')} />
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {filtered.map((group) => {
              const active = catalogKey(group) === selectedKey;
              const missing = unsupportedRequired(group);
              const disabled = missing.length > 0;
              return (
                <button
                  key={catalogKey(group)}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedKey(catalogKey(group))}
                  title={disabled ? `${t('Este catálogo exige:')} ${missing.join(', ')}` : undefined}
                  className={cn(
                    'max-w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition',
                    active
                      ? 'border-accent/50 bg-accent/10 text-fg'
                      : disabled
                        ? 'cursor-not-allowed border-line bg-bg/20 text-faint opacity-60'
                        : 'border-line bg-bg/40 text-muted hover:bg-elevated hover:text-fg'
                  )}
                  aria-pressed={active}
                >
                  <span className="block truncate font-medium">{group.name}</span>
                  <span className="block truncate text-[10px] text-faint">
                    {group.addonName} · {t(typeLabel(group.type))}
                    {disabled
                      ? ` · ${t('exige')} ${missing.join(', ')}`
                      : requiresSearch(group)
                        ? ` · ${t('busca global')}`
                        : ''}
                  </span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <section>
              <div className="mb-2 min-w-0">
                <h2 className="truncate text-sm font-semibold text-fg">{selected.name}</h2>
                <p className="text-[10px] text-faint">
                  {selected.addonName} · {t(typeLabel(selected.type))}
                  {selected.extraRequired.length > 0
                    ? ` · ${t('exige:')} ${selected.extraRequired.join(', ')}`
                    : ''}
                </p>
              </div>

              <p className="mb-2 text-[11px] text-muted">
                {needSearch
                  ? t('este catálogo exige uma busca')
                  : catalogQuery.isLoading || initialLoading
                    ? t('Carregando…')
                    : `${visibleItems.length} ${t('de')} ${targetLimit} ${t(
                        visibleItems.length === 1 ? 'card' : 'cards'
                      )}${
                        !catalogQuery.hasNextPage && visibleItems.length < targetLimit
                          ? ` · ${t('catálogo sem mais itens')}`
                          : !catalogQuery.hasNextPage &&
                              visibleItems.length >= uniqueItems.length
                            ? ` · ${t('fim do catálogo')}`
                            : ''
                      }`}
              </p>

              {needSearch ? (
                <InfoBanner message={t('Este catálogo só funciona com busca. Use a busca global acima para procurar o título.')} />
              ) : catalogQuery.isLoading ? (
                <CardSkeletonGrid />
              ) : catalogQuery.isError && uniqueItems.length === 0 ? (
                <ErrorBanner
                  message={
                    catalogQuery.error instanceof Error
                      ? catalogQuery.error.message
                      : t('Não foi possível carregar este catálogo.')
                  }
                />
              ) : visibleItems.length === 0 ? (
                <EmptyState
                  icon={<Compass className="h-5 w-5" />}
                  title={t('Catálogo vazio')}
                  description={t('O addon não retornou itens para este catálogo.')}
                />
              ) : (
                <>
                  <div
                    className="grid gap-3"
                    style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(9.5rem, 45%), 1fr))'
                    }}
                  >
                    {visibleItems.map((item) => (
                      <AddonCatalogCard
                        key={`${item.addonId}:${item.type}:${item.id}`}
                        item={item}
                      />
                    ))}
                  </div>

                  {!initialLoading && canLoadMore ? (
                    <div className="mt-3 flex justify-center">
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={catalogQuery.isFetchingNextPage}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-line bg-elevated px-4 text-xs font-semibold text-fg transition hover:border-accent/40 disabled:cursor-default disabled:opacity-60"
                      >
                        {catalogQuery.isFetchingNextPage ? t('Carregando…') : t('Carregar mais')}
                      </button>
                    </div>
                  ) : null}
                  {catalogQuery.isError && uniqueItems.length > 0 ? (
                    <div className="mt-3">
                      <InfoBanner message={t('Não foi possível carregar mais itens deste catálogo.')} />
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
