/** Formulário de criação/edição de fonte (YouTube, RSS, TMDB e AniList). */
import { useEffect, useState } from 'react';
import { Check, FlaskConical, Plus, Search } from 'lucide-react';
import {
  INTERVAL_OPTIONS,
  MEDIA_KIND_LABELS,
  SOURCE_TYPES,
  type MediaSearchResultDto,
  type ResolvedSourceDto,
  type SourceDto,
  type SourceType
} from '@hub/shared';
import { Button, ErrorBanner, Field, Modal, SuccessNote } from '@/components/ui';
import { AppIcon } from '@/components/AppIcon';
import { useI18n } from '@/lib/i18n';
import { cn, formatInterval, formatRelative } from '@/lib/utils';
import {
  useCategories,
  useCreateCategory,
  useCreateSource,
  useMediaSearch,
  useResolveSource,
  useSettings,
  useUpdateSource
} from '@/lib/queries';

interface SourceFormModalProps {
  open: boolean;
  onClose: () => void;
  source?: SourceDto | null;
  defaultType?: SourceType;
}

const TYPE_ICON: Partial<Record<SourceType, string>> = {
  youtube: 'youtube',
  rss: 'rss',
  tmdb: 'film',
  anilist: 'sparkles',
  webnovel: 'book-open',
  custom: 'link',
  'steam-wishlist': 'gamepad-2',
  ggdeals: 'tags'
};

function inputOf(source: SourceDto): string {
  const config = source.config;
  const value = config.input ?? config.url ?? config.channelUrl ?? '';
  return typeof value === 'string' ? value : '';
}

function isMediaType(type: SourceType): type is 'tmdb' | 'anilist' {
  return type === 'tmdb' || type === 'anilist';
}

/** Tipos cujo intervalo é definido em Config → Sistema, não por fonte. */
const GLOBAL_SCHEDULE_TYPES = new Set<SourceType>([
  'youtube',
  'rss',
  'custom',
  'webnovel'
]);

export function SourceFormModal({ open, onClose, source, defaultType }: SourceFormModalProps) {
  const { t } = useI18n();
  const editing = Boolean(source);
  const categories = useCategories();
  const resolve = useResolveSource();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const createCategory = useCreateCategory();
  const mediaSearch = useMediaSearch();
  const settings = useSettings();
  const settingsInterval = settings.data?.defaultIntervalMinutes ?? 30;

  const [type, setType] = useState<SourceType>('youtube');
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('youtube');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [resolved, setResolved] = useState<ResolvedSourceDto | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [imdbId, setImdbId] = useState('');
  const usesGlobalSchedule = GLOBAL_SCHEDULE_TYPES.has(type);

  useEffect(() => {
    if (!open) return;
    const initialType = source?.type ?? defaultType ?? 'youtube';
    setType(initialType);
    setInput(source ? inputOf(source) : '');
    setName(source?.name ?? '');
    setCategoryId(source?.categoryId ?? SOURCE_TYPES[initialType].categoryId);
    setIntervalMinutes(source?.intervalMinutes ?? intervalFor(initialType, settingsInterval));
    setImdbId(
      source && typeof source.config.imdbIdOverride === 'string' ? source.config.imdbIdOverride : ''
    );
    setResolved(null);
    setTestError(null);
    setSaveError(null);
    setShowNewCategory(false);
    setNewCategoryLabel('');
    setSearchQuery('');
    setSearchError(null);
    mediaSearch.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source, defaultType]);

  const meta = SOURCE_TYPES[type];
  const mediaType = isMediaType(type);
  const results = mediaSearch.data?.results ?? [];
  const canSubmit = input.trim().length > 0 && categoryId.length > 0 && !createSource.isPending && !updateSource.isPending;

  const handleTypeChange = (next: SourceType): void => {
    if (!SOURCE_TYPES[next].available) return;
    setType(next);
    setCategoryId(SOURCE_TYPES[next].categoryId);
    setIntervalMinutes(intervalFor(next, settingsInterval));
    setResolved(null);
    setTestError(null);
    setInput('');
    setName('');
    setSearchQuery('');
    setSearchError(null);
    mediaSearch.reset();
  };

  const handleSearch = async (): Promise<void> => {
    if (type !== 'tmdb' && type !== 'anilist') return;
    if (searchQuery.trim().length < 2) return;
    setSearchError(null);
    try {
      await mediaSearch.mutateAsync({ provider: type, q: searchQuery.trim() });
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : t('Não foi possível buscar.'));
    }
  };

  const pickResult = (result: MediaSearchResultDto): void => {
    setInput(result.ref);
    setName(result.title);
    setCategoryId(result.mediaType === 'movie' ? 'movie' : result.mediaType === 'series' ? 'series' : 'anime');
    setResolved(null);
    setTestError(null);
  };

  const handleTest = async (): Promise<void> => {
    setTestError(null);
    setResolved(null);
    try {
      const result = await resolve.mutateAsync({ type, input: input.trim() });
      setResolved(result);
      if (!name.trim()) setName(result.name);
      if (!editing) setCategoryId(result.categoryId);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : t('Não foi possível testar a fonte.'));
    }
  };

  const handleSave = async (): Promise<void> => {
    setSaveError(null);
    try {
      if (editing && source) {
        const body: {
          name?: string;
          categoryId?: string;
          intervalMinutes?: number;
          input?: string;
          imdbId?: string;
        } = {
          name: name.trim() || source.name,
          categoryId,
          ...(usesGlobalSchedule ? {} : { intervalMinutes })
        };
        const nextInput = input.trim();
        if (nextInput && nextInput !== inputOf(source)) body.input = nextInput;
        if (type === 'anilist') body.imdbId = imdbId.trim();
        await updateSource.mutateAsync({ id: source.id, body });
      } else {
        await createSource.mutateAsync({
          type,
          input: input.trim(),
          name: name.trim() || undefined,
          categoryId,
          ...(usesGlobalSchedule ? {} : { intervalMinutes }),
          ...(type === 'anilist' ? { imdbId: imdbId.trim() } : {})
        });
      }
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('Não foi possível salvar a fonte.'));
    }
  };

  const handleCreateCategory = async (): Promise<void> => {
    const label = newCategoryLabel.trim();
    if (!label) return;
    try {
      const category = await createCategory.mutateAsync({ label });
      setCategoryId(category.id);
      setNewCategoryLabel('');
      setShowNewCategory(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('Não foi possível criar a categoria.'));
    }
  };

  const availableTypes = (Object.entries(SOURCE_TYPES) as Array<[SourceType, (typeof SOURCE_TYPES)[SourceType]]>).filter(
    ([, item]) => !item.autoManaged
  );
  const providerLabel = type === 'tmdb' ? t('filme ou série') : 'anime';

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? t('Editar fonte') : t('Adicionar fonte')}
      description={
        editing
          ? t(
              usesGlobalSchedule
                ? 'Altere nome, categoria ou URL. Trocar a URL faz o Hub resolver tudo de novo.'
                : 'Altere nome, categoria, intervalo ou URL. Trocar a URL faz o Hub resolver tudo de novo.'
            )
          : t(
              'Busque um título ou cole a URL de um canal, feed ou página de novel. O Hub resolve e já busca os dados.'
            )
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={!canSubmit}
            loading={createSource.isPending || updateSource.isPending}
          >
            {editing ? t('Salvar alterações') : t('Adicionar fonte')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!editing ? (
          <div>
            <p className="field-label">{t('Tipo de fonte')}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {availableTypes.map(([key, item]) => {
                const active = key === type;
                const disabled = !item.available;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleTypeChange(key)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-xl border p-3 text-left transition',
                      active
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-line bg-bg/40 hover:border-line hover:bg-elevated/60',
                      disabled && 'cursor-not-allowed opacity-45 hover:border-line hover:bg-bg/40'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-elevated',
                        active ? 'text-accent' : 'text-muted'
                      )}
                    >
                      <AppIcon name={TYPE_ICON[key] ?? 'link'} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                        {t(item.shortLabel)}
                        {disabled ? (
                          <span className="rounded bg-elevated px-1 py-0.5 text-[9px] font-medium uppercase text-faint">
                            {t('fase')} {item.phase}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-faint">{t(item.description)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {mediaType ? (
          <div className="space-y-2">
            <Field label={`${t('Buscar')} ${t(providerLabel)}`} htmlFor="media-search" hint={t('Selecione um resultado para preencher a fonte.')}>
              <div className="flex gap-2">
                <input
                  id="media-search"
                  className="field-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSearch();
                    }
                  }}
                  placeholder={type === 'tmdb' ? t('Ex.: Duna, Severance, Cidade de Deus') : t('Ex.: Frieren, One Piece')}
                  autoFocus={!editing}
                />
                <Button
                  variant="subtle"
                  onClick={() => void handleSearch()}
                  loading={mediaSearch.isPending}
                  disabled={searchQuery.trim().length < 2}
                  icon={<Search className="h-4 w-4" />}
                  className="shrink-0"
                >
                  {t('Buscar')}
                </Button>
              </div>
            </Field>

            <ErrorBanner message={searchError} />

            {results.length > 0 ? (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line bg-bg/40 p-1.5">
                {results.map((result) => {
                  const selected = input === result.ref;
                  return (
                    <li key={result.ref}>
                      <button
                        type="button"
                        onClick={() => pickResult(result)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition',
                          selected ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-elevated'
                        )}
                      >
                        <span className="h-12 w-8 shrink-0 overflow-hidden rounded bg-elevated">
                          {result.posterUrl ? (
                            <img
                              src={result.posterUrl}
                              alt=""
                              loading="eager"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-fg">{result.title}</span>
                          <span className="block truncate text-[10px] text-faint">
                            {[t(MEDIA_KIND_LABELS[result.mediaType]), result.year, result.originalTitle]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {!mediaSearch.isPending && mediaSearch.isSuccess && results.length === 0 ? (
              <p className="text-[11px] text-faint">{t('Nenhum resultado. Tente outro nome.')}</p>
            ) : null}
          </div>
        ) : null}

        <Field
          label={mediaType ? t('Ou cole um link') : editing ? t('URL / identificador') : t('URL')}
          hint={t(meta.hint)}
          htmlFor="source-input"
        >
          <input
            id="source-input"
            className="field-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              type === 'tmdb'
                ? 'https://www.imdb.com/title/tt0111161/'
                : type === 'anilist'
                  ? 'https://anilist.co/anime/21'
                  : type === 'webnovel'
                    ? 'https://www.royalroad.com/fiction/… ou https://www.webnovel.com/pt/book/…'
                    : type === 'custom'
                      ? 'https://site.com/pagina-que-quero-acompanhar'
                      : 'https://www.youtube.com/@canal ou https://site.com/feed'
            }
            autoFocus={!editing && !mediaType}
            spellCheck={false}
          />
        </Field>

        <div className="flex items-center gap-2">
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void handleTest()}
            loading={resolve.isPending}
            disabled={!input.trim()}
            icon={<FlaskConical className="h-3.5 w-3.5" />}
          >
            {t('Testar conexão')}
          </Button>
          <span className="text-[11px] text-faint">{t('Recomendado antes de salvar.')}</span>
        </div>

        {type === 'anilist' ? (
          <Field
            label={t('ID do IMDB (opcional)')}
            htmlFor="source-imdb"
            hint={t(
              'Usado no botão “Abrir no Stremio”. Ex.: tt1234567. Vazio = o Hub tenta descobrir pelo título no TMDB.'
            )}
          >
            <input
              id="source-imdb"
              className="field-input"
              value={imdbId}
              onChange={(event) => setImdbId(event.target.value)}
              placeholder="tt1234567"
              spellCheck={false}
            />
          </Field>
        ) : null}

        <ErrorBanner message={testError} />

        {resolved ? (
          <div className="space-y-2 rounded-xl border border-success/25 bg-success/5 p-3">
            <SuccessNote message={`${t('Encontrado:')} ${resolved.name}`} />
            {type === 'custom' ? (
              <div className="flex gap-2.5 rounded-lg border border-line/60 bg-bg/40 p-2">
                {typeof resolved.config.image === 'string' && resolved.config.image ? (
                  <img
                    src={resolved.config.image}
                    alt=""
                    className="h-16 w-24 shrink-0 rounded-md object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-faint">
                    {t('Prévia da página')}
                  </p>
                  <p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-muted">
                    {typeof resolved.config.description === 'string' && resolved.config.description
                      ? resolved.config.description
                      : t('Essa página não informou uma descrição. O título será usado como resumo.')}
                  </p>
                </div>
              </div>
            ) : null}
            {resolved.samples.length > 0 ? (
              <ul className="space-y-1 text-[11px] text-muted">
                {resolved.samples.map((sample) => (
                  <li key={sample.url + sample.title} className="flex gap-2">
                    <span className="text-faint">•</span>
                    <span className="min-w-0 flex-1 truncate">{sample.title}</span>
                    <span className="shrink-0 text-faint">{formatRelative(sample.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-faint">
                {type === 'steam-wishlist'
                  ? t('Perfil encontrado. A importação da wishlist começa ao salvar.')
                  : t('Nenhum lançamento futuro encontrado.')}
              </p>
            )}
            <p className="text-[11px] text-faint">
              {t('Revise as informações e clique em')}{' '}
              “{editing ? t('Salvar alterações') : t('Adicionar fonte')}” {t('para confirmar.')}
            </p>
          </div>
        ) : null}

        <div className={usesGlobalSchedule ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
          <Field label={t('Nome exibido')} htmlFor="source-name" hint={t('Opcional — usamos o nome detectado se ficar vazio.')}>
            <input
              id="source-name"
              className="field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={resolved?.name ?? t('Ex.: Meu canal favorito')}
            />
          </Field>

          {usesGlobalSchedule ? (
            <Field label={t('Intervalo de verificação')} htmlFor="source-interval">
              <div className="rounded-lg border border-line bg-elevated/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
                {type === 'webnovel'
                  ? t(
                      'Controlado em Config → Sistema → Atualizar as novels a cada ({value} min).',
                      { value: settings.data?.novelRefreshMinutes ?? 60 }
                    )
                  : t(
                      'Controlado em Config → Sistema → Atualizar o feed a cada ({value} s).',
                      { value: settings.data?.feedRefreshSeconds ?? 60 }
                    )}
              </div>
            </Field>
          ) : (
            <Field label={t('Intervalo de verificação')} htmlFor="source-interval">
              <select
                id="source-interval"
                className="field-input"
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              >
                {[...new Set([...INTERVAL_OPTIONS, intervalMinutes])].sort((a, b) => a - b).map((value) => (
                  <option key={value} value={value}>
                    {formatInterval(value)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field label={t('Categoria')} htmlFor="source-category" hint={t('Define a aba do feed onde os itens aparecem.')}>
          <div className="flex gap-2">
            <select
              id="source-category"
              className="field-input"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {t(category.label)}
                  {category.isSystem ? '' : ` (${t('personalizada')})`}
                </option>
              ))}
            </select>
            <Button
              variant="subtle"
              size="md"
              onClick={() => setShowNewCategory((value) => !value)}
              icon={<Plus className="h-4 w-4" />}
              className="shrink-0"
            >
              {t('Nova')}
            </Button>
          </div>
        </Field>

        {showNewCategory ? (
          <div className="flex gap-2 rounded-xl border border-line bg-bg/50 p-3">
            <input
              className="field-input"
              value={newCategoryLabel}
              onChange={(event) => setNewCategoryLabel(event.target.value)}
              placeholder={t('Nome da nova categoria (ex.: Podcasts)')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreateCategory();
              }}
            />
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleCreateCategory()}
              loading={createCategory.isPending}
              disabled={newCategoryLabel.trim().length < 2}
              className="shrink-0"
            >
              {t('Criar')}
            </Button>
          </div>
        ) : null}

        <ErrorBanner message={saveError} />
      </div>
    </Modal>
  );
}

/** Intervalo inicial por tipo: mídia e preços mudam pouco, então começam mais devagar. */
function intervalFor(type: SourceType, settingsDefault: number): number {
  if (type === 'tmdb' || type === 'steam-wishlist' || type === 'ggdeals') return 360;
  if (type === 'anilist') return 180;
  if (type === 'webnovel') return 60;
  return settingsDefault;
}
