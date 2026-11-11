/** Calendário de lançamentos: visão mensal e próximos 30 dias. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek
} from 'date-fns';
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  Globe2,
  Library,
  List,
  RefreshCw,
  Search,
  Sparkles,
  Tv,
  X
} from 'lucide-react';
import {
  MEDIA_KIND_LABELS,
  RELEASE_KIND_LABELS,
  type MediaKind,
  type ReleaseEventDto
} from '@hub/shared';
import { Button, Chip, EmptyState, ErrorBanner, InfoBanner, PageHeader, SuccessNote } from '@/components/ui';
import { StremioBadge } from '@/components/stremio/StremioBadge';
import { useCalendar, useCalendarSearch, useSettings, useSources } from '@/lib/queries';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { MEDIA_COLORS, cn, dateInZone, getDateLocale } from '@/lib/utils';

const WEEKDAYS_BY_LANGUAGE = {
  pt: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  es: ['D', 'L', 'M', 'X', 'J', 'V', 'S']
} as const;
const CALENDAR_SCOPE_KEY = 'hub.calendarScope';

function readScope(): 'global' | 'library' {
  try {
    return window.localStorage.getItem(CALENDAR_SCOPE_KEY) === 'library' ? 'library' : 'global';
  } catch {
    return 'global';
  }
}

const FILTERS: Array<{ id: 'all' | MediaKind; label: string; icon?: typeof Film }> = [
  { id: 'all', label: 'Todos' },
  { id: 'movie', label: 'Filmes', icon: Film },
  { id: 'series', label: 'Séries', icon: Tv },
  { id: 'anime', label: 'Animes', icon: Sparkles }
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function episodeCode(event: ReleaseEventDto): string | null {
  if (event.kind !== 'episode' && event.kind !== 'airing') return null;
  if (event.episode === null) return null;
  return event.season !== null ? `S${event.season}E${event.episode}` : `E${event.episode}`;
}

function EventRow({ event, highlighted = false }: { event: ReleaseEventDto; highlighted?: boolean }) {
  const { t } = useI18n();
  const color = MEDIA_COLORS[event.mediaKind] ?? '#8b96a8';
  const code = episodeCode(event);

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-xl border p-2.5 transition',
        highlighted
          ? 'border-accent/60 bg-accent/10 ring-1 ring-inset ring-accent/30'
          : 'border-line/60 bg-bg/40 hover:border-accent/30 hover:bg-elevated/50'
      )}
    >
      <a
        href={event.url ?? '#'}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-line/60 bg-elevated">
          {event.posterUrl ? (
            <img
              src={event.posterUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ backgroundImage: `linear-gradient(135deg, ${color}33, transparent)` }}
            >
              <CalendarDays className="h-4 w-4" style={{ color }} />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip color={color}>{t(MEDIA_KIND_LABELS[event.mediaKind])}</Chip>
            <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
              {t(RELEASE_KIND_LABELS[event.kind])}
              {event.region ? ` · ${event.region}` : ''}
            </span>
            {event.releaseTime ? (
              <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                {event.releaseTime}
              </span>
            ) : null}
            {event.inStremioLibrary ? <StremioBadge /> : null}
            {highlighted ? (
              <span className="inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                <Search className="h-2.5 w-2.5" /> {t('resultado')}
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-xs font-semibold text-fg">{event.title}</p>
          <p className="truncate text-[11px] text-muted">
            {[code, event.episodeTitle, event.sourceName].filter(Boolean).join(' · ')}
          </p>
        </div>
      </a>

      <div className="flex shrink-0 items-center gap-0.5">
        <a
          href={event.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          aria-label={t('Abrir link original')}
          title={t('Abrir link original')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const { t, language } = useI18n();
  const dateLocale = getDateLocale();
  const monthPattern = language === 'en' ? 'MMMM yyyy' : "MMMM 'de' yyyy";
  const dayPattern = language === 'en' ? 'EEEE, MMMM d' : "EEEE, d 'de' MMMM";
  const shortDayPattern = language === 'en' ? 'MMM d' : "d 'de' MMM";
  const ariaDayPattern = language === 'en' ? 'MMMM d' : "d 'de' MMMM";
  const weekdays = WEEKDAYS_BY_LANGUAGE[language];
  const settings = useSettings();
  const sourcesQuery = useSources();
  const timeZone = settings.data?.timezone ?? 'America/Sao_Paulo';
  const today = dateInZone(new Date(), timeZone);

  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<'month' | 'list'>('month');
  const [scope, setScope] = useState<'global' | 'library'>(readScope);
  const [filter, setFilter] = useState<'all' | MediaKind>('all');
  const [selectedDay, setSelectedDay] = useState(today);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const lastNavigatedSearch = useRef<string | null>(null);
  const dayPanelRef = useRef<HTMLDivElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CALENDAR_SCOPE_KEY, scope);
    } catch {
      // storage indisponível: mantém o padrão global
    }
  }, [scope]);

  const mediaSources = (sourcesQuery.data ?? []).filter(
    (source) => source.type === 'tmdb' || source.type === 'anilist'
  );
  const failedMedia = mediaSources.filter((source) => source.lastErrorCode);
  const hasMediaSources = mediaSources.length > 0;

  const globalSource = (sourcesQuery.data ?? []).find(
    (source) => source.type === 'global-releases'
  );
  const globalError =
    scope === 'global' &&
    globalSource?.lastErrorCode !== null &&
    globalSource?.lastErrorCode !== undefined
      ? `${globalSource.name}: ${globalSource.lastErrorMessage ?? t('falha ao sincronizar.')}`
      : null;

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchTerm(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const searchQuery = useCalendarSearch(searchTerm, scope);
  const searchResults = searchQuery.data?.events ?? [];
  const searchIds = useMemo(() => new Set(searchResults.map((event) => event.id)), [searchResults]);
  // Prioriza o próximo resultado a partir de hoje; se só houver passados, usa o mais recente.
  const firstSearchResult = useMemo(() => {
    if (searchResults.length === 0) return null;
    return searchResults.find((event) => event.releaseDate >= today) ?? searchResults[searchResults.length - 1] ?? null;
  }, [searchResults, today]);

  // Ao encontrar resultados, vai para o mês/dia do primeiro e muda para a
  // visão mensal; assim o destaque fica visível no calendário e na lista.
  useEffect(() => {
    if (!searchTerm) {
      lastNavigatedSearch.current = null;
      return;
    }
    if (!firstSearchResult) return;
    const key = `${scope}:${firstSearchResult.id}`;
    if (lastNavigatedSearch.current === key) return;
    lastNavigatedSearch.current = key;
    setView('month');
    setCursor(parseISO(firstSearchResult.releaseDate));
    setSelectedDay(firstSearchResult.releaseDate);
    const timer = window.setTimeout(() => {
      dayPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm, scope, firstSearchResult]);

  const goToFirstResult = (): void => {
    if (!firstSearchResult) return;
    setView('month');
    setCursor(parseISO(firstSearchResult.releaseDate));
    setSelectedDay(firstSearchResult.releaseDate);
    window.setTimeout(() => {
      dayPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  };

  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
  const gridStartStr = format(gridStart, 'yyyy-MM-dd');
  const gridEndStr = format(gridEnd, 'yyyy-MM-dd');
  const listEndStr = format(addDays(parseISO(today), 29), 'yyyy-MM-dd');

  const types: MediaKind[] = filter === 'all' ? [] : [filter];

  const monthQuery = useCalendar(gridStartStr, gridEndStr, types, scope, view === 'month');
  const listQuery = useCalendar(today, listEndStr, types, scope, view === 'list');

  const activeQuery = view === 'month' ? monthQuery : listQuery;
  const events = activeQuery.data?.events ?? [];

  const byDay = useMemo(() => {
    const map = new Map<string, ReleaseEventDto[]>();
    for (const event of events) {
      const list = map.get(event.releaseDate);
      if (list) list.push(event);
      else map.set(event.releaseDate, [event]);
    }
    return map;
  }, [events]);

  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStartStr, gridEndStr]);
  const selectedEvents = byDay.get(selectedDay) ?? [];
  // Com busca ativa, os resultados aparecem primeiro na lista do dia.
  const orderedSelectedEvents =
    searchIds.size > 0
      ? [...selectedEvents].sort(
          (a, b) => Number(searchIds.has(b.id)) - Number(searchIds.has(a.id))
        )
      : selectedEvents;

  const listGroups = useMemo(() => {
    if (view !== 'list') return [];
    return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [byDay, view]);

  const changeMonth = (delta: number): void => {
    const next = addMonths(cursor, delta);
    setCursor(next);
    setSelectedDay(isSameMonth(next, new Date()) ? today : format(startOfMonth(next), 'yyyy-MM-dd'));
  };

  const goToday = (): void => {
    setCursor(new Date());
    setSelectedDay(today);
  };

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshMessage(null);
    try {
      if (scope === 'library') {
        await activeQuery.refetch();
        setRefreshMessage(t('Calendário da biblioteca atualizado.'));
      } else {
        await api.refreshCalendar();
        setRefreshMessage(
          t('Atualização do calendário global iniciada. Os lançamentos aparecem em instantes.')
        );
      }
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : t('Não foi possível atualizar o calendário.')
      );
    } finally {
      setRefreshing(false);
    }
  };

  // O calendário é global: não depende das fontes acompanhadas. A fonte
  // "Calendário global" é criada automaticamente e sincroniza em segundo plano.
  return (
    <div>
      <PageHeader
        eyebrow={t('Lançamentos')}
        title={t('Calendário')}
        description={
          scope === 'global'
            ? t(
                'Lançamentos de filmes, séries e animes de todo o catálogo, independentes da sua biblioteca.'
              )
            : t(
                'Lançamentos dos filmes, séries e animes que você acompanha na sua biblioteca.'
              )
        }
        actions={
          <Button
            variant="subtle"
            size="sm"
            onClick={() => void handleRefresh()}
            loading={refreshing}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            {t('Atualizar')}
          </Button>
        }
      />

      <SuccessNote message={refreshMessage} />
      <ErrorBanner message={refreshError} />

      <div className="mb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="field-input h-10 pl-9 pr-9"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setSearchTerm(searchInput.trim());
              }
            }}
            placeholder={
              scope === 'global'
                ? t('Buscar título no calendário global')
                : t('Buscar na minha biblioteca')
            }
            aria-label={t('Buscar título no calendário')}
            spellCheck={false}
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearchTerm('');
                lastNavigatedSearch.current = null;
              }}
              aria-label={t('Limpar busca')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {searchTerm.length >= 2 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            {searchQuery.isLoading ? (
              <span className="text-faint">{t('Buscando…')}</span>
            ) : searchQuery.isError ? (
              <span className="text-warning">{t('Não foi possível buscar agora.')}</span>
            ) : searchResults.length > 0 && firstSearchResult ? (
              <>
                <span className="text-muted">
                  <span className="font-semibold text-fg">{searchResults.length}</span>{' '}
                  {t('resultado(s)')}
                </span>
                <span className="text-faint">
                  {t('resultado em')}{' '}
                  {format(parseISO(firstSearchResult.releaseDate), shortDayPattern, {
                    locale: dateLocale
                  })}
                </span>
                <button
                  type="button"
                  onClick={goToFirstResult}
                  className="font-medium text-accent hover:underline"
                >
                  {t('Ir para o resultado')}
                </button>
              </>
            ) : (
              <span className="text-warning">
                {t('Nenhum título encontrado para')} “{searchTerm}”.
              </span>
            )}
          </div>
        ) : null}
      </div>

      {globalError ? (
        <div className="mb-3">
          <ErrorBanner message={globalError} />
        </div>
      ) : null}

      {scope === 'library' && failedMedia.length > 0 ? (
        <div className="mb-3">
          <ErrorBanner
            message={`${failedMedia[0]!.name}: ${failedMedia[0]!.lastErrorMessage ?? t('falha ao sincronizar este título.')}`}
          />
        </div>
      ) : null}

      {scope === 'library' && !sourcesQuery.isLoading && !hasMediaSources ? (
        <div className="mb-3">
          <InfoBanner
            message={t(
              'Nenhum título acompanhado. Adicione filmes, séries ou animes em Fontes ou volte para o calendário global.'
            )}
            action={
              <Link
                to="/sources"
                className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
              >
                {t('Ver fontes')}
              </Link>
            }
          />
        </div>
      ) : null}

      {view === 'month' && !activeQuery.isLoading && events.length === 0 ? (
        <div className="mb-3">
          <InfoBanner
            message={
              scope === 'global'
                ? t(
                    'Nenhum lançamento global neste período. Clique em Atualizar para sincronizar com o TMDB/AniList; a fonte também roda sozinha a cada 6 horas.'
                  )
                : t(
                    'Nenhum lançamento dos títulos que você acompanha neste período. Adicione títulos em Fontes ou troque para o calendário global.'
                  )
            }
            action={
              scope === 'global' ? (
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
                >
                  {t('Atualizar')}
                </button>
              ) : (
                <Link
                  to="/sources"
                  className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
                >
                  {t('Ver fontes')}
                </Link>
              )
            }
          />
        </div>
      ) : null}

      {/* Controles */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                  active
                    ? 'border-accent/40 bg-accent/10 text-fg'
                    : 'border-transparent text-muted hover:bg-elevated hover:text-fg'
                )}
                aria-pressed={active}
              >
                {item.icon ? <item.icon className="h-3 w-3" /> : null}
                {t(item.label)}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-bg/50 p-0.5">
            <button
              type="button"
              onClick={() => setScope('global')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
                scope === 'global' ? 'bg-elevated text-fg shadow-sm' : 'text-faint hover:text-muted'
              )}
              aria-pressed={scope === 'global'}
              title={t('Lançamentos de todo o catálogo, independente da sua biblioteca')}
            >
              <Globe2 className="h-3.5 w-3.5" />
              {t('Global')}
            </button>
            <button
              type="button"
              onClick={() => setScope('library')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
                scope === 'library' ? 'bg-elevated text-fg shadow-sm' : 'text-faint hover:text-muted'
              )}
              aria-pressed={scope === 'library'}
              title={t('Somente os títulos que você acompanha')}
            >
              <Library className="h-3.5 w-3.5" />
              {t('Minha biblioteca')}
            </button>
          </div>

          <div className="flex rounded-xl border border-line bg-bg/50 p-0.5">
            <button
              type="button"
              onClick={() => setView('month')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
                view === 'month' ? 'bg-elevated text-fg shadow-sm' : 'text-faint hover:text-muted'
              )}
              aria-pressed={view === 'month'}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {t('Mês')}
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition',
                view === 'list' ? 'bg-elevated text-fg shadow-sm' : 'text-faint hover:text-muted'
              )}
              aria-pressed={view === 'list'}
            >
              <List className="h-3.5 w-3.5" />
              {t('Próximos 30 dias')}
            </button>
          </div>
        </div>
      </div>

      {activeQuery.isError ? (
        <div className="mb-3 space-y-2">
          <ErrorBanner
            message={activeQuery.error instanceof Error ? activeQuery.error.message : t('Não foi possível carregar o calendário.')}
          />
          <Button variant="subtle" size="sm" onClick={() => void activeQuery.refetch()}>
            {t('Tentar novamente')}
          </Button>
        </div>
      ) : null}

      {view === 'month' ? (
        <div className="space-y-3">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/70 px-3 py-2.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => changeMonth(-1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-fg"
                  aria-label={t('Mês anterior')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="min-w-[9.5rem] text-center text-sm font-semibold text-fg">
                  {capitalize(format(monthStart, monthPattern, { locale: dateLocale }))}
                </h2>
                <button
                  type="button"
                  onClick={() => changeMonth(1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-elevated hover:text-fg"
                  aria-label={t('Próximo mês')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-faint sm:inline">
                  {events.length} {t(events.length === 1 ? 'lançamento' : 'lançamentos')}
                </span>
                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-elevated hover:text-fg"
                >
                  {t('Hoje')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px bg-line/40 p-px">
              {weekdays.map((day, index) => (
                <div
                  key={`${day}-${index}`}
                  className="bg-surface py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-faint"
                >
                  {day}
                </div>
              ))}

              {days.map((day) => {
                const dayStr = format(day, 'yyyy-MM-dd');
                const dayEvents = byDay.get(dayStr) ?? [];
                const inMonth = isSameMonth(day, monthStart);
                const isToday = dayStr === today;
                const isSelected = dayStr === selectedDay;
                const matchedEvents =
                  searchTerm.length >= 2 ? dayEvents.filter((event) => searchIds.has(event.id)) : [];
                const hasMatch = matchedEvents.length > 0;
                const displayTitle = hasMatch ? matchedEvents[0]!.title : dayEvents[0]?.title;

                return (
                  <button
                    key={dayStr}
                    type="button"
                    onClick={() => setSelectedDay(dayStr)}
                    aria-label={`${format(day, ariaDayPattern, { locale: dateLocale })} — ${dayEvents.length} ${t('lançamento(s)')}${
                      hasMatch ? `, ${matchedEvents.length} ${t('resultado(s) da busca')}` : ''
                    }`}
                    className={cn(
                      'relative flex min-h-[62px] flex-col items-start gap-1 bg-surface p-1.5 text-left transition sm:min-h-[78px]',
                      !inMonth && 'opacity-45',
                      hasMatch
                        ? 'bg-accent/15 ring-2 ring-inset ring-accent/60'
                        : isSelected
                          ? 'bg-accent/10 ring-1 ring-inset ring-accent/40'
                          : 'hover:bg-elevated/60'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                        isToday ? 'bg-accent text-accent-fg' : inMonth ? 'text-muted' : 'text-faint'
                      )}
                    >
                      {format(day, 'd')}
                    </span>

                    {hasMatch ? (
                      <span className="absolute right-1 top-1 rounded-full bg-accent px-1 text-[8px] font-bold text-accent-fg">
                        {matchedEvents.length}
                      </span>
                    ) : null}

                    <div className="flex w-full flex-wrap gap-0.5">
                      {dayEvents.slice(0, 4).map((event) => (
                        <span
                          key={event.id}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: MEDIA_COLORS[event.mediaKind] ?? '#8b96a8' }}
                        />
                      ))}
                      {dayEvents.length > 4 ? (
                        <span className="text-[9px] leading-none text-faint">+{dayEvents.length - 4}</span>
                      ) : null}
                    </div>

                    {dayEvents.length > 0 ? (
                      <span
                        className={cn(
                          'hidden w-full truncate text-[9px] leading-tight sm:block',
                          hasMatch ? 'font-semibold text-accent' : 'text-faint'
                        )}
                      >
                        {displayTitle}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={dayPanelRef} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  {capitalize(format(parseISO(selectedDay), dayPattern, { locale: dateLocale }))}
                </h2>
                <p className="text-[11px] text-faint">
                  {selectedEvents.length} {t(selectedEvents.length === 1 ? 'lançamento' : 'lançamentos')}
                  {selectedDay === today ? ` · ${t('hoje')}` : ''}
                </p>
              </div>
              <span className="text-[11px] text-faint">{t('Horários em')} {timeZone}</span>
            </div>

            <div className="mt-3 space-y-1.5">
              {orderedSelectedEvents.length > 0 ? (
                orderedSelectedEvents.map((event) => (
                  <EventRow key={event.id} event={event} highlighted={searchIds.has(event.id)} />
                ))
              ) : (
                <p className="py-6 text-center text-xs text-faint">{t('Nenhum lançamento neste dia.')}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div>
          {monthQuery.isLoading || listQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="card h-20 animate-pulse bg-elevated/40" />
              ))}
            </div>
          ) : null}

          {!activeQuery.isLoading && events.length === 0 ? (
            <EmptyState
              icon={<CalendarRange className="h-5 w-5" />}
              title={t('Nenhum lançamento nos próximos 30 dias')}
              description={
                scope === 'global'
                  ? t(
                      'O calendário global combina lançamentos do TMDB e a agenda de animes do AniList. Tente atualizar; a fonte também sincroniza a cada 6 horas.'
                    )
                  : t(
                      'Nenhum lançamento dos títulos que você acompanha. Adicione títulos em Fontes ou troque para o calendário global.'
                    )
              }
              action={
                scope === 'global' ? (
                  <Button variant="subtle" size="sm" onClick={() => void handleRefresh()} loading={refreshing}>
                    {t('Atualizar calendário')}
                  </Button>
                ) : (
                  <Link
                    to="/sources"
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition hover:brightness-110"
                  >
                    <CalendarDays className="h-4 w-4" /> {t('Adicionar título')}
                  </Link>
                )
              }
            />
          ) : null}

          <div className="space-y-5">
            {listGroups.map(([date, dayEvents]) => (
              <section key={date}>
                <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-bg/85 px-1 py-1.5 backdrop-blur-sm">
                  <h3 className="text-xs font-semibold text-fg">
                    {capitalize(format(parseISO(date), dayPattern, { locale: dateLocale }))}
                  </h3>
                  {date === today ? (
                    <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">
                      {t('hoje')}
                    </span>
                  ) : null}
                  <span className="text-[10px] text-faint">
                    {dayEvents.length} {t(dayEvents.length === 1 ? 'lançamento' : 'lançamentos')}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {dayEvents.map((event) => (
                    <EventRow key={event.id} event={event} highlighted={searchIds.has(event.id)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {/* Legenda */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[10px] text-faint">
        {(['movie', 'series', 'anime'] as MediaKind[]).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MEDIA_COLORS[kind] }} />
            {t(MEDIA_KIND_LABELS[kind])}
          </span>
        ))}
      </div>
    </div>
  );
}
