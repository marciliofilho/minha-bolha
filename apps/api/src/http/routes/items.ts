/** Rotas de itens: lido, favorito e "ver depois". */
import { Router } from 'express';
import { updateItemSchema } from '@hub/shared';
import { getItemWithSource, updateItemFlags } from '../../db/repositories/items';
import { HttpError, parseBody } from '../errors';

export const itemsRouter = Router();

itemsRouter.get('/items/:id', (req, res) => {
  const item = getItemWithSource(req.params.id);
  if (!item) throw new HttpError(404, 'Item não encontrado.', 'not_found');
  res.json(item);
});

itemsRouter.patch('/items/:id', (req, res) => {
  const body = parseBody(updateItemSchema, req.body);
  const item = updateItemFlags(req.params.id, body);
  if (!item) throw new HttpError(404, 'Item não encontrado.', 'not_found');
  res.json(item);
});
