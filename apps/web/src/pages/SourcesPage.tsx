/** Gerenciador de fontes. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckSquare, LayoutGrid, LayoutList, Plus, Rss, Trash2 } from 'lucide-react';
import { SOURCE_TYPES, type SourceDto, type SourceType } from '@hub/shared';
import { Button, EmptyState, ErrorBanner, Modal, PageHeader } from '@/components/ui';
import { SourceCard } from '@/components/sources/SourceCard';
import { SourceFormModal } from '@/components/sources/SourceFormModal';
import { NovelProgressModal } from '@/components/sources/NovelProgressModal';
import {
  useCategories,
  useDeleteSources,
  useRefreshSource,
  useSources,
  useUpdateSource
} from '@/lib/queries';
import { categoryColor, cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

const SOURCES_VIEW_KEY = 'hub.sources.view';

type SourcesView = 'list' | 'grid';

function readSourcesView(): SourcesView {
  try {
    return window.localStorage.getItem(SOURCES_VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function SourcesPage() {
  const { t } = useI18n();
  const sourcesQuery = useSources();
  const categoriesQuery = useCategories();
  const updateSource = useUpdateSource();
  const refreshSource = useRefreshSource();
  const deleteSources = useDeleteSources();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<SourcesView>(readSourcesView);

  const changeView = (next: SourcesView): void => {
    setView(next);
    try {
      window.localStorage.setItem(SOURCES_VIEW_KEY, next);
    } catch {
      // Armazenamento indisponível.
    }
  };

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDto | null>(null);
  const [defaultType, setDefaultType] = useState<SourceType | undefined>(undefined);
  const [deleteTargets, setDeleteTargets] = useState<SourceDto[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [novelTarget, setNovelTarget] = useState<SourceDto | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');

  const sources = sourcesQuery.data ?? [];

  // Gêneros/categorias realmente usados pelas fontes, na ordem definida pela API.
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sources) {
      counts.set(source.categoryId, (counts.get(source.categoryId) ?? 0) + 1);
    }
    const known = (categoriesQuery.data ?? []).map((category) => ({
      id: category.id,
      label: category.label,
      color: category.color,
      count: counts.get(category.id) ?? 0
    }));
    const knownIds = new Set(known.map((category) => category.id));
    for (const [id, count] of counts) {
      if (knownIds.has(id)) continue;
      known.push({ id, label: id, color: categoryColor(id), count });
    }
    return known;
  }, [categoriesQuery.data, sources]);

  useEffect(() => {
    if (categoryFilter === 'all') return;
    if (!categoryOptions.some((category) => category.id === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryOptions]);

  const visibleSources =
    categoryFilter === 'all' ? sources : sources.filter((source) => source.categoryId === categoryFilter);
  const visibleActiveCount = visibleSources.filter((source) => source.enabled).length;
  const visibleErrorCount = visibleSources.filter((source) => source.enabled && source.lastErrorCode).length;

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => sources.some((source) => source.id === id)));
      return next.size === current.size ? current : next;
    });
  }, [sources]);

  // Permite que o calendário abra o formulário já no tipo certo: /sources?novo=tmdb
  useEffect(() => {
    const requested = searchParams.get('novo');
    if (!requested) return;
    if (!(requested in SOURCE_TYPES)) return;
    const type = requested as SourceType;
    if (!SOURCE_TYPES[type].available) return;

    setEditing(null);
    setDefaultType(type);
    setFormOpen(true);

    const next = new URLSearchParams(searchParams);
    next.delete('novo');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openCreate = (): void => {
    setEditing(null);
    setDefaultType(undefined);
    setFormOpen(true);
  };

  const openEdit = (source: SourceDto): void => {
    setEditing(source);
    setDefaultType(undefined);
    setFormOpen(true);
  };

  const allVisibleSelected =
    visibleSources.length > 0 && visibleSources.every((source) => selectedIds.has(source.id));

  const toggleSelect = (id: string, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const source of visibleSources) next.delete(source.id);
      } else {
        for (const source of visibleSources) next.add(source.id);
      }
      return next;
    });
  };

  const exitSelectMode = (): void => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const confirmDelete = (): void => {
    if (deleteTargets.length === 0) return;
    deleteSources.mutate(
      deleteTargets.map((source) => source.id),
      {
        onSuccess: () => {
          setDeleteTargets([]);
          setSelectMode(false);
          setSelectedIds(new Set());
        }
      }
    );
  };

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t('Conexões')}
        title={t('Fontes')}
        description={
          <>
            {categoryFilter === 'all'
              ? t(sources.length === 1 ? '{count} fonte' : '{count} fontes', {
                  count: sources.length
                })
              : t('{visible} de {total} fontes', {
                  visible: visibleSources.length,
                  total: sources.length
                })}{' '}
            · {visibleActiveCount} {t(visibleActiveCount === 1 ? 'ativa' : 'ativas')}
            {visibleErrorCount > 0
              ? ` · ${visibleErrorCount} ${t('com erro')}`
              : ''}
          </>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant={selectMode ? 'subtle' : 'ghost'}
              size="sm"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              icon={<CheckSquare className="h-4 w-4" />}
            >
              {selectMode ? t('Cancelar seleção') : t('Selecionar')}
            </Button>
            <div
              className="flex items-center gap-0.5 rounded-lg border border-line bg-bg/40 p-0.5"
              role="group"
              aria-label={t('Estilo de apresentação das fontes')}
            >
              <button
                type="button"
                onClick={() => changeView('list')}
                aria-pressed={view === 'list'}
                aria-label={t('Mostrar fontes em lista')}
                title={t('Lista')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition',
                  view === 'list'
                    ? 'bg-accent/15 text-accent'
                    : 'text-faint hover:bg-elevated hover:text-fg'
                )}
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => changeView('grid')}
                aria-pressed={view === 'grid'}
                aria-label={t('Mostrar fontes em grade')}
                title={t('Grade')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md transition',
                  view === 'grid'
                    ? 'bg-accent/15 text-accent'
                    : 'text-faint hover:bg-elevated hover:text-fg'
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
            <Button variant="primary" size="sm" onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
              {t('Nova fonte')}
            </Button>
          </div>
        }
      />

      {selectMode ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 p-2.5">
          <Button variant="subtle" size="sm" onClick={toggleSelectAll}>
            {allVisibleSelected ? t('Desmarcar todas') : t('Selecionar todas')}
          </Button>
          <span className="text-[11px] font-medium text-muted">
            {t('{count} selecionada(s)', { count: selectedIds.size })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={selectedIds.size === 0}
              loading={deleteSources.isPending}
              onClick={() =>
                setDeleteTargets(sources.filter((source) => selectedIds.has(source.id)))
              }
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              {t('Excluir selecionadas')}
            </Button>
            <Button variant="ghost" size="sm" onClick={exitSelectMode}>
              {t('Cancelar')}
            </Button>
          </div>
        </div>
      ) : null}

      {sourcesQuery.isError ? (
        <div className="mb-3">
          <ErrorBanner
            message={sourcesQuery.error instanceof Error ? sourcesQuery.error.message : t('Não foi possível carregar as fontes.')}
          />
        </div>
      ) : null}

      {deleteSources.isError ? (
        <div className="mb-3">
          <ErrorBanner message={deleteSources.error instanceof Error ? deleteSources.error.message : t('Falha ao remover.')} />
        </div>
      ) : null}

      {sourcesQuery.isLoading ? (
        <div
          className={cn(
            view === 'grid'
              ? 'grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]'
              : 'space-y-3'
          )}
        >
          {[0, 1, 2].map((index) => (
            <div key={index} className="card h-28 animate-pulse bg-elevated/40" />
          ))}
        </div>
      ) : null}

      {!sourcesQuery.isLoading && sources.length === 0 ? (
        <EmptyState
          icon={<Rss className="h-5 w-5" />}
          title={t('Nenhuma fonte cadastrada')}
          description={t(
            'Adicione um canal do YouTube ou um feed RSS. Você pode pausar, editar e acompanhar o status de cada fonte aqui.'
          )}
          action={
            <Button variant="primary" size="sm" onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
              {t('Adicionar fonte')}
            </Button>
          }
        />
      ) : null}

      {!sourcesQuery.isLoading && sources.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t('Filtrar fontes por gênero')}>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            aria-pressed={categoryFilter === 'all'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
              categoryFilter === 'all'
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-line bg-bg/40 text-muted hover:border-line hover:bg-elevated/60 hover:text-fg'
            )}
          >
            {t('Todos')}
            <span className="rounded-full bg-elevated px-1.5 text-[10px] tabular-nums text-faint">{sources.length}</span>
          </button>

          {categoryOptions.map((category) => {
            const active = categoryFilter === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryFilter(category.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                  active
                    ? 'border-accent/60 bg-accent/10 text-fg'
                    : 'border-line bg-bg/40 text-muted hover:border-line hover:bg-elevated/60 hover:text-fg',
                  category.count === 0 && !active ? 'opacity-60' : ''
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} aria-hidden="true" />
                {t(category.label)}
                <span className="rounded-full bg-elevated px-1.5 text-[10px] tabular-nums text-faint">
                  {category.count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!sourcesQuery.isLoading && sources.length > 0 && visibleSources.length === 0 ? (
        <EmptyState
          icon={<Rss className="h-5 w-5" />}
          title={t('Nenhuma fonte neste gênero')}
          description={t('Escolha outro gênero ou volte para a lista completa.')}
          action={
            <Button variant="subtle" size="sm" onClick={() => setCategoryFilter('all')}>
              {t('Mostrar todas')}
            </Button>
          }
        />
      ) : null}

      <div
        className={cn(
          view === 'grid'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]'
            : 'space-y-2.5'
        )}
      >
        {visibleSources.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            layout={view}
            refreshing={refreshSource.isPending && refreshSource.variables === source.id}
            onEdit={() => openEdit(source)}
            onDelete={() => setDeleteTargets([source])}
            onRefresh={() => refreshSource.mutate(source.id)}
            onToggle={(enabled) => updateSource.mutate({ id: source.id, body: { enabled } })}
            onNovelProgress={() => setNovelTarget(source)}
            selectable={selectMode}
            selected={selectedIds.has(source.id)}
            onSelect={(checked) => toggleSelect(source.id, checked)}
          />
        ))}
      </div>

      {sources.some((source) => source.isDemo) ? (
        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          {t(
            'As fontes marcadas como demo são fictícias e não entram na atualização automática. Você pode removê-las em Configurações.'
          )}
        </p>
      ) : null}

      <SourceFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        source={editing}
        defaultType={defaultType}
      />

      <NovelProgressModal
        open={Boolean(novelTarget)}
        onClose={() => setNovelTarget(null)}
        source={novelTarget}
      />

      <Modal
        open={deleteTargets.length > 0}
        onClose={() => setDeleteTargets([])}
        title={
          deleteTargets.length === 1
            ? t('Remover fonte?')
            : t('Remover {count} fontes?', { count: deleteTargets.length })
        }
        description={
          deleteTargets.length === 1
            ? t('Os itens já capturados desta fonte também serão apagados.')
            : t('Os itens já capturados dessas fontes também serão apagados.')
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTargets([])}>
              {t('Cancelar')}
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleteSources.isPending}>
              {t('Remover')}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-muted">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p>
            {deleteTargets.length === 1
              ? t('{name} e seus {count} itens serão removidos definitivamente.', {
                  name: deleteTargets[0]?.name ?? '',
                  count: deleteTargets[0]?.itemCount ?? 0
                })
              : t('{count} fontes e todos os seus itens serão removidos definitivamente.', {
                  count: deleteTargets.length
                })}
          </p>
        </div>
      </Modal>
    </div>
  );
}
