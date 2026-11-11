/** Gerenciador manual de addons do Stremio e diagnóstico. */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  FlaskConical,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react';
import type {
  AddonImportResultDto,
  AddonStreamSummaryDto,
  AddonTestSummaryDto,
  StremioAddonDto
} from '@hub/shared';
import { Button, Chip, ErrorBanner, InfoBanner, Modal, SuccessNote, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { useStremioAddons, useStremioStatus } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, formatRelative } from '@/lib/utils';

const RESOURCES = ['catalog', 'meta', 'stream', 'subtitles'] as const;

function formatBytes(value: number | null): string {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function StreamSummary({ summary }: { summary: AddonStreamSummaryDto }) {
  const { t } = useI18n();
  if (summary.error) {
    return <p className="text-[11px] text-warning">{t('Streams:')} {summary.error}</p>;
  }
  return (
    <div className="space-y-0.5 text-[11px] leading-relaxed text-muted">
      <p>
        {t('Amostra:')} <span className="text-fg">{summary.sampleTitle ?? summary.sampleId ?? '—'}</span>
      </p>
      <p>
        <span className="font-semibold text-fg">{summary.count}</span> {t('stream(s)')} · {t('direto')}{' '}
        {summary.kinds.direct} · torrent {summary.kinds.torrent} · {t('externo')} {summary.kinds.external}
        {summary.kinds.unknown > 0 ? ` · ${t('desconhecido')} ${summary.kinds.unknown}` : ''}
      </p>
      <p>
        {t('Qualidades:')} {summary.qualities.length ? summary.qualities.join(', ') : '—'} · {t('maior')}{' '}
        {formatBytes(summary.largestBytes)} · {t('total')} {formatBytes(summary.totalBytes)}
        {summary.maxSeeds !== null ? ` · seeds ${summary.maxSeeds}` : ''}
      </p>
      <p className="text-faint">{t('Tempo da consulta de streams:')} {summary.elapsedMs} ms</p>
    </div>
  );
}

function TestResult({ summary }: { summary: AddonTestSummaryDto }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'mt-2 space-y-1 rounded-lg border p-2.5',
        summary.ok ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
      )}
    >
      <p className={cn('text-[11px] font-semibold', summary.ok ? 'text-success' : 'text-warning')}>
        {summary.ok ? t('Teste concluído') : t('Teste com falha')} · {summary.elapsedMs} ms
      </p>
      <p className="text-[11px] text-muted">
        Manifest: {summary.manifestMs} ms · {t('catálogos declarados:')} {summary.catalogsDeclared} ·{' '}
        {t('catálogos consultados:')} {summary.catalogsTested}
      </p>
      {summary.streams ? <StreamSummary summary={summary.streams} /> : null}
      {summary.warnings.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-warning">
          {summary.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AddonRow({
  addon,
  first,
  last,
  busy,
  testSummary,
  onMove,
  onToggle,
  onTest,
  onEdit,
  onRemove
}: {
  addon: StremioAddonDto;
  first: boolean;
  last: boolean;
  busy: string | null;
  testSummary: AddonTestSummaryDto | null;
  onMove: (direction: -1 | 1) => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const activeResources = useMemo(
    () => new Set(addon.resources.map((resource) => resource.name)),
    [addon.resources]
  );

  return (
    <div className={cn('rounded-xl border border-line/70 bg-bg/40 p-3', !addon.enabled && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-semibold text-fg">{addon.name}</p>
            {addon.version ? <Chip>v{addon.version}</Chip> : null}
            {!addon.enabled ? <Chip>{t('desativado')}</Chip> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-faint">{addon.maskedUrl}</p>
          {addon.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{addon.description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={first || busy !== null}
            aria-label={`${t('Mover')} ${addon.name} ${t('para cima')}`}
            title={t('Mais prioritário')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={last || busy !== null}
            aria-label={`${t('Mover')} ${addon.name} ${t('para baixo')}`}
            title={t('Menos prioritário')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${t('Editar')} ${addon.name}`}
            title={t('Editar URL')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${t('Remover')} ${addon.name}`}
            title={t('Remover')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:bg-danger/15 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {RESOURCES.map((resource) => {
            const active = activeResources.has(resource);
            return (
              <span
                key={resource}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                  active ? 'bg-accent/12 text-accent' : 'bg-elevated text-faint/60'
                )}
              >
                {resource}
              </span>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {addon.types.map((type) => (
            <Chip key={type}>{type}</Chip>
          ))}
          {addon.idPrefixes.length > 0 ? (
            <span className="font-mono text-[10px] text-faint">{addon.idPrefixes.join(', ')}</span>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-faint">
            {addon.lastTestAt
              ? `${t('testado')} ${formatRelative(addon.lastTestAt)}`
              : t('nunca testado')}
          </span>
          <Button
            variant="subtle"
            size="sm"
            onClick={onTest}
            loading={busy === `test:${addon.id}`}
            disabled={busy !== null}
            icon={<FlaskConical className="h-3.5 w-3.5" />}
          >
            {t('Testar')}
          </Button>
          <Switch
            checked={addon.enabled}
            onChange={onToggle}
            label={`${t('Ativar')} ${addon.name}`}
            disabled={busy !== null}
          />
        </div>
      </div>

      {addon.catalogs.length > 0 ? (
        <p className="mt-1.5 line-clamp-1 text-[10px] text-faint">
          {t('Catálogos:')} {addon.catalogs.map((catalog) => `${catalog.type}/${catalog.name}`).join(' · ')}
        </p>
      ) : null}

      {testSummary ? <TestResult summary={testSummary} /> : null}
    </div>
  );
}

export function AddonsPanel() {
  const { t } = useI18n();
  const addonsQuery = useStremioAddons();
  const status = useStremioStatus();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testSummaries, setTestSummaries] = useState<Record<string, AddonTestSummaryDto>>({});
  const [importResult, setImportResult] = useState<AddonImportResultDto | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<StremioAddonDto | null>(null);

  const addons = [...(addonsQuery.data?.addons ?? [])].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name)
  );

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['stremio-addons'] });
    await queryClient.invalidateQueries({ queryKey: ['stremio-catalogs'] });
    await queryClient.invalidateQueries({ queryKey: ['stremio-catalog'] });
  };

  const handleAdd = async (): Promise<void> => {
    if (!url.trim()) {
      setError(t('Cole a URL do manifest.json do addon.'));
      return;
    }
    setBusy('add');
    setError(null);
    setMessage(null);
    try {
      const result = await api.addStremioAddon(url.trim());
      setUrl('');
      setMessage(`${t('Addon')} "${result.addon.name}" ${t('adicionado.')}`);
      await refresh();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : t('Não foi possível adicionar o addon.'));
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (addon: StremioAddonDto, enabled: boolean): Promise<void> => {
    setBusy(`toggle:${addon.id}`);
    setError(null);
    try {
      await api.updateStremioAddon(addon.id, { enabled });
      await refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : t('Não foi possível atualizar o addon.'));
    } finally {
      setBusy(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction;
    if (target < 0 || target >= addons.length) return;
    const ids = addons.map((addon) => addon.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setBusy('reorder');
    setError(null);
    try {
      await api.reorderStremioAddons(ids);
      await refresh();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : t('Não foi possível reordenar.'));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (addon: StremioAddonDto): Promise<void> => {
    setBusy(`test:${addon.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await api.testStremioAddon(addon.id);
      setTestSummaries((previous) => ({ ...previous, [addon.id]: result.summary }));
      setMessage(`${t('Teste de')} "${addon.name}" ${t('concluído.')}`);
      await refresh();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : t('Não foi possível testar o addon.'));
    } finally {
      setBusy(null);
    }
  };

  const handleEdit = async (addon: StremioAddonDto): Promise<void> => {
    if (!editUrl.trim()) {
      setError(t('Cole a nova URL do manifest.json.'));
      return;
    }
    setBusy(`edit:${addon.id}`);
    setError(null);
    try {
      await api.updateStremioAddon(addon.id, { url: editUrl.trim() });
      setEditing(null);
      setEditUrl('');
      setMessage(`${t('Addon')} "${addon.name}" ${t('atualizado.')}`);
      await refresh();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : t('Não foi possível editar o addon.'));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (!confirmRemove) return;
    setBusy(`remove:${confirmRemove.id}`);
    setError(null);
    try {
      await api.removeStremioAddon(confirmRemove.id);
      setMessage(`${t('Addon')} "${confirmRemove.name}" ${t('removido.')}`);
      setConfirmRemove(null);
      await refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t('Não foi possível remover o addon.'));
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (): Promise<void> => {
    setBusy('import');
    setError(null);
    setMessage(null);
    setImportResult(null);
    try {
      const result = await api.importStremioAddons();
      setImportResult(result);
      setMessage(t('Importação da conta concluída.'));
      await refresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t('Não foi possível importar os addons.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line/70 bg-bg/40 p-3">
        <p className="text-xs font-semibold text-fg">{t('Adicionar addon')}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
          {t('Cole a URL do')} <span className="font-mono text-muted">manifest.json</span>.{' '}
          {t('Também aceitamos')} <span className="font-mono text-muted">stremio://</span>,{' '}
          {t('convertido para https. Nenhum addon vem pré-configurado.')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="field-input min-w-[14rem] flex-1"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAdd();
              }
            }}
            placeholder="https://addon.exemplo.com/manifest.json"
            spellCheck={false}
            aria-label={t('URL do manifest.json do addon')}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleAdd()}
            loading={busy === 'add'}
            disabled={busy !== null && busy !== 'add'}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            {t('Adicionar')}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void handleImport()}
            loading={busy === 'import'}
            disabled={!status.data?.connected || (busy !== null && busy !== 'import')}
            icon={<Upload className="h-3.5 w-3.5" />}
            title={
              status.data?.connected
                ? t('Importar a lista de addons da sua conta Stremio (somente leitura)')
                : t('Conecte sua conta do Stremio para importar')
            }
          >
            {t('Importar da conta')}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
          {t('A URL é criptografada com')} <span className="font-mono">APP_SECRET</span>{' '}
          {t('e nunca é devolvida pela API. A interface mostra apenas uma versão mascarada.')}
        </p>
      </div>

      {addonsQuery.isLoading ? <p className="text-[11px] text-faint">{t('Carregando addons…')}</p> : null}

      {!addonsQuery.isLoading && addons.length === 0 ? (
        <InfoBanner message={t('Nenhum addon cadastrado. Adicione um manifest.json acima para habilitar catálogos e streams.')} />
      ) : null}

      {addons.map((addon, index) => (
        <div key={addon.id} className="space-y-2">
          {editing === addon.id ? (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs font-semibold text-fg">{t('Editar URL de')} "{addon.name}"</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="field-input min-w-[14rem] flex-1"
                  value={editUrl}
                  onChange={(event) => setEditUrl(event.target.value)}
                  placeholder={t('Nova URL do manifest.json')}
                  spellCheck={false}
                  aria-label={`${t('Nova URL de')} ${addon.name}`}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleEdit(addon)}
                  loading={busy === `edit:${addon.id}`}
                >
                  {t('Salvar')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setEditUrl('');
                  }}
                >
                  {t('Cancelar')}
                </Button>
              </div>
            </div>
          ) : null}

          <AddonRow
            addon={addon}
            first={index === 0}
            last={index === addons.length - 1}
            busy={busy}
            testSummary={testSummaries[addon.id] ?? addon.lastTestSummary}
            onMove={(direction) => void handleMove(index, direction)}
            onToggle={(enabled) => void handleToggle(addon, enabled)}
            onTest={() => void handleTest(addon)}
            onEdit={() => {
              setEditing(addon.id);
              setEditUrl('');
            }}
            onRemove={() => setConfirmRemove(addon)}
          />
        </div>
      ))}

      {importResult ? (
        <div className="rounded-xl border border-line/70 bg-bg/40 p-3 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-fg">
            {t('Importação: {created} addon(s) criado(s), {skipped} já existente(s).', {
              created: importResult.created,
              skipped: importResult.skipped
            })}
          </p>
          {importResult.errors.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-warning">
              {importResult.errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ErrorBanner message={error} />
      <SuccessNote message={message} />

      <div className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
        <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          {t(
            'Addons são serviços web remotos: o Hub apenas faz requisições HTTP e nunca instala código. Falhas de um addon não afetam os outros. O diagnóstico nunca mostra chaves ou URLs completas.'
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          loading={addonsQuery.isFetching}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          {t('Atualizar lista')}
        </Button>
      </div>

      <Modal
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        title={t('Remover addon?')}
        description={t('O addon será removido do Hub. Nada é alterado na sua conta do Stremio.')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="danger"
              loading={busy === `remove:${confirmRemove?.id ?? ''}`}
              onClick={() => void handleRemove()}
            >
              {t('Remover')}
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          {confirmRemove ? `${confirmRemove.name} (${confirmRemove.maskedUrl})` : ''}
        </p>
      </Modal>
    </div>
  );
}
