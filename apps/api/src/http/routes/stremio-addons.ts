/**
 * Addons do Stremio: CRUD, importação da conta, diagnóstico e catálogos.
 * Rotas locais e URLs sempre mascaradas na resposta.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  addAddon,
  getCardInfoForTitles,
  getCatalogPage,
  getStreamsForTitle,
  getSubtitlesForTitle,
  importAddonsFromAccount,
  listAddons,
  listCatalogGroups,
  probeStreamForAudio,
  removeAddon,
  reorderAddons,
  searchAllAddons,
  testAddon,
  updateAddon
} from '../../domain/stremio-addons';
import { getStremioServerStatus } from '../../lib/stremio/server';
import { fetchSubtitleAsVtt } from '../../lib/stremio/subtitles';
import { proxyStremioHls } from '../../lib/stremio/hls-proxy';
import { AddonHttpError } from '../../lib/stremio/addons/http';
import { ConnectorError } from '../../connectors/types';
import { StremioApiError } from '../../lib/stremio/api';
import { createLogger } from '../../lib/logger';
import { broadcast } from '../../sse';
import { HttpError, parseBody } from '../errors';

export const stremioAddonsRouter = Router();
const log = createLogger('addons');

// Addons e catálogos só podem ser gerenciados a partir do próprio computador.
stremioAddonsRouter.use((req, _res, next) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  if (!local) {
    throw new HttpError(403, 'Os addons só podem ser gerenciados a partir do próprio computador.', 'forbidden');
  }
  next();
});

function mapAddonError(error: unknown): HttpError {
  if (error instanceof AddonHttpError) {
    return new HttpError(error.status >= 400 ? Math.min(error.status, 599) : 502, error.message, error.code);
  }
  if (error instanceof StremioApiError) {
    return new HttpError(error.status === 401 ? 401 : 502, error.message, 'stremio');
  }
  if (error instanceof ConnectorError) {
    const status =
      error.code === 'not_found'
        ? 404
        : error.code === 'auth'
          ? 401
          : error.code === 'blocked'
            ? 403
            : error.code === 'rate_limited'
              ? 429
              : error.code === 'network' || error.code === 'layout_changed'
                ? 502
                : 422;
    return new HttpError(status, error.message, error.code);
  }
  if (error instanceof Error) return new HttpError(422, error.message, 'addon');
  return new HttpError(500, 'Falha ao processar o addon.', 'addon');
}

stremioAddonsRouter.get('/stremio/addons', (_req, res) => {
  res.json({ addons: listAddons() });
});

stremioAddonsRouter.post('/stremio/addons', async (req, res) => {
  const body = parseBody(z.object({ url: z.string().trim().min(3).max(2048) }), req.body);
  try {
    const addon = await addAddon(body.url);
    log.info(`addon adicionado: ${addon.name}`);
    broadcast('stremio:changed', { addons: true });
    res.status(201).json({ addon });
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.patch('/stremio/addons/:id', async (req, res) => {
  const body = parseBody(
    z
      .object({
        url: z.string().trim().min(3).max(2048),
        name: z.string().trim().min(1).max(120),
        enabled: z.boolean(),
        priority: z.number().int().min(0).max(1_000_000)
      })
      .partial()
      .refine((value) => Object.keys(value).length > 0, { message: 'Nenhum campo para atualizar.' }),
    req.body
  );

  try {
    const addon = await updateAddon(req.params.id, body);
    log.info(`addon atualizado: ${addon.name}`);
    broadcast('stremio:changed', { addons: true });
    res.json({ addon });
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.delete('/stremio/addons/:id', (req, res) => {
  try {
    removeAddon(req.params.id);
    log.info('addon removido');
    broadcast('stremio:changed', { addons: true });
    res.status(204).end();
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.post('/stremio/addons/reorder', (req, res) => {
  const body = parseBody(
    z.object({
      ids: z.array(z.string().trim().min(1).max(64)).min(1).max(500)
    }),
    req.body
  );

  try {
    const addons = reorderAddons(body.ids);
    broadcast('stremio:changed', { addons: true });
    res.json({ addons });
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.post('/stremio/addons/import', async (_req, res) => {
  try {
    const summary = await importAddonsFromAccount();
    broadcast('stremio:changed', { addons: true });
    res.json(summary);
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.post('/stremio/addons/:id/test', async (req, res) => {
  try {
    const summary = await testAddon(req.params.id);
    broadcast('stremio:changed', { addons: true });
    res.json({ summary });
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.get('/stremio/catalogs', (_req, res) => {
  res.json({ catalogs: listCatalogGroups() });
});

stremioAddonsRouter.get('/stremio/catalog', async (req, res) => {
  const body = parseBody(
    z.object({
      addonId: z.string().trim().min(1).max(64),
      type: z.string().trim().min(1).max(40),
      catalogId: z.string().trim().min(1).max(200),
      search: z.string().trim().max(200).optional(),
      skip: z.coerce.number().int().min(0).max(100_000).optional(),
      genre: z.string().trim().max(80).optional()
    }),
    req.query
  );

  try {
    res.json(await getCatalogPage(body));
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.get('/stremio/search', async (req, res) => {
  const body = parseBody(
    z.object({
      query: z.string().trim().min(2).max(200),
      type: z.string().trim().min(1).max(30).optional()
    }),
    req.query
  );

  try {
    res.json(await searchAllAddons(body));
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.get('/stremio/server', async (_req, res) => {
  res.json(await getStremioServerStatus());
});

stremioAddonsRouter.post('/stremio/card-info', async (req, res) => {
  const body = parseBody(
    z.object({
      items: z
        .array(
          z.object({
            type: z.string().trim().min(2).max(30),
            id: z.string().trim().min(1).max(300),
            name: z.string().trim().max(300).optional().nullable()
          })
        )
        .min(1)
        .max(30)
    }),
    req.body
  );

  for (const item of body.items) {
    if (!/^[a-z0-9_-]{2,30}$/i.test(item.type)) {
      throw new HttpError(400, 'Tipo inválido no item.', 'validation');
    }
  }

  try {
    res.json({ items: await getCardInfoForTitles(body.items) });
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.get('/stremio/streams', async (req, res) => {
  const body = parseBody(
    z.object({
      type: z.string().trim().min(1).max(40),
      id: z.string().trim().min(1).max(300),
      season: z.coerce.number().int().min(0).max(10_000).optional(),
      episode: z.coerce.number().int().min(0).max(100_000).optional(),
      videoId: z.string().trim().min(1).max(300).optional(),
      refresh: z.enum(['0', '1']).optional()
    }),
    req.query
  );

  try {
    res.json(
      await getStreamsForTitle({
        ...body,
        refresh: body.refresh === '1'
      })
    );
  } catch (error) {
    throw mapAddonError(error);
  }
});

stremioAddonsRouter.get('/stremio/subtitles', async (req, res) => {
  const body = parseBody(
    z.object({
      type: z.string().trim().min(1).max(40),
      id: z.string().trim().min(1).max(300),
      season: z.coerce.number().int().min(0).max(10_000).optional(),
      episode: z.coerce.number().int().min(0).max(100_000).optional(),
      videoId: z.string().trim().min(1).max(300).optional()
    }),
    req.query
  );

  try {
    res.json(await getSubtitlesForTitle(body));
  } catch (error) {
    throw mapAddonError(error);
  }
});

/**
 * Proxy same-origin de legendas: baixa SRT/VTT do addon, detecta charset e
 * devolve WebVTT (o <track> do navegador não aceita SRT e sofreria CORS).
 */
stremioAddonsRouter.get('/stremio/subtitle', async (req, res) => {
  const body = parseBody(
    z.object({
      url: z.string().trim().min(8).max(4096),
      line: z.coerce.number().int().min(0).max(100).optional()
    }),
    req.query
  );

  try {
    const vtt = await fetchSubtitleAsVtt(body.url, body.line);
    res.setHeader('content-type', 'text/vtt; charset=utf-8');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(vtt);
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : 'Falha ao baixar a legenda.', 'addon');
  }
});

stremioAddonsRouter.get('/stremio/probe', async (req, res) => {
  const body = parseBody(
    z.object({ url: z.string().trim().min(8).max(8192) }),
    req.query
  );

  try {
    res.json(await probeStreamForAudio(body.url));
  } catch (error) {
    throw mapAddonError(error);
  }
});

/** Proxy same-origin de master/playlists/segmentos HLS do Stremio Server. */
stremioAddonsRouter.get('/stremio/hls', async (req, res) => {
  const body = parseBody(
    z.object({ url: z.string().trim().min(8).max(8192) }),
    req.query
  );

  try {
    const result = await proxyStremioHls(body.url, req.headers.range);
    for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    res.status(result.status).send(result.body);
  } catch (error) {
    throw new HttpError(
      502,
      error instanceof Error ? error.message : 'Falha ao proxiar o HLS do Stremio Server.',
      'addon'
    );
  }
});
