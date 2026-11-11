/** Modo leitura de novels dentro do Feed. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  AlertTriangle,
  Check,
  Loader2,
  MessageSquare,
  RefreshCw,
  X
} from 'lucide-react';
import type { FeedItemDto, NovelChapterDto } from '@hub/shared';
import {
  useNovelChapter,
  useNovelChapterProgress,
  useNovelDetails,
  useSaveSettings,
  useSetNovelProgress,
  useSettings,
  useTranslatedText
} from '@/lib/queries';
import {
  READER_LANGUAGES,
  buildReaderHtml,
  readerLanguage,
  saveReaderLanguage
} from '@/lib/reader-html';
import { useI18n } from '@/lib/i18n';
import { useStoredBoolean } from '@/lib/use-stored-boolean';

const SCROLL_PIXELS_PER_MS = 0.95;

const ATTEMPT_LABELS: Record<string, string> = {
  feed: 'Navegador do Feed',
  live: 'Navegador principal',
  'live-móvel': 'Versão móvel',
  scraping: 'Extração alternativa',
  'scraping-móvel': 'Extração móvel',
  jina: 'Leitor externo',
  html: 'HTML da página'
};

function NovelAttempts({
  attempts
}: {
  attempts: Array<{
    label: string;
    status: 'trying' | 'ok' | 'failed';
    message: string | null;
  }>;
}) {
  const { t } = useI18n();
  if (attempts.length === 0) return null;
  return (
    <div className="mt-3 w-full max-w-sm space-y-1 rounded-xl border border-line/60 bg-bg/40 p-2 text-left">
      {attempts.map((attempt, index) => (
        <div key={`${attempt.label}:${index}`} className="flex items-start gap-2 text-[10px]">
          <span className="mt-0.5 shrink-0">
            {attempt.status === 'trying' ? (
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
            ) : attempt.status === 'ok' ? (
              <Check className="h-3 w-3 text-success" />
            ) : (
              <AlertTriangle className="h-3 w-3 text-warning" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-muted">
              {t(ATTEMPT_LABELS[attempt.label] ?? attempt.label)}
            </span>
            {attempt.status === 'failed' && attempt.message ? (
              <span className="mt-0.5 block break-words text-[9px] text-warning">
                {attempt.message}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export function NovelReader({
  item,
  onClose,
  initialChapterId,
  initialChapterUrl
}: {
  item: FeedItemDto;
  onClose: () => void;
  initialChapterId?: string | null;
  initialChapterUrl?: string | null;
}) {
  const { t } = useI18n();
  const meta = item.meta ?? {};
  const bookTitle =
    (typeof meta.bookTitle === 'string' ? meta.bookTitle : null) || item.sourceName;
  const initialChapterIdFromMeta =
    typeof meta.chapterId === 'string' ? meta.chapterId : null;
  const initialChapterName =
    typeof meta.chapterName === 'string' ? meta.chapterName : item.title;
  const initialUrl =
    initialChapterUrl !== undefined
      ? initialChapterUrl
      : initialChapterId
        ? null
        : item.url || null;

  const [currentId, setCurrentId] = useState<string | null>(
    initialChapterId ?? initialChapterIdFromMeta
  );
  const [currentUrl, setCurrentUrl] = useState<string | null>(initialUrl);
  const [language, setLanguage] = useState<string>(() => readerLanguage());
  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();
  const setNovelProgress = useSetNovelProgress();
  const offlineEnabled = settingsQuery.data?.novelChaptersOffline ?? true;
  const [showCommentCounts, , setShowCommentCounts] = useStoredBoolean(
    'hub.reader.commentCounts',
    false
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const savedProgressRef = useRef<string | null>(null);
  const scrollRef = useRef<{ direction: number; frame: number; last: number }>({
    direction: 0,
    frame: 0,
    last: 0
  });

  const details = useNovelDetails(item.sourceId);
  const chapters = details.data?.chapters ?? [];
  const currentIndex = chapters.findIndex(
    (chapter) =>
      (currentId !== null && chapter.id === currentId) ||
      (currentUrl !== null && chapter.url === currentUrl)
  );
  const currentChapter = currentIndex >= 0 ? chapters[currentIndex] : null;
  const previous = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const next =
    currentIndex >= 0 && currentIndex < chapters.length - 1
      ? chapters[currentIndex + 1]
      : null;

  // Salva automaticamente o capítulo aberto para o card continuar daqui.
  useEffect(() => {
    if (!currentChapter || item.sourceType !== 'webnovel') return;
    if (savedProgressRef.current === currentChapter.id) return;
    savedProgressRef.current = currentChapter.id;
    setNovelProgress.mutate({
      id: item.sourceId,
      body: {
        chapterId: currentChapter.id,
        chapterName: currentChapter.name,
        chapterIndex: currentChapter.index
      }
    });
  }, [currentChapter, item.sourceId, item.sourceType, setNovelProgress]);

  const chapterQuery = useNovelChapter(currentUrl, Boolean(currentUrl));
  const progressQuery = useNovelChapterProgress(
    currentUrl,
    Boolean(currentUrl) && (chapterQuery.isFetching || chapterQuery.isError)
  );
  const attempts = progressQuery.data?.progress?.attempts ?? [];
  const chapterLoading = !chapterQuery.data && chapterQuery.isFetching;

  const rawText = showCommentCounts
    ? (chapterQuery.data?.textWithComments ?? chapterQuery.data?.text ?? null)
    : (chapterQuery.data?.text ?? null);
  const cachedTranslation =
    language &&
    chapterQuery.data?.translatedText &&
    chapterQuery.data.translatedLanguage === language
      ? chapterQuery.data.translatedText
      : null;
  const translation = useTranslatedText(
    cachedTranslation ? null : rawText,
    language,
    Boolean(chapterQuery.data) && !cachedTranslation
  );
  const translating =
    Boolean(language) &&
    Boolean(chapterQuery.data) &&
    !cachedTranslation &&
    translation.isLoading;
  const translationFailed =
    Boolean(language) && !cachedTranslation && translation.isError;

  useEffect(() => {
    if (currentUrl || !currentId) return;
    const chapter = details.data?.chapters.find(
      (candidate) => candidate.id === currentId
    );
    if (chapter?.url) setCurrentUrl(chapter.url);
  }, [currentUrl, currentId, details.data]);

  const chapterUrl = useCallback(
    (chapter: NovelChapterDto): string | null => {
      if (chapter.url) return chapter.url;
      const base = details.data?.book.url;
      if (base && chapter.id) return `${base.replace(/\/$/, '')}/${chapter.id}`;
      return null;
    },
    [details.data?.book.url]
  );

  const stopScroll = useCallback((): void => {
    scrollRef.current.direction = 0;
    scrollRef.current.last = 0;
    if (scrollRef.current.frame) {
      cancelAnimationFrame(scrollRef.current.frame);
      scrollRef.current.frame = 0;
    }
  }, []);

  const goToChapter = useCallback(
    (chapter: NovelChapterDto | null): void => {
      if (!chapter) return;
      const url = chapterUrl(chapter);
      if (!url) return;
      stopScroll();
      setCurrentId(chapter.id);
      setCurrentUrl(url);
    },
    [chapterUrl, stopScroll]
  );

  const goPrevious = useCallback((): void => {
    if (previous) goToChapter(previous);
  }, [previous, goToChapter]);

  const goNext = useCallback((): void => {
    if (next) goToChapter(next);
  }, [next, goToChapter]);

  const changeLanguage = (value: string): void => {
    setLanguage(value);
    saveReaderLanguage(value);
  };

  const retryChapter = (): void => {
    void chapterQuery.refetch();
  };

  useEffect(() => {
    const step = (now: number): void => {
      const state = scrollRef.current;
      if (!state.direction) {
        state.frame = 0;
        state.last = 0;
        return;
      }
      if (!state.last) state.last = now;
      const delta = Math.min(64, Math.max(0, now - state.last));
      state.last = now;
      iframeRef.current?.contentWindow?.scrollBy(
        0,
        state.direction * SCROLL_PIXELS_PER_MS * delta
      );
      state.frame = requestAnimationFrame(step);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        // Com o foco no iframe, o próprio documento do capítulo cuida do scroll.
        if (event.target instanceof HTMLIFrameElement) return;
        event.preventDefault();
        scrollRef.current.direction = event.key === 'ArrowDown' ? 1 : -1;
        if (!scrollRef.current.frame) {
          scrollRef.current.frame = requestAnimationFrame(step);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') stopScroll();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stopScroll);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopScroll);
      stopScroll();
    };
  }, [goNext, goPrevious, onClose, stopScroll]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string; key?: string } | null;
      if (data?.type !== 'hub-reader-key') return;
      if (data.key === 'ArrowLeft') goPrevious();
      else if (data.key === 'ArrowRight') goNext();
      else if (data.key === 'Escape') onClose();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [goNext, goPrevious, onClose]);

  const chapterTitle =
    chapterQuery.data?.title ||
    currentChapter?.name ||
    initialChapterName ||
    'Capítulo';
  const chapterLabel =
    currentChapter?.index !== null && currentChapter?.index !== undefined
      ? `Cap. ${currentChapter.index}`
      : typeof meta.chapterIndex === 'number'
        ? `Cap. ${meta.chapterIndex}`
        : '';

  const html = useMemo(() => {
    if (!chapterQuery.data) return '';
    const text =
      cachedTranslation ??
      (language ? translation.data?.text : rawText) ??
      rawText ??
      '';
    return buildReaderHtml({
      title: chapterQuery.data.title || chapterTitle,
      subtitle: chapterLabel ? `${bookTitle} · ${chapterLabel}` : bookTitle,
      text,
      language,
      hint: t('Use ↑ / ↓ para rolar. ← / → troca de capítulo. Esc sai.')
    });
  }, [
    chapterQuery.data,
    chapterTitle,
    bookTitle,
    chapterLabel,
    language,
    rawText,
    cachedTranslation,
    translation.data?.text
  ]);

  const cover =
    details.data?.book.coverUrl ||
    (typeof meta.coverUrl === 'string' ? meta.coverUrl : null) ||
    item.thumbnailUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${t('Leitura:')} ${bookTitle}`}
      className="fixed inset-0 z-[90] flex flex-col bg-bg"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Sair do modo leitura')}
          title={t('Sair do modo leitura (Esc)')}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 text-xs font-semibold text-fg transition hover:border-accent/40"
        >
          <X className="h-3.5 w-3.5" /> {t('Sair')}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {cover ? (
            <img
              src={cover}
              alt=""
              className="h-10 w-7 shrink-0 rounded object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <BookOpen className="h-5 w-5 shrink-0 text-accent" />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-fg">{bookTitle}</p>
            <p className="truncate text-[10px] text-faint">
              {chapterTitle} {chapterLabel ? `· ${chapterLabel}` : ''}
            </p>
          </div>
        </div>

        <label className="flex shrink-0 items-center gap-1 text-[10px] text-faint">
          <span className="hidden sm:inline">{t('Capítulo')}</span>
          <select
            aria-label={t('Escolher capítulo')}
            value={currentChapter?.id ?? currentId ?? ''}
            onChange={(event) => {
              const chapter = chapters.find((entry) => entry.id === event.target.value);
              if (chapter) goToChapter(chapter);
            }}
            disabled={chapters.length === 0}
            className="h-7 max-w-[13rem] rounded-md border border-line bg-elevated px-1.5 text-[11px] text-fg outline-none"
          >
            {chapters.length === 0 ? (
              <option value="">
                {details.isLoading ? t('Carregando capítulos…') : t('Capítulos indisponíveis')}
              </option>
            ) : (
              chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.index !== null ? `${chapter.index}. ` : ''}
                  {chapter.name}
                </option>
              ))
            )}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setShowCommentCounts(!showCommentCounts)}
          aria-pressed={showCommentCounts}
          title={
            showCommentCounts
              ? t('Ocultar contadores de comentários')
              : t('Mostrar contadores de comentários')
          }
          className={
            showCommentCounts
              ? 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-accent/50 bg-accent/15 px-2 text-[10px] font-medium text-accent transition'
              : 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-elevated px-2 text-[10px] font-medium text-faint transition hover:text-fg'
          }
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('Comentários')}</span>
        </button>

        <button
          type="button"
          onClick={() =>
            saveSettings.mutate({ novelChaptersOffline: !offlineEnabled })
          }
          aria-pressed={offlineEnabled}
          title={
            offlineEnabled
              ? t('Não salvar capítulos vistos offline')
              : t('Salvar capítulos vistos offline')
          }
          className={
            offlineEnabled
              ? 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-success/50 bg-success/15 px-2 text-[10px] font-medium text-success transition'
              : 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-elevated px-2 text-[10px] font-medium text-faint transition hover:text-fg'
          }
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('Offline')}</span>
        </button>

        <label className="flex shrink-0 items-center gap-1 text-[10px] text-faint">
          <span className="hidden sm:inline">{t('Idioma')}</span>
          <select
            aria-label={t('Idioma da leitura')}
            value={language}
            onChange={(event) => changeLanguage(event.target.value)}
            className="h-7 rounded-md border border-line bg-elevated px-1.5 text-[11px] text-fg outline-none"
          >
            {READER_LANGUAGES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={goPrevious}
            disabled={!previous}
            aria-label={t('Capítulo anterior')}
            title={t('Capítulo anterior (←)')}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-elevated text-faint transition hover:text-fg disabled:cursor-default disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!next}
            aria-label={t('Próximo capítulo')}
            title={t('Próximo capítulo (→)')}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-elevated text-faint transition hover:text-fg disabled:cursor-default disabled:opacity-35"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <span className="hidden text-[10px] text-faint md:inline">
          {currentIndex >= 0 ? `${currentIndex + 1} / ${chapters.length}` : ''}
        </span>
      </header>

      <div className="relative min-h-0 flex-1 bg-[#0b0f16]">
        {!currentUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            {details.isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <p className="text-xs text-faint">{t('Localizando capítulo…')}</p>
              </>
            ) : (
              <>
                <p className="max-w-md text-xs leading-relaxed text-muted">
                  {t('Não foi possível localizar a URL deste capítulo.')}
                </p>
                <button
                  type="button"
                  onClick={() => void details.refetch()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-semibold text-fg transition hover:border-accent/40"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t('Tentar novamente')}
                </button>
              </>
            )}
          </div>
        ) : chapterLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-xs text-faint">{t('Carregando capítulo…')}</p>
            <NovelAttempts attempts={attempts} />
          </div>
        ) : chapterQuery.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-md text-xs leading-relaxed text-muted">
              {chapterQuery.error instanceof Error
                ? chapterQuery.error.message
                : t('Não foi possível carregar o capítulo.')}
            </p>
            <NovelAttempts attempts={attempts} />
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={retryChapter}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-semibold text-fg transition hover:border-accent/40 disabled:opacity-60"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('Tentar novamente')}
              </button>
            </div>
          </div>
        ) : translating ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-xs text-faint">{t('Traduzindo capítulo…')}</p>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {translationFailed ? (
              <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-300">
                {t('Não foi possível traduzir agora. Exibindo o texto original.')}
              </div>
            ) : null}
            <iframe
              ref={iframeRef}
              title={t('Conteúdo do capítulo')}
              srcDoc={html}
              className="min-h-0 w-full flex-1 border-0"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line bg-surface/95 px-3 py-1.5 text-[10px] text-faint">
        <span>
          <ArrowLeft className="mr-1 inline h-3 w-3" /> /{' '}
          <ArrowRight className="mx-1 inline h-3 w-3" /> {t('capítulos · ↑/↓ rolar · Esc sair')}
        </span>
        <span>
          {language
            ? `${t('Traduzido para')} ${
                READER_LANGUAGES.find((entry) => entry.value === language)?.label ??
                language
              }`
            : t('Original')}
        </span>
      </footer>
    </div>
  );
}

