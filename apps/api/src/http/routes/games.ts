/** Biblioteca de jogos: listagem, busca na Steam, importação e preços. */
import { Router } from 'express';
import {
  addGameSchema,
  importWishlistSchema,
  updateGameSchema,
  type GameDto,
  type GameFilter,
  type GameSearchResultDto,
  type GameSort,
  type PricePointDto
} from '@hub/shared';
import {
  deleteGame,
  getGameByAppid,
  getGameById,
  listGameRows,
  listPriceHistory,
  listPriceHistorySince,
  updateTargetPrice
} from '../../db/repositories/games';
import { createSource, listSources, updateSource } from '../../db/repositories/sources';
import { getSettings } from '../../db/repositories/settings';
import { toGameDetailDto, toGameDto, toPricePointDto } from '../../db/mappers';
import { buildNewItemNotifications, insertItems } from '../../db/repositories/items';
import { addManualGame, applyPriceSnapshots, ensureGgdealsSource, getGgdealsSource } from '../../domain/games';
import { fetchSteamApp, searchSteamGames, steamWishlistConnector } from '../../connectors/steam-wishlist';
import { fetchGgdealsPrices } from '../../connectors/ggdeals';
import { enqueueSource } from '../../scheduler';
import { broadcast } from '../../sse';
import { hasSecret } from '../../lib/secrets';
import { addDaysToDate, todayInZone } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { HttpError, parseBody } from '../errors';

export const gamesRouter = Router();

const FILTERS = new Set<GameFilter>(['all', 'wishlist', 'outside', 'deals', 'low']);
const SORTS = new Set<GameSort>(['discount', 'price', 'name', 'recent']);

function maxDiscount(game: GameDto): number {
  return Math.max(game.officialDiscount, game.keyshopDiscount, game.steamDiscount);
}

function bestPrice(game: GameDto): number | null {
  const prices = [game.currentOfficialCents, game.currentKeyshopCents, game.steamFinalCents].filter(
    (price): price is number => typeof price === 'number'
  );
  return prices.length > 0 ? Math.min(...prices) : null;
}

function historyPoints(gameId: string, days: number): PricePointDto[] {
  const from = addDaysToDate(todayInZone(getSettings().timezone), -days);
  return listPriceHistory(gameId, from).map(toPricePointDto);
}

gamesRouter.get('/games', (req, res) => {
  const filter: GameFilter = FILTERS.has(req.query.filter as GameFilter)
    ? (req.query.filter as GameFilter)
    : 'all';
  const sort: GameSort = SORTS.has(req.query.sort as GameSort) ? (req.query.sort as GameSort) : 'discount';
  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

  const since = addDaysToDate(todayInZone(getSettings().timezone), -45);
  const historyByGame = listPriceHistorySince(since);

  const all = listGameRows().map((row) =>
    toGameDto(row, (historyByGame.get(row.id) ?? []).map(toPricePointDto))
  );

  const stats = {
    total: all.length,
    wishlist: all.filter((game) => game.inWishlist).length,
    deals: all.filter((game) => maxDiscount(game) > 0).length,
    atLow: all.filter((game) => game.isAtLow).length
  };

  let games = all;
  if (filter === 'wishlist') games = games.filter((game) => game.inWishlist);
  if (filter === 'outside') games = games.filter((game) => !game.inWishlist);
  if (filter === 'deals') games = games.filter((game) => maxDiscount(game) > 0);
  if (filter === 'low') games = games.filter((game) => game.isAtLow);
  if (query) games = games.filter((game) => game.name.toLowerCase().includes(query));

  const sorted = [...games];
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (sort === 'recent') sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  if (sort === 'price') {
    sorted.sort((a, b) => (bestPrice(a) ?? Number.MAX_SAFE_INTEGER) - (bestPrice(b) ?? Number.MAX_SAFE_INTEGER));
  }
  if (sort === 'discount') sorted.sort((a, b) => maxDiscount(b) - maxDiscount(a));

  res.json({ games: sorted, stats });
});

gamesRouter.get('/games/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) throw new HttpError(400, 'Digite o nome do jogo, o appid ou o link da Steam.', 'validation');

  const settings = getSettings();
  let results: GameSearchResultDto[] = [];

  const appUrl = /store\.steampowered\.com\/app\/(\d+)/i.exec(query);
  const directAppid = appUrl?.[1] ? Number(appUrl[1]) : /^\d+$/.test(query) ? Number(query) : null;

  if (directAppid) {
    const meta = await fetchSteamApp(directAppid, settings);
    if (meta) {
      results = [
        {
          appid: meta.appid,
          name: meta.name,
          imageUrl: meta.coverUrl,
          priceLabel:
            meta.steamFinalCents !== null
              ? formatMoney(meta.steamFinalCents, settings.currency)
              : null
        }
      ];
    }
  } else {
    results = await searchSteamGames(query, settings);
  }

  res.json({ results });
});

gamesRouter.get('/games/:id', (req, res) => {
  const row = getGameById(req.params.id);
  if (!row) throw new HttpError(404, 'Jogo não encontrado.', 'not_found');
  res.json(toGameDetailDto(row, historyPoints(row.id, 120)));
});

gamesRouter.post('/games', async (req, res) => {
  const body = parseBody(addGameSchema, req.body);
  if (getGameByAppid(body.appid)) {
    throw new HttpError(409, 'Este jogo já está na sua biblioteca.', 'conflict');
  }

  const row = await addManualGame(body.appid, getSettings(), body.targetPriceCents ?? null);
  const priceSource = ensureGgdealsSource();
  if (priceSource) enqueueSource(priceSource.id, true);

  broadcast('games:changed', { added: body.appid });
  res.status(201).json(toGameDetailDto(row, historyPoints(row.id, 120)));
});

gamesRouter.patch('/games/:id', (req, res) => {
  const body = parseBody(updateGameSchema, req.body);
  const row = updateTargetPrice(req.params.id, body.targetPriceCents);
  if (!row) throw new HttpError(404, 'Jogo não encontrado.', 'not_found');
  broadcast('games:changed', { updated: row.appid });
  res.json(toGameDetailDto(row, historyPoints(row.id, 120)));
});

gamesRouter.delete('/games/:id', (req, res) => {
  const removed = deleteGame(req.params.id);
  if (!removed) throw new HttpError(404, 'Jogo não encontrado.', 'not_found');
  broadcast('games:changed', { removed: req.params.id });
  res.status(204).end();
});

/** Importa (ou reimporta) a wishlist da Steam e cria as fontes necessárias. */
gamesRouter.post('/games/import', async (req, res) => {
  const body = parseBody(importWishlistSchema, req.body);
  const settings = getSettings();
  const resolved = await steamWishlistConnector.resolve!(body.input, settings);

  const existing = listSources().find((source) => source.type === 'steam-wishlist');
  const source = existing
    ? updateSource(existing.id, {
        name: resolved.name,
        categoryId: 'game',
        config: resolved.config,
        enabled: true
      })
    : createSource({
        type: 'steam-wishlist',
        name: resolved.name,
        categoryId: 'game',
        config: resolved.config,
        intervalMinutes: 360
      });

  if (!source) throw new HttpError(500, 'Não foi possível salvar a fonte da Steam.', 'internal');

  // A fonte de preços é criada aqui; ela é enfileirada automaticamente quando
  // a sincronização da wishlist terminar (para já existirem jogos para checar).
  ensureGgdealsSource();
  enqueueSource(source.id, true);

  res.status(202).json({ queued: true, sourceId: source.id, name: source.name });
});

/** Verificação avulsa de preço (1 registro da API) para o modal de detalhe. */
gamesRouter.post('/games/:id/refresh-price', async (req, res) => {
  const row = getGameById(req.params.id);
  if (!row) throw new HttpError(404, 'Jogo não encontrado.', 'not_found');
  if (row.is_demo === 1) {
    throw new HttpError(
      422,
      'Jogos de demonstração usam preços fictícios. Adicione um jogo real para consultar o gg.deals.',
      'demo'
    );
  }

  if (!hasSecret('ggdeals')) {
    throw new HttpError(
      422,
      'Configure a chave do gg.deals em Configurações → Chaves de API para consultar preços.',
      'auth'
    );
  }

  const source = ensureGgdealsSource() ?? getGgdealsSource();
  if (!source) throw new HttpError(500, 'Não foi possível criar a fonte de preços.', 'internal');

  const settings = getSettings();
  const { snapshots, warnings } = await fetchGgdealsPrices([row.appid], settings);
  const items = applyPriceSnapshots(snapshots, settings);

  if (items.length > 0) {
    const result = insertItems(source.id, source.categoryId, items);
    if (result.inserted > 0) {
      broadcast('items:new', {
        sourceId: source.id,
        count: result.inserted,
        items: buildNewItemNotifications(result)
      });
    }
  }
  broadcast('games:changed', { updated: snapshots.length });

  const updated = getGameById(row.id);
  res.json({
    game: toGameDetailDto(updated ?? row, historyPoints(row.id, 120)),
    warnings
  });
});
