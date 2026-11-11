/** Progresso do download de capítulos de novel, sempre visível no Feed. */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  EyeOff,
  Loader2,
  X,
  XCircle
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { useStoredBoolean } from '@/lib/use-stored-boolean';
import {
  clearNovelDownloadJob,
  useNovelDownloadJob
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { NovelDownloadProgressModal } from './NovelDownloadProgressModal';

export function NovelDownloadStatus({ extraAction }: { extraAction?: ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const jobQuery = useNovelDownloadJob();
  const job = jobQuery.data;
  const [progressOpen, setProgressOpen] = useState(false);
  const [hidden, toggleHidden, setHidden] = useStoredBoolean(
    'hub.novelDownload.hidden',
    false
  );

  useEffect(() => {
    if (job?.status === 'done') {
      void queryClient.invalidateQueries({ queryKey: ['storage-stats'] });
    }
  }, [job?.status, queryClient]);

  const progress =
    job && job.total > 0
      ? Math.min(100, Math.round((job.completed / job.total) * 100))
      : 0;
  const running = job?.status === 'running';
  const canceled = job?.status === 'canceled';
  const finished = Boolean(job) && !running;
  const hasErrors = Boolean(job && (job.failed > 0 || job.errors.length > 0));

  return (
    <>
      {hidden ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setHidden(false)}
            aria-label={t('Mostrar progresso do download')}
            title={t('Mostrar progresso do download')}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-elevated text-faint transition hover:text-fg"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
          {extraAction}
        </div>
      ) : (
        <div
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-xl border px-2 py-1 text-[10px]',
            running
              ? 'border-accent/30 bg-accent/5'
              : job?.status === 'done'
                ? hasErrors
                  ? 'border-warning/30 bg-warning/5'
                  : 'border-success/30 bg-success/5'
                : 'border-line bg-elevated'
          )}
        >
          <button
            type="button"
            onClick={() => setProgressOpen(true)}
            title={
              job
                ? job.errors.length > 0
                  ? job.errors.slice(0, 5).join('\n')
                  : job.title
                : t('Nenhum download em andamento.')
            }
            className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-left"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            ) : canceled ? (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
            ) : job?.status === 'done' ? (
              hasErrors ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
              )
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0 text-faint" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium text-fg">
                {running
                  ? t('Baixando {completed}/{total}', {
                      completed: job.completed,
                      total: job.total
                    })
                  : canceled
                    ? t('Download cancelado')
                    : job
                      ? t('{count} capítulo(s) baixado(s)', { count: job.completed })
                      : t('Downloads')}
                {hasErrors ? (
                  <span className="text-warning"> · {job?.failed} {t('falha(s)')}</span>
                ) : null}
              </span>
              {job ? (
                <span className="mt-0.5 block h-1 w-24 overflow-hidden rounded-full bg-elevated">
                  <span
                    className={cn(
                      'block h-full transition-all',
                      running ? 'bg-accent' : canceled ? 'bg-warning/70' : 'bg-success'
                    )}
                    style={{ width: `${running ? progress : 100}%` }}
                  />
                </span>
              ) : null}
            </span>
          </button>

          {finished ? (
            <button
              type="button"
              onClick={() => clearNovelDownloadJob()}
              aria-label={t('Fechar progresso do download')}
              title={t('Fechar')}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition hover:bg-elevated hover:text-fg"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}

          {extraAction}

          <button
            type="button"
            onClick={toggleHidden}
            aria-label={t('Ocultar progresso do download')}
            title={t('Ocultar')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition hover:bg-elevated hover:text-fg"
          >
            <Eye className="h-3 w-3" />
          </button>
        </div>
      )}

      <NovelDownloadProgressModal
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        job={job}
      />
    </>
  );
}
