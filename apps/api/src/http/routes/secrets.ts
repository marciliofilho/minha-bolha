/** Gerenciamento das chaves de API pela interface (nunca devolve o valor). */
import { Router } from 'express';
import { z } from 'zod';
import type { SecretId } from '@hub/shared';
import {
  SECRET_IDS,
  deleteSecret,
  hasSecret,
  isValidSecretFormat,
  listSecretStatuses,
  setSecret
} from '../../lib/secrets';
import { countGames } from '../../db/repositories/games';
import { listSources, updateSource } from '../../db/repositories/sources';
import { ensureGgdealsSource } from '../../domain/games';
import { enqueueSource } from '../../scheduler';
import { broadcast } from '../../sse';
import { createLogger } from '../../lib/logger';
import { HttpError, parseBody } from '../errors';

export const secretsRouter = Router();
const log = createLogger('secrets');

// As chaves só podem ser lidas/alteradas a partir do próprio computador,
// mesmo que o servidor seja exposto na rede local (HOST=0.0.0.0).
secretsRouter.use((req, _res, next) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const local =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost';
  if (!local) {
    throw new HttpError(403, 'As chaves só podem ser gerenciadas a partir do próprio computador.', 'forbidden');
  }
  next();
});

const valueSchema = z.object({
  value: z.string().trim().min(4).max(512)
});

function parseId(raw: string): SecretId {
  if (!SECRET_IDS.includes(raw as SecretId)) {
    throw new HttpError(404, 'Chave desconhecida.', 'not_found');
  }
  return raw as SecretId;
}

secretsRouter.get('/secrets', (_req, res) => {
  res.json({ secrets: listSecretStatuses() });
});

secretsRouter.put('/secrets/:id', (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(valueSchema, req.body);
  if (!isValidSecretFormat(id, body.value)) {
    throw new HttpError(
      422,
      'A chave da Steam deve ter 32 caracteres hexadecimais, sem espaços, barras ou outros símbolos. Copie novamente em steamcommunity.com/dev/apikey.',
      'validation'
    );
  }
  setSecret(id, body.value);

  // Ao salvar a chave do gg.deals, cria/reativa a fonte e já testa o preço.
  // Para TMDB/Steam, reexecuta as fontes habilitadas que estavam falhando.
  if (id === 'ggdeals' && countGames() > 0) {
    const source = ensureGgdealsSource();
    if (source) {
      updateSource(source.id, { enabled: true });
      enqueueSource(source.id, true);
    }
  } else {
    const affectedType = id === 'tmdb' ? 'tmdb' : id === 'steam' ? 'steam-wishlist' : null;
    if (affectedType) {
      for (const source of listSources()) {
        if (source.type === affectedType && source.enabled) enqueueSource(source.id, true);
      }
    }
  }

  log.info(`chave ${id} salva pelo app`);
  broadcast('secrets:changed', { id });
  res.json({ secrets: listSecretStatuses() });
});

secretsRouter.delete('/secrets/:id', (req, res) => {
  const id = parseId(req.params.id);
  deleteSecret(id);

  // Sem chave efetiva, pausa a fonte de preços para não acumular erros.
  if (id === 'ggdeals' && !hasSecret('ggdeals')) {
    const source = listSources().find((item) => item.type === 'ggdeals');
    if (source) updateSource(source.id, { enabled: false });
  }

  log.info(`chave ${id} removida do app`);
  broadcast('secrets:changed', { id });
  res.json({ secrets: listSecretStatuses() });
});
