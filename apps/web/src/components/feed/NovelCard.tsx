/** Card agregado de novel no Feed, com prévia, progresso e seletor de capítulos. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, CheckCheck, Download, Languages, Loader2, Play } from 'lucide-react';
import type { FeedItemDto } from '@hub/shared';
import { Thumb } from '@/components/ui';
import { NovelDownloadModal } from '@/components/novels/NovelDownloadModal';
import { useI18n } from '@/lib/i18n';
import { useNovelDetails, useSettings } from '@/lib/queries';
import { readerLanguage } from '@/lib/reader-html';
import { translateText } from '@/lib/translate';
import { useLongPress } from '@/lib/use-long-press';
import { useNow } from '@/lib/use-now';
import { cn, formatDateTime, formatRelativeCompact } from '@/lib/utils';

export interface NovelGroup {
  key: string;
  sourceId: string;
  bookId: string | null;
  title: string;
  author: string | null;
  coverUrl: string | null;
  description: string | null;
  categoryLabel: string;
  chapterCount: number;
  latest: FeedItemDto;
  items: FeedItemDto[];
  lastRead: {
    chapterId: string;
    chapterIndex: number | null;
    chapterName: string;
  } | null;
  lastReadIndex: number;
  latestIndex: number | null;
  hasNew: boolean;
}

export interface NovelChapterTarget {
  id: string | null;
  name: string;
  index: number | null;
  url: string | null;
}

const DEFAULT_HOVER_OPEN_DELAY_MS = 3000;
const HOVER_CLOSE_DELAY_MS = 220;
const PANEL_WIDTH = 380;

function totalChapters(
  group: NovelGroup,
  details: { chapters?: unknown[] } | undefined
): number {
  return Math.max(group.chapterCount, details?.chapters?.length ?? 0);
}

function canHover(): boolean {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

function progressPercent(group: NovelGroup, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (group.lastReadIndex / total) * 100));
}

function latestTarget(group: NovelGroup): NovelChapterTarget {
  const meta = group.latest.meta ?? {};
  return {
    id: typeof meta.chapterId === 'string' ? meta.chapterId : null,
    name: typeof meta.chapterName === 'string' ? meta.chapterName : group.latest.title,
    index: typeof meta.chapterIndex === 'number' ? meta.chapterIndex : group.latestIndex,
    url: group.latest.url || null
  };
}

function readTarget(group: NovelGroup): NovelChapterTarget | null {
  if (!group.lastRead) return null;
  const item =
    group.items.find(
      (candidate) =>
        candidate.meta?.chapterId === group.lastRead?.chapterId ||
        candidate.meta?.chapterUrl === group.lastRead?.chapterId ||
        candidate.url === group.lastRead?.chapterId
    ) ??
    (typeof group.lastRead.chapterIndex === 'number'
      ? group.items.find(
          (candidate) =>
            typeof candidate.meta?.chapterIndex === 'number' &&
            candidate.meta.chapterIndex === group.lastRead?.chapterIndex
        )
      : undefined);
  return {
    id: group.lastRead.chapterId,
    name: group.lastRead.chapterName,
    index: group.lastRead.chapterIndex,
    url: item?.url ?? null
  };
}

export function NovelCard({
  group,
  layout,
  onOpenChapter
}: {
  group: NovelGroup;
  layout: 'list' | 'tile' | 'row';
  onOpenChapter: (chapter: NovelChapterTarget | null) => void;
}) {
  const { t } = useI18n();
  const now = useNow();
  const latestAge = formatRelativeCompact(group.latest.publishedAt, now);
  const settings = useSettings();
  const hoverDelayMs =
    (settings.data?.hoverPreviewSeconds ?? DEFAULT_HOVER_OPEN_DELAY_MS / 1000) * 1000;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [detailsWanted, setDetailsWanted] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // Fontes antigas podem ter sido salvas sem capa/contagem. Nesse caso a
  // prévia carrega os detalhes sozinha e corrige o card na hora.
  const details = useNovelDetails(group.sourceId, detailsWanted || !group.coverUrl);
  const chapters = details.data?.chapters ?? [];
  const coverUrl = details.data?.book.coverUrl ?? group.coverUrl;
  const chapterTotal = totalChapters(group, details.data);
  const continueTarget = readTarget(group);
  const firstTarget: NovelChapterTarget | null =
    chapters.length > 0
      ? {
          id: chapters[0].id,
          name: chapters[0].name,
          index: chapters[0].index,
          url: chapters[0].url
        }
      : null;
  const openDefaultChapter = (): void => {
    setDetailsWanted(true);
    openChapter(continueTarget ?? firstTarget ?? latestTarget(group));
  };
  const synopsis =
    details.data?.book.description || group.description || '';
  const [translatedSynopsis, setTranslatedSynopsis] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  useEffect(() => {
    setTranslatedSynopsis(null);
    setShowTranslated(false);
    setTranslateError(null);
  }, [synopsis]);

  const toggleSynopsisTranslation = async (): Promise<void> => {
    if (translating) return;
    if (translatedSynopsis) {
      setShowTranslated((current) => !current);
      return;
    }
    if (!synopsis.trim()) return;
    setTranslating(true);
    setTranslateError(null);
    try {
      const language = readerLanguage() || 'pt';
      const translated = await translateText(synopsis, language);
      setTranslatedSynopsis(translated);
      setShowTranslated(true);
    } catch (error) {
      setTranslateError(
        error instanceof Error ? error.message : t('Não foi possível traduzir agora.')
      );
    } finally {
      setTranslating(false);
    }
  };

  const clearOpen = (): void => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const clearClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const close = (): void => {
    clearOpen();
    clearClose();
    setPosition(null);
  };

  useEffect(() => {
    if (!position) return;
    const onScrollOrResize = (): void => close();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [position]);

  useEffect(
    () => () => {
      clearOpen();
      clearClose();
    },
    []
  );

  const openPreview = (): void => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
    let left = rect.right + 12;
    if (left + width > window.innerWidth - 8) left = rect.left - width - 12;
    if (left < 8) left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, rect.top - 24), Math.max(8, window.innerHeight - 520));
    setPosition({ left, top });
  };

  const longPress = useLongPress(() => {
    setDetailsWanted(true);
    openPreview();
  });

  const onMouseEnter = (): void => {
    if (!canHover()) return;
    setDetailsWanted(true);
    clearClose();
    clearOpen();
    if (position) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      openPreview();
    }, hoverDelayMs);
  };

  const onMouseLeave = (): void => {
    clearOpen();
    if (!position) return;
    clearClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPosition(null);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const openChapter = (chapter: NovelChapterTarget | null): void => {
    close();
    onOpenChapter(chapter);
  };

  const openFromSelect = (chapterId: string): void => {
    const chapter = chapters.find((candidate) => candidate.id === chapterId);
    if (!chapter) return;
    openChapter({
      id: chapter.id,
      name: chapter.name,
      index: chapter.index,
      url: chapter.url
    });
  };

  const cover = (
    <div className="relative overflow-hidden rounded-xl border border-line/70 bg-elevated">
      <Thumb
        src={coverUrl}
        categoryId="novel"
        kind="chapter"
        alt=""
        className={cn(
          'w-full rounded-none border-0',
          layout === 'list' ? 'aspect-[3/4]' : 'aspect-[3/4]'
        )}
      />
      {group.hasNew ? (
        <span className="absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-fg shadow">
          {t('Novo')}
        </span>
      ) : null}
      <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
        {latestAge !== '—' ? (
          <span
            className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm"
            title={formatDateTime(group.latest.publishedAt)}
          >
            {latestAge}
          </span>
        ) : null}
        <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
          {chapterTotal} cap.
        </span>
      </div>
    </div>
  );

  const text = (
    <div className="flex min-w-0 flex-1 flex-col">
      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-fg sm:text-sm">
        {group.title}
      </p>
      {group.author ? (
        <p className="mt-0.5 truncate text-[10px] text-faint">{group.author}</p>
      ) : null}
      <p className="mt-1 text-[10px] font-medium text-accent">
        {t('{read}/{total} lidos', {
          read: group.lastReadIndex,
          total: chapterTotal
        })}
      </p>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${progressPercent(group, chapterTotal)}%` }}
        />
      </div>
      {group.hasNew ? (
        <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-accent">
          <CheckCheck className="h-3 w-3" /> {t('Capítulo novo disponível')}
        </p>
      ) : null}
    </div>
  );

  const card =
    layout === 'list' ? (
      <button
        type="button"
        onClick={openDefaultChapter}
        className="group card flex w-full gap-3 p-3 text-left transition duration-200 hover:border-accent/30 hover:bg-elevated/40 sm:gap-4 sm:p-4"
      >
        <div className="w-[84px] shrink-0 sm:w-[112px]">{cover}</div>
        {text}
      </button>
    ) : (
      <button
        type="button"
        onClick={openDefaultChapter}
        className="group flex w-full flex-col text-left"
      >
        {cover}
        <div className="mt-1.5 flex min-w-0 flex-1 flex-col">{text}</div>
      </button>
    );

  return (
    <div
      ref={anchorRef}
      {...longPress}
      className={cn('relative', layout === 'row' && 'w-[10.5rem] shrink-0')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {card}

      {position
        ? createPortal(
            <div
              role="complementary"
              aria-label={`Prévia de ${group.title}`}
              className="fixed z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/50"
              style={{
                left: position.left,
                top: position.top,
                width: Math.min(PANEL_WIDTH, window.innerWidth - 16)
              }}
              onMouseEnter={clearClose}
              onMouseLeave={onMouseLeave}
            >
              <div className="flex gap-3 p-3">
                <div className="h-[92px] w-[64px] shrink-0 overflow-hidden rounded-lg border border-line bg-elevated">
                  <Thumb
                    src={coverUrl}
                    categoryId="novel"
                    kind="chapter"
                    alt=""
                    className="h-full w-full rounded-none border-0"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-fg">
                    {group.title}
                  </p>
                  {group.author ? (
                    <p className="mt-0.5 truncate text-[10px] text-faint">{group.author}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] font-semibold text-accent">
                    {t('{read}/{total} lidos', {
                      read: group.lastReadIndex,
                      total: chapterTotal
                    })}
                  </p>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${progressPercent(group, chapterTotal)}%` }}
                    />
                  </div>
                  {group.hasNew ? (
                    <p className="mt-1 text-[10px] font-semibold text-accent">
                      {t('Novo capítulo disponível')}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="px-4 pb-3">
                <p className="line-clamp-5 text-[11px] leading-relaxed text-muted">
                  {showTranslated && translatedSynopsis
                    ? translatedSynopsis
                    : synopsis || t('Sinopse indisponível para esta novel.')}
                </p>
                {synopsis ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleSynopsisTranslation()}
                      disabled={translating}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent transition hover:underline disabled:opacity-60"
                    >
                      {translating ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" /> {t('Traduzindo…')}
                        </>
                      ) : (
                        <>
                          <Languages className="h-3 w-3" />
                          {showTranslated ? t('Ver original') : t('Traduzir sinopse')}
                        </>
                      )}
                    </button>
                    {translateError ? (
                      <span className="text-[10px] text-red-400">{translateError}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 px-4 py-3">
                <button
                  type="button"
                  onClick={() => firstTarget && openChapter(firstTarget)}
                  disabled={!firstTarget}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg transition hover:brightness-110 disabled:cursor-default disabled:opacity-40"
                >
                  <BookOpen className="h-3.5 w-3.5" /> {t('Ler primeiro capítulo')}
                </button>
                <button
                  type="button"
                  onClick={() => openChapter(latestTarget(group))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-semibold text-fg transition hover:border-accent/40"
                >
                  <BookOpen className="h-3.5 w-3.5" /> {t('Ler último capítulo')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDetailsWanted(true);
                    if (!details.data) void details.refetch();
                    setDownloadOpen(true);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-semibold text-fg transition hover:border-accent/40 disabled:cursor-default disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" /> {t('Baixar capítulos')}
                </button>
                <button
                  type="button"
                  onClick={() => continueTarget && openChapter(continueTarget)}
                  disabled={!continueTarget}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-semibold text-fg transition hover:border-accent/40 disabled:cursor-default disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5" /> {t('Continuar lendo')}
                </button>
              </div>

              <div className="border-t border-line/60 px-4 py-2.5">
                <label className="flex items-center gap-2 text-[10px] text-faint">
                  <span className="shrink-0">{t('Escolher capítulo')}</span>
                  <select
                    aria-label={`${t('Escolher capítulo de')} ${group.title}`}
                    value=""
                    onChange={(event) => {
                      if (event.target.value) openFromSelect(event.target.value);
                    }}
                    disabled={details.isLoading || chapters.length === 0}
                    className="h-7 min-w-0 flex-1 rounded-md border border-line bg-elevated px-1.5 text-[10px] text-fg outline-none disabled:opacity-60"
                  >
                    <option value="">
                      {details.isLoading
                        ? t('Carregando capítulos…')
                        : chapters.length === 0
                          ? t('Capítulos indisponíveis')
                          : t('Selecionar…')}
                    </option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.index !== null ? `${chapter.index + 1}. ` : ''}
                        {chapter.name}
                      </option>
                    ))}
                  </select>
                  {details.isLoading ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
                  ) : null}
                </label>
              </div>
            </div>,
            document.body
          )
        : null}

      <NovelDownloadModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        bookTitle={group.title}
        chapters={chapters}
        loading={details.isLoading}
        error={
          details.isError
            ? details.error instanceof Error
              ? details.error.message
              : t('Não foi possível carregar os capítulos desta novel.')
            : null
        }
        onRetry={() => void details.refetch()}
      />
    </div>
  );
}
