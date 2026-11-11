/**
 * Streaming de torrents pelo motor embutido (WebTorrent + FFmpeg).
 * Rotas locais: preparação, arquivo bruto com Range e HLS sob demanda.
 */
import { Router } from 'express';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import {
  getHlsPlaylist,
  getHlsSegment,
  getSession,
  prepareTorrent,
  torrentContentType
} from '../../lib/stremio/torrent/engine';
import { createLogger } from '../../lib/logger';
import { HttpError, parseBody } from '../errors';

export const stremioTorrentRouter = Router();
const log = createLogger('torrent');
const MAX_RANGE_RESPONSE = 16 * 1024 * 1024;

// O motor baixa torrents e lê arquivos locais; só pode ser usado do próprio PC.
stremioTorrentRouter.use((req, _res, next) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const local =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost';
  if (!local) {
    throw new HttpError(403, 'Os torrents só podem ser usados a partir do próprio computador.', 'forbidden');
  }
  next();
});

stremioTorrentRouter.post('/stremio/torrent/prepare', async (req, res) => {
  const body = parseBody(
    z.object({
      infoHash: z.string().trim().regex(/^[a-f0-9]{40}$/i),
      fileIdx: z.number().int().min(-1).max(100_000).nullable().optional(),
      sources: z.array(z.string().trim().min(1).max(2048)).max(100).optional()
    }),
    req.body
  );

  try {
    res.json(await prepareTorrent(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao preparar o torrent.';
    log.warn(message);
    throw new HttpError(422, message, 'torrent');
  }
});

stremioTorrentRouter.get('/stremio/torrent/:sessionId/raw', async (req, res) => {
  let session;
  try {
    session = getSession(req.params.sessionId);
  } catch (error) {
    throw new HttpError(404, error instanceof Error ? error.message : 'Sessão não encontrada.', 'not_found');
  }

  const file = session.file;
  const total = file.length;
  if (!total || total <= 0) throw new HttpError(416, 'Arquivo do torrent vazio.', 'range');

  const range = req.headers.range?.trim();
  let start = 0;
  let end = total - 1;
  let status = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
    if (!match) {
      res.setHeader('content-range', `bytes */${total}`);
      throw new HttpError(416, 'Range inválido.', 'range');
    }

    if (!match[1] && match[2]) {
      // Sufixo: bytes=-N
      const suffix = Number(match[2]);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        res.setHeader('content-range', `bytes */${total}`);
        throw new HttpError(416, 'Range inválido.', 'range');
      }
      start = Math.max(0, total - suffix);
    } else {
      start = Number(match[1] || 0);
      if (match[2]) end = Number(match[2]);
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start >= total ||
      end < start
    ) {
      res.setHeader('content-range', `bytes */${total}`);
      throw new HttpError(416, 'Range fora do arquivo.', 'range');
    }
    end = Math.min(end, total - 1);
    // ffprobe/ffmpeg pedem "bytes=0-" achando que vão ler o arquivo inteiro.
    // Limitar cada resposta evita selecionar 20 GB e travar seeks no meio.
    if (end - start + 1 > MAX_RANGE_RESPONSE) {
      end = start + MAX_RANGE_RESPONSE - 1;
    }
    status = 206;
  }

  res.status(status);
  res.setHeader('content-type', torrentContentType(file.name));
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-length', String(end - start + 1));
  res.setHeader('cache-control', 'no-store');
  if (status === 206) {
    res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  try {
    const stream = file.createReadStream({ start, end });
    await pipeline(stream, res);
  } catch (error) {
    if (!res.headersSent) {
      throw new HttpError(502, 'Não foi possível ler o arquivo do torrent.', 'network');
    }
    // Cliente cancelou ou a conexão caiu; mantém o torrent para a próxima tentativa.
    res.destroy();
    void error;
  }
});

stremioTorrentRouter.get('/stremio/torrent/:sessionId/hls/:audio/index.m3u8', (req, res) => {
  const audioIndex = Number(req.params.audio);
  try {
    const playlist = getHlsPlaylist(req.params.sessionId, audioIndex);
    res.setHeader('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.send(playlist);
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : 'Falha ao montar o HLS.', 'torrent');
  }
});

stremioTorrentRouter.get('/stremio/torrent/:sessionId/hls/:audio/:segment', async (req, res) => {
  const match = /^segment(\d+)\.ts$/.exec(req.params.segment);
  if (!match) throw new HttpError(404, 'Segmento não encontrado.', 'not_found');

  try {
    const filePath = await getHlsSegment(
      req.params.sessionId,
      Number(req.params.audio),
      Number(match[1])
    );
    res.setHeader('content-type', 'video/mp2t');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.sendFile(filePath);
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : 'Falha ao gerar o segmento.', 'torrent');
  }
});
