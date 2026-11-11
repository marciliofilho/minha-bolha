/** Progresso local de filmes/séries reproduzidos no Hub. */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  deletePlaybackRow,
  getPlaybackRow,
  listPlaybackRows,
  upsertPlaybackRow
} from '../../db/repositories/playback';
import { toPlaybackProgressDto } from '../../domain/playback';
import { HttpError, parseBody } from '../errors';

export const playbackRouter = Router();

// Dados de reprodução são pessoais e ficam no próprio computador.
playbackRouter.use((req, _res, next) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const local =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost';
  if (!local) {
    throw new HttpError(403, 'O progresso só pode ser acessado do próprio computador.', 'forbidden');
  }
  next();
});

const progressBodySchema = z.object({
  metaId: z.string().trim().min(1).max(200),
  type: z.enum(['movie', 'series']),
  videoId: z.string().trim().min(1).max(300),
  season: z.number().int().min(0).max(10_000).nullable().optional(),
  episode: z.number().int().min(0).max(100_000).nullable().optional(),
  positionMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000),
  durationMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000).nullable().optional(),
  addonId: z.string().trim().max(100).nullable().optional(),
  streamSignature: z.string().trim().max(600).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  poster: z.string().trim().max(2048).nullable().optional(),
  backdrop: z.string().trim().max(2048).nullable().optional(),
  year: z.number().int().min(1800).max(3000).nullable().optional(),
  completed: z.boolean().optional()
});

const progressQuerySchema = z.object({
  metaId: z.string().trim().min(1).max(200),
  videoId: z.string().trim().min(1).max(300)
});

playbackRouter.get('/playback/progress', (req, res) => {
  const body = parseBody(progressQuerySchema, req.query);
  const row = getPlaybackRow(body.metaId, body.videoId);
  res.json({ progress: row ? toPlaybackProgressDto(row) : null });
});

playbackRouter.get('/playback/continue', (req, res) => {
  const body = parseBody(
    z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
    req.query
  );
  res.json({ items: listPlaybackRows(body.limit ?? 20).map(toPlaybackProgressDto) });
});

const saveHandler = (req: Request, res: Response): void => {
  const body = parseBody(progressBodySchema, req.body);
  const duration = body.durationMs && body.durationMs > 0 ? body.durationMs : null;
  const completed =
    body.completed ??
    (duration !== null ? body.positionMs / duration >= 0.95 : false);

  const row = upsertPlaybackRow({
    metaId: body.metaId,
    type: body.type,
    videoId: body.videoId,
    season: body.season ?? null,
    episode: body.episode ?? null,
    positionMs: body.positionMs,
    durationMs: duration,
    addonId: body.addonId ?? null,
    streamSignature: body.streamSignature ?? null,
    name: body.name,
    poster: body.poster ?? null,
    backdrop: body.backdrop ?? null,
    year: body.year ?? null,
    completed
  });

  res.json({ progress: toPlaybackProgressDto(row) });
};

playbackRouter.put('/playback/progress', saveHandler);
playbackRouter.post('/playback/progress', saveHandler);

playbackRouter.delete('/playback/progress', (req, res) => {
  const body = parseBody(progressQuerySchema, req.query);
  deletePlaybackRow(body.metaId, body.videoId);
  res.status(204).end();
});
