/** Modo leitura de notícias dentro do Feed. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Newspaper,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react';
import type { FeedItemDto } from '@hub/shared';
import { useArticleContent, useTranslatedText } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';
import {
  READER_LANGUAGES,
  buildReaderHtml,
  readerLanguage,
  saveReaderLanguage
} from '@/lib/reader-html';
import { useI18n } from '@/lib/i18n';

const SCROLL_PIXELS_PER_MS = 0.95;

export function ArticleReader({
  item,
  onClose
}: {
  item: FeedItemDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<string>(() => readerLanguage());
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const scrollRef = useRef<{ direction: number; frame: number; last: number }>({
    direction: 0,
    frame: 0,
    last: 0
  });

  const article = useArticleContent(item.url, Boolean(item.url));
  const translation = useTranslatedText(
    article.data?.text ?? null,
    language,
    Boolean(article.data)
  );
  const translating =
    Boolean(language) && Boolean(article.data) && translation.isLoading;
  const translationFailed = Boolean(language) && translation.isError;
  const title = article.data?.title || item.title;
  const sourceName = article.data?.siteName || item.sourceName;

  const stopScroll = useCallback((): void => {
    scrollRef.current.direction = 0;
    scrollRef.current.last = 0;
    if (scrollRef.current.frame) {
      cancelAnimationFrame(scrollRef.current.frame);
      scrollRef.current.frame = 0;
    }
  }, []);

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
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
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
  }, [onClose, stopScroll]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string; key?: string } | null;
      if (data?.type !== 'hub-reader-key') return;
      if (data.key === 'Escape') onClose();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onClose]);

  const html = useMemo(() => {
    if (!article.data) return '';
    const text =
      (language ? translation.data?.text : article.data.text) ?? article.data.text;
    const meta = [sourceName, formatDateTime(item.publishedAt)]
      .filter(Boolean)
      .join(' · ');
    return buildReaderHtml({
      title,
      subtitle: meta,
      text,
      language,
      hint: t('Use ↑ / ↓ para rolar. Esc sai.')
    });
  }, [
    article.data,
    item.publishedAt,
    language,
    sourceName,
    title,
    translation.data?.text
  ]);

  const changeLanguage = (value: string): void => {
    setLanguage(value);
    saveReaderLanguage(value);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${t('Leitura:')} ${title}`}
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
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              className="h-10 w-14 shrink-0 rounded object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Newspaper className="h-5 w-5 shrink-0 text-accent" />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-fg">{title}</p>
            <p className="truncate text-[10px] text-faint">
              {sourceName} · {formatDateTime(item.publishedAt)}
            </p>
          </div>
        </div>

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
      </header>

      <div className="relative min-h-0 flex-1 bg-[#0b0f16]">
        {!item.url ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-md text-xs leading-relaxed text-muted">
              {t('Esta notícia não tem um link para leitura.')}
            </p>
          </div>
        ) : article.isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-xs text-faint">{t('Carregando notícia…')}</p>
          </div>
        ) : article.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-md text-xs leading-relaxed text-muted">
              {article.error instanceof Error
                ? article.error.message
                : t('Não foi possível carregar a notícia.')}
            </p>
            <button
              type="button"
              onClick={() => void article.refetch()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-3 text-xs font-semibold text-fg transition hover:border-accent/40"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t('Tentar novamente')}
            </button>
          </div>
        ) : translating ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-xs text-faint">{t('Traduzindo notícia…')}</p>
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
              title={t('Conteúdo da notícia')}
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
          <ArrowRight className="mx-1 inline h-3 w-3" /> ↑/↓ {t('rolar · Esc sair')}
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
