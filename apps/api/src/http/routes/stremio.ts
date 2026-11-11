/**
 * Stremio: status da conta, conexão (senha usada uma única vez), chave manual,
 * biblioteca (somente leitura) e importação de títulos como fontes.
 *
 * O token só é devolvido por estas rotas; a senha nunca é persistida nem logada.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  disconnectStremio,
  ensureStremioSource,
  getStremioStatus,
  loginStremio,
  saveStremioAuthKey
} from '../../lib/stremio/account';
import { StremioApiError } from '../../lib/stremio/api';
import {
  importStremioLibrary,
  listStremioLibrary,
  searchStremioLibrary,
  setStremioLibraryItemState
} from '../../domain/stremio';
import { getTitleDetails, getEpisodesForTitle } from '../../domain/titles';
import { ConnectorError } from '../../connectors/types';
import { enqueueSource } from '../../scheduler';
import { broadcast } from '../../sse';
import { isAppSecretConfigured } from '../../lib/crypto';
import { HttpError, parseBody } from '../errors';

export const stremioRouter = Router();

// Dados de conta só podem ser gerenciados a partir do próprio computador.
stremioRouter.use((req, _res, next) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  if (!local) {
    throw new HttpError(403, 'O Stremio só pode ser gerenciado a partir do próprio computador.', 'forbidden');
  }
  next();
});

function mapStremioError(error: unknown): HttpError {
  if (error instanceof StremioApiError) {
    return new HttpError(error.status === 401 ? 401 : 502, error.message, 'stremio');
  }
  if (error instanceof Error) {
    return new HttpError(422, error.message, 'stremio');
  }
  return new HttpError(500, 'Falha ao falar com o Stremio.', 'stremio');
}

stremioRouter.get('/stremio/status', (_req, res) => {
  res.json(getStremioStatus());
});

stremioRouter.post('/stremio/login', async (req, res) => {
  const body = parseBody(
    z.object({
      email: z.string().trim().email(),
      password: z.string().min(1).max(200)
    }),
    req.body
  );

  if (!isAppSecretConfigured()) {
    throw new HttpError(
      422,
      'Configure APP_SECRET no .env (mínimo 16 caracteres) para criptografar o token do Stremio.',
      'config'
    );
  }

  try {
    const status = await loginStremio(body.email, body.password);
    const source = ensureStremioSource();
    if (source) enqueueSource(source.id, true);
    broadcast('stremio:changed', { connected: true });
    broadcast('source:status', { sourceId: source?.id, ok: true, itemsNew: 0, lastCheckedAt: null });
    res.json({ status });
  } catch (error) {
    throw mapStremioError(error);
  }
});

stremioRouter.post('/stremio/auth-key', async (req, res) => {
  const body = parseBody(
    z.object({
      authKey: z.string().trim().min(10).max(4096),
      email: z.string().trim().email().optional()
    }),
    req.body
  );

  if (!isAppSecretConfigured()) {
    throw new HttpError(
      422,
      'Configure APP_SECRET no .env (mínimo 16 caracteres) para criptografar o token do Stremio.',
      'config'
    );
  }

  try {
    const status = await saveStremioAuthKey(body.authKey, body.email ?? null);
    const source = ensureStremioSource();
    if (source) enqueueSource(source.id, true);
    broadcast('stremio:changed', { connected: true });
    broadcast('source:status', { sourceId: source?.id, ok: true, itemsNew: 0, lastCheckedAt: null });
    res.json({ status });
  } catch (error) {
    throw mapStremioError(error);
  }
});

stremioRouter.post('/stremio/disconnect', (_req, res) => {
  disconnectStremio();
  ensureStremioSource();
  broadcast('stremio:changed', { connected: false });
  res.json(getStremioStatus());
});

stremioRouter.post('/stremio/sync', (_req, res) => {
  const status = getStremioStatus();
  if (!status.connected) {
    throw new HttpError(422, 'Conecte sua conta do Stremio primeiro.', 'auth');
  }
  const source = ensureStremioSource();
  if (!source) throw new HttpError(500, 'Não foi possível criar a fonte da biblioteca.', 'internal');
  const queued = enqueueSource(source.id, true);
  res.status(202).json({ queued });
});

stremioRouter.get('/stremio/library', (req, res) => {
  const body = parseBody(
    z.object({ search: z.string().trim().max(200).optional() }),
    req.query
  );
  const items = body.search ? searchStremioLibrary(body.search) : listStremioLibrary();
  res.json({ items, status: getStremioStatus() });
});

stremioRouter.patch('/stremio/library/:metaId/state', (req, res) => {
  const metaId = (req.params.metaId ?? '').trim();
  if (!metaId || metaId.length > 200) {
    throw new HttpError(400, 'ID do título inválido.', 'validation');
  }

  const body = parseBody(
    z
      .object({
        isFavorite: z.boolean().optional(),
        isWatchLater: z.boolean().optional(),
        inLibrary: z.boolean().optional(),
        type: z.enum(['movie', 'series']).optional(),
        name: z.string().trim().min(1).max(300).optional(),
        poster: z.string().trim().max(2048).optional().nullable()
      })
      .refine(
        (value) =>
          value.isFavorite !== undefined ||
          value.isWatchLater !== undefined ||
          value.inLibrary !== undefined,
        { message: 'Informe isFavorite, isWatchLater e/ou inLibrary.' }
      ),
    req.body
  );

  const state = setStremioLibraryItemState(metaId, {
    isFavorite: body.isFavorite,
    isWatchLater: body.isWatchLater,
    inLibrary: body.inLibrary,
    metaType: body.type,
    name: body.name,
    poster: body.poster
  });
  if (!state) {
    throw new HttpError(
      422,
      'Informe type e name para salvar no Hub um título que não está na biblioteca do Stremio.',
      'validation'
    );
  }
  res.json(state);
});

stremioRouter.get('/stremio/title/:type/:id', async (req, res) => {
  const type = (req.params.type ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(type)) {
    throw new HttpError(400, 'Tipo inválido.', 'validation');
  }

  const id = (req.params.id ?? '').trim();
  if (!id || id.length > 200) {
    throw new HttpError(400, 'ID do título inválido.', 'validation');
  }

  const nameHint =
    typeof req.query.name === 'string' && req.query.name.trim()
      ? req.query.name.trim().slice(0, 200)
      : null;

  try {
    res.json(await getTitleDetails(type, id, nameHint));
  } catch (error) {
    if (error instanceof ConnectorError) {
      throw new HttpError(error.code === 'not_found' ? 404 : 422, error.message, error.code);
    }
    throw error;
  }
});

stremioRouter.get('/stremio/title/:type/:id/episodes', async (req, res) => {
  const type = (req.params.type ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(type)) {
    throw new HttpError(400, 'Tipo inválido.', 'validation');
  }
  const id = (req.params.id ?? '').trim();
  if (!id || id.length > 200) {
    throw new HttpError(400, 'ID do título inválido.', 'validation');
  }

  try {
    res.json(await getEpisodesForTitle(type, id));
  } catch (error) {
    if (error instanceof ConnectorError) {
      throw new HttpError(error.code === 'not_found' ? 404 : 422, error.message, error.code);
    }
    throw error;
  }
});

stremioRouter.post('/stremio/import', async (_req, res) => {
  const status = getStremioStatus();
  if (!status.connected) {
    throw new HttpError(422, 'Conecte sua conta do Stremio primeiro.', 'auth');
  }

  try {
    const { summary, sourceIds } = await importStremioLibrary();
    for (const sourceId of sourceIds) enqueueSource(sourceId, true);
    broadcast('stremio:changed', { imported: summary.created });
    if (sourceIds.length > 0) broadcast('source:status', { ok: true, itemsNew: 0, lastCheckedAt: null });
    res.json(summary);
  } catch (error) {
    throw mapStremioError(error);
  }
});
