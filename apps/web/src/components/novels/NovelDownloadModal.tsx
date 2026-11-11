/** Modal para escolher capítulos de novel e acompanhar o download offline. */
import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import type { NovelChapterDto } from '@hub/shared';
import { Button, ErrorBanner, Modal, SuccessNote } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  clearNovelDownloadJob,
  useNovelDownloadJob,
  useStartNovelDownload
} from '@/lib/queries';
import { useI18n } from '@/lib/i18n';

export function NovelDownloadModal({
  open,
  onClose,
  bookTitle,
  chapters,
  loading = false,
  error: loadError = null,
  onRetry
}: {
  open: boolean;
  onClose: () => void;
  bookTitle: string;
  chapters: NovelChapterDto[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const start = useStartNovelDownload();
  const jobQuery = useNovelDownloadJob();
  const job = jobQuery.data;
  const allWithUrl = useMemo(
    () => chapters.filter((chapter) => Boolean(chapter.url)),
    [chapters]
  );
  const chapterKey = useMemo(
    () => allWithUrl.map((chapter) => chapter.url).join('|'),
    [allWithUrl]
  );
  const [availability, setAvailability] = useState<
    Record<string, { downloaded: boolean; translated: boolean }>
  >({});
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [startedHere, setStartedHere] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () =>
      allWithUrl.filter((chapter) => !availability[chapter.url as string]?.downloaded),
    [allWithUrl, availability]
  );
  const downloadedCount = allWithUrl.length - available.length;

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setStartedHere(false);
    setError(null);
    setAvailability({});
    if (allWithUrl.length === 0) return;

    let cancelled = false;
    setChecking(true);
    // Novels longas (ex.: Shadow Slave, 3000+ capítulos) precisam de lotes.
    const urls = allWithUrl.map((chapter) => chapter.url as string);
    const chunks: string[][] = [];
    for (let index = 0; index < urls.length; index += 300) {
      chunks.push(urls.slice(index, index + 300));
    }
    void Promise.all(
      chunks.map((chunk) =>
        api.novelDownloadStatus(chunk.map((url) => ({ url })))
      )
    )
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, { downloaded: boolean; translated: boolean }> = {};
        for (const result of results) {
          for (const entry of result.chapters) {
            next[entry.url] = {
              downloaded: entry.downloaded,
              translated: entry.translated
            };
          }
        }
        setAvailability(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, chapterKey]);

  const toggle = (url: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectAll = (): void => {
    setSelected(new Set(available.map((chapter) => chapter.url as string)));
  };

  const handleDownload = (): void => {
    if (selected.size === 0) return;
    setError(null);
    const chosen = available
      .filter((chapter) => selected.has(chapter.url as string))
      .map((chapter) => ({
        url: chapter.url as string,
        name: chapter.name,
        index: chapter.index
      }));
    start.mutate(
      { title: bookTitle, chapters: chosen },
      {
        onSuccess: () => setStartedHere(true),
        onError: (startError) =>
          setError(
            startError instanceof Error
              ? startError.message
              : t('Não foi possível iniciar o download.')
          )
      }
    );
  };

  const running = job?.status === 'running';
  const showProgress = Boolean(job && (running || startedHere));
  const progress =
    job && job.total > 0
      ? Math.min(100, Math.round((job.completed / job.total) * 100))
      : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('Baixar capítulos')}
      description={t(
        'Escolha os capítulos de {title} para salvar e ler sem internet.',
        { title: bookTitle }
      )}
      footer={
        showProgress ? (
          <>
            {!running ? (
              <Button
                variant="ghost"
                onClick={() => {
                  clearNovelDownloadJob();
                  onClose();
                }}
              >
                {t('Fechar')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={onClose}>
                {t('Fechar e continuar em segundo plano')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancelar')}
            </Button>
            <Button
              onClick={handleDownload}
              loading={start.isPending}
              disabled={selected.size === 0}
              icon={<Download className="h-4 w-4" />}
            >
              {t('Baixar selecionados ({count})', { count: selected.size })}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2 text-[11px] leading-relaxed text-muted">
          <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          {t(
            'Os downloads continuam em segundo plano. Você pode fechar esta janela e acompanhar o progresso no Feed.'
          )}
        </p>

        {error ? <ErrorBanner message={error} /> : null}

        {!showProgress && allWithUrl.length === 0 ? (
          <div className="space-y-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                {t('Carregando capítulos…')}
              </div>
            ) : loadError ? (
              <>
                <ErrorBanner message={loadError} />
                {onRetry ? (
                  <div className="flex justify-center">
                    <Button variant="subtle" size="sm" onClick={onRetry}>
                      {t('Tentar novamente')}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="py-6 text-center text-xs text-faint">
                {t('Nenhum capítulo disponível para baixar.')}
              </p>
            )}
          </div>
        ) : null}

        {showProgress && job ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-line/70 bg-bg/40 p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 font-medium text-fg">
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-success" />
                  )}
                  {running
                    ? t('Baixando {completed}/{total}', {
                        completed: job.completed,
                        total: job.total
                      })
                    : t('Download concluído: {completed}/{total}', {
                        completed: job.completed,
                        total: job.total
                      })}
                </span>
                <span className="text-[10px] text-faint">{progress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                <div
                  className={running ? 'h-full bg-accent transition-all' : 'h-full bg-success transition-all'}
                  style={{ width: `${running ? progress : 100}%` }}
                />
              </div>
              {running && job.current ? (
                <p className="mt-2 truncate text-[10px] text-faint">
                  {t('Processando:')} {job.current}
                </p>
              ) : null}
              {job.failed > 0 ? (
                <p className="mt-2 text-[10px] text-warning">
                  {t('{count} capítulo(s) com falha', { count: job.failed })}
                </p>
              ) : null}
            </div>

            {!running ? (
              <SuccessNote
                message={t('{downloaded} capítulo(s) salvos offline. {failed} falha(s).', {
                  downloaded: job.completed,
                  failed: job.failed
                })}
              />
            ) : null}

            {job.errors.length > 0 ? (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-warning/25 bg-warning/5 p-2 text-[11px] text-warning">
                {job.errors.map((item) => (
                  <li key={item} className="break-all">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-faint">
                {t('{count} capítulo(s) disponível(is)', { count: available.length })}
                {downloadedCount > 0 ? (
                  <span> · {t('{count} já baixado(s)', { count: downloadedCount })}</span>
                ) : null}
                {checking ? <span> · {t('verificando…')}</span> : null}
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {t('Selecionar todos')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                >
                  {t('Limpar seleção')}
                </Button>
              </div>
            </div>

            <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-line/70 bg-bg/40 p-1.5">
              {allWithUrl.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-faint">
                  {t('Nenhum capítulo disponível para baixar.')}
                </p>
              ) : available.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-faint">
                  {t('Todos os capítulos já estão baixados.')}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {allWithUrl.map((chapter) => {
                    const url = chapter.url as string;
                    const state = availability[url];
                    const isDownloaded = state?.downloaded === true;
                    return (
                      <li key={chapter.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-elevated',
                            isDownloaded && 'cursor-default opacity-70'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                            checked={!isDownloaded && selected.has(url)}
                            disabled={isDownloaded}
                            onChange={() => toggle(url)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-fg">
                              {chapter.index !== null ? `${chapter.index}. ` : ''}
                              {chapter.name}
                            </span>
                            {isDownloaded ? (
                              <span className="text-[10px] text-success">
                                {t('Baixado')}
                                {state?.translated ? ` · ${t('traduzido')}` : ''}
                              </span>
                            ) : chapter.isVip ? (
                              <span className="text-[10px] text-warning">{t('VIP')}</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
