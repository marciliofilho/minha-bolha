/** Lista de streams do Stremio exibida dentro do card de destaque do Feed. */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Clapperboard,
  ExternalLink,
  Info,
  Play,
  RefreshCw,
  Tv,
  X
} from 'lucide-react';
import type { TitleStreamDto } from '@hub/shared';
import { Chip, ErrorBanner, InfoBanner } from '@/components/ui';
import { useSettings, useStremioEpisodes, useStremioServerStatus, useStremioStreams } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { isAndroidShell } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { StreamPlayer } from './StreamPlayer';

export interface StreamTarget {
  title: string;
  type: 'movie' | 'series';
  metaId: string;
  imdbId: string | null;
  poster: string | null;
  backdrop: string | null;
  description: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
}

interface StreamPickerProps {
  target: StreamTarget;
  onClose: () => void;
}

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit >= 3 ? 1 : 0)} ${units[unit]}`;
}

function kindLabel(kind: TitleStreamDto['kind']): string {
  if (kind === 'direct') return 'direto';
  if (kind === 'torrent') return 'torrent';
  if (kind === 'external') return 'externo';
  return 'stream';
}

export function StreamPicker({ target, onClose }: StreamPickerProps) {
  const { t } = useI18n();
  const closePicker = (): void => {
    window.HubNative?.stopPlayback?.();
    onClose();
  };
  const [season, setSeason] = useState(target.season ?? 1);
  const [episode, setEpisode] = useState(target.episode ?? 1);
  const [playing, setPlaying] = useState<TitleStreamDto | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [posterStage, setPosterStage] = useState(0);

  useEffect(() => {
    setSeason(target.season ?? 1);
    setEpisode(target.episode ?? 1);
    setPlaying(null);
    setRefreshToken(0);
    setPosterStage(0);
  }, [target.metaId, target.season, target.episode, target.type]);

  const episodesQuery = useStremioEpisodes(
    target.type === 'series' ? 'series' : undefined,
    target.type === 'series' ? target.metaId : undefined,
    target.type === 'series'
  );
  const seasons = episodesQuery.data?.seasons ?? [];
  const selectedSeason = seasons.find((item) => item.season === season) ?? seasons[0] ?? null;
  const episodes = selectedSeason?.episodes ?? [];
  const selectedEpisode =
    episodes.find((item) => item.episode === episode) ?? episodes[0] ?? null;
  const effectiveSeason = selectedSeason?.season ?? season;
  const effectiveEpisode = selectedEpisode?.episode ?? episode;
  const playbackVideoId =
    target.type === 'series'
      ? `${target.metaId}:${effectiveSeason}:${effectiveEpisode}`
      : target.metaId;

  const nextEpisode = useMemo(() => {
    if (target.type !== 'series' || !selectedSeason) return null;
    const index = selectedSeason.episodes.findIndex(
      (item) => item.episode === effectiveEpisode
    );
    if (index >= 0 && index + 1 < selectedSeason.episodes.length) {
      const next = selectedSeason.episodes[index + 1];
      return { season: selectedSeason.season, episode: next.episode, name: next.name };
    }
    const seasonIndex = seasons.findIndex((item) => item.season === selectedSeason.season);
    for (let cursor = seasonIndex + 1; cursor < seasons.length; cursor += 1) {
      const candidate = seasons[cursor];
      if (candidate.episodes.length > 0) {
        const first = candidate.episodes[0];
        return { season: candidate.season, episode: first.episode, name: first.name };
      }
    }
    return null;
  }, [target.type, selectedSeason, seasons, effectiveEpisode]);

  const params = useMemo(
    () =>
      target.type === 'series'
        ? {
            type: 'series' as const,
            id: target.metaId,
            season: effectiveSeason,
            episode: effectiveEpisode,
            videoId: null,
            refreshToken
          }
        : {
            type: 'movie' as const,
            id: target.metaId,
            season: null,
            episode: null,
            videoId: null,
            refreshToken
          },
    [target.type, target.metaId, effectiveSeason, effectiveEpisode, refreshToken]
  );

  const streamsQuery = useStremioStreams(params, true);
  const streams = streamsQuery.data?.streams ?? [];
  const authErrors = (streamsQuery.data?.errors ?? []).filter((error) => error.helpUrl);
  const server = useStremioServerStatus();
  const settingsQuery = useSettings();

  // Se o backend devolveu cache antigo ou está esperando um addon lento em
  // segundo plano, faz algumas leituras extras para trazer a lista nova.
  useEffect(() => {
    if (!streamsQuery.data?.cache.refreshing) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void streamsQuery.refetch();
      if (attempts >= 5) window.clearInterval(timer);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [streamsQuery.data?.cache.refreshing]);

  const title = target.title;
  const background = target.backdrop ?? target.poster;
  const metahubPoster = /^tt\d+$/.test(target.metaId)
    ? `https://images.metahub.space/poster/medium/${target.metaId}/img`
    : null;
  const posterCandidates = [target.poster, target.backdrop, metahubPoster].filter(
    (value): value is string => Boolean(value)
  );
  const poster = posterCandidates[posterStage] ?? null;

  /**
   * No Android, streams diretos/HLS vão para o player nativo (Media3). O
   * player web fica para o desktop e para YouTube. Isso também resolve HEVC,
   * redirecionamentos e a tela cheia sem depender do layout do WebView.
   */
  const nativePayload = (stream: TitleStreamDto): string => {
    // Streams diretos passam pelo proxy local: ele aplica UA/Referer e
    // mantém cookies nos redirecionamentos HTTP↔HTTPS.
    const playbackUrl =
      stream.kind === 'direct' && stream.playbackUrl
        ? `/api/stream-proxy?url=${encodeURIComponent(stream.playbackUrl)}`
        : stream.playbackUrl;
    return JSON.stringify({
      url: playbackUrl,
      title,
      subtitleLanguage: settingsQuery.data?.subtitleLanguage ?? 'por',
      tracking: {
        metaId: target.metaId,
        type: target.type,
        videoId: playbackVideoId,
        season: target.type === 'series' ? effectiveSeason : null,
        episode: target.type === 'series' ? effectiveEpisode : null,
        name: target.title,
        poster: target.poster,
        backdrop: target.backdrop,
        year: target.year,
        addonId: stream.addonId,
        streamSignature: [
          stream.addonId,
          stream.quality,
          stream.name,
          stream.infoHash,
          stream.fileIdx
        ]
          .filter((value) => value !== null && value !== undefined)
          .join('|')
      }
    });
  };

  const selectStream = (stream: TitleStreamDto): void => {
    if (stream.kind === 'external' && stream.externalUrl && !stream.ytId) {
      window.open(stream.externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (
      isAndroidShell() &&
      window.HubNative &&
      stream.kind !== 'torrent' &&
      stream.playbackUrl
    ) {
      window.HubNative.playTorrent(nativePayload(stream));
      return;
    }
    setPlaying(stream);
  };

  if (playing) {
    return (
      <StreamPlayer
        title={title}
        stream={playing}
        subtitleTarget={params}
        serverBaseUrl={server.data?.baseUrl ?? null}
        serverAvailable={server.data?.available ?? false}
        tracking={{
          metaId: target.metaId,
          type: target.type,
          videoId: playbackVideoId,
          season: target.type === 'series' ? effectiveSeason : null,
          episode: target.type === 'series' ? effectiveEpisode : null,
          name: target.title,
          poster: target.poster,
          backdrop: target.backdrop,
          year: target.year,
          addonId: playing.addonId,
          streamSignature: [
            playing.addonId,
            playing.quality,
            playing.name,
            playing.infoHash,
            playing.fileIdx
          ]
            .filter((value) => value !== null && value !== undefined && value !== '')
            .join('|')
        }}
        nextEpisode={nextEpisode}
        onNextEpisode={() => {
          if (!nextEpisode) return;
          setSeason(nextEpisode.season);
          setEpisode(nextEpisode.episode);
          setPlaying(null);
        }}
        onBack={() => setPlaying(null)}
        onClose={onClose}
      />
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-elevated">
      {background ? (
        <img
          src={background}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover opacity-20 blur-sm"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/45 via-bg/85 to-bg" />

      <div className="relative p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-line bg-elevated sm:h-28 sm:w-20">
            {poster ? (
              <img
                src={poster}
                alt=""
                className="h-full w-full object-cover"
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setPosterStage((stage) => stage + 1)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-faint">
                {target.type === 'series' ? <Tv className="h-5 w-5" /> : <Clapperboard className="h-5 w-5" />}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip color={target.type === 'series' ? '#38bdf8' : '#f59e0b'}>
                {target.type === 'series' ? t('Série') : t('Filme')}
              </Chip>
              {target.year ? <Chip>{target.year}</Chip> : null}
              {target.type === 'series' ? (
                <Chip>
                  T{season} · E{episode}
                </Chip>
              ) : null}
            </div>
            <h2 className="mt-1 line-clamp-1 text-lg font-semibold text-fg">{title}</h2>
            {target.description ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
                {target.description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={closePicker}
            aria-label={t('Fechar lista de streams')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-elevated hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {target.type === 'series' ? (
          <div className="mt-3 space-y-1.5">
            {episodesQuery.isLoading ? (
              <p className="text-[10px] text-faint">{t('Carregando temporadas e episódios…')}</p>
            ) : null}

            {seasons.length > 0 ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-medium text-faint" htmlFor="stream-season">
                  {t('Temporada')}
                  <select
                    id="stream-season"
                    className="field-input mt-1 h-8 min-w-[10rem] py-1 text-xs"
                    value={String(effectiveSeason)}
                    onChange={(event) => {
                      const next = seasons.find((item) => item.season === Number(event.target.value));
                      setSeason(next?.season ?? (Number(event.target.value) || 1));
                      setEpisode(next?.episodes[0]?.episode ?? 1);
                      setPlaying(null);
                    }}
                  >
                    {seasons.map((item) => (
                      <option key={item.season} value={item.season}>
                        {item.name} ({item.episodes.length} eps)
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-[11px] font-medium text-faint" htmlFor="stream-episode">
                  {t('Episódio')}
                  <select
                    id="stream-episode"
                    className="field-input mt-1 h-8 min-w-[13rem] max-w-[20rem] py-1 text-xs"
                    value={String(effectiveEpisode)}
                    onChange={(event) => {
                      setEpisode(Number(event.target.value) || 1);
                      setPlaying(null);
                    }}
                  >
                    {episodes.map((item) => (
                      <option key={item.episode} value={item.episode}>
                        E{item.episode} - {item.name ?? t('Sem título')}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedEpisode?.released ? (
                  <span className="pb-1 text-[10px] text-faint">{selectedEpisode.released}</span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-medium text-faint" htmlFor="stream-season">
                  {t('Temporada')}
                  <input
                    id="stream-season"
                    type="number"
                    min={1}
                    max={1000}
                    value={season}
                    onChange={(event) => {
                      setSeason(Math.max(1, Number(event.target.value) || 1));
                      setPlaying(null);
                    }}
                    className="field-input mt-1 h-8 w-20 py-1 text-xs"
                  />
                </label>
                <label className="text-[11px] font-medium text-faint" htmlFor="stream-episode">
                  {t('Episódio')}
                  <input
                    id="stream-episode"
                    type="number"
                    min={1}
                    max={10000}
                    value={episode}
                    onChange={(event) => {
                      setEpisode(Math.max(1, Number(event.target.value) || 1));
                      setPlaying(null);
                    }}
                    className="field-input mt-1 h-8 w-20 py-1 text-xs"
                  />
                </label>
              </div>
            )}

            <p className="text-[10px] text-faint">
              {seasons.length > 0
                ? `${t('Temporadas e episódios via')} ${episodesQuery.data?.sourceAddonName ?? t('addons')}.`
                : episodesQuery.isError
                  ? t('Não foi possível carregar a lista; informe temporada/episódio manualmente.')
                  : episodesQuery.isLoading
                    ? t('Consultando a lista de episódios nos addons…')
                    : t('Lista de episódios indisponível; informe temporada/episódio manualmente.')}
            </p>
            {episodesQuery.data?.error ? (
              <p className="text-[10px] text-warning">{episodesQuery.data.error}</p>
            ) : null}
          </div>
        ) : null}

        {authErrors.length > 0 ? (
          <div className="mt-3">
            <InfoBanner
              message={`${authErrors.map((error) => error.addonName).join(', ')} ${
                authErrors.length === 1 ? t('precisa') : t('precisam')
              } ${t('de configuração/autenticação.')}`}
              action={
                <a
                  href={authErrors[0].helpUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:text-fg"
                >
                  <ExternalLink className="h-3 w-3" /> {t('Configurar')}
                </a>
              }
            />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">{t('Streams disponíveis')}</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-faint">
              {streamsQuery.isLoading
                ? t('buscando nos addons…')
                : `${streams.length} ${t(streams.length === 1 ? 'opção' : 'opções')}`}
              {streamsQuery.data ? ` · ${streamsQuery.data.elapsedMs} ms` : ''}
              {streamsQuery.data?.cache.refreshing
                ? ` · ${t('atualizando em segundo plano…')}`
                : streamsQuery.data?.cache.used
                  ? ` · ${t('cache local')}`
                  : ''}
            </span>
            <button
              type="button"
              onClick={() => setRefreshToken((value) => value + 1)}
              disabled={streamsQuery.isFetching}
              title={t('Atualizar streams (ignora o cache)')}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-elevated px-2 text-[10px] font-medium text-muted transition hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', streamsQuery.isFetching ? 'animate-spin' : '')} />
              {t('Atualizar')}
            </button>
          </div>
        </div>

        {streamsQuery.isError ? (
          <div className="mt-2">
            <ErrorBanner
              message={
                streamsQuery.error instanceof Error
                  ? streamsQuery.error.message
                  : t('Não foi possível buscar os streams.')
              }
            />
          </div>
        ) : null}

        {streamsQuery.isLoading ? (
          <div className="mt-2 space-y-1.5">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-elevated/70" />
            ))}
          </div>
        ) : null}

        {!streamsQuery.isLoading && streams.length > 0 ? (
          <div className="no-scrollbar mt-2 max-h-[42vh] space-y-1.5 overflow-y-auto pr-1">
            {streams.map((stream) => {
              const external = stream.kind === 'external' && stream.externalUrl && !stream.ytId;
              const size = formatBytes(stream.sizeBytes);
              return (
                <button
                  key={stream.id}
                  type="button"
                  onClick={() => selectStream(stream)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl border border-line/70 bg-bg/60 p-2.5 text-left transition',
                    'hover:border-accent/40 hover:bg-elevated/70'
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    {external ? <ExternalLink className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {stream.quality ? <Chip color="#38bdf8">{stream.quality}</Chip> : null}
                      <Chip>{t(kindLabel(stream.kind))}</Chip>
                      {stream.seeds !== null && stream.kind === 'torrent' ? (
                        <span className="text-[10px] text-muted">👤 {stream.seeds}</span>
                      ) : null}
                      {size ? <span className="text-[10px] text-faint">{size}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-medium text-fg">
                      {stream.name ?? stream.addonName}
                    </span>
                    {stream.title || stream.description ? (
                      <span className="block truncate text-[10px] text-faint">
                        {stream.title ?? stream.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="hidden shrink-0 text-[10px] font-medium text-muted sm:block">
                    {stream.addonName}
                  </span>
                  <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-line bg-elevated px-2 text-[10px] font-semibold text-fg">
                    {external ? t('Abrir') : t('Assistir')}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {!streamsQuery.isLoading && streams.length === 0 && !streamsQuery.isError ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-line/60 bg-bg/40 p-3 text-[11px] leading-relaxed text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
            <span>
              {t(
                'Nenhum stream encontrado para este título/episódio. Confira se os addons de streams estão habilitados em Configurações → Addons.'
              )}
            </span>
          </div>
        ) : null}

        {streamsQuery.data?.errors.length ? (
          <details className="mt-2 text-[10px] text-faint">
            <summary className="cursor-pointer font-medium text-muted">
              {streamsQuery.data.errors.length} {t('addon(s) falharam')}
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {streamsQuery.data.errors.map((error) => (
                <li key={error.addonId}>
                  <span className="text-muted">{error.addonName}:</span> {error.message}
                  {error.helpUrl ? (
                    <>
                      {' '}
                      <a
                        href={error.helpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-accent hover:underline"
                      >
                        {t('Configurar')}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2 text-[10px] text-faint">
          <span className="inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> {t('O player abre neste mesmo destaque.')}
          </span>
          <span>{t('Streams via addons do Stremio.')}</span>
        </div>
      </div>
    </section>
  );
}
