/** Gerenciador dos capítulos de novel salvos para leitura offline. */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckSquare,
  Loader2,
  Settings,
  Square,
  Trash2
} from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
  useDeleteNovelOfflineChapters,
  useNovelOfflineBook,
  useNovelOfflineBooks
} from '@/lib/queries';
import { cn } from '@/lib/utils';

function OfflineCover({
  coverUrl,
  title,
  count
}: {
  coverUrl: string | null;
  title: string;
  count: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(coverUrl) && !failed;
  return (
    <span className="relative block aspect-[2/3] w-full overflow-hidden rounded-lg border border-line bg-elevated transition group-hover:border-accent/50">
      {showImage ? (
        <img
          src={coverUrl as string}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-accent/70">
          {title.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">
        {count}
      </span>
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NovelOfflineManager() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [bookId, setBookId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const booksQuery = useNovelOfflineBooks(open);
  const bookQuery = useNovelOfflineBook(bookId);
  const removeChapters = useDeleteNovelOfflineChapters();

  const books = booksQuery.data?.books ?? [];
  const book = bookQuery.data?.book ?? null;
  const chapters = bookQuery.data?.chapters ?? [];

  useEffect(() => {
    setSelected(new Set());
  }, [bookId]);

  useEffect(() => {
    // Livro removido por completo: volta para a lista.
    if (bookId && booksQuery.data && !books.some((item) => item.bookId === bookId)) {
      setBookId(null);
    }
  }, [bookId, books, booksQuery.data]);

  const allSelected = chapters.length > 0 && selected.size === chapters.length;

  const toggleChapter = (url: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(chapters.map((chapter) => chapter.url)));
  };

  const deleteSelected = (): void => {
    const urls = [...selected];
    if (urls.length === 0) return;
    removeChapters.mutate(urls, {
      onSuccess: () => setSelected(new Set())
    });
  };

  const footer = useMemo(
    () => (
      <>
        {bookId ? (
          <Button
            variant="subtle"
            onClick={() => setBookId(null)}
            icon={<ArrowLeft className="h-4 w-4" />}
          >
            {t('Voltar')}
          </Button>
        ) : null}
        {bookId && chapters.length > 0 ? (
          <Button
            variant="subtle"
            onClick={deleteSelected}
            loading={removeChapters.isPending}
            disabled={selected.size === 0}
            icon={<Trash2 className="h-4 w-4" />}
          >
            {t('Excluir selecionados ({count})', { count: selected.size })}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('Fechar')}
        </Button>
      </>
    ),
    [bookId, chapters.length, selected.size, removeChapters.isPending, t]
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('Gerenciar capítulos offline')}
        title={t('Gerenciar capítulos offline')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={t('Capítulos offline')}
        description={
          book
            ? t('Capítulos de {title} salvos neste computador.', { title: book.title })
            : t('Escolha uma novel para ver e apagar os capítulos salvos.')
        }
        footer={footer}
      >
        {booksQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-faint">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            {t('Carregando capítulos salvos…')}
          </div>
        ) : books.length === 0 ? (
          <p className="py-10 text-center text-xs text-faint">
            {t('Nenhum capítulo de novel está salvo para leitura offline.')}
          </p>
        ) : !bookId ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
            {books.map((item) => (
              <button
                key={item.bookId}
                type="button"
                onClick={() => setBookId(item.bookId)}
                className="group flex min-w-0 flex-col items-center gap-1.5 text-center"
                title={item.title}
              >
                <OfflineCover
                  coverUrl={item.coverUrl}
                  title={item.title}
                  count={item.count}
                />
                <span className="line-clamp-2 text-[10px] font-medium leading-tight text-fg">
                  {item.title}
                </span>
                <span className="text-[9px] text-faint">{formatBytes(item.bytes)}</span>
              </button>
            ))}
          </div>
        ) : bookQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-faint">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            {t('Carregando capítulos…')}
          </div>
        ) : chapters.length === 0 ? (
          <p className="py-10 text-center text-xs text-faint">
            {t('Nenhum capítulo salvo desta novel.')}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
              <button
                type="button"
                onClick={toggleAll}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-2 py-1 font-medium text-muted transition hover:text-fg"
              >
                {allSelected ? (
                  <CheckSquare className="h-3.5 w-3.5 text-accent" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {allSelected ? t('Desmarcar todos') : t('Selecionar todos')}
              </button>
              <span>
                {t('{count} capítulo(s) · {size}', {
                  count: book?.count ?? chapters.length,
                  size: formatBytes(book?.bytes ?? 0)
                })}
              </span>
            </div>

            <div className="max-h-[48vh] space-y-1 overflow-y-auto rounded-xl border border-line/70 bg-bg/40 p-1.5">
              {chapters.map((chapter) => {
                const checked = selected.has(chapter.url);
                return (
                  <div
                    key={chapter.url}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition',
                      checked ? 'bg-accent/10' : 'hover:bg-elevated/60'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleChapter(chapter.url)}
                      aria-label={t('Selecionar capítulo')}
                      className="shrink-0 text-muted transition hover:text-fg"
                    >
                      {checked ? (
                        <CheckSquare className="h-4 w-4 text-accent" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleChapter(chapter.url)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-fg">
                        {chapter.index !== null ? `${chapter.index}. ` : ''}
                        {chapter.title}
                      </span>
                      <span className="text-[10px] text-faint">
                        {formatBytes(chapter.bytes)}
                        {chapter.translatedLanguage
                          ? ` · ${chapter.translatedLanguage.toUpperCase()}`
                          : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChapters.mutate([chapter.url])}
                      aria-label={t('Apagar capítulo do cache')}
                      title={t('Apagar capítulo do cache')}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition hover:bg-elevated hover:text-warning"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
