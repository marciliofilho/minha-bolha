/**
 * Motor de torrent embutido no Hub.
 * WebTorrent baixa os pedaços e o ffmpeg gera segmentos HLS sob demanda,
 * sem depender do Stremio Server.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join } from 'node:path';
import WebTorrent, { type Torrent, type TorrentFile } from 'webtorrent';
import type { TorrentPrepareDto } from '@hub/shared';
import { env, paths } from '../../../config/env';
import { createLogger } from '../../logger';
import { generateHlsSegment, probeMedia, type MediaProbe } from './ffmpeg';

const log = createLogger('torrent');

const METADATA_TIMEOUT_MS = 45_000;
const SESSION_IDLE_MS = 2 * 60 * 60_000;
const SEGMENT_SECONDS = 4;
const MAX_SEGMENT_JOBS = 2;

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'https://tracker.tamersunion.org:443/announce',
  'http://tracker.dler.com:6969/announce',
  'http://tracker.renfei.net:8080/announce',
  'http://tracker2.dler.org:80/announce',
  'udp://explodie.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.ducks.party:1984/announce',
  'udp://tracker.peerfect.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.tryhackx.org:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce'
];

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mkv|avi|mov|wmv|flv|webm|ts|m2ts|mpg|mpeg)$/i;
const DIRECT_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const DIRECT_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const DIRECT_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);

interface TorrentSession {
  id: string;
  key: string;
  infoHash: string;
  fileIdx: number;
  torrent: Torrent;
  file: TorrentFile;
  probe: MediaProbe | null;
  probeError: string | null;
  hlsDir: string;
  lastAccess: number;
}

const sessions = new Map<string, TorrentSession>();
const sessionsByKey = new Map<string, TorrentSession>();
const preparingByKey = new Map<string, Promise<TorrentPrepareDto>>();
const segmentJobs = new Map<string, Promise<string>>();
const torrentErrors = new WeakMap<Torrent, Error>();
const torrentsWithErrorListener = new WeakSet<Torrent>();

let client: WebTorrent | null = null;
let activeSegmentJobs = 0;
const segmentQueue: Array<() => void> = [];

function attachTorrentErrorListener(torrent: Torrent): void {
  if (torrentsWithErrorListener.has(torrent)) return;
  torrentsWithErrorListener.add(torrent);
  torrent.on('error', (error: Error) => {
    torrentErrors.set(torrent, error);
    log.warn(`torrent ${torrent.infoHash?.slice(0, 8) ?? '?'}: ${error.message}`);
  });
  torrent.on('warning', (warning: Error | string) => {
    log.warn(
      `aviso do torrent ${torrent.infoHash?.slice(0, 8) ?? '?'}: ${
        warning instanceof Error ? warning.message : String(warning)
      }`
    );
  });
}

function cacheRoot(): string {
  const configured = process.env.TORRENT_CACHE_DIR?.trim();
  const root = configured
    ? isAbsolute(configured)
      ? configured
      : join(paths.repoRoot, configured)
    : join(dirname(env.dbPath), 'torrent-cache');
  mkdirSync(root, { recursive: true });
  return root;
}

function getClient(): WebTorrent {
  if (client) return client;
  const root = cacheRoot();
  client = new WebTorrent({ dht: true, tracker: true, path: root });
  client.on('error', (error: Error) => log.warn(`cliente webtorrent: ${error.message}`));
  client.on('warning', (warning: Error | string) =>
    log.warn(`aviso webtorrent: ${warning instanceof Error ? warning.message : String(warning)}`)
  );
  log.info(
    `cliente webtorrent criado: dht=${Boolean(client.dht)} tracker=${Boolean(
      client.tracker
    )} path=${root}`
  );
  return client;
}

function trackersFromSources(sources: string[]): string[] {
  const fromSources = sources
    .map((source) => source.trim())
    .filter((source) => source.startsWith('tracker:'))
    .map((source) => source.slice('tracker:'.length))
    .filter((source) => /^(https?|udp|wss?):\/\//i.test(source));
  return [...new Set([...fromSources, ...DEFAULT_TRACKERS])];
}

async function waitForMetadata(torrent: Torrent): Promise<void> {
  if (torrent.ready) return;
  const deadline = Date.now() + METADATA_TIMEOUT_MS;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const error = torrentErrors.get(torrent);
    if (error) throw new Error(`O torrent falhou: ${error.message}`);
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      log.info(
        `aguardando metadados ${torrent.infoHash?.slice(0, 8) ?? '?'}: ready=${String(
          torrent.ready
        )} peers=${torrent.numPeers ?? '?'}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (torrent.ready) return;
  }
  throw new Error('O torrent não retornou metadados a tempo. Verifique os seeds/peers.');
}

async function openTorrent(infoHash: string, sources: string[]): Promise<Torrent> {
  const bitTorrent = getClient();
  const existing = await bitTorrent.get(infoHash);
  if (existing) {
    attachTorrentErrorListener(existing);
    await waitForMetadata(existing);
    return existing;
  }

  const torrent = bitTorrent.add(infoHash, {
    announce: trackersFromSources(sources),
    path: cacheRoot()
  });
  attachTorrentErrorListener(torrent);
  log.info(
    `torrent ${infoHash.slice(0, 8)} adicionado (${trackersFromSources(sources).length} trackers)`
  );
  await waitForMetadata(torrent);
  return torrent;
}

function pickFile(
  torrent: Torrent,
  requestedIndex: number | null
): { file: TorrentFile; fileIdx: number } {
  if (torrent.files.length === 0) throw new Error('O torrent não contém arquivos.');

  if (
    requestedIndex !== null &&
    Number.isInteger(requestedIndex) &&
    requestedIndex >= 0 &&
    requestedIndex < torrent.files.length
  ) {
    return { file: torrent.files[requestedIndex], fileIdx: requestedIndex };
  }

  let best: { file: TorrentFile; fileIdx: number } | null = null;
  torrent.files.forEach((file, fileIdx) => {
    if (!VIDEO_EXTENSIONS.test(file.name)) return;
    if (!best || file.length > best.file.length) best = { file, fileIdx };
  });

  const selected = best ?? { file: torrent.files[0], fileIdx: 0 };
  return selected;
}

function publicBase(sessionId: string): string {
  return `/api/stremio/torrent/${sessionId}`;
}

function absoluteRawUrl(sessionId: string): string {
  return `http://127.0.0.1:${env.port}${publicBase(sessionId)}/raw`;
}

function hlsUrl(sessionId: string, audioIndex: number): string {
  return `${publicBase(sessionId)}/hls/${audioIndex}/index.m3u8`;
}

function preferredAudioIndex(tracks: MediaProbe['audioTracks']): number {
  const index = tracks.findIndex((track) =>
    /^(pob|por|pt|pt-br|pt-pt)$/i.test(track.language ?? '')
  );
  return index >= 0 ? index : 0;
}

function isDirectPlayable(file: TorrentFile, probe: MediaProbe | null): boolean {
  const extension = extname(file.name).toLowerCase();
  if (!probe || probe.durationSec === null) {
    return DIRECT_EXTENSIONS.has(extension);
  }
  // O ffprobe chama o container de "matroska,webm"; MKV não é reproduzível
  // diretamente pelo Chrome, então só MP4/MOV/WebM contam como diretos.
  if (extension === '.mkv' || extension === '.avi' || extension === '.m2ts' || extension === '.ts') {
    return false;
  }
  const container = (probe.container ?? '').toLowerCase();
  const containerOk =
    DIRECT_EXTENSIONS.has(extension) || container.includes('mp4') || container.includes('mov');
  const videoOk = DIRECT_VIDEO_CODECS.has((probe.videoCodec ?? '').toLowerCase());
  const audioOk = probe.audioTracks.every((track) =>
    DIRECT_AUDIO_CODECS.has((track.codec ?? '').toLowerCase())
  );
  const singleAudio = probe.audioTracks.length <= 1;
  return containerOk && videoOk && audioOk && singleAudio;
}

function toPrepareDto(session: TorrentSession): TorrentPrepareDto {
  const probe = session.probe;
  const duration = probe?.durationSec ?? null;
  const audioTracks = probe?.audioTracks ?? [];
  const audioHlsUrls =
    duration === null
      ? []
      : audioTracks.length > 0
        ? audioTracks.map((track) => hlsUrl(session.id, track.index))
        : [hlsUrl(session.id, 0)];
  const defaultAudio = preferredAudioIndex(audioTracks);
  const directPlayable = isDirectPlayable(session.file, probe);

  return {
    sessionId: session.id,
    infoHash: session.infoHash,
    fileIdx: session.fileIdx,
    fileName: session.file.name,
    fileLength: session.file.length,
    durationSec: duration,
    container: probe?.container ?? null,
    videoCodec: probe?.videoCodec ?? null,
    audioTracks,
    directUrl: `${publicBase(session.id)}/raw`,
    directPlayable,
    hlsUrl: audioHlsUrls[defaultAudio] ?? audioHlsUrls[0] ?? null,
    audioHlsUrls,
    error: session.probeError
  };
}

async function createSession(
  infoHash: string,
  sources: string[],
  requestedFileIdx: number | null
): Promise<TorrentSession> {
  const metadataStarted = Date.now();
  const torrent = await openTorrent(infoHash, sources);
  log.info(
    `metadados de ${infoHash.slice(0, 8)} em ${Date.now() - metadataStarted} ms (${torrent.files.length} arquivos)`
  );
  const { file, fileIdx } = pickFile(torrent, requestedFileIdx);
  const key = `${infoHash}:${fileIdx}`;
  const existing = sessionsByKey.get(key);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }

  const id = randomUUID();
  const hlsDir = join(cacheRoot(), 'hls', id);
  await mkdir(hlsDir, { recursive: true });

  const session: TorrentSession = {
    id,
    key,
    infoHash,
    fileIdx,
    torrent,
    file,
    probe: null,
    probeError: null,
    hlsDir,
    lastAccess: Date.now()
  };
  sessions.set(id, session);
  sessionsByKey.set(key, session);
  return session;
}

async function ensureProbe(session: TorrentSession): Promise<void> {
  if (session.probe) return;
  try {
    const probeStarted = Date.now();
    session.probe = await probeMedia(absoluteRawUrl(session.id));
    session.probeError = null;
    log.info(
      `ffprobe de ${session.file.name} em ${Date.now() - probeStarted} ms: ${
        session.probe.videoCodec ?? '?'
      } / ${session.probe.audioTracks.length} faixa(s) de áudio`
    );
  } catch (error) {
    session.probeError = error instanceof Error ? error.message : String(error);
    log.warn(`ffprobe falhou em ${session.file.name}: ${session.probeError}`);
  }
}

export async function prepareTorrent(input: {
  infoHash: string;
  fileIdx?: number | null;
  sources?: string[];
}): Promise<TorrentPrepareDto> {
  const infoHash = input.infoHash.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(infoHash)) {
    throw new Error('InfoHash de torrent inválido.');
  }

  const requestedFileIdx =
    typeof input.fileIdx === 'number' && Number.isInteger(input.fileIdx)
      ? input.fileIdx
      : null;
  const sources = Array.isArray(input.sources) ? input.sources.slice(0, 100) : [];

  // A chave só é conhecida após escolher o arquivo; usa o par pedido para
  // compartilhar a preparação entre chamadas concorrentes do player.
  const pendingKey = `${infoHash}:${requestedFileIdx ?? -1}`;
  const pending = preparingByKey.get(pendingKey);
  if (pending) return pending;

  const promise = (async () => {
    const session = await createSession(infoHash, sources, requestedFileIdx);
    session.lastAccess = Date.now();
    await ensureProbe(session);
    return toPrepareDto(session);
  })().finally(() => preparingByKey.delete(pendingKey));

  preparingByKey.set(pendingKey, promise);
  return promise;
}

export function getSession(sessionId: string): TorrentSession {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Sessão de torrent expirada. Escolha o stream novamente.');
  session.lastAccess = Date.now();
  return session;
}

export function torrentContentType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.avi':
      return 'video/x-msvideo';
    case '.mov':
      return 'video/quicktime';
    case '.ts':
    case '.m2ts':
      return 'video/mp2t';
    case '.mpg':
    case '.mpeg':
      return 'video/mpeg';
    default:
      return 'application/octet-stream';
  }
}

export function getHlsPlaylist(sessionId: string, _audioIndex: number): string {
  const session = getSession(sessionId);
  const duration = session.probe?.durationSec ?? null;
  if (!duration || duration <= 0) {
    throw new Error('Duração desconhecida; não é possível montar o HLS.');
  }

  const count = Math.max(1, Math.ceil(duration / SEGMENT_SECONDS));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${Math.ceil(SEGMENT_SECONDS)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS'
  ];

  for (let index = 0; index < count; index += 1) {
    const start = index * SEGMENT_SECONDS;
    const length = Math.min(SEGMENT_SECONDS, duration - start);
    if (length <= 0) break;
    lines.push(`#EXTINF:${length.toFixed(3)},`);
    lines.push(`segment${index}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');

  return `${lines.join('\n')}\n`;
}

async function withSegmentSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeSegmentJobs >= MAX_SEGMENT_JOBS) {
    await new Promise<void>((resolve) => segmentQueue.push(resolve));
  }
  activeSegmentJobs += 1;
  try {
    return await task();
  } finally {
    activeSegmentJobs -= 1;
    const next = segmentQueue.shift();
    if (next) next();
  }
}

export async function getHlsSegment(
  sessionId: string,
  audioIndex: number,
  segmentIndex: number
): Promise<string> {
  const session = getSession(sessionId);
  const duration = session.probe?.durationSec ?? null;
  if (!duration || duration <= 0) throw new Error('Duração desconhecida.');
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new Error('Segmento HLS inválido.');
  }

  const start = segmentIndex * SEGMENT_SECONDS;
  if (start >= duration) throw new Error('Segmento HLS fora do arquivo.');

  const tracks = session.probe?.audioTracks ?? [];
  const selectedAudio =
    tracks.length === 0 ? 0 : Math.min(Math.max(audioIndex, 0), tracks.length - 1);
  const length = Math.min(SEGMENT_SECONDS, duration - start);
  const outputPath = join(session.hlsDir, `a${selectedAudio}_${segmentIndex}.ts`);
  if (existsSync(outputPath)) return outputPath;

  const existingJob = segmentJobs.get(outputPath);
  if (existingJob) return existingJob;

  const job = withSegmentSlot(async () => {
    if (existsSync(outputPath)) return outputPath;
    const partial = `${outputPath}.part`;
    await generateHlsSegment({
      mediaUrl: absoluteRawUrl(session.id),
      outputPath: partial,
      start,
      duration: length,
      audioIndex: selectedAudio,
      hasAudio: tracks.length > 0,
      videoWidth: session.probe?.videoWidth ?? null
    });
    await rename(partial, outputPath);
    return outputPath;
  }).finally(() => {
    segmentJobs.delete(outputPath);
  });

  segmentJobs.set(outputPath, job);
  return job;
}

function cleanupSession(session: TorrentSession): void {
  sessions.delete(session.id);
  sessionsByKey.delete(session.key);
  void rm(session.hlsDir, { recursive: true, force: true }).catch(() => undefined);

  const stillUsed = [...sessions.values()].some(
    (item) => item.infoHash === session.infoHash
  );
  if (!stillUsed && client) {
    const current = client;
    void current
      .remove(session.infoHash, { destroyStore: true }, () => undefined)
      .catch(() => undefined);
  }
}

export function getTorrentCacheRoot(): string {
  return cacheRoot();
}

/** Há torrents ativos? A limpeza automática não deve interromper streams. */
export function hasActiveTorrentSessions(): boolean {
  return sessions.size > 0;
}

/** Encerra os torrents e apaga o cache local de streams/HLS. */
export async function clearTorrentCache(): Promise<void> {
  sessions.clear();
  sessionsByKey.clear();
  preparingByKey.clear();
  segmentJobs.clear();

  if (client) {
    const current = client;
    client = null;
    await new Promise<void>((resolve) => {
      try {
        current.destroy(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  const root = cacheRoot();
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  mkdirSync(root, { recursive: true });
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const session of [...sessions.values()]) {
    if (now - session.lastAccess > SESSION_IDLE_MS) {
      log.info(`encerrando sessão de torrent ociosa: ${session.file.name}`);
      cleanupSession(session);
    }
  }
}, 60_000);
cleanupTimer.unref();
