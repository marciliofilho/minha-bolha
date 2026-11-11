/** Busca de títulos (TMDB/AniList) para o formulário de fontes. */
import { Router } from 'express';
import { getConnector, hasConnector } from '../../connectors/registry';
import { getSettings } from '../../db/repositories/settings';
import { HttpError } from '../errors';

export const mediaRouter = Router();

const PROVIDERS = new Set(['tmdb', 'anilist']);

mediaRouter.get('/media/search', async (req, res) => {
  const provider = typeof req.query.provider === 'string' ? req.query.provider : '';
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (!PROVIDERS.has(provider) || !hasConnector(provider)) {
    throw new HttpError(400, 'Provedor inválido. Use "tmdb" ou "anilist".', 'validation');
  }
  if (query.length < 2) {
    throw new HttpError(400, 'Digite pelo menos 2 caracteres para buscar.', 'validation');
  }

  const connector = getConnector(provider);
  if (!connector.search) {
    throw new HttpError(400, 'Este provedor não suporta busca.', 'not_supported');
  }

  const results = await connector.search(query, getSettings());
  res.json({ results });
});
