/** Progresso detalhado do download de capítulos offline. */
import { AlertTriangle, Check, Loader2, RotateCcw, XCircle } from 'lucide-react';
import type { NovelDownloadJobDto } from '@hub/shared';
import { Button, Modal, SuccessNote } from '@/components/ui';
import { useCancelNovelDownload, useRetryNovelDownload } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function NovelDownloadProgressModal({
  open,
  onClose,
  job
}: {
  open: boolean;
  onClose: () => void;
  job: NovelDownloadJobDto | null | undefined;
}) {
  const { t } = useI18n();
  const retry = useRetryNovelDownload();
  const cancel = useCancelNovelDownload();
  const running = job?.status === 'running';
  const canceled = job?.status === 'canceled';
  const active = job?.chapters.filter((chapter) => chapter.status !== 'done') ?? [];
  const failed = active.filter((chapter) => chapter.status === 'failed');
  const progress =
    job && job.total > 0
      ? Math.min(100, Math.round((job.completed / job.total) * 100))
      : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('Progresso do download')}
      description={
        job
          ? t('Acompanhe os capítulos de {title}.', { title: job.title })
          : t('Nenhum download em andamento.')
      }
      footer={
        <>
          {running ? (
            <Button
              variant="subtle"
              onClick={() => job && cancel.mutate(job.id)}
              loading={cancel.isPending}
              icon={<XCircle className="h-4 w-4" />}
            >
              {t('Cancelar downloads')}
            </Button>
          ) : null}
          {failed.length > 0 && !running ? (
            <Button
              variant="subtle"
              onClick={() => job && retry.mutate(job.id)}
              loading={retry.isPending}
              icon={<RotateCcw className="h-4 w-4" />}
            >
              {t('Tentar novamente ({count})', { count: failed.length })}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {t('Fechar')}
          </Button>
        </>
      }
    >
      {!job ? (
        <p className="py-10 text-center text-xs text-faint">
          {t('Nenhum capítulo está sendo baixado agora.')}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-line/70 bg-bg/40 p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 font-medium text-fg">
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                ) : canceled ? (
                  <XCircle className="h-3.5 w-3.5 text-warning" />
                ) : job.failed > 0 ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-success" />
                )}
                {running
                  ? t('Baixando {completed}/{total}', {
                      completed: job.completed,
                      total: job.total
                    })
                  : canceled
                    ? t('Download cancelado: {completed}/{total}', {
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
                className={cn(
                  'h-full transition-all',
                  running ? 'bg-accent' : canceled ? 'bg-warning/70' : 'bg-success'
                )}
                style={{ width: `${running ? progress : 100}%` }}
              />
            </div>
            {job.current && running ? (
              <p className="mt-2 truncate text-[10px] text-faint">
                {t('Processando:')} {job.current}
              </p>
            ) : null}
          </div>

          {active.length === 0 && !running ? (
            <SuccessNote
              message={t('Todos os capítulos selecionados foram baixados.')}
            />
          ) : (
            <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-xl border border-line/70 bg-bg/40 p-1.5">
              {active.map((chapter) => (
                <div
                  key={chapter.url}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs',
                    chapter.status === 'failed' && 'bg-warning/5'
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {chapter.status === 'failed' ? (
                      <span className="text-warning">!</span>
                    ) : chapter.status === 'downloading' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    ) : chapter.status === 'canceled' ? (
                      <XCircle className="h-3.5 w-3.5 text-warning" />
                    ) : (
                      <span className="block h-3.5 w-3.5 rounded-full border border-line" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{chapter.name}</span>
                    {chapter.status === 'failed' ? (
                      <span className="mt-0.5 block break-words text-[10px] text-warning">
                        {chapter.error || t('Falhou ao baixar.')}
                      </span>
                    ) : chapter.status === 'downloading' ? (
                      <span className="text-[10px] text-faint">{t('Baixando…')}</span>
                    ) : chapter.status === 'canceled' ? (
                      <span className="text-[10px] text-faint">{t('Cancelado')}</span>
                    ) : (
                      <span className="text-[10px] text-faint">{t('Na fila')}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {job.failed > 0 ? (
            <p className="text-[11px] text-warning">
              {t('{count} capítulo(s) com falha', { count: job.failed })}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
