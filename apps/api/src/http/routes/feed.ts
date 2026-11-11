/** Rotas do feed: listagem paginada, contadores e "marcar tudo como lido". */
import { Router } from 'express';
import { markAllReadSchema } from '@hub/shared';
import { getCategoryCounts, listFeed, markAllRead } from '../../db/repositories/items';
import { parseBody } from '../errors';

export const feedRouter = Router();

feedRouter.get('/feed', (req, res) => {
  const tab = typeof req.query.tab === 'string' ? req.query.tab : 'all';
  const sourceId = typeof req.query.sourceId === 'string' && req.query.sourceId ? req.query.sourceId : undefined;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 30;

  res.json(listFeed({ tab, sourceId, cursor, limit }));
});

feedRouter.get('/feed/counts', (_req, res) => {
  res.json({ counts: getCategoryCounts() });
});

feedRouter.post('/feed/mark-all-read', (req, res) => {
  const body = parseBody(markAllReadSchema, req.body);
  const updated = markAllRead(body.tab, body.sourceId);
  res.json({ updated });
});
