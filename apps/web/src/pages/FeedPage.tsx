/** Tela principal: feed com abas, filtro por fonte, scroll infinito e 3 layouts. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BellRing,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Gamepad2,
  Globe,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Play,
  Plus,
  RefreshCw,
  Rss,
  Star,
  X
} from 'lucide-react';
import {
  FAVORITES_TAB_ID,
  WATCH_LATER_TAB_ID,
  type CategoryCountDto,
  type FeedItemDto,
  type GameDto,
  type PlaybackProgressDto,
  type StremioLibraryItemDto
} from '@hub/shared';
import { Button, EmptyState, ErrorBanner, IconButton, PageHeader, Thumb } from '@/components/ui';
import { HorizontalScroller } from '@/components/ui/HorizontalScroller';
import { ItemCard } from '@/components/feed/ItemCard';
import { ItemTile } from '@/components/feed/ItemTile';
import { FeedBrowser } from '@/components/feed/FeedBrowser';
import {
  NovelCard,
  type NovelChapterTarget,
  type NovelGroup
} from '@/components/feed/NovelCard';
import { NovelReader } from '@/components/novels/NovelReader';
import { NovelDownloadStatus } from '@/components/novels/NovelDownloadStatus';
import { NovelOfflineManager } from '@/components/novels/NovelOfflineManager';
import { ArticleReader } from '@/components/news/ArticleReader';
import { FeedTabs } from '@/components/feed/FeedTabs';
import { FeedViewSwitcher, type FeedView } from '@/components/feed/FeedViewSwitcher';
import { GameDetailModal } from '@/components/games/GameDetailModal';
import { GameFeedCard } from '@/components/games/GameFeedCard';
import { useI18n } from '@/lib/i18n';
import { ContinueWatchingSection } from '@/components/stremio/ContinueWatching';
import { LocalContinueWatchingSection } from '@/components/stremio/LocalContinueWatching';
import type { StreamTarget } from '@/components/stremio/StreamPicker';
import { StremioBadge } from '@/components/stremio/StremioBadge';
import { LibraryToggleButton } from '@/components/stremio/LibraryToggleButton';
import {
  useCounts,
  useFeed,
  useGames,
  useMarkAllRead,
  usePlaybackContinue,
  useRefreshAll,
  useRefreshState,
  useSetNovelProgress,
  useSources,
  useStremioLibrary,
  useStremioStatus,
  useSettings,
  useUpdateItem
} from '@/lib/queries';
import { syntheticNovelItem } from '@/lib/novel-source-item';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  feedItemFromNotification,
  notificationStreamTarget,
  notificationVideoId,
  readNotificationCategories,
  writeNotificationCategories,
  type ContentNotification
} from '@/lib/notifications';
import { youtubeVideoId } from '@/lib/youtube';
import { SourceFormModal } from '@/components/sources/SourceFormModal';
import { QuickAddModal } from '@/components/sources/QuickAddModal';
import { AddAddonModal } from '@/components/sources/AddAddonModal';

const FALLBACK_COUNTS: CategoryCountDto[] = [{ id: 'all', label: 'Todos', unread: 0, total: 0 }];
const VIEW_STORAGE_KEY = 'hub.feedView';
const SECTION_ORDER_KEY = 'hub.feed.sectionOrder';
const COLLAPSED_ROWS_KEY = 'hub.feed.collapsedRows';

function novelKey(item: FeedItemDto): string | null {
  const meta = item.meta ?? {};
  if (item.kind !== 'chapter' && typeof meta.bookId !== 'string') return null;
  const bookId = typeof meta.bookId === 'string' ? meta.bookId : null;
  const title = typeof meta.bookTitle === 'string' ? meta.bookTitle : item.sourceName;
  return `${item.sourceId}:${bookId ?? title}`;
}

function novelTarget(
  group: NovelGroup,
  chapter: NovelChapterTarget | null
): NovelChapterTarget {
  if (chapter) return chapter;
  if (group.lastRead) {
    const item = group.items.find(
      (candidate) => candidate.meta?.chapterId === group.lastRead?.chapterId
    );
    return {
      id: group.lastRead.chapterId,
      name: group.lastRead.chapterName,
      index: group.lastRead.chapterIndex,
      url: item?.url ?? null
    };
  }
  const meta = group.latest.meta ?? {};
  return {
    id: typeof meta.chapterId === 'string' ? meta.chapterId : null,
    name: typeof meta.chapterName === 'string' ? meta.chapterName : group.latest.title,
    index: typeof meta.chapterIndex === 'number' ? meta.chapterIndex : group.latestIndex,
    url: group.latest.url || null
  };
}

function readStoredStringArray(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeStoredStringArray(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Armazenamento indisponível.
  }
}

function RowMoveButtons({
  canUp,
  canDown,
  onUp,
  onDown
}: {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const { t } = useI18n();
  const base =
    'flex h-6 w-6 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint';
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onUp}
        disabled={!canUp}
        aria-label={t('Mover seção para cima')}
        title={t('Mover para cima')}
        className={base}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={!canDown}
        aria-label={t('Mover seção para baixo')}
        title={t('Mover para baixo')}
        className={base}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface FeedSection {
  id: string;
  kind: 'local' | 'stremio' | 'category';
  label?: string;
  items?: FeedItemDto[];
}

function readStoredView(): FeedView {
  try {
    const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (value === 'grid' || value === 'netflix' || value === 'list') return value;
  } catch {
    // localStorage indisponível (modo privado): usa o estilo Netflix.
  }
  return 'netflix';
}

const StreamPicker = lazy(() =>
  import('@/components/stremio/StreamPicker').then((module) => ({
    default: module.StreamPicker
  }))
);

/** Notícias e artigos ganham o modo leitura interno. */
function isArticleItem(item: FeedItemDto): boolean {
  return item.kind === 'article' || item.categoryId === 'news';
}

/** Botão/aba do navegador embutido, usado no destaque e no Feed vazio. */
function FeedBrowserToggle({
  open,
  onOpen,
  onClose,
  title
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  title: string;
}) {
  if (open) {
    return (
      <div className="min-w-0 flex-1">
        <FeedBrowser onClose={onClose} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        // Android: o navegador é uma tela nativa (WebView), não o painel com CDP.
        if (window.HubNative?.openBrowser) {
          window.HubNative.openBrowser('');
          return;
        }
        onOpen();
      }}
      title={title}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-xl border border-line bg-elevated px-3 text-xs font-semibold text-fg shadow-sm transition hover:border-accent/40 hover:bg-elevated/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Globe className="h-4 w-4 text-accent" />
      Browser
    </button>
  );
}

function targetFromFeedItem(item: FeedItemDto): StreamTarget | null {  if (!item.imdbId) return null;
  const meta = item.meta ?? {};
  const releaseKind = typeof meta.releaseKind === 'string' ? meta.releaseKind : null;
  const type: 'movie' | 'series' =
    item.mediaKind === 'movie' || releaseKind === 'cinema' || releaseKind === 'digital'
      ? 'movie'
      : 'series';
  const season =
    type === 'series' ? (typeof meta.season === 'number' ? meta.season : 1) : null;
  const episode =
    type === 'series' ? (typeof meta.episode === 'number' ? meta.episode : 1) : null;

  return {
    title: item.sourceName || item.title,
    type,
    metaId: item.imdbId,
    imdbId: item.imdbId,
    poster: item.thumbnailUrl,
    backdrop: item.thumbnailUrl,
    description: item.description,
    year: null,
    season,
    episode
  };
}

function targetFromLibraryItem(item: StremioLibraryItemDto): StreamTarget {
  return {
    title: item.name,
    type: item.type,
    metaId: item.metaId,
    imdbId: item.imdbId,
    poster: item.poster,
    backdrop: null,
    description: null,
    year: null,
    season: item.type === 'series' ? (item.season && item.season > 0 ? item.season : 1) : null,
    episode: item.type === 'series' ? (item.episode && item.episode > 0 ? item.episode : 1) : null
  };
}

export function FeedPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [sourceId, setSourceId] = useState<string | undefined>(undefined);

  const changeTab = (next: string): void => {
    setTab(next);
    setSourceId(undefined);
  };
  const [view, setView] = useState<FeedView>(readStoredView);
  const [heroIndex, setHeroIndex] = useState(0);
  const [playing, setPlaying] = useState<{ item: FeedItemDto; videoId: string } | null>(null);
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);
  const [heroPaused, setHeroPaused] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [readerItem, setReaderItem] = useState<FeedItemDto | null>(null);
  const [articleReaderItem, setArticleReaderItem] = useState<FeedItemDto | null>(null);
  const [gameDetailId, setGameDetailId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [sourceFormOpen, setSourceFormOpen] = useState(false);
  const [addonFormOpen, setAddonFormOpen] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<string[] | null>(() =>
    readNotificationCategories()
  );
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const allCategoriesRef = useRef<HTMLInputElement | null>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() =>
    readStoredStringArray(SECTION_ORDER_KEY)
  );
  const [collapsedRows, setCollapsedRows] = useState<string[]>(() =>
    readStoredStringArray(COLLAPSED_ROWS_KEY)
  );
  const heroRef = useRef<HTMLDivElement | null>(null);

  const countsQuery = useCounts();
  const settingsQuery = useSettings();
  const sourcesQuery = useSources();
  const feedQuery = useFeed(tab, sourceId);
  const refreshState = useRefreshState();
  const refreshAll = useRefreshAll();
  const markAllRead = useMarkAllRead();
  const updateItem = useUpdateItem();
  const setNovelProgress = useSetNovelProgress();
  const playbackContinue = usePlaybackContinue();
  const stremioStatus = useStremioStatus();
  const stremioLibrary = useStremioLibrary();
  const gamesQuery = useGames('all', 'discount');

  const counts = countsQuery.data ?? FALLBACK_COUNTS;
  const feedWindowHours = settingsQuery.data?.feedWindowHours ?? 48;
  const sources = sourcesQuery.data ?? [];
  const items = useMemo(() => {
    const base = feedQuery.data?.pages.flatMap((page) => page.items) ?? [];
    if (tab !== 'novel' && tab !== 'all') return base;
    // Fontes recém-adicionadas ainda não têm itens sincronizados; mostra a
    // novel no Feed imediatamente usando os dados resolvidos da fonte.
    const known = new Set(base.map((item) => item.sourceId));
    const synthetic: FeedItemDto[] = [];
    for (const source of sources) {
      if (source.categoryId !== 'novel' || known.has(source.id)) continue;
      const item = syntheticNovelItem(source);
      if (item) synthetic.push(item);
    }
    return synthetic.length > 0 ? [...base, ...synthetic] : base;
  }, [feedQuery.data, sources, tab]);
  const gamesById = useMemo(
    () => new Map<string, GameDto>((gamesQuery.data?.games ?? []).map((game) => [game.id, game])),
    [gamesQuery.data]
  );
  const unread = counts.find((count) => count.id === tab)?.unread ?? 0;

  const novelGroups = useMemo(() => {
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const map = new Map<string, NovelGroup>();

    for (const item of items) {
      if (item.kind !== 'chapter') continue;
      const key = novelKey(item);
      if (!key) continue;
      const meta = item.meta ?? {};
      const source = sourceMap.get(item.sourceId);
      const config = source?.config ?? {};
      const index = typeof meta.chapterIndex === 'number' ? meta.chapterIndex : null;

      let group = map.get(key);
      if (!group) {
        group = {
          key,
          sourceId: item.sourceId,
          bookId:
            (typeof meta.bookId === 'string' ? meta.bookId : null) ??
            (typeof config.bookId === 'string' ? config.bookId : null),
          title:
            (typeof meta.bookTitle === 'string' ? meta.bookTitle : null) ??
            source?.name ??
            item.sourceName,
          author: typeof config.author === 'string' ? config.author : null,
          coverUrl:
            (typeof meta.coverUrl === 'string' ? meta.coverUrl : null) ??
            item.thumbnailUrl ??
            (typeof config.coverUrl === 'string' ? config.coverUrl : null),
          description:
            typeof config.description === 'string' ? config.description : item.description,
          categoryLabel: item.categoryLabel,
          chapterCount: 0,
          latest: item,
          items: [],
          lastRead: null,
          lastReadIndex: 0,
          latestIndex: null,
          hasNew: false
        };
        map.set(key, group);
      }

      group.items.push(item);
      group.chapterCount = Math.max(
        group.chapterCount,
        typeof meta.chapterCount === 'number' ? meta.chapterCount : 0,
        index ?? 0
      );

      const latestIndex =
        typeof group.latest.meta?.chapterIndex === 'number'
          ? group.latest.meta.chapterIndex
          : null;
      if (
        index !== null &&
        (latestIndex === null ||
          index > latestIndex ||
          (index === latestIndex && item.publishedAt > group.latest.publishedAt))
      ) {
        group.latest = item;
      }
    }

    for (const group of map.values()) {
      group.items.sort(
        (a, b) =>
          (typeof a.meta?.chapterIndex === 'number' ? a.meta.chapterIndex : 0) -
          (typeof b.meta?.chapterIndex === 'number' ? b.meta.chapterIndex : 0)
      );
      const source = sourceMap.get(group.sourceId);
      const raw = source?.config?.lastReadChapter;
      if (raw && typeof raw === 'object') {
        const record = raw as Record<string, unknown>;
        if (typeof record.chapterId === 'string' && typeof record.chapterName === 'string') {
          group.lastRead = {
            chapterId: record.chapterId,
            chapterIndex:
              typeof record.chapterIndex === 'number' ? record.chapterIndex : null,
            chapterName: record.chapterName
          };
        }
      }
      group.lastReadIndex = group.lastRead?.chapterIndex ?? 0;
      group.latestIndex =
        typeof group.latest.meta?.chapterIndex === 'number'
          ? group.latest.meta.chapterIndex
          : null;
      group.chapterCount = Math.max(group.chapterCount, group.latestIndex ?? 0);
      group.hasNew =
        (group.latestIndex !== null && group.latestIndex > group.lastReadIndex) ||
        (!group.lastRead && !group.latest.isRead);
    }

    const groups = [...map.values()].sort(
      (a, b) => Date.parse(b.latest.publishedAt) - Date.parse(a.latest.publishedAt)
    );
    return { groups, byKey: new Map(groups.map((group) => [group.key, group])) };
  }, [items, sources]);

  const openNovelChapter = (group: NovelGroup, chapter: NovelChapterTarget | null): void => {
    const target = novelTarget(group, chapter);
    const base = group.latest;
    const baseMeta = base.meta ?? {};
    const selectedItem = group.items.find(
      (candidate) => candidate.meta?.chapterId === target.id
    );
    if (selectedItem) markRead(selectedItem);
    const readerItem: FeedItemDto = {
      ...base,
      url: target.url ?? '',
      title: target.name,
      meta: {
        ...baseMeta,
        bookId: group.bookId ?? baseMeta.bookId,
        bookTitle: group.title,
        chapterId: target.id ?? baseMeta.chapterId,
        chapterName: target.name,
        chapterIndex: target.index ?? baseMeta.chapterIndex,
        chapterCount: group.chapterCount,
        coverUrl: group.coverUrl
      }
    };
    setReaderItem(readerItem);
  };

  const feedEntries = useMemo(() => {
    const seen = new Set<string>();
    const seenGames = new Set<string>();
    const entries: Array<
      | { kind: 'novel'; group: NovelGroup }
      | { kind: 'game'; item: FeedItemDto; game: GameDto }
      | { kind: 'item'; item: FeedItemDto }
    > = [];
    for (const item of items) {
      const key = novelKey(item);
      const group = key ? novelGroups.byKey.get(key) : null;
      if (group) {
        if (seen.has(group.key)) continue;
        seen.add(group.key);
        entries.push({ kind: 'novel', group });
        continue;
      }
      const gameId =
        item.kind === 'price_drop' && typeof item.meta?.gameId === 'string'
          ? item.meta.gameId
          : null;
      const game = gameId ? gamesById.get(gameId) : null;
      if (game) {
        if (seenGames.has(game.id)) continue;
        seenGames.add(game.id);
        entries.push({ kind: 'game', item, game });
        continue;
      }
      entries.push({ kind: 'item', item });
    }
    return entries;
  }, [items, novelGroups, gamesById]);

  const novelGroupsForItems = (rowItems: FeedItemDto[]): NovelGroup[] => {
    const keys = new Set(rowItems.map((item) => novelKey(item)).filter(Boolean));
    return novelGroups.groups.filter((group) => keys.has(group.key));
  };
  const notificationCategories = counts.filter((count) => count.id !== 'all');
  const enabledCategories =
    notificationPrefs === null
      ? new Set(notificationCategories.map((count) => count.id))
      : new Set(notificationPrefs);
  const allNotifications = notificationPrefs === null;

  useEffect(() => {
    if (!notificationsOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!allCategoriesRef.current) return;
    allCategoriesRef.current.indeterminate =
      !allNotifications && enabledCategories.size > 0;
  }, [allNotifications, enabledCategories.size, notificationCategories.length]);

  const filterSources = useMemo(() => {
    const specialTab = tab === FAVORITES_TAB_ID || tab === WATCH_LATER_TAB_ID;
    const categoryTab = specialTab ? 'all' : tab;
    const base =
      categoryTab === 'all'
        ? sources
        : sources.filter((source) => source.categoryId === categoryTab);
    // Só fontes com itens aparecem no filtro do feed.
    return base.filter((source) => source.itemCount > 0);
  }, [sources, tab]);

  const busy = (refreshState.data?.active ?? 0) + (refreshState.data?.queued ?? 0) > 0;

  useEffect(() => {
    if (sourceId && !filterSources.some((source) => source.id === sourceId)) {
      setSourceId(undefined);
    }
  }, [filterSources, sourceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // ignora falha de storage
    }
  }, [view]);

  // Ao trocar de aba, o filtro de fonte da aba anterior deixa de fazer sentido.
  useEffect(() => {
    setSourceId(undefined);
  }, [tab]);

  // Ao trocar de aba/fonte, o destaque e o player voltam ao começo.
  useEffect(() => {
    setPlaying(null);
    setStreamTarget(null);
    setHeroIndex(0);
  }, [tab, sourceId]);

  useEffect(() => {
    if (view !== 'netflix') setStreamTarget(null);
  }, [view]);

  // Abre no destaque do Feed o título enviado por Explorar/Biblioteca ou por uma notificação.
  useEffect(() => {
    const state = location.state as {
      streamTarget?: StreamTarget;
      notification?: ContentNotification;
    } | null;
    const notification = state?.notification;
    const target =
      state?.streamTarget ?? (notification ? notificationStreamTarget(notification) : null);
    if (!target && !notification) return;

    if (target) {
      setPlaying(null);
      setStreamTarget(target);
    } else if (notification) {
      const videoId = notificationVideoId(notification);
      if (videoId) {
        const existing = items.find((item) => item.id === notification.id);
        setStreamTarget(null);
        setPlaying({ item: existing ?? feedItemFromNotification(notification), videoId });
      }
    }

    setView('netflix');
    setHeroPaused(false);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate, items]);

  // O destaque alterna como sugestão; pausa ao passar o mouse, reproduzir ou escolher stream.
  useEffect(() => {
    if (view !== 'netflix' || playing || streamTarget || heroPaused || browserOpen || items.length < 2) return;
    const timer = window.setInterval(() => {
      setHeroIndex((index) => (index + 1) % items.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [view, playing, streamTarget, heroPaused, browserOpen, items.length]);

  // Leva o player/destaque para a área visível quando um vídeo ou stream é escolhido.
  useEffect(() => {
    if (playing || streamTarget) heroRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [playing, streamTarget]);

  // Scroll infinito.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
          void feedQuery.fetchNextPage();
        }
      },
      { rootMargin: '500px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [feedQuery.hasNextPage, feedQuery.isFetchingNextPage, feedQuery.fetchNextPage, items.length]);

  const markRead = (item: FeedItemDto): void => {
    if (!item.isRead) updateItem.mutate({ id: item.id, patch: { isRead: true } });
  };

  const playInHero = (item: FeedItemDto, videoId: string): void => {
    markRead(item);
    const index = items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) setHeroIndex(index);
    setStreamTarget(null);
    setView('netflix');
    setHeroPaused(false);
    setPlaying({ item, videoId });
  };

  const openStreamsFromFeed = (item: FeedItemDto): void => {
    const target = targetFromFeedItem(item);
    if (!target) return;
    markRead(item);
    setPlaying(null);
    setStreamTarget(target);
    setView('netflix');
    setHeroPaused(false);
  };

  const openStreamsFromLibrary = (item: StremioLibraryItemDto): void => {
    setPlaying(null);
    setStreamTarget(targetFromLibraryItem(item));
    setView('netflix');
    setHeroPaused(false);
  };

  const openStreamsFromPlayback = (item: PlaybackProgressDto): void => {
    setPlaying(null);
    setStreamTarget({
      title: item.name,
      type: item.type,
      metaId: item.metaId,
      imdbId: item.metaId.startsWith('tt') ? item.metaId : null,
      poster: item.poster,
      backdrop: item.backdrop,
      description: null,
      year: item.year,
      season:
        item.type === 'series' ? (item.season && item.season > 0 ? item.season : 1) : null,
      episode:
        item.type === 'series' ? (item.episode && item.episode > 0 ? item.episode : 1) : null
    });
    setView('netflix');
    setHeroPaused(false);
  };

  const setNovelProgressFromItem = (item: FeedItemDto): void => {
    const meta = item.meta ?? {};
    if (typeof meta.chapterId !== 'string' || typeof meta.chapterName !== 'string') return;
    if (!item.isRead) updateItem.mutate({ id: item.id, patch: { isRead: true } });
    setNovelProgress.mutate({
      id: item.sourceId,
      body: {
        chapterId: meta.chapterId,
        chapterName: meta.chapterName,
        chapterIndex: typeof meta.chapterIndex === 'number' ? meta.chapterIndex : null
      }
    });
  };

  const toggleNotificationCategory = (id: string): void => {
    const next = new Set(enabledCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const value = next.size === notificationCategories.length ? null : [...next];
    setNotificationPrefs(value);
    writeNotificationCategories(value);
  };

  const toggleAllNotifications = (): void => {
    const value = allNotifications ? [] : null;
    setNotificationPrefs(value);
    writeNotificationCategories(value);
  };

  const openGameDetails = (item: FeedItemDto): void => {
    const gameId = typeof item.meta?.gameId === 'string' ? item.meta.gameId : null;
    if (!gameId) return;
    markRead(item);
    setGameDetailId(gameId);
  };

  const itemActions = (item: FeedItemDto) => ({
    item,
    onOpen: (event: MouseEvent<HTMLAnchorElement>) => {
      if (item.kind === 'chapter') {
        event.preventDefault();
        markRead(item);
        setReaderItem(item);
        return;
      }
      if (item.kind === 'price_drop' && typeof item.meta?.gameId === 'string') {
        event.preventDefault();
        openGameDetails(item);
        return;
      }
      const videoId = youtubeVideoId(item);
      if (videoId) {
        event.preventDefault();
        playInHero(item, videoId);
        return;
      }
      if (targetFromFeedItem(item)) {
        event.preventDefault();
        openStreamsFromFeed(item);
        return;
      }
      if (isArticleItem(item)) {
        event.preventDefault();
        markRead(item);
        setArticleReaderItem(item);
        return;
      }
      markRead(item);
    },
    onExternal: () => markRead(item),
    onToggleRead: () => updateItem.mutate({ id: item.id, patch: { isRead: !item.isRead } }),
    onToggleFavorite: () => updateItem.mutate({ id: item.id, patch: { isFavorite: !item.isFavorite } }),
    onToggleWatchLater: () => updateItem.mutate({ id: item.id, patch: { isWatchLater: !item.isWatchLater } }),
    onSetNovelProgress: item.kind === 'chapter' ? () => setNovelProgressFromItem(item) : undefined
  });

  // Estilo Netflix: um destaque rotativo (que também aparece nas fileiras abaixo).
  const heroItem =
    playing?.item ?? (items.length > 0 ? items[heroIndex % items.length] : undefined);
  const heroVideoId = heroItem ? youtubeVideoId(heroItem) : null;
  const heroStreamTarget = heroItem && !heroVideoId ? targetFromFeedItem(heroItem) : null;
  const rows = useMemo(() => {
    if (view !== 'netflix') return [] as Array<{ id: string; label: string; items: FeedItemDto[] }>;
    const map = new Map<string, { id: string; label: string; items: FeedItemDto[] }>();
    for (const item of items) {
      const id = `category:${item.categoryId}`;
      const entry = map.get(id);
      if (entry) {
        entry.items.push(item);
      } else {
        map.set(id, { id, label: item.categoryLabel, items: [item] });
      }
    }
    return [...map.values()];
  }, [items, view]);

  const sections = useMemo(() => {
    if (view !== 'netflix') return [] as FeedSection[];
    const list: FeedSection[] = [];
    const streamingItems = stremioLibrary.data?.items ?? [];
    const hasStreamingContent =
      stremioStatus.data?.connected ||
      streamingItems.some(
        (item) =>
          item.progress > 0.01 ||
          (item.isLocal && item.inLibrary) ||
          item.isFavorite ||
          item.isWatchLater
      );
    if (tab === 'all') {
      if ((playbackContinue.data?.items.length ?? 0) > 0) {
        list.push({ id: 'local-continue', kind: 'local' });
      }
      if (hasStreamingContent) {
        list.push({ id: 'stremio-continue', kind: 'stremio' });
      }
    }
    for (const row of rows) {
      list.push({ id: row.id, kind: 'category', label: row.label, items: row.items });
    }

    if (sectionOrder.length === 0) return list;
    const known = new Set(list.map((section) => section.id));
    const ordered: FeedSection[] = [];
    for (const id of sectionOrder) {
      if (!known.has(id)) continue;
      const section = list.find((candidate) => candidate.id === id);
      if (section) ordered.push(section);
    }
    for (const section of list) {
      if (!ordered.some((candidate) => candidate.id === section.id)) ordered.push(section);
    }
    return ordered;
  }, [
    view,
    tab,
    rows,
    sectionOrder,
    playbackContinue.data,
    stremioStatus.data,
    stremioLibrary.data
  ]);

  const updateSectionOrder = (next: string[]): void => {
    setSectionOrder(next);
    writeStoredStringArray(SECTION_ORDER_KEY, next);
  };

  const toggleRowCollapsed = (id: string): void => {
    setCollapsedRows((previous) => {
      const next = previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id];
      writeStoredStringArray(COLLAPSED_ROWS_KEY, next);
      return next;
    });
  };

  const moveSection = (id: string, direction: -1 | 1): void => {
    const index = sections.findIndex((section) => section.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const next = sections.map((section) => section.id);
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    const extras = sectionOrder.filter((value) => !next.includes(value));
    updateSectionOrder([...next, ...extras]);
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('Sua central')}
        title={t('Feed')}
        description={
          <>
            <span className="font-medium text-fg">{unread}</span>{' '}
            {t(unread === 1 ? 'não lido' : 'não lidos')} ·{' '}
            {t(sources.length === 1 ? '{count} fonte' : '{count} fontes', {
              count: sources.length
            })}{' '}
            · {t('mais recentes primeiro')}
            {tab === 'youtube'
              ? ` ${t('· YouTube: últimas {hours}h', { hours: feedWindowHours })}`
              : ''}
          </>
        }
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setQuickAddOpen(true)}
              icon={<Plus className="h-3.5 w-3.5" />}
              title={t('Adicionar fontes')}
            >
              <span className="hidden sm:inline">{t('Adicionar fontes')}</span>
            </Button>

            <div ref={notificationsRef} className="relative">
              <Button
                variant="subtle"
                size="sm"
                onClick={() => setNotificationsOpen((open) => !open)}
                icon={<BellRing className="h-3.5 w-3.5" />}
                title={t('Escolher quais feeds geram notificação')}
              >
                <span className="hidden sm:inline">{t('Notificações')}</span>
              </Button>
              {notificationsOpen ? (
                <div className="absolute right-0 top-full z-[80] mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-2xl shadow-black/40">
                  <div className="flex items-center justify-between gap-2 px-1 pb-1">
                    <p className="text-[11px] font-semibold text-fg">{t('Notificar sobre')}</p>
                    <button
                      type="button"
                      onClick={toggleAllNotifications}
                      className="text-[10px] font-semibold text-accent hover:underline"
                    >
                      {allNotifications ? t('Desmarcar todos') : t('Marcar todos')}
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-elevated">
                    <input
                      ref={allCategoriesRef}
                      type="checkbox"
                      checked={allNotifications}
                      onChange={toggleAllNotifications}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                    <span className="text-xs font-medium text-fg">{t('Todos os feeds')}</span>
                  </label>
                  <div className="max-h-64 space-y-0.5 overflow-y-auto border-t border-line/60 pt-1">
                    {notificationCategories.map((category) => (
                      <label
                        key={category.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-elevated"
                      >
                        <input
                          type="checkbox"
                          checked={enabledCategories.has(category.id)}
                          onChange={() => toggleNotificationCategory(category.id)}
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs text-fg">
                          {t(category.label)}
                        </span>
                        <span className="text-[10px] text-faint">{category.total}</span>
                      </label>
                    ))}
                    {notificationCategories.length === 0 ? (
                      <p className="px-1.5 py-2 text-[11px] text-faint">
                        {t('Nenhuma categoria disponível.')}
                      </p>
                    ) : null}
                  </div>
                  <p className="border-t border-line/60 px-1.5 pt-1.5 text-[10px] leading-relaxed text-faint">
                    {t(
                      'Vale para as notificações de novos conteúdos. O botão de teste continua mostrando os três exemplos.'
                    )}
                  </p>
                </div>
              ) : null}
            </div>

            <Button
              variant="subtle"
              size="sm"
              onClick={() => refreshAll.mutate()}
              loading={busy || refreshAll.isPending}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('Atualizar')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate({ tab, sourceId })}
              disabled={unread === 0 || markAllRead.isPending}
              icon={<CheckCheck className="h-3.5 w-3.5" />}
              title={t('Marcar todos os itens visíveis como lidos')}
            >
              <span className="hidden sm:inline">{t('Marcar lidos')}</span>
            </Button>
          </>
        }
      />

      <div className="mb-4 space-y-2">
        <div className="min-w-0">
          <FeedTabs counts={counts} active={tab} onChange={changeTab} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {filterSources.length > 0 ? (
              <>
                <label htmlFor="source-filter" className="text-[11px] font-medium text-faint">
                  {t('Fonte')}
                </label>
                <select
                  id="source-filter"
                  className="field-input h-8 w-auto max-w-[15rem] py-1 text-xs"
                  value={sourceId ?? ''}
                  onChange={(event) => setSourceId(event.target.value || undefined)}
                >
                  <option value="">{t('Todas')}</option>
                  {filterSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <NovelDownloadStatus />
            <span className="hidden text-[11px] font-medium text-faint sm:inline">{t('Visualização')}</span>
            <FeedViewSwitcher view={view} onChange={setView} />
          </div>
        </div>
      </div>

      {/* "Continuar assistindo" só aparece na aba Todos e fora do estilo Netflix. */}
      {view === 'netflix' || tab !== 'all' ? null : (
        <>
          <LocalContinueWatchingSection onPlay={openStreamsFromPlayback} />
          <ContinueWatchingSection onPlay={openStreamsFromLibrary} />
        </>
      )}

      {feedQuery.isError ? (
        <div className="space-y-3">
          <ErrorBanner message={feedQuery.error instanceof Error ? feedQuery.error.message : t('Não foi possível carregar o feed.')} />
          <Button variant="subtle" size="sm" onClick={() => void feedQuery.refetch()}>
            {t('Tentar novamente')}
          </Button>
        </div>
      ) : null}

      {feedQuery.isLoading ? (
        view === 'list' ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="card flex gap-4 p-4">
                <div className="h-[84px] w-[150px] shrink-0 animate-pulse rounded-xl bg-elevated" />
                <div className="flex flex-1 flex-col gap-2 py-1">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-elevated" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-elevated" />
                  <div className="mt-auto h-3 w-1/3 animate-pulse rounded bg-elevated" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}
          >
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="space-y-2">
                <div className="aspect-video animate-pulse rounded-xl bg-elevated" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-elevated" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-elevated" />
              </div>
            ))}
          </div>
        )
      ) : null}

      {!feedQuery.isLoading && items.length === 0 && !(view === 'netflix' && sections.length > 0) ? (
        <div className="space-y-4">
          <div
            className={cn(
              'mx-auto w-full',
              browserOpen
                ? 'max-w-[145rem] 2xl:max-w-[161rem]'
                : 'max-w-[79rem] 2xl:max-w-[87rem]'
            )}
          >
            <div className={cn('flex w-full gap-3', browserOpen ? 'items-stretch' : 'items-start')}>
              <FeedBrowserToggle
                open={browserOpen}
                onOpen={() => setBrowserOpen(true)}
                onClose={() => setBrowserOpen(false)}
                title={t('Abrir navegador embutido')}
              />
            </div>
          </div>

          {sources.length === 0 ? (
            <EmptyState
              icon={<Rss className="h-5 w-5" />}
              title={t('Comece adicionando uma fonte')}
              description={t(
                'Cole a URL de um canal do YouTube ou de um feed RSS. Os itens novos aparecem aqui automaticamente.'
              )}
              action={
                <Link
                  to="/sources"
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition hover:brightness-110"
                >
                  <Rss className="h-4 w-4" /> {t('Adicionar fonte')}
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={t('Nada por aqui ainda')}
              description={
                sourceId
                  ? t('Esta fonte ainda não tem itens. Tente atualizar agora.')
                  : t('Nenhum item nesta categoria. Atualize as fontes ou troque de aba.')
              }
              action={
                <Button variant="subtle" size="sm" onClick={() => refreshAll.mutate()} loading={busy}>
                  {t('Atualizar agora')}
                </Button>
              }
            />
          )}
        </div>
      ) : null}

      {!feedQuery.isLoading && (items.length > 0 || (view === 'netflix' && sections.length > 0)) ? (
        view === 'list' ? (
          <div className="space-y-2.5">
            {feedEntries.map((entry) => {
              if (entry.kind === 'novel') {
                return (
                  <NovelCard
                    key={entry.group.key}
                    group={entry.group}
                    layout="list"
                    onOpenChapter={(chapter) => openNovelChapter(entry.group, chapter)}
                  />
                );
              }
              const actions = itemActions(entry.item);
              if (entry.kind === 'game') {
                return (
                  <GameFeedCard
                    key={entry.item.id}
                    game={entry.game}
                    item={entry.item}
                    variant="list"
                    onOpen={() => openGameDetails(entry.item)}
                    onToggleRead={actions.onToggleRead}
                    onToggleFavorite={actions.onToggleFavorite}
                    onToggleWatchLater={actions.onToggleWatchLater}
                  />
                );
              }
              return <ItemCard key={entry.item.id} {...actions} />;
            })}
          </div>
        ) : view === 'grid' ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}
          >
            {feedEntries.map((entry) => {
              if (entry.kind === 'novel') {
                return (
                  <NovelCard
                    key={entry.group.key}
                    group={entry.group}
                    layout="tile"
                    onOpenChapter={(chapter) => openNovelChapter(entry.group, chapter)}
                  />
                );
              }
              const actions = itemActions(entry.item);
              if (entry.kind === 'game') {
                return (
                  <GameFeedCard
                    key={entry.item.id}
                    game={entry.game}
                    item={entry.item}
                    variant="grid"
                    onOpen={() => openGameDetails(entry.item)}
                    onToggleRead={actions.onToggleRead}
                    onToggleFavorite={actions.onToggleFavorite}
                    onToggleWatchLater={actions.onToggleWatchLater}
                  />
                );
              }
              return (
                <ItemTile
                  key={entry.item.id}
                  item={entry.item}
                  onOpen={actions.onOpen}
                  onToggleRead={actions.onToggleRead}
                  onToggleFavorite={actions.onToggleFavorite}
                  onToggleWatchLater={actions.onToggleWatchLater}
                  onSetNovelProgress={actions.onSetNovelProgress}
                  variant="grid"
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-6">
            <div
              ref={heroRef}
              className={cn(
                'mx-auto w-full',
                browserOpen
                  ? 'max-w-[145rem] 2xl:max-w-[161rem]'
                  : 'max-w-[79rem] 2xl:max-w-[87rem]'
              )}
              onMouseEnter={() => setHeroPaused(true)}
              onMouseLeave={() => setHeroPaused(false)}
            >
              <div className={cn('flex w-full gap-3', browserOpen ? 'items-stretch' : 'items-start')}>
                <FeedBrowserToggle
                  open={browserOpen}
                  onOpen={() => setBrowserOpen(true)}
                  onClose={() => setBrowserOpen(false)}
                  title={t('Abrir navegador ao lado do destaque')}
                />

                <div className="min-w-0 flex-1">
                  {streamTarget ? (
                    <Suspense
                      fallback={
                        <div className="flex min-h-[30vh] items-center justify-center rounded-2xl border border-line bg-elevated">
                          <Loader2 className="h-5 w-5 animate-spin text-faint" />
                        </div>
                      }
                    >
                      <StreamPicker target={streamTarget} onClose={() => setStreamTarget(null)} />
                    </Suspense>
                  ) : playing ? (
                    <HeroPlayer
                      item={playing.item}
                      videoId={playing.videoId}
                      onClose={() => setPlaying(null)}
                    />
                  ) : heroItem ? (
                    <NetflixHero
                      item={heroItem}
                      onExternal={() => markRead(heroItem)}
                      onOpenGame={
                        heroItem.kind === 'price_drop' && typeof heroItem.meta?.gameId === 'string'
                          ? () => openGameDetails(heroItem)
                          : undefined
                      }
                      onOpenReader={
                        heroItem.kind === 'chapter'
                          ? () => {
                              markRead(heroItem);
                              setReaderItem(heroItem);
                            }
                          : isArticleItem(heroItem)
                            ? () => {
                                markRead(heroItem);
                                setArticleReaderItem(heroItem);
                              }
                            : undefined
                      }
                      onPlay={heroVideoId ? () => playInHero(heroItem, heroVideoId) : undefined}
                      onWatch={heroStreamTarget ? () => openStreamsFromFeed(heroItem) : undefined}
                      onToggleRead={() =>
                        updateItem.mutate({ id: heroItem.id, patch: { isRead: !heroItem.isRead } })
                      }
                      onToggleFavorite={() =>
                        updateItem.mutate({
                          id: heroItem.id,
                          patch: { isFavorite: !heroItem.isFavorite }
                        })
                      }
                      onToggleWatchLater={() =>
                        updateItem.mutate({
                          id: heroItem.id,
                          patch: { isWatchLater: !heroItem.isWatchLater }
                        })
                      }
                      onSetNovelProgress={
                        heroItem.kind === 'chapter'
                          ? () => setNovelProgressFromItem(heroItem)
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              </div>
            </div>

            {sections.map((section, index) => {
              const moveControls = (
                <RowMoveButtons
                  canUp={index > 0}
                  canDown={index < sections.length - 1}
                  onUp={() => moveSection(section.id, -1)}
                  onDown={() => moveSection(section.id, 1)}
                />
              );

              if (section.kind === 'local') {
                return (
                  <LocalContinueWatchingSection
                    key={section.id}
                    onPlay={openStreamsFromPlayback}
                    moveControls={moveControls}
                  />
                );
              }

              if (section.kind === 'stremio') {
                return (
                  <ContinueWatchingSection
                    key={section.id}
                    onPlay={openStreamsFromLibrary}
                    moveControls={moveControls}
                  />
                );
              }

              const collapsed = collapsedRows.includes(section.id);
              const rowItems = section.items ?? [];
              const rowNovelGroups = rowItems.some((item) => item.kind === 'chapter')
                ? novelGroupsForItems(rowItems)
                : [];
              const isNovelRow = rowNovelGroups.length > 0;
              const sectionLabel = t(section.label ?? '');
              return (
                <section key={section.id} className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <h2 className="truncate text-sm font-semibold text-fg">{sectionLabel}</h2>
                      <button
                        type="button"
                        onClick={() => toggleRowCollapsed(section.id)}
                        aria-label={
                          collapsed
                            ? `${t('Mostrar')} ${sectionLabel}`
                            : `${t('Minimizar')} ${sectionLabel}`
                        }
                        title={
                          collapsed
                            ? `${t('Mostrar')} ${sectionLabel}`
                            : `${t('Minimizar')} ${sectionLabel}`
                        }
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
                      >
                        {collapsed ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {isNovelRow ? <NovelOfflineManager /> : null}
                      {moveControls}
                    </div>
                    <span className="text-[10px] text-faint">
                      {isNovelRow
                        ? t('{count} novel(s)', { count: rowNovelGroups.length })
                        : t('{count} itens', { count: rowItems.length })}
                    </span>
                  </div>
                  {collapsed ? null : (
                    <HorizontalScroller>
                      {isNovelRow
                        ? rowNovelGroups.map((group) => (
                            <NovelCard
                              key={group.key}
                              group={group}
                              layout="row"
                              onOpenChapter={(chapter) => openNovelChapter(group, chapter)}
                            />
                          ))
                        : rowItems.map((item) => {
                            const actions = itemActions(item);
                            const gameId =
                              item.kind === 'price_drop' && typeof item.meta?.gameId === 'string'
                                ? item.meta.gameId
                                : null;
                            const game = gameId ? gamesById.get(gameId) : null;
                            if (game) {
                              return (
                                <GameFeedCard
                                  key={item.id}
                                  game={game}
                                  item={item}
                                  variant="row"
                                  onOpen={() => openGameDetails(item)}
                                  onToggleRead={actions.onToggleRead}
                                  onToggleFavorite={actions.onToggleFavorite}
                                  onToggleWatchLater={actions.onToggleWatchLater}
                                />
                              );
                            }
                            return (
                              <div key={item.id}>
                                <ItemTile
                                  item={item}
                                  onOpen={actions.onOpen}
                                  onToggleRead={actions.onToggleRead}
                                  onToggleFavorite={actions.onToggleFavorite}
                                  onToggleWatchLater={actions.onToggleWatchLater}
                                  onSetNovelProgress={actions.onSetNovelProgress}
                                  variant="row"
                                />
                              </div>
                            );
                          })}
                    </HorizontalScroller>
                  )}
                </section>
              );
            })}
          </div>
        )
      ) : null}

      <div ref={sentinelRef} className="flex h-16 items-center justify-center">
        {feedQuery.isFetchingNextPage ? (
          <span className="text-xs text-faint">{t('Carregando mais…')}</span>
        ) : !feedQuery.hasNextPage && items.length > 0 ? (
          <span className="text-[11px] text-faint">{t('Você chegou ao fim do feed')}</span>
        ) : null}
      </div>

      {readerItem ? (
        <NovelReader item={readerItem} onClose={() => setReaderItem(null)} />
      ) : null}
      {articleReaderItem ? (
        <ArticleReader
          item={articleReaderItem}
          onClose={() => setArticleReaderItem(null)}
        />
      ) : null}

      <QuickAddModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onSource={() => {
          setQuickAddOpen(false);
          setSourceFormOpen(true);
        }}
        onAddon={() => {
          setQuickAddOpen(false);
          setAddonFormOpen(true);
        }}
      />

      <SourceFormModal open={sourceFormOpen} onClose={() => setSourceFormOpen(false)} />

      <AddAddonModal open={addonFormOpen} onClose={() => setAddonFormOpen(false)} />

      <GameDetailModal gameId={gameDetailId} onClose={() => setGameDetailId(null)} />
    </div>
  );
}

/** Player nativo do YouTube exibido no lugar do destaque. */
function HeroPlayer({
  item,
  videoId,
  onClose
}: {
  item: FeedItemDto;
  videoId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-black">
      <div className="relative aspect-video w-full bg-black">
        <iframe
          key={videoId}
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
          title={item.title}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line/60 bg-bg/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-fg">{item.title}</p>
          <p className="truncate text-[10px] text-faint">{item.sourceName}</p>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 text-xs font-medium text-fg transition hover:border-accent/40 hover:bg-elevated/80"
        >
          <ExternalLink className="h-3.5 w-3.5 text-accent" /> {t('Abrir no YouTube')}
        </a>
        <Button
          variant="subtle"
          size="sm"
          onClick={onClose}
          icon={<X className="h-3.5 w-3.5" />}
        >
          {t('Fechar player')}
        </Button>
      </div>
    </section>
  );
}

function NetflixHero({
  item,
  onExternal,
  onOpenReader,
  onPlay,
  onWatch,
  onOpenGame,
  onToggleRead,
  onToggleFavorite,
  onToggleWatchLater,
  onSetNovelProgress
}: {
  item: FeedItemDto;
  onExternal: () => void;
  /** Abre o modo leitura interno para capítulos de novels. */
  onOpenReader?: () => void;
  /** Definido apenas para itens do YouTube; abre o player no próprio destaque. */
  onPlay?: () => void;
  /** Definido para filmes/séries/animes com ID do IMDB; abre a lista de streams. */
  onWatch?: () => void;
  /** Definido para alertas de jogos; abre o modal de detalhes da Wishlist. */
  onOpenGame?: () => void;
  onToggleRead: () => void;
  onToggleFavorite: () => void;
  onToggleWatchLater: () => void;
  onSetNovelProgress?: () => void;
}) {
  const { t } = useI18n();
  const isChapter = item.kind === 'chapter';
  const libraryType: 'movie' | 'series' | null = item.mediaKind
    ? item.mediaKind === 'movie'
      ? 'movie'
      : 'series'
    : null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-elevated">
      <div className="relative aspect-[4/3] w-full sm:aspect-video">
        {isChapter && item.thumbnailUrl ? (
          <>
            <img
              src={item.thumbnailUrl}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
              referrerPolicy="no-referrer"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-black/20" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute right-5 top-1/2 hidden aspect-[2/3] h-[76%] -translate-y-1/2 overflow-hidden rounded-xl border border-white/15 shadow-2xl sm:block">
              <img
                src={item.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          </>
        ) : (
          <>
            <Thumb
              src={item.thumbnailUrl}
              categoryId={item.categoryId}
              kind={item.kind}
              alt=""
              className="h-full w-full rounded-none border-0"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
          </>
        )}

        {onPlay ? (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Reproduzir ${item.title} no player`}
            className="group/play absolute inset-0 flex items-center justify-center transition hover:bg-black/20"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition group-hover/play:scale-105 group-hover/play:bg-white/25">
              <Play className="h-6 w-6 fill-current" />
            </span>
          </button>
        ) : null}

        {onWatch ? (
          <button
            type="button"
            onClick={onWatch}
            aria-label={`Assistir ${item.title}`}
            className="group/play absolute inset-0 flex items-center justify-center transition hover:bg-black/20"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition group-hover/play:scale-105 group-hover/play:bg-white/25">
              <Play className="h-6 w-6 fill-current" />
            </span>
          </button>
        ) : null}

        {onOpenGame ? (
          <button
            type="button"
            onClick={onOpenGame}
            aria-label={`Ver detalhes de ${item.title}`}
            className="group/play absolute inset-0 flex items-center justify-center transition hover:bg-black/20"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition group-hover/play:scale-105 group-hover/play:bg-white/25">
              <Gamepad2 className="h-6 w-6" />
            </span>
          </button>
        ) : null}

        {onOpenReader ? (
          <button
            type="button"
            onClick={onOpenReader}
            aria-label={`Ler ${item.title} no modo leitura`}
            className="group/play absolute inset-0 flex items-center justify-center transition hover:bg-black/20"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white shadow-lg backdrop-blur-sm transition group-hover/play:scale-105 group-hover/play:bg-white/25">
              <BookOpen className="h-6 w-6" />
            </span>
          </button>
        ) : null}

        <div className={cn('absolute inset-x-0 bottom-0 p-3 sm:p-5', isChapter && 'sm:right-[29%]')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              {t(item.categoryLabel)}
            </span>
            {!item.isRead ? (
              <span className="rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-fg">
                novo
              </span>
            ) : null}
            {item.inStremioLibrary ? <StremioBadge /> : null}
            <span className="text-[10px] text-white/70">
              {item.sourceName} ·{' '}
              <time dateTime={item.publishedAt} title={formatRelative(item.publishedAt)}>
                {item.kind === 'chapter' ? formatDateTime(item.publishedAt) : formatRelative(item.publishedAt)}
              </time>
            </span>
          </div>

          <h2 className="mt-1 line-clamp-2 max-w-2xl text-lg font-semibold text-white drop-shadow sm:text-xl">
            {item.title}
          </h2>
          {item.description ? (
            <p className="mt-1 line-clamp-2 hidden max-w-xl text-xs leading-relaxed text-white/75 sm:block">
              {item.description}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {onPlay ? (
              <button
                type="button"
                onClick={onPlay}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/90"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> {t('Reproduzir')}
              </button>
            ) : null}
            {onWatch ? (
              <button
                type="button"
                onClick={onWatch}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/90"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> {t('Assistir')}
              </button>
            ) : null}
            {onOpenGame ? (
              <button
                type="button"
                onClick={onOpenGame}
                className="hidden h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/90 sm:inline-flex"
              >
                <Gamepad2 className="h-3.5 w-3.5" /> {t('Detalhes do jogo')}
              </button>
            ) : null}
            {onOpenReader ? (
              <button
                type="button"
                onClick={onOpenReader}
                className="hidden h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/90 sm:inline-flex"
              >
                <BookOpen className="h-3.5 w-3.5" /> {t('Ler aqui')}
              </button>
            ) : null}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={onExternal}
              className={
                onPlay || onOpenReader
                  ? 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/25'
                  : 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/90'
              }
            >
              <ExternalLink className="h-3.5 w-3.5" /> {onOpenReader ? t('Abrir no site') : t('Abrir')}
            </a>
            {libraryType && item.imdbId ? (
              <LibraryToggleButton
                type={libraryType}
                metaId={item.imdbId}
                name={item.sourceName}
                poster={item.thumbnailUrl}
                variant="button"
                tone="overlay"
              />
            ) : null}
            {onSetNovelProgress ? (
              <button
                type="button"
                onClick={onSetNovelProgress}
                className="hidden h-8 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/25 sm:inline-flex"
              >
                <CheckCheck className="h-3.5 w-3.5" /> {t('Lido até aqui')}
              </button>
            ) : null}
            <IconButton
              label={item.isRead ? 'Marcar como não lido' : 'Marcar como lido'}
              onClick={onToggleRead}
              active={item.isRead}
              className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            >
              {item.isRead ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            </IconButton>
            <IconButton
              label={item.isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              onClick={onToggleFavorite}
              active={item.isFavorite}
              className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            >
              <Star className={item.isFavorite ? 'h-4 w-4 fill-current text-warning' : 'h-4 w-4'} />
            </IconButton>
            <IconButton
              label={item.isWatchLater ? 'Remover de ver depois' : 'Salvar para ver depois'}
              onClick={onToggleWatchLater}
              active={item.isWatchLater}
              tone="accent"
              className="h-8 w-8 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            >
              <Clock className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>
    </section>
  );
}


