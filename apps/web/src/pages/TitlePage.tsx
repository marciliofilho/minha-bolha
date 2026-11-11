/** Detalhes de um título dentro do Hub (dados da biblioteca + TMDB). */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock, Film, Loader2, Play, Star, Tv } from 'lucide-react';
import { Button, Chip, ErrorBanner, InfoBanner } from '@/components/ui';
import { StremioBadge } from '@/components/stremio/StremioBadge';
import type { StreamTarget } from '@/components/stremio/StreamPicker';
import { useStremioTitle } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const StreamPicker = lazy(() =>
  import('@/components/stremio/StreamPicker').then((module) => ({
    default: module.StreamPicker
  }))
);

function Poster({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-xl border border-line bg-elevated sm:w-32">
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
          <Film className="h-7 w-7" />
        </div>
      )}
    </div>
  );
}

export function TitlePage() {
  const { t } = useI18n();
  const { type: rawType, metaId } = useParams<{ type: string; metaId: string }>();
  const [searchParams] = useSearchParams();
  const [streamsOpen, setStreamsOpen] = useState(false);
  const navigate = useNavigate();
  const type = rawType && /^[a-z0-9_-]{2,30}$/i.test(rawType) ? rawType.toLowerCase() : null;
  const nameHint = searchParams.get('name');
  const details = useStremioTitle(type ?? undefined, metaId, nameHint);

  useEffect(() => {
    setStreamsOpen(false);
  }, [metaId]);

  if (!type || !metaId) {
    return (
      <div>
        <ErrorBanner message={t('Endereço de título inválido.')} />
        <Link to="/library" className="mt-3 inline-flex text-xs font-medium text-accent hover:underline">
          {t('Voltar para a biblioteca')}
        </Link>
      </div>
    );
  }

  if (details.isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 w-28 rounded bg-elevated" />
        <div className="flex gap-4">
          <div className="aspect-[2/3] w-28 rounded-xl bg-elevated sm:w-32" />
          <div className="flex-1 space-y-2 py-2">
            <div className="h-6 w-2/3 rounded bg-elevated" />
            <div className="h-3 w-1/2 rounded bg-elevated" />
            <div className="h-3 w-full rounded bg-elevated" />
            <div className="h-3 w-5/6 rounded bg-elevated" />
          </div>
        </div>
      </div>
    );
  }

  if (details.isError || !details.data) {
    return (
      <div>
        <ErrorBanner
          message={
            details.error instanceof Error
              ? details.error.message
              : t('Não foi possível carregar os detalhes deste título.')
          }
        />
        <div className="mt-3 flex gap-2">
          <Button variant="subtle" size="sm" onClick={() => void details.refetch()}>
            {t('Tentar novamente')}
          </Button>
          <Link
            to="/library"
            className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-medium text-muted transition hover:text-fg"
          >
            {t('Voltar para a biblioteca')}
          </Link>
        </div>
      </div>
    );
  }

  const title = details.data;
  const streamTarget: StreamTarget = {
    title: title.name,
    type: title.type,
    metaId: title.imdbId ?? title.id,
    imdbId: title.imdbId,
    poster: title.posterUrl,
    backdrop: title.backdropUrl,
    description: title.overview,
    year: title.year,
    season: title.type === 'series' ? (title.progress?.season ?? 1) : null,
    episode: title.type === 'series' ? (title.progress?.episode ?? 1) : null
  };
  const code =
    title.progress?.season !== null &&
    title.progress?.season !== undefined &&
    title.progress.season > 0 &&
    title.progress.episode !== null &&
    title.progress.episode !== undefined
      ? `S${title.progress.season}E${title.progress.episode}`
      : null;
  const percent =
    title.progress?.positionMs && title.progress.durationMs
      ? Math.min(100, Math.round((title.progress.positionMs / title.progress.durationMs) * 100))
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('Voltar')}
      </button>

      <section className="relative overflow-hidden rounded-2xl border border-line bg-elevated">
        {title.backdropUrl ? (
          <img
            src={title.backdropUrl}
            alt=""
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/30" />

        <div className="relative flex gap-4 p-4 sm:p-5">
          <Poster src={title.posterUrl} name={title.name} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip color={title.type === 'series' ? '#38bdf8' : '#f59e0b'}>
                {title.metaType === 'anime'
                  ? t('Anime')
                  : title.metaType === 'tv'
                    ? 'TV'
                    : title.type === 'series'
                      ? t('Série')
                      : t('Filme')}
              </Chip>
              {title.inStremioLibrary ? <StremioBadge /> : null}
              {title.addonName ? (
                <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  {t('via')} {title.addonName}
                </span>
              ) : null}
              {code ? (
                <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  {code}
                  {percent !== null ? ` · ${percent}%` : ''}
                </span>
              ) : null}
            </div>

            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title.name}</h1>
            {title.originalName && title.originalName !== title.name ? (
              <p className="text-[11px] text-faint">{title.originalName}</p>
            ) : null}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              {title.year ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> {title.year}
                </span>
              ) : null}
              {title.runtimeMinutes ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {title.runtimeMinutes} min
                </span>
              ) : null}
              {title.status ? <span>{title.status}</span> : null}
              {title.imdbId ? <span className="font-mono text-[10px] text-faint">{title.imdbId}</span> : null}
              {title.tmdbId ? <span className="font-mono text-[10px] text-faint">TMDB {title.tmdbId}</span> : null}
            </div>

            {title.genres.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {title.genres.map((genre) => (
                  <Chip key={genre}>{genre}</Chip>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setStreamsOpen((value) => !value)}
                icon={<Play className="h-3.5 w-3.5" />}
              >
                {streamsOpen ? t('Ocultar streams') : t('Assistir')}
              </Button>
              <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                <Star className="h-3 w-3" /> {t('Streams via addons do Stremio.')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {streamsOpen ? (
        <div className="mt-3">
          <Suspense
            fallback={
              <div className="flex min-h-[30vh] items-center justify-center rounded-2xl border border-line bg-elevated">
                <Loader2 className="h-5 w-5 animate-spin text-faint" />
              </div>
            }
          >
            <StreamPicker target={streamTarget} onClose={() => setStreamsOpen(false)} />
          </Suspense>
        </div>
      ) : null}

      {!title.tmdbConfigured ? (
        <div className="mt-3">
          <InfoBanner message={t('Configure a chave do TMDB em Configurações → Chaves de API para ver sinopse, fundo e temporadas.')} />
        </div>
      ) : null}

      {title.tmdbError && title.source !== 'addon' ? (
        <div className="mt-3">
          <ErrorBanner message={title.tmdbError} />
        </div>
      ) : null}

      {title.overview ? (
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-fg">{t('Sinopse')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{title.overview}</p>
        </section>
      ) : null}

      {title.type === 'series' ? (
        <section className="mt-5">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{t('Temporadas')}</h2>
            <span className="text-[10px] text-faint">
              {title.seasons.length} {t('temporada(s)')}
            </span>
          </div>

          {title.seasons.length === 0 ? (
            <p className="rounded-xl border border-line/60 bg-bg/40 p-3 text-[11px] leading-relaxed text-faint">
              {t(
                'Temporadas e episódios são carregados pelos addons quando disponíveis. No player, ajuste temporada/episódio manualmente.'
              )}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {title.seasons.map((season) => (
                <div
                  key={season.season}
                  className={cn(
                    'flex gap-3 rounded-xl border border-line/70 bg-bg/40 p-2.5',
                    title.progress?.season === season.season && 'border-accent/40 bg-accent/5'
                  )}
                >
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md border border-line/60 bg-elevated">
                    {season.posterUrl ? (
                      <img
                        src={season.posterUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-faint">
                        <Tv className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-fg">{season.name}</p>
                    <p className="text-[10px] text-faint">
                      {season.episodeCount} {t('episódio(s)')}
                      {season.airDate ? ` · ${season.airDate.slice(0, 4)}` : ''}
                    </p>
                    {season.overview ? (
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted">{season.overview}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
