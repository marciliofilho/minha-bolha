/** Configurações: tema, atualização, região/moeda, chaves e dados demo. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Captions,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  Heart,
  Info,
  KeyRound,
  Monitor,
  Moon,
  RefreshCw,
  Rss,
  BookOpen,
  Sun,
  Timer,
  Trash2,
  Upload,
  Youtube,
  Clapperboard,
  Puzzle
} from 'lucide-react';
import {
  APP_LANGUAGES,
  CURRENCY_OPTIONS,
  INTERVAL_OPTIONS,
  REGION_OPTIONS,
  type BackupDocumentDto,
  type BackupPreviewDto,
  type SecretId,
  type SecretStatusDto,
  type SettingsDto,
  type SourceType
} from '@hub/shared';
import { Button, Chip, ErrorBanner, Modal, PageHeader, SuccessNote, Switch } from '@/components/ui';
import { SourceFormModal } from '@/components/sources/SourceFormModal';
import { StremioPanel } from '@/components/settings/StremioPanel';
import { AddonsPanel } from '@/components/settings/AddonsPanel';
import {
  FALLBACK_SETTINGS,
  useClearCaches,
  useClearNovelCache,
  useDeleteSecret,
  useOptimizeDatabase,
  useSaveSettings,
  useSecrets,
  useSetSecret,
  useSettings,
  useStorageStats
} from '@/lib/queries';
import { api } from '@/lib/api';
import { useStoredBoolean } from '@/lib/use-stored-boolean';
import { useI18n } from '@/lib/i18n';
import { appBrand, KOFI_URL } from '@/lib/brand';
import { cn, formatInterval, formatRelative } from '@/lib/utils';

const THEMES: Array<{ value: SettingsDto['theme']; label: string; icon: typeof Moon }> = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor }
];

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'UTC'
];

type SettingsCategory = 'interface' | 'streaming' | 'system' | 'keys';

const SETTINGS_CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  icon: typeof Moon;
}> = [
  { id: 'interface', label: 'Interface', icon: Monitor },
  { id: 'streaming', label: 'Streaming', icon: Clapperboard },
  { id: 'system', label: 'Sistema', icon: Database },
  { id: 'keys', label: 'Chaves', icon: KeyRound }
];

function formatStorageBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function Section({
  title,
  description,
  icon,
  children,
  badge,
  collapsible = false,
  storageKey
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  badge?: string;
  collapsible?: boolean;
  storageKey?: string;
}) {
  const { t } = useI18n();
  const [collapsed, toggleCollapsed] = useStoredBoolean(
    storageKey ?? `hub.settings.section.${title}`,
    false
  );

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-elevated text-muted">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            {badge ? <Chip>{badge}</Chip> : null}
            {collapsible ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? `${t('Mostrar')} ${title}` : `${t('Minimizar')} ${title}`}
                title={collapsed ? `${t('Mostrar')} ${title}` : `${t('Minimizar')} ${title}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
              >
                {collapsed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
          {collapsed ? null : <div className="mt-4">{children}</div>}
        </div>
      </div>
    </section>
  );
}

function NumberSetting({
  id,
  label,
  value,
  min,
  max,
  suffix,
  hint,
  onCommit
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    };
  }, []);

  const handleChange = (raw: string): void => {
    setDraft(raw);
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = Math.round(parsed);
    if (next < min || next > max) return;
    commitTimerRef.current = window.setTimeout(() => {
      if (next !== value) onCommit(next);
    }, 700);
  };

  const commitValue = (raw: string): void => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          value={draft}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => commitValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitValue(event.currentTarget.value);
              event.currentTarget.blur();
            }
          }}
          className="field-input w-28"
        />
        {suffix ? <span className="text-[11px] text-faint">{suffix}</span> : null}
      </div>
      {hint ? (
        <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

function RangeSetting({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  display,
  hint,
  onCommit
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: (value: number) => string;
  hint?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitValue = (raw: string): void => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const digits = (String(step).split('.')[1] ?? '').length;
    const snapped = Number((Math.round(parsed / step) * step).toFixed(digits));
    const next = Math.min(max, Math.max(min, snapped));
    if (next !== value) onCommit(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="field-label mb-0" htmlFor={id}>
          {label}
        </label>
        <span className="text-[11px] font-medium text-muted">{display ? display(draft) : draft}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={(event) => commitValue(event.currentTarget.value)}
        onKeyUp={(event) => commitValue(event.currentTarget.value)}
        onBlur={(event) => commitValue(event.currentTarget.value)}
        className="mt-2 w-full accent-accent"
      />
      {hint ? (
        <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

function ColorSetting({
  id,
  label,
  value,
  hint,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-bg p-1"
        />
        <span className="font-mono text-[11px] text-muted">{value}</span>
      </div>
      {hint ? (
        <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const SUBTITLE_LANGUAGE_OPTIONS = [
  { value: 'por', label: 'Português (qualquer variante)' },
  { value: 'pob', label: 'Português (Brasil)' },
  { value: 'eng', label: 'Inglês' },
  { value: 'spa', label: 'Espanhol' },
  { value: 'fra', label: 'Francês' },
  { value: 'deu', label: 'Alemão' },
  { value: 'ita', label: 'Italiano' },
  { value: 'jpn', label: 'Japonês' },
  { value: 'kor', label: 'Coreano' },
  { value: 'chi', label: 'Chinês' },
  { value: 'rus', label: 'Russo' },
  { value: 'ara', label: 'Árabe' },
  { value: 'off', label: 'Desligada (não selecionar automaticamente)' }
];

function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '').trim();
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  const integer = Number.parseInt(value, 16);
  if (!Number.isFinite(integer) || value.length !== 6) {
    return `rgba(0, 0, 0, ${Math.min(100, Math.max(0, opacity)) / 100})`;
  }
  return `rgba(${(integer >> 16) & 255}, ${(integer >> 8) & 255}, ${integer & 255}, ${
    Math.min(100, Math.max(0, opacity)) / 100
  })`;
}

function StorageCard({
  label,
  value,
  detail,
  path
}: {
  label: string;
  value: string;
  detail: string;
  path?: string | null;
}) {
  return (
    <div className="rounded-xl border border-line/60 bg-bg/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold text-fg">{value}</p>
      <p className="text-[10px] text-faint">{detail}</p>
      {path ? (
        <p className="mt-1 truncate text-[9px] text-faint" title={path}>
          {path}
        </p>
      ) : null}
    </div>
  );
}

function StorageSection() {
  const { t } = useI18n();
  const stats = useStorageStats();
  const clear = useClearCaches();
  const optimize = useOptimizeDatabase();
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = stats.data;

  const handleClear = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const result = await clear.mutateAsync();
      setConfirmClear(false);
      setMessage(
        `${t('Caches limpos:')} ${formatStorageBytes(result.freedBytes)} ${t('liberados.')}`
      );
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : t('Não foi possível limpar os caches.')
      );
    }
  };

  const handleOptimize = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const result = await optimize.mutateAsync();
      setMessage(
        `${t('Banco otimizado em')} ${result.elapsedMs} ms. ${formatStorageBytes(
          result.freedBytes
        )} ${t('liberados.')}`
      );
    } catch (optimizeError) {
      setError(
        optimizeError instanceof Error
          ? optimizeError.message
          : t('Não foi possível otimizar o banco.')
      );
    }
  };

  return (
    <Section
      title={t('Armazenamento e cache')}
      description={t(
        'Veja o espaço usado por downloads de streams e temporários, limpe caches manualmente e compacte o banco.'
      )}
      icon={<HardDrive className="h-4 w-4" />}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <StorageCard
          label={t('Cache de streams')}
          value={formatStorageBytes(data?.torrentCache.bytes)}
          detail={`${data?.torrentCache.files ?? 0} ${t('arquivo(s)')}`}
          path={data?.torrentCache.path}
        />
        <StorageCard
          label={t('Temporários do navegador')}
          value={formatStorageBytes(data?.browserTemp.bytes)}
          detail={`${data?.browserTemp.dirs ?? 0} ${t('pasta(s)')} · ${data?.browserTemp.files ?? 0} ${t('arquivo(s)')}`}
        />
        <StorageCard
          label={t('Banco de dados')}
          value={formatStorageBytes(data?.database.bytes)}
          detail="SQLite + WAL"
          path={data?.database.path}
        />
      </div>

      <p className="mt-2 text-[11px] text-faint">
        {t('Total de caches (streams + temporários + capítulos offline):')}{' '}
        <span className="font-medium text-muted">
          {formatStorageBytes(data?.totalCacheBytes)}
        </span>
        {stats.isFetching ? ` · ${t('atualizando…')}` : ''}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => {
            setError(null);
            setMessage(null);
            setConfirmClear(true);
          }}
        >
          {t('Limpar caches')}
        </Button>
        <Button
          variant="subtle"
          size="sm"
          icon={<Database className="h-3.5 w-3.5" />}
          loading={optimize.isPending}
          onClick={() => void handleOptimize()}
        >
          {t('Otimizar banco')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          loading={stats.isFetching}
          onClick={() => void stats.refetch()}
        >
          {t('Atualizar')}
        </Button>
      </div>

      {stats.isError ? (
        <div className="mt-2">
          <ErrorBanner message={t('Não foi possível calcular o uso de armazenamento.')} />
        </div>
      ) : null}
      {error ? (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      <SuccessNote message={message} />

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {t(
          'Limpar caches remove os pedaços baixados dos torrents, os segmentos HLS e temporários antigos do navegador (mais de 30 min). Streams em andamento serão interrompidos. Banco, configurações, addons e progresso de reprodução são preservados.'
        )}
      </p>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('Limpar caches?')}
        description={t(
          'Essa ação não afeta configurações, addons, banco nem progresso de reprodução.'
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="danger"
              loading={clear.isPending}
              onClick={() => void handleClear()}
            >
              {t('Limpar caches')}
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-muted">
          {t('Serão removidos aproximadamente')}{' '}
          <strong className="text-fg">
            {formatStorageBytes(data?.torrentCache.bytes)}
          </strong>{' '}
          {t(
            'de cache de streams e temporários antigos. Streams em andamento serão interrompidos.'
          )}
        </p>
      </Modal>
    </Section>
  );
}

function NovelOfflineSection() {
  const { t } = useI18n();
  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();
  const stats = useStorageStats();
  const clear = useClearNovelCache();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!settingsQuery.data) return null;
  const settings = settingsQuery.data;
  const cache = stats.data?.novelOfflineCache;

  const handleClear = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const result = await clear.mutateAsync();
      setMessage(
        `${t('Capítulos offline limpos:')} ${result.entries} · ${formatStorageBytes(result.bytes)}`
      );
    } catch (clearError) {
      setError(
        clearError instanceof Error
          ? clearError.message
          : t('Não foi possível limpar os capítulos offline.')
      );
    }
  };

  return (
    <Section
      title={t('Capítulos offline')}
      description={t(
        'Guarde capítulos já lidos para continuar a leitura sem internet.'
      )}
      icon={<Download className="h-4 w-4" />}
    >
      <label className="flex items-start gap-2 rounded-xl border border-line/70 bg-elevated/40 p-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
          checked={settings.novelChaptersOffline}
          onChange={(event) =>
            saveSettings.mutate({ novelChaptersOffline: event.target.checked })
          }
        />
        <span>
          <span className="block text-xs font-medium text-fg">
            {t('Salvar capítulos vistos offline')}
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">
            {t(
              'Salva o conteúdo dos capítulos abertos no leitor. Você também pode alternar isso pelo botão Offline no próprio leitor.'
            )}
          </span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 bg-bg/40 p-3">
        <div>
          <p className="text-xs font-medium text-fg">
            {formatStorageBytes(cache?.bytes)}
          </p>
          <p className="text-[11px] text-faint">
            {t('{count} capítulo(s) salvo(s) offline', {
              count: cache?.entries ?? 0
            })}
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          loading={clear.isPending}
          onClick={() => void handleClear()}
        >
          {t('Limpar capítulos offline')}
        </Button>
      </div>

      <div className="mt-3">
        <NumberSetting
          id="novel-offline-retention"
          label={t('Limpar capítulos offline após')}
          value={settings.novelOfflineRetentionDays}
          min={1}
          max={365}
          suffix={t('dias')}
          hint={t(
            'A limpeza automática verifica a cada 30 minutos e remove capítulos mais antigos que esse período.'
          )}
          onCommit={(value) =>
            saveSettings.mutate({ novelOfflineRetentionDays: value })
          }
        />
      </div>

      <ErrorBanner message={error} />
      <SuccessNote message={message} />
    </Section>
  );
}

export function SettingsPage() {
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();
  const backupFileRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{
    data: BackupDocumentDto;
    preview: BackupPreviewDto;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sourceFormOpen, setSourceFormOpen] = useState(false);
  const [sourceFormType, setSourceFormType] = useState<SourceType>('youtube');

  const settings = settingsQuery.data ?? FALLBACK_SETTINGS;
  const [category, setCategory] = useState<SettingsCategory>(() => {
    try {
      const stored = window.localStorage.getItem('hub.settings.category');
      return SETTINGS_CATEGORIES.some((item) => item.id === stored)
        ? (stored as SettingsCategory)
        : 'interface';
    } catch {
      return 'interface';
    }
  });

  const changeCategory = (next: SettingsCategory): void => {
    setCategory(next);
    try {
      window.localStorage.setItem('hub.settings.category', next);
    } catch {
      // Armazenamento indisponível.
    }
  };

  const secretsQuery = useSecrets();
  const secretOrder: SecretId[] = ['tmdb', 'ggdeals'];
  // A chave da Steam não é necessária para a wishlist (API pública) e foi
  // removida da interface de configuração.
  const secrets = [...(secretsQuery.data ?? [])]
    .filter((secret) => secret.id !== 'steam')
    .sort((a, b) => secretOrder.indexOf(a.id) - secretOrder.indexOf(b.id));

  const secretDescriptions: Record<SecretId, string> = {
    tmdb: t('Filmes, séries e calendário de lançamentos.'),
    ggdeals: t('Preços de jogos em lojas oficiais e keyshops.'),
    steam: t(
      'Opcional - resolve links de perfil (vanity URLs). Não é necessária para importar a wishlist. Formato: 32 caracteres hexadecimais.'
    )
  };

  const secretDocs: Record<SecretId, string> = {
    tmdb: 'https://www.themoviedb.org/settings/api',
    ggdeals: 'https://gg.deals/api/',
    steam: 'https://steamcommunity.com/dev/apikey'
  };

  const exportBackup = async (): Promise<void> => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupMessage(null);
    try {
      const backup = await api.backupExport();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupMessage(t('Backup exportado com sucesso.'));
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : t('Não foi possível exportar o backup.')
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const selectBackupFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as BackupDocumentDto;
      if (parsed?.format !== 'hub-backup' || parsed.version !== 1) {
        throw new Error(t('Este arquivo não é um backup válido do Hub.'));
      }
      const preview = await api.backupPreview(parsed);
      setPendingBackup({ data: parsed, preview });
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : t('Não foi possível ler o arquivo de backup.')
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const confirmBackupImport = async (): Promise<void> => {
    if (!pendingBackup) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupMessage(null);
    try {
      const result = await api.backupImport(pendingBackup.data);
      setPendingBackup(null);
      setBackupMessage(
        t(
          'Backup importado: {created} fonte(s) criada(s), {updated} atualizada(s) e {categories} categoria(s).',
          {
            created: result.sourcesCreated,
            updated: result.sourcesUpdated,
            categories: result.categoriesImported
          }
        )
      );
      await queryClient.invalidateQueries();
    } catch (error) {
      setBackupError(
        error instanceof Error ? error.message : t('Não foi possível importar o backup.')
      );
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        eyebrow={t('Preferências')}
        title={t('Configurações')}
        description={t('Interface, streaming, sistema e chaves organizados por categoria.')}
      />

      <nav
        aria-label={t('Categorias de configuração')}
        className="mb-3 flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface/80 p-1.5"
      >
        {SETTINGS_CATEGORIES.map((item) => {
          const active = category === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => changeCategory(item.id)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition',
                active
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:bg-elevated hover:text-fg'
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {t(item.label)}
            </button>
          );
        })}
      </nav>

      <div className="space-y-3">
        {category === 'streaming' ? (
          <>
        <Section
          title={t('Fontes e canais')}
          description={t(
            'Canais do YouTube, feeds RSS, filmes, séries, animes e jogos ficam na tela de Fontes.'
          )}
          icon={<Rss className="h-4 w-4" />}
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSourceFormType('youtube');
                setSourceFormOpen(true);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3.5 text-sm font-medium text-accent-fg transition hover:brightness-110"
            >
              <Youtube className="h-4 w-4" /> {t('Adicionar canal do YouTube')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceFormType('rss');
                setSourceFormOpen(true);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-elevated px-3.5 text-sm font-medium text-fg transition hover:border-accent/40"
            >
              <Rss className="h-4 w-4" /> {t('Adicionar feed RSS')}
            </button>
            <Link
              to="/sources"
              className="inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-muted transition hover:bg-elevated hover:text-fg"
            >
              {t('Gerenciar todas as fontes')}
            </Link>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {t(
              'No YouTube, cole a URL do canal (/@nome, /channel/UC… ou /c/nome). O Hub descobre o canal e busca os vídeos.'
            )}
          </p>
        </Section>

        <Section
          title="Stremio"
          description={t(
            'Conecte sua conta para ler a biblioteca e o que está em andamento. O Hub nunca altera sua conta.'
          )}
          icon={<Clapperboard className="h-4 w-4" />}
          collapsible
          storageKey="hub.settings.stremio.collapsed"
        >
          <StremioPanel />
        </Section>

        <Section
          title="Addons"
          description={t(
            'Catálogos, metadados e streams de addons do Stremio. Nada é instalado: o Hub só consulta as URLs cadastradas.'
          )}
          icon={<Puzzle className="h-4 w-4" />}
          collapsible
          storageKey="hub.settings.addons.collapsed"
        >
          <AddonsPanel />
        </Section>
          </>
        ) : null}

        {category === 'interface' ? (
          <>
        <Section
          title={t('Aparência')}
          description={t('O tema é salvo no banco local e aplicado na hora.')}
          icon={<Sun className="h-4 w-4" />}
        >
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((theme) => {
              const active = settings.theme === theme.value;
              return (
                <button
                  key={theme.value}
                  type="button"
                  onClick={() => saveSettings.mutate({ theme: theme.value })}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition',
                    active
                      ? 'border-accent/50 bg-accent/10 text-fg'
                      : 'border-line bg-bg/40 text-muted hover:border-line hover:bg-elevated/70 hover:text-fg'
                  )}
                  aria-pressed={active}
                >
                  <theme.icon className={cn('h-4 w-4', active ? 'text-accent' : 'text-faint')} />
                  {t(theme.label)}
                </button>
              );
            })}
          </div>

          <div className="mt-4 max-w-xs">
            <label className="field-label" htmlFor="app-language">
              {t('Idioma do app')}
            </label>
            <select
              id="app-language"
              className="field-input"
              value={settings.language ?? 'pt'}
              onChange={(event) =>
                saveSettings.mutate({
                  language: event.target.value as SettingsDto['language']
                })
              }
            >
              {APP_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-relaxed text-faint">
              {t(
                'Muda o idioma dos menus e telas do Hub. O idioma do leitor é escolhido no próprio leitor.'
              )}
            </p>
          </div>
        </Section>

        <Section
          title={t('Feed e prévias')}
          description={t(
            'Ajuste a janela de conteúdo do feed e o tempo para abrir a prévia dos cards.'
          )}
          icon={<Timer className="h-4 w-4" />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberSetting
              id="hover-preview-seconds"
              label={t('Atraso da prévia ao passar o mouse')}
              value={settings.hoverPreviewSeconds}
              min={0}
              max={15}
              suffix={t('segundos')}
              hint={t(
                'Tempo com o mouse sobre qualquer card (filmes, séries, animes e novels) antes de abrir a prévia. Use 0 para abrir imediatamente.'
              )}
              onCommit={(value) => saveSettings.mutate({ hoverPreviewSeconds: value })}
            />
            <NumberSetting
              id="feed-window-hours"
              label={t('YouTube e notícias das últimas')}
              value={settings.feedWindowHours}
              min={1}
              max={168}
              suffix={t('horas')}
              hint={t(
                'Itens mais antigos continuam salvos, mas não aparecem no feed. Vale para vídeos do YouTube e notícias.'
              )}
              onCommit={(value) => saveSettings.mutate({ feedWindowHours: value })}
            />
          </div>
        </Section>

        <Section
          title={t('Inicialização')}
          description={t(
            'Escolha se a animação de abertura deve aparecer e se ela deve tocar áudio.'
          )}
          icon={<Monitor className="h-4 w-4" />}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-bg/40 p-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg">{t('Mostrar intro ao iniciar')}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                  {t('Exibe o vídeo de abertura enquanto o Hub carrega.')}
                </p>
              </div>
              <Switch
                checked={settings.introEnabled}
                onChange={(value) => saveSettings.mutate({ introEnabled: value })}
                label={t('Mostrar intro ao iniciar')}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-bg/40 p-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg">{t('Áudio da intro')}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                  {t('Toca o som da animação de abertura.')}
                </p>
              </div>
              <Switch
                checked={settings.introAudio}
                onChange={(value) => saveSettings.mutate({ introAudio: value })}
                label={t('Áudio da intro')}
                disabled={!settings.introEnabled}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {t('A alteração vale na próxima vez que o app desktop for aberto.')}
          </p>
        </Section>

        <Section
          title={t('Player e legendas')}
          description={t('Ajuste o salto dos atalhos e o visual das legendas carregadas dos addons.')}
          icon={<Captions className="h-4 w-4" />}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <NumberSetting
                id="player-skip-seconds"
                label={t('Avanço/retrocesso')}
                value={settings.playerSkipSeconds}
                min={1}
                max={120}
                suffix={t('segundos')}
                hint={t('Usado pelas setas ←/→ e pelos botões ±N s do player.')}
                onCommit={(value) => saveSettings.mutate({ playerSkipSeconds: value })}
              />

              <div>
                <label className="field-label" htmlFor="subtitle-language">
                  {t('Idioma padrão da legenda')}
                </label>
                <select
                  id="subtitle-language"
                  className="field-input"
                  value={settings.subtitleLanguage}
                  onChange={(event) =>
                    saveSettings.mutate({ subtitleLanguage: event.target.value })
                  }
                >
                  {[
                    ...new Set([
                      settings.subtitleLanguage,
                      ...SUBTITLE_LANGUAGE_OPTIONS.map((option) => option.value)
                    ])
                  ].map((value) => {
                    const label =
                      SUBTITLE_LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ??
                      value;
                    return (
                      <option key={value} value={value}>
                        {t(label)}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-[11px] leading-relaxed text-faint">
                  {t(
                    'Essa legenda é selecionada automaticamente ao abrir o player. Escolha Desligada para não selecionar nenhuma.'
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <RangeSetting
                id="subtitle-font-size"
                label={t('Tamanho da legenda')}
                value={settings.subtitleFontSize}
                min={12}
                max={48}
                display={(value) => `${value} px`}
                onCommit={(value) => saveSettings.mutate({ subtitleFontSize: value })}
              />

              <RangeSetting
                id="subtitle-line-height"
                label={t('Espaçamento entre linhas')}
                value={settings.subtitleLineHeight}
                min={0.8}
                max={2.5}
                step={0.05}
                display={(value) => `${value.toFixed(2)}×`}
                hint={t(
                  'Controla o espaço entre as linhas quando a legenda quebra em duas ou mais linhas.'
                )}
                onCommit={(value) => saveSettings.mutate({ subtitleLineHeight: value })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <ColorSetting
                  id="subtitle-color"
                  label={t('Cor do texto')}
                  value={settings.subtitleColor}
                  onChange={(value) => saveSettings.mutate({ subtitleColor: value })}
                />
                <ColorSetting
                  id="subtitle-bg-color"
                  label={t('Cor de fundo')}
                  value={settings.subtitleBackgroundColor}
                  onChange={(value) =>
                    saveSettings.mutate({ subtitleBackgroundColor: value })
                  }
                />
              </div>

              <RangeSetting
                id="subtitle-bg-opacity"
                label={t('Opacidade do fundo')}
                value={settings.subtitleBackgroundOpacity}
                min={0}
                max={100}
                display={(value) => `${value}%`}
                hint={t('0% remove o fundo preto da legenda.')}
                onCommit={(value) =>
                  saveSettings.mutate({ subtitleBackgroundOpacity: value })
                }
              />

              <RangeSetting
                id="subtitle-position"
                label={t('Posição vertical')}
                value={settings.subtitlePosition}
                min={40}
                max={95}
                display={(value) => `${value}%`}
                hint={t('Valores menores deixam a legenda mais alta no player.')}
                onCommit={(value) => saveSettings.mutate({ subtitlePosition: value })}
              />
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-medium text-muted">{t('Prévia da legenda')}</p>
            <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl border border-line bg-black">
              <div
                className="absolute inset-x-0 flex justify-center px-4"
                style={{
                  top: `${settings.subtitlePosition}%`,
                  transform: 'translateY(-100%)'
                }}
              >
                <span
                  style={{
                    fontSize: `${settings.subtitleFontSize}px`,
                    color: settings.subtitleColor,
                    backgroundColor: hexToRgba(
                      settings.subtitleBackgroundColor,
                      settings.subtitleBackgroundOpacity
                    ),
                    padding: '0.15em 0.4em',
                    borderRadius: 4,
                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.9)',
                    lineHeight: settings.subtitleLineHeight,
                    textAlign: 'center',
                    maxWidth: '80%'
                  }}
                >
                  {t(
                    'Exemplo de legenda com duas linhas para você ajustar o espaçamento entre elas.'
                  )}
                </span>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-faint">
              {t('A prévia usa os valores salvos; solte o controle para aplicar no player.')}
            </p>
          </div>
        </Section>
          </>
        ) : null}

        {category === 'system' ? (
          <>
        <Section
          title={t('Atualizações')}
          description={t('Intervalo padrão para novas fontes. Cada fonte pode ter o seu próprio ritmo.')}
          icon={<RefreshCw className="h-4 w-4" />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="default-interval">
                {t('Intervalo padrão')}
              </label>
              <select
                id="default-interval"
                className="field-input"
                value={settings.defaultIntervalMinutes}
                onChange={(event) => saveSettings.mutate({ defaultIntervalMinutes: Number(event.target.value) })}
              >
                {INTERVAL_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatInterval(value)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                {t(
                  'O scheduler roda a cada 30s e respeita o intervalo mínimo de cada conector (ex.: 15 min para RSS).'
                )}
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="timezone">
                {t('Fuso horário')}
              </label>
              <select
                id="timezone"
                className="field-input"
                value={settings.timezone}
                onChange={(event) => saveSettings.mutate({ timezone: event.target.value })}
              >
                {[...new Set([settings.timezone, ...TIMEZONES])].map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                {t('Usado para exibir datas e, a partir da Fase 2, os lançamentos do calendário.')}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <NumberSetting
              id="feed-refresh-seconds"
              label={t('Atualizar o feed a cada')}
              value={settings.feedRefreshSeconds}
              min={60}
              max={3600}
              suffix={t('segundos')}
              hint={t(
                'Vale para YouTube, RSS, novels e fontes personalizadas. O mínimo é 60s; valores baixos podem atingir limites das fontes.'
              )}
              onCommit={(value) => saveSettings.mutate({ feedRefreshSeconds: value })}
            />
          </div>
        </Section>

        <Section
          title={t('Região e moeda')}
          description={t(
            'Base para preços (gg.deals) e datas de lançamento regionais. Aplicado nas próximas fases.'
          )}
          icon={<Database className="h-4 w-4" />}
          badge="Fase 2 · 3"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="region">
                {t('Região')}
              </label>
              <select
                id="region"
                className="field-input"
                value={settings.region}
                onChange={(event) => saveSettings.mutate({ region: event.target.value })}
              >
                {REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="currency">
                {t('Moeda')}
              </label>
              <select
                id="currency"
                className="field-input"
                value={settings.currency}
                onChange={(event) => saveSettings.mutate({ currency: event.target.value })}
              >
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>
          </>
        ) : null}

        {category === 'keys' ? (
          <>
        <Section
          title={t('Chaves de API')}
          description={t(
            'Salvas no banco local e nunca devolvidas pela API. O .env continua como fallback; o valor salvo aqui tem prioridade.'
          )}
          icon={<KeyRound className="h-4 w-4" />}
          collapsible
          storageKey="hub.settings.secrets.collapsed"
        >
          <div className="space-y-2">
            {secrets.length === 0 ? (
              <p className="text-[11px] text-faint">{t('Carregando chaves…')}</p>
            ) : (
              secrets.map((secret) => (
                <SecretRow
                  key={secret.id}
                  secret={secret}
                  description={secretDescriptions[secret.id]}
                  docsUrl={secretDocs[secret.id]}
                />
              ))
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {t('As chaves ficam no SQLite local (')}
            <span className="font-mono text-muted">data/hub.db</span>
            {t(
              '), ignorado pelo git. Elas são mascaradas na interface e não há criptografia em repouso — o app é para uso pessoal e local. Ao salvar a chave do gg.deals, a fonte de preços é criada ou reativada.'
            )}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            {t(
              'A chave da Steam não é usada pela wishlist (a API pública funciona sem chave) e foi removida desta tela.'
            )}
          </p>
        </Section>
          </>
        ) : null}

        {category === 'system' ? (
          <>
        <Section
          title={t('Cache inteligente')}
          description={t(
            'Ajuste a validade dos caches e a manutenção automática de arquivos temporários.'
          )}
          icon={<Database className="h-4 w-4" />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberSetting
              id="stream-cache-ttl"
              label={t('Cache de streams')}
              value={settings.streamCacheTtlHours}
              min={1}
              max={168}
              suffix={t('horas')}
              hint={t(
                'Tempo em que a lista de streams de um título fica reutilizada antes de consultar os addons novamente.'
              )}
              onCommit={(value) => saveSettings.mutate({ streamCacheTtlHours: value })}
            />
            <NumberSetting
              id="torrent-cache-days"
              label={t('Limpeza do cache de torrents')}
              value={settings.torrentCacheRetentionDays}
              min={0}
              max={365}
              suffix={t('dias')}
              hint={t(
                'Limpa os torrents/segmentos baixados quando ficarem sem uso por esse período. 0 desativa.'
              )}
              onCommit={(value) =>
                saveSettings.mutate({ torrentCacheRetentionDays: value })
              }
            />
            <NumberSetting
              id="novel-cache-retention"
              label={t('Guardar cache de prévias por')}
              value={settings.novelCacheRetentionHours}
              min={1}
              max={720}
              suffix={t('horas')}
              hint={t(
                'Listas de capítulos usadas nas prévias ficam salvas para abrir mesmo quando o site está lento ou bloqueado. Os capítulos para leitura offline são configurados na seção Capítulos offline.'
              )}
              onCommit={(value) => saveSettings.mutate({ novelCacheRetentionHours: value })}
            />
            <NumberSetting
              id="novel-cache-cleanup"
              label={t('Limpeza automática do cache de novels')}
              value={settings.novelCacheCleanupHours}
              min={1}
              max={168}
              suffix={t('horas')}
              hint={t(
                'De quanto em quanto tempo o app remove do cache as novels mais antigas que o período acima.'
              )}
              onCommit={(value) => saveSettings.mutate({ novelCacheCleanupHours: value })}
            />
          </div>
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-line/70 bg-elevated/40 p-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
              checked={settings.autoMaintenanceEnabled}
              onChange={(event) =>
                saveSettings.mutate({ autoMaintenanceEnabled: event.target.checked })
              }
            />
            <span>
              <span className="block text-xs font-medium text-fg">{t('Manutenção automática')}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">
                {t(
                  'Remove temporários antigos do navegador, caches de torrents sem uso e o cache de novels conforme o intervalo configurado. Nunca interrompe um stream em andamento.'
                )}
              </span>
            </span>
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {t(
              'Caches de addons, catálogos e metadados também são reaproveitados automaticamente. As páginas e os arquivos com hash usam cache de longo prazo; o HTML continua sempre fresco.'
            )}
          </p>
        </Section>

        <StorageSection />
        <NovelOfflineSection />

        <Section
          title={t('Backup e portabilidade')}
          description={t(
            'Exporte e importe fontes, categorias personalizadas e configurações em JSON. Chaves, caches e dados do Stremio ficam de fora.'
          )}
          icon={<Download className="h-4 w-4" />}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void exportBackup()}
              loading={backupBusy}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              {t('Exportar JSON')}
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => backupFileRef.current?.click()}
              disabled={backupBusy}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {t('Importar JSON')}
            </Button>
            <input
              ref={backupFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void selectBackupFile(event)}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {t(
              'O backup inclui o progresso de leitura das novels que fica salvo no config das fontes. A importação mescla os dados: fontes com o mesmo ID são atualizadas e as demais são criadas.'
            )}
          </p>
          <SuccessNote message={backupMessage} />
          <ErrorBanner message={backupError} />
        </Section>
          </>
        ) : null}

        <ErrorBanner message={saveSettings.error instanceof Error ? saveSettings.error.message : null} />

        <Modal
          open={Boolean(pendingBackup)}
          onClose={() => setPendingBackup(null)}
          title={t('Importar backup?')}
          description={t(
            'Confira o resumo antes de importar. Fontes existentes com o mesmo ID serão atualizadas; as demais serão criadas.'
          )}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingBackup(null)}>
                {t('Cancelar')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void confirmBackupImport()}
                loading={backupBusy}
                icon={<Upload className="h-4 w-4" />}
              >
                {t('Importar backup')}
              </Button>
            </>
          }
        >
          {pendingBackup ? (
            <div className="space-y-3 text-xs text-muted">
              <p>
                {t('Exportado em')}{' '}
                <span className="font-medium text-fg">
                  {formatRelative(pendingBackup.preview.exportedAt)}
                </span>
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-line/60 bg-bg/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-faint">
                    {t('Fontes')}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-fg">
                    {pendingBackup.preview.sources.total}
                  </p>
                  <p className="text-[10px] text-faint">
                    {pendingBackup.preview.sources.new} {t('nova(s)')} ·{' '}
                    {pendingBackup.preview.sources.existing} {t('existente(s)')}
                  </p>
                </div>
                <div className="rounded-xl border border-line/60 bg-bg/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-faint">
                    {t('Categorias')}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-fg">
                    {pendingBackup.preview.categories.total}
                  </p>
                  <p className="text-[10px] text-faint">
                    {pendingBackup.preview.categories.new} {t('nova(s)')} ·{' '}
                    {pendingBackup.preview.categories.existing} {t('existente(s)')}
                  </p>
                </div>
                <div className="rounded-xl border border-line/60 bg-bg/40 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-faint">
                    {t('Configurações')}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-fg">
                    {pendingBackup.preview.settingsFields}
                  </p>
                  <p className="text-[10px] text-faint">{t('campo(s)')}</p>
                </div>
              </div>
            </div>
          ) : null}
        </Modal>

        <div className="mt-6">
          <h2 className="text-base font-semibold text-fg">{t('Apoio')}</h2>
          <div className="mt-3 flex flex-col gap-4 rounded-xl border border-line/70 bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">
                {t('Apoiar o {app}', { app: appBrand(language).name })}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-faint">
                {t('Ajude a manter o projeto vivo e crescendo, no Ko-fi')}
              </p>
            </div>
            <Button
              variant="subtle"
              size="sm"
              className="shrink-0 text-fg ring-1 ring-accent/60 hover:ring-accent"
              icon={<Heart className="h-3.5 w-3.5 text-rose-400" />}
              onClick={() => window.open(KOFI_URL, '_blank', 'noopener')}
            >
              {t('Apoie a gente')}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-line/70 bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img
              src={appBrand(language).logo}
              alt=""
              aria-hidden="true"
              className="h-10 w-10 shrink-0 object-contain"
            />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-fg">
                {appBrand(language).name}{' '}
                <span className="font-normal text-faint">v{__APP_VERSION__}</span>
              </p>
              <p className="text-[11px] text-faint">
                © 2026 Minha Bolha (My Bubble) · GPL-3.0
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {window.hubDesktop?.isDesktop ? (
              <Button
                variant="subtle"
                size="sm"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => window.dispatchEvent(new Event('hub:check-updates'))}
              >
                {t('Verificar atualizações')}
              </Button>
            ) : null}
            <Button
              variant="subtle"
              size="sm"
              icon={<Info className="h-3.5 w-3.5" />}
              onClick={() => setAboutOpen(true)}
            >
              {t('Sobre')}
            </Button>
          </div>
        </div>

        <Modal
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          title={t('Sobre o app')}
          footer={
            <Button variant="subtle" onClick={() => setAboutOpen(false)}>
              {t('Fechar')}
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img
                src={appBrand(language).logo}
                alt=""
                aria-hidden="true"
                className="h-14 w-14 shrink-0 object-contain"
              />
              <div className="leading-tight">
                <p className="text-lg font-semibold text-fg">{appBrand(language).name}</p>
                <p className="text-xs text-faint">v{__APP_VERSION__}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted">
              {t(
                'Agregador pessoal de feeds, lançamentos, novels, notícias e preços de jogos. Dados 100% locais em SQLite.'
              )}
            </p>
            <div className="space-y-1.5 rounded-xl border border-line/70 bg-bg/40 p-3 text-xs leading-relaxed text-muted">
              <p>Copyright (C) 2026 Minha Bolha (My Bubble).</p>
              <p>{t('Licenciado sob a GNU General Public License v3.0 (GPL-3.0-only).')}</p>
              <p>
                {t(
                  'Software livre: você pode usar, estudar, modificar e redistribuir sob os termos da GPL-3.0.'
                )}
              </p>
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-1 text-accent hover:underline"
                onClick={() =>
                  window.open('https://www.gnu.org/licenses/gpl-3.0.html', '_blank', 'noopener')
                }
              >
                {t('Ler a licença')} <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            {window.hubDesktop ? (
              <p className="text-[11px] text-faint">
                Electron {window.hubDesktop.electronVersion} · Chromium{' '}
                {window.hubDesktop.chromeVersion}
              </p>
            ) : null}
            <Button
              variant="subtle"
              size="sm"
              icon={<Heart className="h-3.5 w-3.5" />}
              onClick={() => window.open(KOFI_URL, '_blank', 'noopener')}
            >
              {t('Apoie o projeto no Ko-fi')}
            </Button>
          </div>
        </Modal>

        <SourceFormModal
          open={sourceFormOpen}
          onClose={() => setSourceFormOpen(false)}
          defaultType={sourceFormType}
        />
      </div>
    </div>
  );
}

/** Linha editável de uma chave de API (valor nunca vem do backend). */
function SecretRow({
  secret,
  description,
  docsUrl
}: {
  secret: SecretStatusDto;
  description: string;
  docsUrl: string;
}) {
  const { t } = useI18n();
  const save = useSetSecret();
  const remove = useDeleteSecret();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      await save.mutateAsync({ id: secret.id, value: value.trim() });
      setValue('');
      setMessage(
        secret.id === 'ggdeals'
          ? t('Chave salva. A fonte de preços foi criada ou reativada.')
          : t('Chave salva.')
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('Não foi possível salvar a chave.')
      );
    }
  };

  const clear = async (): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const result = await remove.mutateAsync(secret.id);
      const updated = result.secrets.find((item) => item.id === secret.id);
      setMessage(
        updated?.configured
          ? t('Chave removida do app; o valor do .env voltou a valer.')
          : t('Chave removida.')
      );
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : t('Não foi possível remover a chave.')
      );
    }
  };

  const statusLabel = secret.configured
    ? secret.source === 'app'
      ? t('salva no app')
      : t('do .env')
    : t('não configurada');

  return (
    <div className="rounded-xl border border-line/70 bg-bg/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg">
            {secret.label}{' '}
            <span className="font-mono text-[10px] font-normal text-faint">{secret.envVar}</span>
          </p>
          <p className="text-[11px] text-faint">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              secret.configured ? 'bg-success/15 text-success' : 'bg-elevated text-faint'
            )}
          >
            {statusLabel}
          </span>
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-[10px] text-faint transition hover:text-fg"
          >
            {t('Onde obter')} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {secret.configured ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted">
          {secret.masked}
          {secret.source === 'env' ? (
            <span className="font-sans text-[10px] text-faint">· {t('fallback do .env; salvar aqui substitui')}</span>
          ) : null}
        </p>
      ) : null}

      {secret.formatValid === false ? (
        <p className="mt-1.5 rounded-lg border border-warning/30 bg-warning/5 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
          {secret.id === 'steam'
            ? t(
                'A chave salva não tem o formato esperado (32 caracteres hexadecimais). Copie novamente em steamcommunity.com/dev/apikey e substitua abaixo.'
              )
            : t('O formato desta chave não parece válido. Substitua abaixo.')}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="password"
          className="field-input min-w-[12rem] flex-1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={
            secret.configured ? t('Nova chave (substituir)') : t('Cole a chave aqui')
          }
          autoComplete="off"
          spellCheck={false}
          aria-label={t('Nova chave {name}', { name: secret.label })}
        />
        <Button
          variant="subtle"
          size="sm"
          onClick={() => void submit()}
          loading={save.isPending}
          disabled={value.trim().length < 4}
        >
          {t('Salvar')}
        </Button>
        {secret.source === 'app' ? (
          <Button variant="danger" size="sm" onClick={() => void clear()} loading={remove.isPending}>
            {t('Remover')}
          </Button>
        ) : null}
      </div>

      <div className="mt-2 space-y-2">
        <ErrorBanner message={error} />
        <SuccessNote message={message} />
      </div>
    </div>
  );
}
