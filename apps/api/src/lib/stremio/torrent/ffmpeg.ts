/**
 * FFmpeg/FFprobe do motor de torrent embutido.
 * Usa os binários empacotados (ffmpeg-static/ffprobe-static), com fallback
 * para FFMPEG_PATH/FFPROBE_PATH ou para o PATH do sistema.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { StremioAudioTrackDto } from '@hub/shared';
import { subtitleLanguageName } from '../subtitles';

const execFileAsync = promisify(execFile);
const requireModule = createRequire(import.meta.url);

function resolveFfmpeg(): string {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured) return configured;
  try {
    const bundled = requireModule('ffmpeg-static') as string | null;
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // Pacote ausente: usa o binário do PATH.
  }
  return 'ffmpeg';
}

function resolveFfprobe(): string {
  const configured = process.env.FFPROBE_PATH?.trim();
  if (configured) return configured;
  try {
    const packaged = (requireModule('ffprobe-static') as { path?: string } | undefined)?.path;
    if (packaged && existsSync(packaged)) return packaged;
  } catch {
    // Pacote ausente: usa o binário do PATH.
  }
  return 'ffprobe';
}

export const FFMPEG_PATH = resolveFfmpeg();
export const FFPROBE_PATH = resolveFfprobe();

const PROBE_TIMEOUT_MS = 45_000;
const SEGMENT_TIMEOUT_MS = 150_000;

export interface MediaProbe {
  durationSec: number | null;
  container: string | null;
  videoCodec: string | null;
  videoWidth: number | null;
  audioTracks: StremioAudioTrackDto[];
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  channels?: number;
  duration?: string;
  tags?: Record<string, unknown>;
  disposition?: Record<string, unknown>;
}

interface ProbeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: ProbeStream[];
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function probeMedia(mediaUrl: string): Promise<MediaProbe> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      FFPROBE_PATH,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-analyzeduration',
        '2000000',
        '-probesize',
        '4000000',
        mediaUrl
      ],
      {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8'
      }
    );
    stdout = String(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`O ffprobe não conseguiu analisar o arquivo: ${message.slice(-300)}`);
  }

  let data: ProbeOutput;
  try {
    data = JSON.parse(stdout) as ProbeOutput;
  } catch {
    throw new Error('O ffprobe devolveu uma resposta inválida.');
  }

  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find(
    (stream) =>
      stream.codec_type === 'video' &&
      !(typeof stream.disposition === 'object' && stream.disposition?.attached_pic === 1)
  );
  const audio = streams.filter((stream) => stream.codec_type === 'audio');

  const audioTracks: StremioAudioTrackDto[] = audio.map((stream, index) => {
    const tags =
      typeof stream.tags === 'object' && stream.tags !== null ? stream.tags : {};
    const language = textOrNull(tags.language) ?? textOrNull(tags.LANGUAGE);
    return {
      index,
      language,
      languageLabel: language ? subtitleLanguageName(language) : null,
      title: textOrNull(tags.title) ?? textOrNull(tags.TITLE),
      codec: textOrNull(stream.codec_name),
      channels: numberOrNull(stream.channels)
    };
  });

  const duration =
    numberOrNull(data.format?.duration) ?? numberOrNull(video?.duration) ?? null;

  return {
    durationSec: duration,
    container: textOrNull(data.format?.format_name),
    videoCodec: textOrNull(video?.codec_name),
    videoWidth: numberOrNull(video?.width),
    audioTracks
  };
}

export interface SegmentInput {
  mediaUrl: string;
  outputPath: string;
  start: number;
  duration: number;
  audioIndex: number;
  hasAudio: boolean;
  videoWidth: number | null;
}

/** Gera um segmento MPEG-TS curto direto do arquivo do torrent. */
export async function generateHlsSegment(input: SegmentInput): Promise<void> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(input.start),
    '-t',
    String(input.duration),
    '-i',
    input.mediaUrl,
    '-map',
    '0:v:0',
    ...(input.hasAudio ? ['-map', `0:a:${input.audioIndex}`] : []),
    '-sn',
    '-dn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    ...(input.videoWidth && input.videoWidth > 1920 ? ['-vf', 'scale=1920:-2'] : []),
    '-force_key_frames',
    '0',
    ...(input.hasAudio
      ? ['-c:a', 'aac', '-b:a', '160k', '-ac', '2']
      : ['-an']),
    '-output_ts_offset',
    String(input.start),
    '-muxdelay',
    '0',
    '-muxpreload',
    '0',
    '-f',
    'mpegts',
    input.outputPath
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('O ffmpeg demorou demais para gerar o segmento.'));
    }, SEGMENT_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Não foi possível iniciar o ffmpeg: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `O ffmpeg falhou ao gerar o segmento (código ${code}).${
            stderr ? ` ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''
          }`
        )
      );
    });
  });
}
