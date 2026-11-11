/** Modal para escolher e lembrar o último capítulo lido de uma novel. */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { SourceDto } from '@hub/shared';
import { Button, ErrorBanner, Field, Modal, SuccessNote } from '@/components/ui';
import {
  useClearNovelProgress,
  useNovelDetails,
  useSetNovelProgress
} from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { formatDateTime } from '@/lib/utils';

interface NovelProgressModalProps {
  open: boolean;
  onClose: () => void;
  source: SourceDto | null;
}

export function NovelProgressModal({ open, onClose, source }: NovelProgressModalProps) {
  const { t } = useI18n();
  const details = useNovelDetails(source?.id ?? null, open);
  const setProgress = useSetNovelProgress();
  const clearProgress = useClearNovelProgress();
  const [chapterId, setChapterId] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualIndex, setManualIndex] = useState('');
  const [manualName, setManualName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const chapters = useMemo(
    () =>
      [...(details.data?.chapters ?? [])].sort(
        (a, b) => (b.index ?? 0) - (a.index ?? 0)
      ),
    [details.data]
  );
  const book = details.data?.book;
  const selected = chapters.find((chapter) => chapter.id === chapterId) ?? null;
  const effectiveManual = chapters.length === 0 || manualMode;
  const manualIndexNumber = manualIndex.trim() ? Number(manualIndex.trim()) : null;
  const manualIndexValid =
    manualIndexNumber === null ||
    (Number.isFinite(manualIndexNumber) && manualIndexNumber >= 0);
  const manualChapterName =
    manualName.trim() || (manualIndexNumber !== null ? `${t('Capítulo')} ${manualIndexNumber}` : '');
  const canSaveManual = manualIndexValid && Boolean(manualChapterName);
  const canSave = effectiveManual ? canSaveManual : Boolean(selected);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(false);
    setManualMode(false);
    setManualIndex('');
    setManualName('');
    const progress = source?.config.lastReadChapter;
    const initial =
      progress && typeof progress === 'object' && typeof (progress as Record<string, unknown>).chapterId === 'string'
        ? String((progress as Record<string, unknown>).chapterId)
        : '';
    setChapterId(initial);
  }, [open, source]);

  useEffect(() => {
    if (!open || !details.data) return;
    setChapterId(details.data.progress?.chapterId ?? '');
  }, [open, details.data]);

  const handleSave = (): void => {
    if (!source) return;
    const target = effectiveManual
      ? canSaveManual
        ? {
            chapterId: `manual:${manualIndexNumber ?? manualChapterName.slice(0, 48)}`,
            chapterIndex: manualIndexNumber,
            chapterName: manualChapterName
          }
        : null
      : selected
        ? {
            chapterId: selected.id,
            chapterIndex: selected.index,
            chapterName: selected.name
          }
        : null;
    if (!target) return;
    setError(null);
    setProgress.mutate(
      { id: source.id, body: target },
      {
        onSuccess: () => {
          setSaved(true);
          setError(null);
        },
        onError: (mutationError) => {
          setError(
            mutationError instanceof Error ? mutationError.message : t('Não foi possível salvar o progresso.')
          );
        }
      }
    );
  };

  const handleClear = (): void => {
    if (!source) return;
    setError(null);
    clearProgress.mutate(source.id, {
      onSuccess: () => {
        setChapterId('');
        setSaved(false);
        setError(null);
      },
      onError: (mutationError) => {
        setError(
          mutationError instanceof Error ? mutationError.message : t('Não foi possível limpar o progresso.')
        );
      }
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('Progresso de leitura')}
      description={t('O Hub lembra em que capítulo você parou. Isso não altera nada no site.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Fechar')}
          </Button>
          {details.data?.progress ? (
            <Button
              variant="danger"
              onClick={handleClear}
              loading={clearProgress.isPending}
              disabled={setProgress.isPending}
            >
              {t('Limpar progresso')}
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={handleSave}
            loading={setProgress.isPending}
            disabled={clearProgress.isPending || details.isLoading || !canSave}
          >
            {t('Salvar progresso')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {details.isLoading ? (
          <p className="text-xs text-faint">{t('Carregando os capítulos da novel…')}</p>
        ) : null}

        {details.isError ? (
          <ErrorBanner
            message={
              details.error instanceof Error
                ? details.error.message
                : t('Não foi possível carregar os capítulos desta novel.')
            }
          />
        ) : null}

        {book ? (
          <div className="flex gap-3 rounded-xl border border-line/70 bg-bg/40 p-3">
            <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-line bg-elevated">
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="eager"
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
              <p className="truncate text-sm font-semibold text-fg">{book.title}</p>
              <p className="mt-0.5 text-[11px] text-faint">
                {[book.author, book.category, `${book.chapterCount} ${t('capítulos')}`].filter(Boolean).join(' · ')}
              </p>
              {book.latestChapter ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  {t('Último capítulo:')}{' '}
                  <span className="font-medium text-fg">
                    {book.latestChapter.index !== null ? `Cap. ${book.latestChapter.index} — ` : ''}
                    {book.latestChapter.name}
                  </span>
                  {book.latestChapter.publishedAt
                    ? ` · ${formatDateTime(book.latestChapter.publishedAt)}`
                    : ''}
                </p>
              ) : null}
              {details.data?.progress ? (
                <p className="mt-1 text-[11px] leading-relaxed text-accent">
                  {t('Lido até:')} Cap. {details.data.progress.chapterIndex ?? '?'} — {details.data.progress.chapterName}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-faint">{t('Nenhum capítulo marcado como lido.')}</p>
              )}
            </div>
          </div>
        ) : null}

        {chapters.length > 0 ? (
          <div className="space-y-2">
            <Field
              label={t('Último capítulo lido')}
              htmlFor="novel-progress-chapter"
              hint={t('Escolha até onde você leu. O capítulo mais recente fica no topo.')}
            >
              <select
                id="novel-progress-chapter"
                className="field-input"
                value={chapterId}
                onChange={(event) => {
                  setChapterId(event.target.value);
                  setManualMode(false);
                  setSaved(false);
                }}
              >
                <option value="">{t('Nenhum capítulo')}</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.index !== null ? `Cap. ${chapter.index} — ` : ''}
                    {chapter.name}
                    {chapter.publishedAt ? ` · ${formatDateTime(chapter.publishedAt)}` : ''}
                    {chapter.isVip ? ' · VIP' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={manualMode}
                onChange={(event) => {
                  setManualMode(event.target.checked);
                  setSaved(false);
                }}
              />
              {t('Informar capítulo manualmente')}
            </label>
          </div>
        ) : null}

        {!details.isLoading && (chapters.length === 0 || manualMode) ? (
          <div className="space-y-3 rounded-xl border border-line/70 bg-bg/40 p-3">
            <p className="text-[11px] leading-relaxed text-muted">
              {chapters.length === 0
                ? t(
                    'Não encontrei a lista de capítulos nesta página. Você ainda pode registrar o progresso manualmente.'
                  )
                : t('Informe o número e/ou o nome do capítulo que você leu.')}
            </p>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field label={t('Número')} htmlFor="novel-manual-index">
                <input
                  id="novel-manual-index"
                  type="number"
                  min={0}
                  step="any"
                  className="field-input"
                  value={manualIndex}
                  onChange={(event) => {
                    setManualIndex(event.target.value);
                    setSaved(false);
                  }}
                  placeholder={t('Ex.: 42')}
                />
              </Field>
              <Field label={t('Nome do capítulo')} htmlFor="novel-manual-name">
                <input
                  id="novel-manual-name"
                  className="field-input"
                  value={manualName}
                  onChange={(event) => {
                    setManualName(event.target.value);
                    setSaved(false);
                  }}
                  placeholder={t('Ex.: O retorno')}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {saved ? <SuccessNote message={t('Progresso salvo neste dispositivo.')} /> : null}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
