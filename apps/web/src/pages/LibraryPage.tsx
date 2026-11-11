/** Biblioteca Stremio: todos os títulos, Continuar assistindo e sincronização. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard,
  Library,
  RefreshCw,
  Search,
  Upload
} from 'lucide-react';
import type {
  FeedItemDto,
  StremioImportResultDto,
  StremioLibraryItemDto
} from '@hub/shared';
import { Button, EmptyState, ErrorBanner, InfoBanner, PageHeader, SuccessNote } from '@/components/ui';
import { CardHoverPreview } from '@/components/stremio/CardHoverPreview';
import { NovelCard, type NovelChapterTarget, type NovelGroup } from '@/components/feed/NovelCard';
import { NovelReader } from '@/components/novels/NovelReader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { syntheticNovelItem } from '@/lib/novel-source-item';
import { useFeed, useSources, useStremioLibrary, useStremioStatus } from '@/lib/queries';
import { streamTargetFromLibraryItem } from '@/lib/stream-target';
import { cn, formatRelative } from '@/lib/utils';

type Filter = 'all' | 'movie' | 'series' | 'anime' | 'novel';

const LIBRARY_LIMITS = [25, 50, 100] as const;
type LibraryLimit = (typeof LIBRARY_LIMITS)[number];
const LIBRARY_LIMIT_KEY = 'hub.library.limit';

function readLibraryLimit(): LibraryLimit {
  try {
    const value = Number(window.localStorage.getItem(LIBRARY_LIMIT_KEY));
    return LIBRARY_LIMITS.includes(value as LibraryLimit) ? (value as LibraryLimit) : 25;
  } catch {
    return 25;
  }
}

function seasonCode(item: StremioLibraryItemDto): string | null {
  if (item.type !== 'series') return null;
  if (item.season !== null && item.season > 0 && item.episode !== null) {
    return `S${item.season}E${item.episode}`;
  }
  return 'Série';
}

function LibraryCard({ item }: { item: StremioLibraryItemDto }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const navigate = useNavigate();
  const target = streamTargetFromLibraryItem(item);
  const open = (): void => {
    navigate('/', { state: { streamTarget: target } });
  };
  const code = seasonCode(item);

  return (
    <CardHoverPreview
      type={item.type}
      metaId={item.metaId}
      name={item.name}
      poster={item.poster}
      onPlay={open}
      playLabel={item.progress > 0.01 ? t('Continuar') : t('Assistir')}
    >
      <button
        type="button"
        onClick={open}
        className="group block w-full min-w-0 text-left"
        title={`${t('Assistir')} ${item.name} ${t('no Feed')}`}
      >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-line bg-elevated">
        {item.poster && !failed ? (
          <img
            src={item.poster}
            alt=""
            loading="lazy"
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
              <div className="h-full bg-accent" style={{ width: `${Math.round(item.progress * 100)}%` }} />
            </div>
            <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
              {Math.round(item.progress * 100)}%
            </span>
          </>
        ) : null}

        {code ? (
          <span className="absolute bottom-2 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            {code === 'Série' ? t('Série') : code}
          </span>
        ) : null}

        {item.isLocal ? (
          <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-accent-fg shadow">
            {t('Local')}
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-fg">{item.name}</p>
      <p className="mt-0.5 truncate text-[10px] text-faint">
        {item.type === 'series' ? t('Série') : t('Filme')} · {formatRelative(item.lastWatchedAt)}
      </p>
      </button>
    </CardHoverPreview>
  );
}

export function LibraryPage() {
  const { t } = useI18n();
  const statusQuery = useStremioStatus();
  const connected = Boolean(statusQuery.data?.connected);
  const expired = Boolean(statusQuery.data?.expired);
  const libraryQuery = useStremioLibrary(connected);
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState<LibraryLimit>(readLibraryLimit);
  const [extraCount, setExtraCount] = useState(0);
  const [busy, setBusy] = useState<'sync' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<StremioImportResultDto | null>(null);

  const items = libraryQuery.data?.items ?? [];
  const sourcesQuery = useSources();
  const novelSources = useMemo(
    () =>
      (sourcesQuery.data ?? []).filter((source) => source.categoryId === 'novel'),
    [sourcesQuery.data]
  );

  const [novelReader, setNovelReader] = useState<FeedItemDto | null>(null);
  const novelFeedQuery = useFeed('novel');

  const novelFeedBySource = useMemo(() => {
    const map = new Map<string, FeedItemDto>();
    for (const item of novelFeedQuery.data?.pages.flatMap((page) => page.items) ?? []) {
      if (item.kind !== 'chapter') continue;
      const current = map.get(item.sourceId);
      const index =
        typeof item.meta?.chapterIndex === 'number' ? item.meta.chapterIndex : null;
      const currentIndex =
        current && typeof current.meta?.chapterIndex === 'number'
          ? current.meta.chapterIndex
          : null;
      if (
        !current ||
        index === null ||
        currentIndex === null ||
        index > currentIndex ||
        (index === currentIndex && item.publishedAt > current.publishedAt)
      ) {
        map.set(item.sourceId, item);
      }
    }
    return map;
  }, [novelFeedQuery.data]);

  const novelGroups = useMemo<NovelGroup[]>(() => {
    const groups: NovelGroup[] = [];
    for (const source of novelSources) {
      const latest = novelFeedBySource.get(source.id) ?? syntheticNovelItem(source);
      if (!latest) continue;
      const config = source.config ?? {};
      const meta = latest.meta ?? {};
      const rawLastRead = config.lastReadChapter;
      const lastRead =
        rawLastRead && typeof rawLastRead === 'object'
          ? (() => {
              const record = rawLastRead as Record<string, unknown>;
              return typeof record.chapterId === 'string' &&
                typeof record.chapterName === 'string'
                ? {
                    chapterId: record.chapterId,
                    chapterIndex:
                      typeof record.chapterIndex === 'number'
                        ? record.chapterIndex
                        : null,
                    chapterName: record.chapterName
                  }
                : null;
            })()
          : null;
      const latestIndex = typeof meta.chapterIndex === 'number' ? meta.chapterIndex : null;
      groups.push({
        key: `novel-source:${source.id}`,
        sourceId: source.id,
        bookId:
          (typeof meta.bookId === 'string' ? meta.bookId : null) ??
          (typeof config.bookId === 'string' ? config.bookId : null),
        title:
          (typeof meta.bookTitle === 'string' ? meta.bookTitle : null) ??
          (typeof config.title === 'string' && config.title.trim()
            ? config.title.trim()
            : source.name),
        author: typeof config.author === 'string' ? config.author : null,
        coverUrl:
          (typeof meta.coverUrl === 'string' ? meta.coverUrl : null) ??
          (typeof config.coverUrl === 'string' ? config.coverUrl : null),
        description:
          (typeof config.description === 'string' ? config.description : null) ??
          latest.description,
        categoryLabel: latest.categoryLabel,
        chapterCount:
          typeof meta.chapterCount === 'number'
            ? meta.chapterCount
            : typeof config.chapterCount === 'number'
              ? config.chapterCount
              : (latestIndex ?? 0),
        latest,
        items: [latest],
        lastRead,
        lastReadIndex: lastRead?.chapterIndex ?? 0,
        latestIndex,
        hasNew: latestIndex !== null && latestIndex > (lastRead?.chapterIndex ?? 0)
      });
    }
    return groups.sort(
      (a, b) => Date.parse(b.latest.publishedAt) - Date.parse(a.latest.publishedAt)
    );
  }, [novelSources, novelFeedBySource]);

  const openNovelGroupChapter = (
    group: NovelGroup,
    chapter: NovelChapterTarget | null
  ): void => {
    const base = group.latest;
    const baseMeta = base.meta ?? {};
    setNovelReader({
      ...base,
      id: `novel-source:${group.sourceId}`,
      title: chapter?.name ?? base.title,
      url: chapter?.url ?? base.url,
      meta: {
        ...baseMeta,
        bookId: group.bookId ?? baseMeta.bookId,
        bookTitle: group.title,
        chapterId: chapter?.id ?? baseMeta.chapterId,
        chapterName: chapter?.name ?? baseMeta.chapterName,
        chapterIndex: chapter?.index ?? baseMeta.chapterIndex,
        chapterCount: group.chapterCount,
        coverUrl: group.coverUrl
      }
    });
  };

  const counts = useMemo(
    () => ({
      all: items.length,
      movie: items.filter((item) => item.type === 'movie' && !item.isAnime).length,
      series: items.filter((item) => item.type === 'series' && !item.isAnime).length,
      anime: items.filter((item) => item.isAnime).length
    }),
    [items]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'novel') return false;
      if (filter === 'anime' && !item.isAnime) return false;
      if (filter === 'movie' && (item.type !== 'movie' || item.isAnime)) return false;
      if (filter === 'series' && (item.type !== 'series' || item.isAnime)) return false;
      if (term && !item.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, filter, search]);

  const filteredNovels = useMemo(() => {
    if (filter !== 'all' && filter !== 'novel') return [];
    const term = search.trim().toLowerCase();
    if (!term) return novelGroups;
    return novelGroups.filter(
      (group) =>
        group.title.toLowerCase().includes(term) ||
        (group.author ?? '').toLowerCase().includes(term)
    );
  }, [novelGroups, filter, search]);

  useEffect(() => {
    setExtraCount(0);
  }, [filter, search, limit]);

  const visibleCount = limit + extraCount;
  const visible = filtered.slice(0, visibleCount);

  const updateLimit = (next: LibraryLimit): void => {
    setLimit(next);
    try {
      window.localStorage.setItem(LIBRARY_LIMIT_KEY, String(next));
    } catch {
      // Armazenamento indisponível.
    }
  };

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['stremio-status'] });
    await queryClient.invalidateQueries({ queryKey: ['stremio-library'] });
  };

  const handleSync = async (): Promise<void> => {
    setBusy('sync');
    setError(null);
    setMessage(null);
    try {
      await api.stremioSync();
      setMessage(t('Sincronização iniciada. A biblioteca atualiza em instantes.'));
    } catch (syncError) {
      setError(
        syncError instanceof Error ? syncError.message : t('Não foi possível sincronizar.')
      );
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (): Promise<void> => {
    setBusy('import');
    setError(null);
    setMessage(null);
    setImportResult(null);
    try {
      const result = await api.stremioImport();
      setImportResult(result);
      setMessage(t('Importação concluída.'));
      await refresh();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : t('Não foi possível importar a biblioteca.')
      );
    } finally {
      setBusy(null);
    }
  };

  if (statusQuery.isLoading) {
    return (
      <div>
        <PageHeader eyebrow="Stremio" title={t('Biblioteca')} description={t('Carregando sua biblioteca…')} />
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
      </div>
    );
  }

  if (!connected) {
    return (
      <div>
        <PageHeader
          eyebrow="Stremio"
          title={t('Biblioteca')}
          description={t(
            'Sua biblioteca e o que você está assistindo, lidos direto da conta do Stremio.'
          )}
        />
        <EmptyState
          icon={<Library className="h-5 w-5" />}
          title={t('Conecte sua conta do Stremio')}
          description={t(
            'A conexão é somente leitura: o Hub nunca adiciona, remove ou grava progresso na sua conta.'
          )}
          action={
            <Link
              to="/settings"
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition hover:brightness-110"
            >
              {t('Ir para Configurações')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Stremio"
        title={t('Biblioteca')}
        description={
          <>
            <span className="font-medium text-fg">{items.length}</span> {t('título(s)')} · Stremio (
            {t('somente leitura')}) + {t('Minha biblioteca do Hub')}
            {statusQuery.data?.lastSyncAt
              ? ` · ${t('sincronizada')} ${formatRelative(statusQuery.data.lastSyncAt)}`
              : ''}
          </>
        }
        actions={
          <>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void handleSync()}
              loading={busy === 'sync'}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('Sincronizar')}
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void handleImport()}
              loading={busy === 'import'}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {t('Importar para fontes')}
            </Button>
          </>
        }
      />

      {expired ? (
        <InfoBanner
          message={t(
            'Sessão do Stremio expirada. Os títulos abaixo são a última sincronização; reconecte para atualizar.'
          )}
          action={
            <Link
              to="/settings"
              className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
            >
              {t('Reconectar')}
            </Link>
          }
        />
      ) : null}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', t('Todos {count}', { count: counts.all + novelGroups.length })],
              ['movie', t('Filmes {count}', { count: counts.movie })],
              ['series', t('Séries {count}', { count: counts.series })],
              ['anime', t('Animação/Anime {count}', { count: counts.anime })],
              ['novel', t('Novel {count}', { count: novelGroups.length })]
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'h-8 rounded-lg border px-2.5 text-xs font-medium transition',
                filter === value
                  ? 'border-accent/40 bg-accent/10 text-fg'
                  : 'border-line bg-bg/40 text-muted hover:bg-elevated hover:text-fg'
              )}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              className="field-input h-8 pl-8 text-xs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Buscar na biblioteca')}
              aria-label={t('Buscar na biblioteca')}
            />
          </div>

          <label className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-faint">
            {t('Mostrar')}
            <select
              className="field-input h-8 w-auto py-1 text-xs"
              value={limit}
              onChange={(event) => updateLimit(Number(event.target.value) as LibraryLimit)}
              aria-label={t('Quantidade de cards')}
            >
              {LIBRARY_LIMITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ErrorBanner message={error} />
      <SuccessNote message={message} />

      {importResult ? (
        <div className="mt-2 rounded-xl border border-line/70 bg-bg/40 p-3 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-fg">
            {t('Importação: {created} fonte(s) criada(s), {skipped} já existente(s).', {
              created: importResult.created,
              skipped: importResult.skipped
            })}
          </p>
          {importResult.errors.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-warning">
              {importResult.errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {libraryQuery.isError ? (
        <div className="mt-3">
          <ErrorBanner
            message={
              libraryQuery.error instanceof Error
                ? libraryQuery.error.message
                : t('Não foi possível carregar a biblioteca.')
            }
          />
        </div>
      ) : null}

      {!libraryQuery.isLoading && filtered.length === 0 && filteredNovels.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            icon={<Library className="h-5 w-5" />}
            title={
              items.length === 0 ? t('Sua biblioteca está vazia') : t('Nenhum título encontrado')
            }
            description={
              items.length === 0
                ? t(
                    'Adicione títulos no Stremio ou use a prévia dos cards para salvar na Minha biblioteca do Hub.'
                  )
                : t('Tente outro termo ou troque o filtro.')
            }
            action={
              items.length === 0 ? (
                <Button variant="subtle" size="sm" onClick={() => void handleSync()} loading={busy === 'sync'}>
                  {t('Sincronizar agora')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-3 text-[10px] text-faint">
            {t('Mostrando {shown} de {total} título(s)', {
              shown: visible.length + filteredNovels.length,
              total: filtered.length + filteredNovels.length
            })}
          </p>
          <div
            className="mt-2 grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(9.5rem, 45%), 1fr))' }}
          >
            {visible.map((item) => (
              <LibraryCard key={item.metaId} item={item} />
            ))}
            {filteredNovels.map((group) => (
              <NovelCard
                key={group.key}
                group={group}
                layout="tile"
                onOpenChapter={(chapter) => openNovelGroupChapter(group, chapter)}
              />
            ))}
          </div>
          {filtered.length > visible.length ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setExtraCount((count) => count + limit)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-line bg-elevated px-4 text-xs font-semibold text-fg transition hover:border-accent/40"
              >
                {t('Carregar mais')}
              </button>
            </div>
          ) : null}
        </>
      )}

      {novelReader ? (
        <NovelReader item={novelReader} onClose={() => setNovelReader(null)} />
      ) : null}
    </div>
  );
}
