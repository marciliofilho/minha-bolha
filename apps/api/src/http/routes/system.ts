/** Saúde, status do scheduler, SSE, categorias e dados de demonstração. */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { HealthDto } from '@hub/shared';
import { env } from '../../config/env';
import { countItems } from '../../db/repositories/items';
import { countDemoSources, countSources, deleteDemoSources } from '../../db/repositories/sources';
import { countDemoGames, countGames, deleteDemoGames } from '../../db/repositories/games';
import { getCategory, listCategories, upsertCustomCategory } from '../../db/repositories/categories';
import { clearCaches, getStorageStats, optimizeDatabase } from '../../lib/storage';
import { clearNovelChapterCache } from '../../db/repositories/novel-cache';
import { enqueueAll, getRefreshState } from '../../scheduler';
import { seedDemoData } from '../../seed';
import { addSseClient, broadcast } from '../../sse';
import { hasSecret } from '../../lib/secrets';
import { HttpError, parseBody } from '../errors';

export const systemRouter = Router();

function assertLocal(req: Request): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const local =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost';
  if (!local) {
    throw new HttpError(
      403,
      'A manutenção de cache só pode ser executada no próprio computador.',
      'forbidden'
    );
  }

  // Evita que uma página externa dispare a limpeza de cache via CSRF.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(origin)) {
    throw new HttpError(403, 'Origem não autorizada para manutenção.', 'forbidden');
  }
}

function keyFlags() {
  return {
    tmdb: hasSecret('tmdb'),
    steam: hasSecret('steam'),
    ggdeals: hasSecret('ggdeals')
  };
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

systemRouter.get('/health', (_req, res) => {
  const counts = countItems();
  const health: HealthDto = {
    ok: true,
    version: env.version,
    phase: env.phase,
    keys: keyFlags(),
    demo: countDemoSources() > 0 || countDemoGames() > 0,
    counts: { sources: countSources(), items: counts.total, unread: counts.unread, games: countGames() }
  };
  res.json(health);
});

systemRouter.get('/status', (_req, res) => {
  res.json({
    refresh: getRefreshState(),
    keys: keyFlags(),
    demo: countDemoSources() > 0 || countDemoGames() > 0
  });
});

systemRouter.post('/refresh', (_req, res) => {
  const queued = enqueueAll(true);
  res.status(202).json({ queued, refresh: getRefreshState() });
});

systemRouter.get('/events', (req, res) => {
  addSseClient(res);
});

systemRouter.get('/categories', (_req, res) => {
  res.json({ categories: listCategories() });
});

systemRouter.post('/categories', (req, res) => {
  const body = parseBody(
    z.object({
      label: z.string().trim().min(2).max(40),
      icon: z.string().trim().min(1).max(40).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
    }),
    req.body
  );

  const id = slugify(body.label);
  if (!id) throw new HttpError(400, 'Nome de categoria inválido.', 'validation');

  const existing = getCategory(id);
  if (existing?.isSystem) {
    throw new HttpError(409, 'Já existe uma categoria do sistema com esse nome.', 'conflict');
  }
  if (existing) {
    res.json(existing);
    return;
  }

  const category = upsertCustomCategory({ id, label: body.label, icon: body.icon, color: body.color });
  broadcast('categories:changed', { categoryId: id });
  res.status(201).json(category);
});

systemRouter.get('/system/storage', async (req, res) => {
  assertLocal(req);
  res.json(await getStorageStats());
});

systemRouter.post('/system/storage/clear', async (req, res) => {
  assertLocal(req);
  res.json(await clearCaches());
});

systemRouter.post('/system/storage/clear-novels', (req, res) => {
  assertLocal(req);
  res.json(clearNovelChapterCache());
});

systemRouter.post('/system/database/optimize', async (req, res) => {
  assertLocal(req);
  try {
    res.json(await optimizeDatabase());
  } catch (error) {
    throw new HttpError(
      422,
      error instanceof Error ? error.message : 'Não foi possível compactar o banco.',
      'database'
    );
  }
});

systemRouter.post('/demo/seed', (_req, res) => {
  const result = seedDemoData(true);
  broadcast('demo:changed', result as unknown as Record<string, unknown>);
  res.status(201).json(result);
});

systemRouter.delete('/demo', (_req, res) => {
  const sources = deleteDemoSources();
  const games = deleteDemoGames();
  broadcast('demo:changed', { removed: sources + games, sources, games });
  res.json({ removed: sources + games, sources, games });
});
