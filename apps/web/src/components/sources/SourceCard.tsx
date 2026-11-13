/** Card de uma fonte com status, contadores e histórico de execuções. */
import { useState } from 'react';
import { BookOpen, ExternalLink, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { ERROR_LABELS, type SourceDto } from '@hub/shared';
import { AppIcon } from '@/components/AppIcon';
import { Chip, IconButton, StatusDot, Switch } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useCategories, useSourceRuns } from '@/lib/queries';
import {
  SOURCE_TYPE_ICON,
  categoryColor,
  cn,
  formatDateTime,
  formatInterval,
  formatRelative
} from '@/lib/utils';

interface SourceCardProps {
  source: SourceDto;
  layout?: 'list' | 'grid';
  refreshing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
  onNovelProgress?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}

function statusOf(source: SourceDto): { tone: 'ok' | 'error' | 'paused' | 'unknown'; label: string } {
  if (!source.enabled) return { tone: 'paused', label: 'Pausada' };
  if (source.lastErrorCode) {
    return { tone: 'error', label: ERROR_LABELS[source.lastErrorCode] ?? 'Erro' };
  }
  if (source.lastSuccessAt) return { tone: 'ok', label: 'Atualizada' };
  return { tone: 'unknown', label: 'Aguardando 1ª verificação' };
}

function readProgress(source: SourceDto): {
  chapterId: string;
  chapterIndex: number | null;
  chapterName: string;
  updatedAt: string;
} | null {
  const value = source.config.lastReadChapter;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.chapterId !== 'string' || typeof record.chapterName !== 'string') return null;
  return {
    chapterId: record.chapterId,
    chapterIndex: typeof record.chapterIndex === 'number' ? record.chapterIndex : null,
    chapterName: record.chapterName,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : ''
  };
}

export function SourceCard({
  source,
  layout = 'list',
  refreshing,
  onEdit,
  onDelete,
  onToggle,
  onRefresh,
  onNovelProgress,
  selectable = false,
  selected = false,
  onSelect
}: SourceCardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const categories = useCategories();
  const runs = useSourceRuns(expanded ? source.id : null);

  const color = categoryColor(source.categoryId);
  const status = statusOf(source);
  const categoryLabel = categories.data?.find((category) => category.id === source.categoryId)?.label ?? source.categoryId;
  const isNovel = source.type === 'webnovel';
  const coverUrl = typeof source.config.coverUrl === 'string' ? source.config.coverUrl : null;
  const bookUrl = typeof source.config.url === 'string' ? source.config.url : null;
  const siteName = typeof source.config.site === 'string' ? source.config.site : null;
  const progress = isNovel ? readProgress(source) : null;
  const configuredLatest =
    source.config.latestChapter && typeof source.config.latestChapter === 'object'
      ? (source.config.latestChapter as Record<string, unknown>)
      : null;
  const configuredLatestTitle =
    configuredLatest && typeof configuredLatest.name === 'string'
      ? `${typeof configuredLatest.index === 'number' ? `Cap. ${configuredLatest.index}: ` : ''}${configuredLatest.name}`
      : null;
  const configuredLatestAt =
    configuredLatest && typeof configuredLatest.publishedAt === 'string'
      ? configuredLatest.publishedAt
      : null;
  const latestTitle = source.latestItemTitle ?? configuredLatestTitle ?? t('Nenhum capítulo importado ainda');
  const latestAt = source.latestItemPublishedAt ?? configuredLatestAt;
  const latestChapterIndex = source.latestItemTitle
    ? Number(
        /^(?:Cap\.?|Capítulo|Chapter)\s*(\d+(?:[.,]\d+)?)/i
          .exec(source.latestItemTitle)?.[1]
          ?.replace(',', '.') ?? NaN
      )
    : Number(configuredLatest?.index ?? NaN);
  const hasNewChapter = Boolean(
    progress &&
      (Number.isFinite(latestChapterIndex) && progress.chapterIndex !== null
        ? latestChapterIndex > progress.chapterIndex
        : latestAt && progress.updatedAt && latestAt > progress.updatedAt)
  );

  // A API resolve e guarda a imagem por 3 dias; o bucket na query faz o
  // navegador buscar uma versão nova quando o cache expira.
  const imageSrc = `/api/sources/${source.id}/image?v=${Math.floor(
    Date.now() / (3 * 24 * 60 * 60 * 1000)
  )}`;

  if (layout === 'grid') {
    const showImage = !imageFailed;

    return (
      <article
        className={cn(
          'card flex h-full flex-col p-3',
          selected && 'border-accent/60 ring-1 ring-accent/30'
        )}
      >
        <div className="flex items-start justify-between gap-1.5">
          <div
            className={cn(
              'flex shrink-0 items-center justify-center overflow-hidden rounded-xl border',
              isNovel && showImage ? 'h-16 w-12' : 'h-9 w-9'
            )}
            style={
              showImage
                ? undefined
                : { borderColor: `${color}33`, backgroundColor: `${color}14`, color }
            }
          >
            {showImage ? (
              <img
                src={imageSrc}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <AppIcon name={SOURCE_TYPE_ICON[source.type]} className="h-4 w-4" />
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {selectable ? (
              <input
                type="checkbox"
                checked={selected}
                onChange={(event) => onSelect?.(event.target.checked)}
                aria-label={t('Selecionar {name}', { name: source.name })}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
            ) : null}
            <Switch
              checked={source.enabled}
              onChange={onToggle}
              label={source.enabled ? t('Pausar fonte') : t('Ativar fonte')}
            />
          </div>
        </div>

        <h3 className="mt-2 line-clamp-2 text-xs font-semibold leading-snug text-fg">
          {source.name}
        </h3>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Chip color={color}>{t(categoryLabel)}</Chip>
          {source.unreadCount > 0 ? (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
              {source.unreadCount}
            </span>
          ) : null}
          {isNovel && hasNewChapter ? <Chip color="#38bdf8">{t('novo')}</Chip> : null}
        </div>

        <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted">
          <StatusDot tone={status.tone} />
          {t(status.label)}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[10px] text-faint">
          {source.latestItemTitle ?? t('{count} itens', { count: source.itemCount })}
        </p>

        {isNovel ? (
          <p className="mt-1 line-clamp-1 text-[10px] text-faint">
            {progress
              ? `${t('Lido até')} Cap. ${progress.chapterIndex ?? '?'}`
              : t('Nenhum capítulo marcado como lido.')}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-1 pt-2">
          <span className="truncate text-[9px] text-faint">
            {formatRelative(source.lastCheckedAt)}
          </span>
          <div className="flex items-center gap-0.5">
            <IconButton
              label={t('Atualizar agora')}
              onClick={onRefresh}
              disabled={refreshing}
              className="h-6 w-6"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </IconButton>
            <IconButton label={t('Editar fonte')} onClick={onEdit} className="h-6 w-6">
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label={t('Remover fonte')}
              onClick={onDelete}
              tone="danger"
              className="h-6 w-6"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>

        {isNovel && onNovelProgress ? (
          <button
            type="button"
            onClick={onNovelProgress}
            className="mt-2 inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-line bg-elevated px-2 text-[10px] font-medium text-fg transition hover:border-accent/40"
          >
            <BookOpen className="h-3 w-3" />
            {t('Progresso')}
          </button>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={cn(
        'card p-4',
        selected && 'border-accent/60 ring-1 ring-accent/30'
      )}
    >
      <div className="flex items-start gap-3">
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelect?.(event.target.checked)}
            aria-label={t('Selecionar {name}', { name: source.name })}
            className="mt-3 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
        ) : null}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border"
          style={
            imageFailed
              ? { borderColor: `${color}33`, backgroundColor: `${color}14`, color }
              : undefined
          }
        >
          {imageFailed ? (
            <AppIcon name={SOURCE_TYPE_ICON[source.type]} className="h-5 w-5" />
          ) : (
            <img
              src={imageSrc}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-fg">{source.name}</h3>
            {source.isDemo ? <Chip>demo</Chip> : null}
            <Chip color={color}>{t(categoryLabel)}</Chip>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <StatusDot tone={status.tone} />
              {t(status.label)}
            </span>
            <span>{t('intervalo:')} {formatInterval(source.intervalMinutes)}</span>
            <span>{t('última:')} {formatRelative(source.lastCheckedAt)}</span>
            <span>{t('próxima:')} {formatRelative(source.nextRunAt)}</span>
          </div>

          {source.lastErrorCode && source.lastErrorMessage ? (
            <p className={cn('mt-1.5 line-clamp-2 text-[11px] text-danger/90')} title={source.lastErrorMessage}>
              {source.lastErrorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:flex-col sm:items-end">
          <div className="flex items-center gap-1">
            {source.unreadCount > 0 ? (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                {source.unreadCount} novo{source.unreadCount > 1 ? 's' : ''}
              </span>
            ) : null}
            <Switch checked={source.enabled} onChange={onToggle} label={source.enabled ? t('Pausar fonte') : t('Ativar fonte')} />
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton label={t('Atualizar agora')} onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </IconButton>
            <IconButton label={t('Editar fonte')} onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton label={t('Remover fonte')} onClick={onDelete} tone="danger">
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>

      {isNovel ? (
        <div className="mt-3 flex gap-3 rounded-xl border border-line/60 bg-bg/40 p-2.5">
          <div className="h-28 w-[76px] shrink-0 overflow-hidden rounded-lg border border-line bg-elevated">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-faint">
                <BookOpen className="h-5 w-5" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-fg">
                  {latestTitle}
                </p>
                <p className="mt-0.5 text-[11px] text-faint">
                  {[siteName, latestAt ? `${t('Adicionado em')} ${formatDateTime(latestAt)}` : t('Aguardando a primeira sincronização')]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {hasNewChapter ? <Chip color="#38bdf8">{t('novo capítulo')}</Chip> : null}
            </div>

            <p className="mt-2 text-[11px] text-muted">
              {progress ? (
                <>
                  {t('Lido até')}{' '}
                  <span className="font-medium text-fg">
                    Cap. {progress.chapterIndex ?? '?'} — {progress.chapterName}
                  </span>
                </>
              ) : (
                <span className="text-faint">{t('Nenhum capítulo marcado como lido.')}</span>
              )}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {onNovelProgress ? (
                <button
                  type="button"
                  onClick={onNovelProgress}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-elevated px-2 text-[11px] font-medium text-fg transition hover:border-accent/40 hover:bg-elevated/80"
                >
                  <BookOpen className="h-3 w-3" />
                  {t('Progresso')}
                </button>
              ) : null}
              {bookUrl ? (
                <a
                  href={bookUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-elevated px-2 text-[11px] font-medium text-muted transition hover:border-accent/40 hover:text-fg"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('Abrir novel')}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="mt-3 flex items-center justify-between border-t border-line/60 pt-2"
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[11px] font-medium text-muted transition hover:text-fg"
        >
          {expanded ? t('Ocultar histórico') : t('Histórico')}
        </button>
        <span className="text-[11px] text-faint">
          {source.itemCount} {t(source.itemCount === 1 ? 'item' : 'itens')}
        </span>
      </div>

      {expanded ? (
        <div className="mt-2 space-y-1.5 rounded-xl border border-line/60 bg-bg/40 p-2.5">
          {runs.isLoading ? <p className="text-[11px] text-faint">{t('Carregando histórico…')}</p> : null}
          {runs.data && runs.data.length > 0
            ? runs.data.map((run) => (
                <div key={run.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
                  <StatusDot tone={run.ok ? 'ok' : 'error'} />
                  <time dateTime={run.startedAt}>{formatRelative(run.startedAt)}</time>
                  {run.ok ? (
                    <span className="text-muted">
                      {run.itemsNew} novo(s) · {run.itemsFound} encontrado(s)
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-danger/90">
                      {t(ERROR_LABELS[run.errorCode ?? 'unknown'])}: {run.errorMessage}
                    </span>
                  )}
                  {run.durationMs !== null ? <span className="ml-auto">{run.durationMs} ms</span> : null}
                </div>
              ))
            : null}
          {runs.data && runs.data.length === 0 ? (
            <p className="text-[11px] text-faint">{t('Nenhuma execução registrada ainda.')}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
