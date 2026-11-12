/** Player da Etapa 3 exibido dentro do card de destaque do Feed. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Captions,
  Check,
  ExternalLink,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type { TitleStreamDto, TorrentPrepareDto } from '@hub/shared';
import type HlsInstance from 'hls.js';
import { api } from '@/lib/api';
import {
  FALLBACK_SETTINGS,
  probeStremioStream,
  useSettings,
  useStremioSubtitles
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { isAndroidShell } from '@/lib/platform';

interface SubtitleTarget {
  type: string;
  id: string;
  season?: number | null;
  episode?: number | null;
  videoId?: string | null;
}

interface StreamPlayerProps {
  title: string;
  stream: TitleStreamDto;
  subtitleTarget?: SubtitleTarget | null;
  serverBaseUrl?: string | null;
  serverAvailable?: boolean;
  tracking?: PlaybackTracking | null;
  nextEpisode?: NextEpisode | null;
  onNextEpisode?: () => void;
  onBack: () => void;
  onClose: () => void;
}

export interface PlaybackTracking {
  metaId: string;
  type: 'movie' | 'series';
  videoId: string;
  season: number | null;
  episode: number | null;
  name: string;
  poster: string | null;
  backdrop: string | null;
  year: number | null;
  addonId: string | null;
  streamSignature: string | null;
}

export interface NextEpisode {
  season: number;
  episode: number;
  name: string | null;
}

interface AudioOption {
  index: number;
  label: string;
  lang: string | null;
  detail?: string | null;
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

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function isHlsUrl(url: string | null | undefined): boolean {
  return Boolean(url && /\.m3u8(?:[?#]|$)/i.test(url));
}

function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    const display = new Intl.DisplayNames(['pt-BR'], { type: 'language' });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}

function subtitleLabel(language: string, addonName: string): string {
  return `${language} · ${addonName}`;
}

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
  const red = (integer >> 16) & 255;
  const green = (integer >> 8) & 255;
  const blue = integer & 255;
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(100, Math.max(0, opacity)) / 100})`;
}

const SUBTITLE_LANGUAGE_ALIASES: Record<string, string[]> = {
  por: ['por', 'pob', 'pt', 'pt-br', 'pt-pt'],
  pob: ['pob', 'pt-br', 'por', 'pt'],
  eng: ['eng', 'en'],
  spa: ['spa', 'es'],
  fra: ['fre', 'fra', 'fr'],
  deu: ['ger', 'deu', 'de'],
  ita: ['ita', 'it'],
  jpn: ['jpn', 'ja'],
  kor: ['kor', 'ko'],
  chi: ['chi', 'zho', 'zh'],
  rus: ['rus', 'ru'],
  ara: ['ara', 'ar']
};

export function StreamPlayer({
  title,
  stream,
  subtitleTarget,
  serverBaseUrl,
  serverAvailable = false,
  tracking,
  nextEpisode,
  onNextEpisode,
  onBack,
  onClose
}: StreamPlayerProps) {
  const { t } = useI18n();
  const closePlayer = (): void => {
    // Fechar o vídeo também para o player nativo/MediaSession, senão o áudio
    // continua tocando em segundo plano.
    window.HubNative?.stopPlayback?.();
    onClose();
  };
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const resumeAtRef = useRef<number | null>(null);
  const fallbackTriedRef = useRef(false);
  const autoSubtitleRef = useRef<string | null>(null);
  const subtitleElsRef = useRef<Map<string, HTMLTrackElement>>(new Map());

  const [error, setError] = useState<string | null>(null);
  const [transcodedUrl, setTranscodedUrl] = useState<string | null>(null);
  const [hlsAudio, setHlsAudio] = useState<AudioOption[]>([]);
  const [probeAudio, setProbeAudio] = useState<AudioOption[]>([]);
  const [activeAudio, setActiveAudio] = useState(0);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);
  const [menu, setMenu] = useState<'subtitles' | 'audio' | null>(null);
  const [torrentPrep, setTorrentPrep] = useState<TorrentPrepareDto | null>(null);
  const [torrentPreparing, setTorrentPreparing] = useState(false);
  const [forceHls, setForceHls] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draggingSeek, setDraggingSeek] = useState(false);
  const [ended, setEnded] = useState(false);
  const [resumedAt, setResumedAt] = useState<number | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);
  const userSeekedRef = useRef(false);

  const settingsQuery = useSettings();
  const settings = settingsQuery.data ?? FALLBACK_SETTINGS;
  const skipSeconds = Math.min(120, Math.max(1, Math.round(settings.playerSkipSeconds)));
  const subtitleFontSize = Math.min(48, Math.max(12, Math.round(settings.subtitleFontSize)));
  const subtitlePosition = Math.min(95, Math.max(40, Math.round(settings.subtitlePosition)));
  const subtitleColor = /^#[0-9a-f]{6}$/i.test(settings.subtitleColor)
    ? settings.subtitleColor
    : '#ffffff';
  const subtitleBackgroundColor = /^#[0-9a-f]{6}$/i.test(settings.subtitleBackgroundColor)
    ? settings.subtitleBackgroundColor
    : '#000000';
  const subtitleBackgroundOpacity = Math.min(
    100,
    Math.max(0, Math.round(settings.subtitleBackgroundOpacity))
  );
  const subtitleLineHeight =
    Math.round(Math.min(2.5, Math.max(0.8, Number(settings.subtitleLineHeight) || 1.32)) * 100) /
    100;
  const subtitleCueCss = `
    .hub-player-video::cue {
      font-size: ${subtitleFontSize}px;
      color: ${subtitleColor};
      background-color: ${hexToRgba(subtitleBackgroundColor, subtitleBackgroundOpacity)};
      font-family: inherit;
      line-height: ${subtitleLineHeight};
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    }
    .player-stage:fullscreen .hub-player-video::cue {
      font-size: ${Math.round(subtitleFontSize * 1.5)}px;
    }
  `;

  const playbackUrl = stream.playbackUrl;
  const isYouTube = Boolean(stream.ytId);
  const isExternal = stream.kind === 'external' && !isYouTube;
  const isTorrent = stream.kind === 'torrent' && Boolean(stream.infoHash);

  const embeddedAudioOptions = useMemo<AudioOption[]>(() => {
    if (!torrentPrep) return [];
    return torrentPrep.audioTracks.map((track) => {
      const label =
        [track.languageLabel, track.title?.trim()].filter(Boolean).join(' · ') ||
        `Faixa ${track.index + 1}`;
      const detail = [
        track.codec?.toUpperCase() ?? null,
        track.channels ? `${track.channels} canais` : null
      ]
        .filter((value): value is string => Boolean(value))
        .join(' · ');
      return {
        index: track.index,
        label,
        lang: track.language ?? null,
        detail: detail || null
      };
    });
  }, [torrentPrep]);

  const embeddedPlaybackUrl =
    isTorrent && torrentPrep
      ? torrentPrep.directPlayable && !forceHls
        ? torrentPrep.directUrl
        : (torrentPrep.audioHlsUrls[activeAudio] ?? torrentPrep.hlsUrl)
      : null;
  const basePlaybackUrl = isTorrent ? (embeddedPlaybackUrl ?? fallbackUrl) : playbackUrl;
  const baseIsHls = isHlsUrl(basePlaybackUrl);
  const sourceUrl = transcodedUrl ?? basePlaybackUrl;
  const sourceIsHls = Boolean(transcodedUrl) || baseIsHls;
  const size = formatBytes(stream.sizeBytes);

  // Android: streams diretos 4K costumam ser HEVC, que o WebView não decodifica.
  // Entrega direto ao player nativo (Media3) em vez de arriscar uma tela preta.
  const forceNative4k =
    isAndroidShell() &&
    Boolean(window.HubNative) &&
    !isTorrent &&
    !isYouTube &&
    !isExternal &&
    /4k|2160|uhd/i.test(`${stream.quality ?? ''} ${stream.name ?? ''}`);

  useEffect(() => {
    if (!forceNative4k || !playbackUrl) return;
    window.HubNative?.playTorrent(
      JSON.stringify({ url: playbackUrl, title, tracking: tracking ?? null })
    );
    onBack();
  }, [forceNative4k, playbackUrl, title, tracking, onBack]);

  const canLoadSubtitles = Boolean(subtitleTarget) && !isYouTube && !isExternal;
  const subtitlesQuery = useStremioSubtitles(subtitleTarget ?? null, canLoadSubtitles);
  const subtitleList = subtitlesQuery.data?.subtitles;
  const subtitleOptions = useMemo(() => {
    const counters = new Map<string, number>();
    return (subtitleList ?? []).map((subtitle) => {
      const optionNumber = (counters.get(subtitle.language) ?? 0) + 1;
      counters.set(subtitle.language, optionNumber);
      return { ...subtitle, optionNumber };
    });
  }, [subtitleList]);

  const audioOptions =
    hlsAudio.length > 0
      ? hlsAudio
      : isTorrent && torrentPrep
        ? embeddedAudioOptions
        : transcodedUrl
          ? []
          : probeAudio;
  const activeAudioOption = audioOptions[activeAudio] ?? audioOptions[0] ?? null;
  const activeSubtitle =
    selectedSubtitle && subtitleList
      ? subtitleList.find((subtitle) => subtitle.proxyUrl === selectedSubtitle) ?? null
      : null;

  // Reprodução: direta, HLS do addon ou HLS de transcodificação do Stremio Server.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl || isYouTube || isExternal) return;

    let cancelled = false;
    let hls: HlsInstance | null = null;
    setError(null);
    setHlsAudio([]);

    const startAt = resumeAtRef.current;

    const setup = async (): Promise<void> => {
      if (sourceIsHls) {
        const module = await import('hls.js').catch(() => null);
        if (cancelled) return;
        const Hls = module?.default;
        if (Hls?.isSupported()) {
          hls = new Hls({ enableWorker: true });
          hlsRef.current = hls;
          hls.loadSource(sourceUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (startAt && Number.isFinite(startAt) && video.duration > startAt) {
              video.currentTime = startAt;
            }
            if (startAt !== null) resumeAtRef.current = null;
            void video.play().catch(() => undefined);
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
            setHlsAudio(
              data.audioTracks.map((track, index) => ({
                index,
                label:
                  track.name?.trim() ||
                  languageLabel(track.lang) ||
                  track.lang ||
                  `Faixa ${index + 1}`,
                lang: track.lang || null
              }))
            );
            if (hls) setActiveAudio(hls.audioTrack >= 0 ? hls.audioTrack : 0);
          });
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
            setActiveAudio(data.id);
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal) return;
            setError(
              isTorrent && torrentPrep
                ? t('Não foi possível carregar o HLS do torrent. Tente outro stream.')
                : transcodedUrl
                  ? t('Não foi possível iniciar a transcodificação deste stream.')
                  : t('Não foi possível carregar este stream HLS.')
            );
          });
          return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = sourceUrl;
        } else {
          setError(t('Este navegador não consegue reproduzir streams HLS.'));
          return;
        }
      } else {
        video.src = sourceUrl;
      }

      void video.play().catch(() => {
        // Alguns navegadores bloqueiam autoplay; os controles continuam disponíveis.
      });
    };

    void setup();

    return () => {
      cancelled = true;
      if (video.currentTime > 0.5 && Number.isFinite(video.currentTime)) {
        resumeAtRef.current = video.currentTime;
      }
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [sourceUrl, sourceIsHls, isYouTube, isExternal, transcodedUrl, isTorrent, torrentPrep]);

  // Torrents: prepara o motor embutido (WebTorrent + ffprobe) antes de tocar.
  useEffect(() => {
    if (!isTorrent || !stream.infoHash) {
      setTorrentPrep(null);
      setTorrentPreparing(false);
      setFallbackUrl(null);
      setForceHls(false);
      return;
    }

    let cancelled = false;
    setTorrentPrep(null);
    setTorrentPreparing(true);
    setFallbackUrl(null);
    setForceHls(false);
    setTranscodedUrl(null);
    setProbeAudio([]);
    setHlsAudio([]);
    setActiveAudio(0);
    setError(null);

    // Identifica o título para o cache de torrent. O Android apaga o cache
    // do título anterior quando este valor muda.
    const torrentTitleKey = tracking?.metaId?.trim() || title.trim();
    const torrentSources = [...(stream.sources ?? [])];
    if (torrentTitleKey) torrentSources.push(`meta:${torrentTitleKey}`);

    void api
      .prepareTorrent({
        infoHash: stream.infoHash,
        fileIdx: stream.fileIdx,
        sources: torrentSources
      })
      .then((prep) => {
        if (cancelled) return;

        // Android: o player nativo (Media3) assume qualquer torrent, inclusive
        // MP4, para ter tela cheia, codecs e MediaSession consistentes.
        if (window.HubNative) {
          window.HubNative.playTorrent(
            JSON.stringify({
              url: prep.directUrl,
              title,
              fileName: prep.fileName,
              tracking: tracking ?? null
            })
          );
          setTorrentPreparing(false);
          onBack();
          return;
        }

        if (prep.audioTracks.length > 0) {
          const preferred = prep.audioTracks.findIndex((track) =>
            /^(pob|por|pt|pt-br|pt-pt)$/i.test(track.language ?? '')
          );
          setActiveAudio(preferred >= 0 ? preferred : 0);
        }
        setTorrentPrep(prep);
        setTorrentPreparing(false);
        if (!prep.directPlayable && !prep.hlsUrl) {
          setError(
        prep.error ?? t('Não foi possível preparar a reprodução deste torrent.')
      );
        }
      })
      .catch((prepareError: unknown) => {
        if (cancelled) return;
        setTorrentPreparing(false);
        const message =
          prepareError instanceof Error
        ? prepareError.message
        : t('Falha ao preparar o torrent.');
        if (playbackUrl) {
          // Fallback opcional: se o motor embutido falhar, tenta o Stremio Server.
          setFallbackUrl(playbackUrl);
        } else {
          setError(message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isTorrent, stream.id, stream.infoHash, stream.fileIdx, stream.sources, playbackUrl]);

  // Descobre faixas de áudio no Stremio Server antes de trocar para HLS.
  useEffect(() => {
    fallbackTriedRef.current = false;
    setProbeAudio([]);
    if (!playbackUrl || isYouTube || isExternal || !serverAvailable || baseIsHls) return;
    if (isTorrent && (torrentPreparing || torrentPrep)) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void probeStremioStream(playbackUrl).then((result) => {
        if (cancelled) return;
        setProbeAudio(
          result.audioTracks.map((track) => ({
            index: track.index,
            label:
              track.title?.trim() ||
              track.languageLabel ||
              languageLabel(track.language) ||
              `Faixa ${track.index + 1}`,
            lang: track.language ?? null
          }))
        );
        if (result.hlsUrl && result.audioTracks.length > 1) {
          resumeAtRef.current = videoRef.current?.currentTime ?? null;
          setTranscodedUrl(result.hlsUrl);
        }
      });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    playbackUrl,
    isYouTube,
    isExternal,
    serverAvailable,
    baseIsHls,
    isTorrent,
    torrentPreparing,
    torrentPrep
  ]);

  // Legendas: cria <track> same-origin e controla qual fica visível.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    for (const element of subtitleElsRef.current.values()) element.remove();
    subtitleElsRef.current.clear();

    if (!subtitleList) return;

    const targetKey = [
      subtitleTarget?.type ?? '',
      subtitleTarget?.videoId ?? subtitleTarget?.id ?? '',
      subtitleTarget?.season ?? '',
      subtitleTarget?.episode ?? '',
      settings.subtitleLanguage
    ].join(':');
    let preferredKey = selectedSubtitle;
    if (autoSubtitleRef.current !== targetKey) {
      autoSubtitleRef.current = targetKey;
      const language = settings.subtitleLanguage.toLowerCase();
      const aliases =
        language === 'off' ? [] : (SUBTITLE_LANGUAGE_ALIASES[language] ?? [language]);
      const exact =
        language === 'off'
          ? undefined
          : subtitleList.find((subtitle) => subtitle.lang.toLowerCase() === language);
      const preferred =
        exact ??
        (aliases.length > 0
          ? subtitleList.find((subtitle) =>
              aliases.includes(subtitle.lang.toLowerCase())
            )
          : undefined);
      preferredKey = preferred?.proxyUrl ?? null;
      setSelectedSubtitle(preferredKey);
    }

    for (const subtitle of subtitleList) {
      const element = document.createElement('track');
      element.kind = 'subtitles';
      element.label = subtitleLabel(subtitle.language, subtitle.addonName);
      element.srclang = subtitle.lang.slice(0, 12) || 'und';
      element.src = `${subtitle.proxyUrl}&line=${subtitlePosition}`;
      element.default = subtitle.proxyUrl === preferredKey;
      element.setAttribute('data-hub-subtitle', subtitle.proxyUrl);
      video.appendChild(element);
      subtitleElsRef.current.set(subtitle.proxyUrl, element);
    }
  }, [
    subtitleList,
    subtitlePosition,
    settings.subtitleLanguage,
    subtitleTarget?.type,
    subtitleTarget?.id,
    subtitleTarget?.videoId,
    subtitleTarget?.season,
    subtitleTarget?.episode
  ]);

  useEffect(() => {
    for (const [key, element] of subtitleElsRef.current) {
      const track = element.track;
      if (!track) continue;
      track.mode = key === selectedSubtitle ? 'showing' : 'disabled';
    }
  }, [selectedSubtitle, subtitleList]);

  const selectAudio = useCallback(
    (index: number) => {
      if (isTorrent && torrentPrep && hlsAudio.length === 0) {
        if (!torrentPrep.audioHlsUrls[index] && !torrentPrep.hlsUrl) {
          setMenu(null);
          return;
        }
        resumeAtRef.current = videoRef.current?.currentTime ?? null;
        setActiveAudio(index);
        setForceHls(true);
        setMenu(null);
        return;
      }

      const hls = hlsRef.current;
      if (hls && hls.audioTracks.length > index) {
        hls.audioTrack = index;
        setActiveAudio(index);
        setMenu(null);
        return;
      }

      const video = videoRef.current as
        | (HTMLVideoElement & {
            audioTracks?: {
              length: number;
              [index: number]: { enabled: boolean };
            };
          })
        | null;
      const tracks = video?.audioTracks;
      if (tracks && tracks.length > index) {
        for (let item = 0; item < tracks.length; item += 1) {
          tracks[item].enabled = item === index;
        }
        setActiveAudio(index);
      }
      setMenu(null);
    },
    [isTorrent, torrentPrep, hlsAudio.length]
  );

  const retryWithTranscode = useCallback((): boolean => {
    if (isTorrent && torrentPrep) {
      if (torrentPrep.directPlayable && !forceHls && torrentPrep.hlsUrl) {
        resumeAtRef.current = videoRef.current?.currentTime ?? null;
        setForceHls(true);
        setError(null);
        return true;
      }
      return false;
    }

    if (!playbackUrl || !serverAvailable || baseIsHls || fallbackTriedRef.current) return false;
    fallbackTriedRef.current = true;
    setError('Tentando transcodificar este stream no Stremio Server…');
    void probeStremioStream(playbackUrl).then((result) => {
      if (result.hlsUrl) {
        resumeAtRef.current = videoRef.current?.currentTime ?? null;
        setTranscodedUrl(result.hlsUrl);
      } else {
        setError(
          result.error ??
            t(
              'Não foi possível reproduzir este stream. Tente outro formato ou abra o link original.'
            )
        );
      }
    });
    return true;
  }, [
    playbackUrl,
    serverAvailable,
    baseIsHls,
    isTorrent,
    torrentPrep,
    forceHls
  ]);

  const hasControls = !isYouTube && !isExternal && (isTorrent || Boolean(playbackUrl));
  const showAudioButton = audioOptions.length > 1;
  const audioButtonLabel = activeAudioOption ? activeAudioOption.label : t('Áudio');

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    const video = videoRef.current;
    if (!video || video.paused || menu) return;
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000);
  }, [clearHideTimer, menu]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    showControls();
  }, [showControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const max = Number.isFinite(video.duration)
        ? video.duration
        : video.currentTime + Math.abs(delta);
      const next = Math.min(Math.max(0, video.currentTime + delta), max);
      video.currentTime = next;
      userSeekedRef.current = true;
      setCurrentTime(next);
      showControls();
    },
    [showControls]
  );

  const changeVolume = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const current = video.muted ? 0 : video.volume;
      const next = Math.min(1, Math.max(0, current + delta));
      video.muted = false;
      video.volume = next;
      setVolume(next);
      setMuted(false);
      showControls();
    },
    [showControls]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    showControls();
  }, [showControls]);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
      } else if (stage.requestFullscreen) {
        await stage.requestFullscreen();
      } else if (video && 'webkitEnterFullscreen' in video) {
        (video as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
      }
    } catch {
      // Navegador sem suporte/permissão.
    }
    setControlsVisible(true);
  }, []);

  const seekToClientX = useCallback((clientX: number) => {
    const bar = progressRef.current;
    const video = videoRef.current;
    if (!bar || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = ratio * video.duration;
    userSeekedRef.current = true;
    setCurrentTime(video.currentTime);
  }, []);

  const handleVideoClick = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      if (event.detail > 1) return;
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        togglePlay();
      }, 220);
    },
    [togglePlay]
  );

  const handleVideoDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      event.preventDefault();
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      void toggleFullscreen();
    },
    [toggleFullscreen]
  );

  const buildProgressPayload = useCallback(
    (completedOverride?: boolean) => {
      const video = videoRef.current;
      if (!video || !tracking || isYouTube || isExternal) return null;
      const durationMs =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.round(video.duration * 1000)
          : null;
      const positionMs = Math.round(video.currentTime * 1000);
      if (positionMs <= 0) return null;
      const completed =
        completedOverride ??
        (durationMs !== null ? positionMs / durationMs >= 0.95 : false);
      return { ...tracking, positionMs, durationMs, completed };
    },
    [tracking, isYouTube, isExternal]
  );

  const saveProgress = useCallback(
    (completedOverride?: boolean, invalidate = false) => {
      const payload = buildProgressPayload(completedOverride);
      if (!payload) return;
      void api
        .savePlaybackProgress(payload)
        .then(() => {
          if (invalidate) {
            void queryClient.invalidateQueries({ queryKey: ['playback-continue'] });
          }
        })
        .catch(() => undefined);
    },
    [buildProgressPayload, queryClient]
  );

  const restartPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setEnded(false);
    video.currentTime = 0;
    setCurrentTime(0);
    setControlsVisible(true);
    void video.play().catch(() => undefined);
  }, []);

  // Retoma de onde parou ao abrir o mesmo filme/episódio.
  useEffect(() => {
    setEnded(false);
    setResumedAt(null);
    lastSaveRef.current = 0;
    userSeekedRef.current = false;
    if (!tracking || isYouTube || isExternal) return;

    let cancelled = false;
    void api
      .playbackProgress(tracking.metaId, tracking.videoId)
      .then(({ progress }) => {
        if (cancelled || !progress || progress.completed) return;
        const savedDuration = progress.durationMs ?? 0;
        if (savedDuration > 0 && progress.positionMs / savedDuration >= 0.95) return;
        if (progress.positionMs < 5000) return;
        const seconds = progress.positionMs / 1000;
        resumeAtRef.current = seconds;
        setResumedAt(seconds);
        const video = videoRef.current;
        if (
          video &&
          video.readyState >= 1 &&
          !userSeekedRef.current &&
          video.currentTime < 10
        ) {
          video.currentTime = seconds;
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [tracking?.metaId, tracking?.videoId, isYouTube, isExternal]);

  useEffect(() => {
    if (resumedAt === null) return;
    const timer = window.setTimeout(() => setResumedAt(null), 4500);
    return () => window.clearTimeout(timer);
  }, [resumedAt]);

  // Salva o último ponto ao desmontar/fechar o player (sem depender do fetch).
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (!video || !tracking || isYouTube || isExternal) return;
      const durationMs =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.round(video.duration * 1000)
          : null;
      const positionMs = Math.round(video.currentTime * 1000);
      if (positionMs <= 0) return;
      const payload = {
        ...tracking,
        positionMs,
        durationMs,
        completed: durationMs !== null ? positionMs / durationMs >= 0.95 : false
      };
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/playback/progress', blob);
      } catch {
        void fetch('/api/playback/progress', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: ['playback-continue'] });
    };
  }, [tracking?.metaId, tracking?.videoId, tracking?.name, isYouTube, isExternal, queryClient]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, sourceUrl]);

  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
      setControlsVisible(true);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!isPlaying || menu) {
      setControlsVisible(true);
      clearHideTimer();
      return;
    }
    scheduleHide();
    return clearHideTimer;
  }, [isPlaying, menu, scheduleHide, clearHideTimer]);

  useEffect(() => {
    if (!error) return;
    setControlsVisible(true);
    clearHideTimer();
  }, [error, clearHideTimer]);

  useEffect(() => {
    setCurrentTime(0);
    setBufferedEnd(0);
    setDuration(0);
  }, [sourceUrl]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    };
  }, []);

  // Atalhos globais: funcionam mesmo sem clicar no vídeo e dentro do fullscreen.
  useEffect(() => {
    if (isYouTube || isExternal || !hasControls) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      const isTextEntry =
        element &&
        (element.closest('textarea') ||
          element.closest('select') ||
          element.closest('[contenteditable="true"]') ||
          (element instanceof HTMLInputElement &&
            !['range', 'checkbox', 'radio', 'button'].includes(element.type)));
      if (isTextEntry) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      const isRangeInput = element instanceof HTMLInputElement && element.type === 'range';
      if (
        isRangeInput &&
        (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown')
      ) {
        // Deixa o slider de volume tratar as setas nativamente.
        return;
      }
      if (
        key === ' ' &&
        element &&
        (element.closest('button') || element.closest('a'))
      ) {
        // Espaço em um botão focado deve ativar o próprio botão.
        return;
      }
      if (key === 'escape') {
        if (menu && !document.fullscreenElement) {
          event.preventDefault();
          setMenu(null);
        }
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (key === ' ' || key === 'k') {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (key === 'arrowleft') {
        event.preventDefault();
        seekBy(-skipSeconds);
        return;
      }
      if (key === 'arrowright') {
        event.preventDefault();
        seekBy(skipSeconds);
        return;
      }
      if (key === 'arrowup') {
        event.preventDefault();
        changeVolume(0.05);
        return;
      }
      if (key === 'arrowdown') {
        event.preventDefault();
        changeVolume(-0.05);
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isYouTube,
    isExternal,
    hasControls,
    menu,
    skipSeconds,
    toggleFullscreen,
    togglePlay,
    seekBy,
    changeVolume,
    toggleMute
  ]);

  const playedPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const bufferedPercent =
    duration > 0 ? Math.min(100, Math.max(0, (bufferedEnd / duration) * 100)) : 0;
  const controlsClass = controlsVisible
    ? 'opacity-100'
    : 'pointer-events-none opacity-0';

  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-black">
      <style>{subtitleCueCss}</style>
      <div
        ref={stageRef}
        className={cn(
          'player-stage relative aspect-video w-full overflow-hidden bg-black',
          !controlsVisible && isPlaying ? 'cursor-none' : 'cursor-default'
        )}
        onPointerMove={showControls}
        onPointerDown={showControls}
      >
        {isYouTube && stream.ytId ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(stream.ytId)}?autoplay=1&rel=0`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : isExternal ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-bg via-elevated to-bg p-6 text-center">
            <p className="text-sm text-muted">{t('Este stream precisa ser aberto no site de origem.')}</p>
            {stream.externalUrl ? (
              <a
                href={stream.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                <ExternalLink className="h-4 w-4" /> {t('Abrir stream')}
              </a>
            ) : null}
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-medium text-accent hover:underline"
            >
              {t('Voltar para a lista')}
            </button>
          </div>
        ) : hasControls ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            preload="metadata"
            onClick={handleVideoClick}
            onDoubleClick={handleVideoDoubleClick}
            onPlay={() => {
              setIsPlaying(true);
              showControls();
            }}
            onPause={() => {
              setIsPlaying(false);
              setControlsVisible(true);
              saveProgress(undefined, true);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setControlsVisible(true);
              setEnded(true);
              saveProgress(true, true);
            }}
            onSeeked={() => {
              lastSaveRef.current = Date.now();
              saveProgress(undefined, true);
            }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              setCurrentTime(video.currentTime);
              const now = Date.now();
              if (!video.paused && now - lastSaveRef.current >= 5000) {
                lastSaveRef.current = now;
                saveProgress();
              }
            }}
            onDurationChange={(event) => {
              const value = event.currentTarget.duration;
              setDuration(Number.isFinite(value) ? value : 0);
            }}
            onProgress={(event) => {
              const video = event.currentTarget;
              const last = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;
              setBufferedEnd(last);
            }}
            onVolumeChange={(event) => {
              const video = event.currentTarget;
              setVolume(video.volume);
              setMuted(video.muted);
            }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              if (resumeAtRef.current) {
                if (!Number.isFinite(video.duration) || video.duration > resumeAtRef.current) {
                  video.currentTime = resumeAtRef.current;
                }
                resumeAtRef.current = null;
              }
              setError(null);
            }}
            onError={() => {
              // Android: o WebView pode não decodificar HEVC/4K. O player
              // nativo (Media3) tenta o mesmo endereço antes de desistir.
              if (
                isAndroidShell() &&
                window.HubNative &&
                !isTorrent &&
                !isYouTube &&
                !isExternal &&
                playbackUrl
              ) {
                window.HubNative.playTorrent(
                  JSON.stringify({
                    url: playbackUrl,
                    title,
                    tracking: tracking ?? null
                  })
                );
                onBack();
                return;
              }
              if (!transcodedUrl && retryWithTranscode()) return;
              setError(t('Não foi possível reproduzir este stream.'));
            }}
            className="hub-player-video h-full w-full bg-black object-contain outline-none focus:outline-none"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted">{t('Este stream não tem uma URL reproduzível.')}</p>
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-medium text-accent hover:underline"
            >
              {t('Voltar para a lista')}
            </button>
          </div>
        )}

        {isTorrent && torrentPreparing ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/85 p-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <p className="text-sm font-medium text-white">{t('Preparando torrent…')}</p>
            <p className="max-w-sm text-[11px] leading-relaxed text-white/55">
              {t('Conectando aos peers e analisando o vídeo. O primeiro segmento pode levar alguns segundos.')}
            </p>
          </div>
        ) : null}

        {ended ? (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
            <button
              type="button"
              onClick={closePlayer}
              aria-label={t('Fechar player')}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold text-white">
              {tracking?.type === 'series' ? t('Fim do episódio') : t('Fim do vídeo')}
            </p>
            {nextEpisode && onNextEpisode ? (
              <>
                <button
                  type="button"
                  onClick={onNextEpisode}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  <Play className="h-4 w-4 fill-current" /> {t('Próximo episódio')}
                </button>
                <p className="max-w-xs text-[10px] leading-relaxed text-white/55">
                  S{nextEpisode.season}E{nextEpisode.episode}
                  {nextEpisode.name ? ` · ${nextEpisode.name}` : ''} — {t('escolha um stream na lista.')}
                </p>
              </>
            ) : tracking?.type === 'series' ? (
              <p className="text-xs text-white/60">{t('Não há próximo episódio disponível.')}</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={restartPlayback}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20"
              >
                <RotateCcw className="h-3.5 w-3.5" /> {t('Reiniciar')}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {t('Voltar aos streams')}
              </button>
            </div>
          </div>
        ) : null}

        <div
          data-player-top
          className={cn(
            'absolute inset-x-0 top-0 z-30 flex items-start gap-2 bg-gradient-to-b from-black/85 to-transparent p-3 transition-opacity duration-300',
            controlsClass
          )}
        >
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-black/50 px-2.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/70"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Streams
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{title}</p>
            <p className="truncate text-[10px] text-white/65">
              {[stream.addonName, stream.quality, stream.name, size]
                .filter(Boolean)
                .join(' · ')}
              {stream.kind === 'torrent' ? ` · torrent (${t('motor embutido')})` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={closePlayer}
            aria-label={t('Fechar player')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {hasControls ? (
          <div
            className={cn(
              'absolute right-3 top-14 z-30 flex items-center gap-1.5 transition-opacity duration-300',
              controlsClass
            )}
          >
            <button
              type="button"
              onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}
              aria-label={t('Escolher legenda')}
              aria-expanded={menu === 'subtitles'}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg bg-black/55 px-2.5 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/75',
                activeSubtitle ? 'ring-1 ring-white/35' : ''
              )}
            >
              <Captions className="h-3.5 w-3.5" />
              {activeSubtitle ? (
                <span className="max-w-[8rem] truncate">{activeSubtitle.language}</span>
              ) : (
                <span>{t('Legendas')}</span>
              )}
            </button>

            {showAudioButton ? (
              <button
                type="button"
                onClick={() => setMenu(menu === 'audio' ? null : 'audio')}
                aria-label={t('Escolher faixa de áudio')}
                aria-expanded={menu === 'audio'}
                className="inline-flex h-8 max-w-[12rem] items-center gap-1.5 rounded-lg bg-black/55 px-2.5 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/75"
              >
                <Volume2 className="h-3.5 w-3.5" />
                <span className="truncate">{audioButtonLabel}</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {resumedAt !== null && !isYouTube && !isExternal ? (
          <div className="absolute left-3 top-14 z-30 inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur">
            <RotateCw className="h-3.5 w-3.5" /> {t('Retomando de')} {formatTime(resumedAt)}
          </div>
        ) : null}

        {hasControls && !torrentPreparing && !error ? (
          <div
            data-player-controls
            className={cn(
              'absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-3 pb-2 pt-10 transition-opacity duration-300',
              controlsClass
            )}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-white/85">
                {formatTime(currentTime)}
              </span>
              <div
                ref={progressRef}
                role="slider"
                tabIndex={0}
                aria-label={t('Progresso do vídeo')}
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
                aria-valuenow={Math.floor(currentTime)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDraggingSeek(true);
                  seekToClientX(event.clientX);
                  showControls();
                }}
                onPointerMove={(event) => {
                  if (draggingSeek) seekToClientX(event.clientX);
                }}
                onPointerUp={(event) => {
                  setDraggingSeek(false);
                  try {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  } catch {
                    // ponteiro já liberado
                  }
                }}
                onPointerCancel={() => setDraggingSeek(false)}
                className="group relative flex h-6 flex-1 cursor-pointer items-center outline-none"
              >
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-white"
                    style={{ width: `${playedPercent}%` }}
                  />
                </div>
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ left: `${playedPercent}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-[10px] tabular-nums text-white/55">
                {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? t('Pausar') : t('Reproduzir')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition hover:bg-white/15 hover:text-white"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => seekBy(-skipSeconds)}
                aria-label={`${t('Voltar')} ${skipSeconds} ${t('segundos')}`}
                title={`${t('Voltar')} ${skipSeconds} ${t('segundos')} (←)`}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition hover:bg-white/15 hover:text-white"
              >
                <RotateCcw className="h-4 w-4" />
                <span className="absolute text-[7px] font-bold">{skipSeconds}</span>
              </button>
              <button
                type="button"
                onClick={() => seekBy(skipSeconds)}
                aria-label={`${t('Avançar')} ${skipSeconds} ${t('segundos')}`}
                title={`${t('Avançar')} ${skipSeconds} ${t('segundos')} (→)`}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition hover:bg-white/15 hover:text-white"
              >
                <RotateCw className="h-4 w-4" />
                <span className="absolute text-[7px] font-bold">{skipSeconds}</span>
              </button>

              <div className="ml-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? t('Ativar som') : t('Silenciar')}
                  title={muted ? t('Ativar som (M)') : t('Silenciar (M)')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition hover:bg-white/15 hover:text-white"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    const video = videoRef.current;
                    if (video) {
                      video.muted = false;
                      video.volume = value;
                      setVolume(value);
                      setMuted(false);
                    }
                    showControls();
                  }}
                  aria-label={t('Volume')}
                  title={t('Volume (↑/↓)')}
                  className="hidden h-1 w-16 cursor-pointer accent-white sm:block"
                />
              </div>

              <span className="ml-auto hidden pr-2 text-[10px] text-white/35 sm:block">
                F {t('tela cheia')} · ←/→ {skipSeconds}s · ↑/↓ {t('volume')}
              </span>

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? t('Sair da tela cheia') : t('Tela cheia')}
                title={isFullscreen ? t('Sair da tela cheia (F)') : t('Tela cheia (F)')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition hover:bg-white/15 hover:text-white"
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </div>
          </div>
        ) : null}

        {menu ? (
          <button
            type="button"
            aria-label={t('Fechar menu do player')}
            onClick={() => setMenu(null)}
            className="absolute inset-0 z-20 cursor-default bg-transparent"
          />
        ) : null}

        {menu === 'subtitles' ? (
          <div className="absolute right-3 top-[6.3rem] z-30 w-[min(21rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-black/92 text-left shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <p className="text-xs font-semibold text-white">{t('Legendas')}</p>
              <span className="text-[10px] text-white/55">
                {subtitlesQuery.isLoading
                  ? t('buscando…')
                  : `${subtitleList?.length ?? 0} ${t('disponíveis')}`}
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedSubtitle(null);
                  setMenu(null);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition',
                  selectedSubtitle === null
                    ? 'bg-white/15 text-white'
                    : 'text-white/75 hover:bg-white/10'
                )}
              >
                <Check
                  className={cn('h-3.5 w-3.5 shrink-0', selectedSubtitle === null ? 'opacity-100' : 'opacity-0')}
                />
                {t('Desligada')}
              </button>

              {subtitlesQuery.isLoading ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-white/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Consultando os addons…')}
                </div>
              ) : null}

              {subtitlesQuery.isError ? (
                <div className="space-y-1.5 px-2.5 py-2">
                  <p className="text-xs text-red-300">
                    {subtitlesQuery.error instanceof Error
                      ? subtitlesQuery.error.message
                      : t('Não foi possível buscar as legendas.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void subtitlesQuery.refetch()}
                    className="text-[11px] font-medium text-accent hover:underline"
                  >
                    {t('Tentar novamente')}
                  </button>
                </div>
              ) : null}

              {!subtitlesQuery.isLoading && !subtitlesQuery.isError && subtitleList?.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-white/60">
                  {t(
                    'Nenhuma legenda encontrada para este título/episódio. Confira os addons de legendas em Configurações → Addons.'
                  )}
                </p>
              ) : null}

              {subtitleOptions.map((subtitle) => {
                const active = subtitle.proxyUrl === selectedSubtitle;
                return (
                  <button
                    key={subtitle.proxyUrl}
                    type="button"
                    onClick={() => {
                      setSelectedSubtitle(subtitle.proxyUrl);
                      setMenu(null);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition',
                      active ? 'bg-white/15' : 'hover:bg-white/10'
                    )}
                  >
                    <Check
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0 text-white',
                        active ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-white">
                        {subtitle.language}
                        {subtitle.optionNumber > 1 ? ` · ${t('opção')} ${subtitle.optionNumber}` : ''}
                      </span>
                      <span className="block truncate text-[10px] text-white/50">
                        {subtitle.addonName} · {subtitle.lang}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {subtitlesQuery.data?.errors.length ? (
              <div className="border-t border-white/10 px-3 py-2 text-[10px] leading-relaxed text-white/45">
                {subtitlesQuery.data.errors.map((item) => (
                  <p key={item.addonId}>
                    <span className="text-white/65">{item.addonName}:</span> {item.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {menu === 'audio' ? (
          <div className="absolute right-3 top-[6.3rem] z-30 w-[min(20rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-black/92 text-left shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
              <p className="text-xs font-semibold text-white">{t('Faixa de áudio')}</p>
              <span className="text-[10px] text-white/55">{audioOptions.length} {t('faixas')}</span>
            </div>
            <div className="max-h-56 overflow-y-auto p-1.5">
              {audioOptions.length === 0 ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-white/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Preparando as faixas…')}
                </div>
              ) : (
                audioOptions.map((option) => {
                  const active = option.index === activeAudio;
                  return (
                    <button
                      key={option.index}
                      type="button"
                      onClick={() => selectAudio(option.index)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition',
                        active ? 'bg-white/15' : 'hover:bg-white/10'
                      )}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-3.5 w-3.5 shrink-0 text-white',
                          active ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-white">
                          {option.label}
                        </span>
                        {option.detail || option.lang ? (
                          <span className="block truncate text-[10px] text-white/50">
                            {option.detail ??
                              [languageLabel(option.lang), option.lang]
                                .filter((value): value is string => Boolean(value))
                                .filter(
                                  (value, index, values) => values.indexOf(value) === index
                                )
                                .join(' · ')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {transcodedUrl ? (
              <p className="border-t border-white/10 px-3 py-2 text-[10px] text-white/40">
                {t('Faixas via transcodificação do Stremio Server.')}
              </p>
            ) : isTorrent && torrentPrep ? (
              <p className="border-t border-white/10 px-3 py-2 text-[10px] text-white/40">
                {t('Faixas via FFmpeg do motor embutido.')}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/90 to-transparent p-3">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-black/70 px-3 py-2 text-[11px] text-white/85 backdrop-blur-sm">
              <span className="min-w-0 flex-1">
                {error}
                {stream.kind === 'torrent' && !isTorrent
                  ? ` ${t('Abra o Stremio para iniciar o Stremio Server local e tente novamente.')}`
                  : stream.kind === 'torrent'
                    ? ` ${t('Aguarde mais seeds ou escolha outro stream.')}`
                    : ''}
              </span>
              {stream.externalUrl || stream.url ? (
                <a
                  href={stream.externalUrl ?? stream.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> {t('Abrir link')}
                </a>
              ) : null}
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 font-medium text-white hover:underline"
              >
                <Play className="h-3 w-3" /> {t('Outro stream')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
