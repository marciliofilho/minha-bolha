/**
 * Regras de jogos e preços:
 * - sincronização da wishlist (entrada/remoção);
 * - aplicação dos preços do gg.deals;
 * - alertas de preço (alvo, mínima histórica e desconto relevante);
 * - criação automática da fonte de preços.
 */
import type { SettingsDto, SourceDto } from '@hub/shared';
import type { RawItem, RawPriceSnapshot, RawWishlistGame } from '../connectors/types';
import { ConnectorError } from '../connectors/types';
import { fetchSteamApp } from '../connectors/steam-wishlist';
import { createSource, listSources } from '../db/repositories/sources';
import {
  getGameByAppid,
  insertManualGame,
  recordPricePoint,
  updateGamePrices,
  upsertWishlistGames
} from '../db/repositories/games';
import type { GameRow } from '../db/types';
import { hasSecret } from '../lib/secrets';
import { discountPercent, formatMoney } from '../lib/money';
import { nowIso, todayInZone } from '../lib/dates';

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export function syncWishlist(games: RawWishlistGame[]): { added: number; updated: number } {
  return upsertWishlistGames(games);
}

// ---------------------------------------------------------------------------
// Fonte de preços (criada automaticamente)
// ---------------------------------------------------------------------------

export function getGgdealsSource(): SourceDto | null {
  return listSources().find((source) => source.type === 'ggdeals') ?? null;
}

export function ensureGgdealsSource(): SourceDto | null {
  // Sem chave não há como consultar preços; a UI mostra as instruções.
  if (!hasSecret('ggdeals')) return null;

  const existing = getGgdealsSource();
  if (existing) return existing;

  return createSource({
    type: 'ggdeals',
    name: 'Preços · gg.deals',
    categoryId: 'game',
    config: { provider: 'ggdeals' },
    intervalMinutes: 360
  });
}

// ---------------------------------------------------------------------------
// Jogo manual
// ---------------------------------------------------------------------------

export async function addManualGame(
  appid: number,
  settings: SettingsDto,
  targetPriceCents: number | null
): Promise<GameRow> {
  const meta = await fetchSteamApp(appid, settings);
  if (!meta) {
    throw new ConnectorError('not_found', `App ${appid} não encontrado na loja da Steam.`);
  }

  const row = insertManualGame(meta, targetPriceCents);
  ensureGgdealsSource();
  return row;
}

// ---------------------------------------------------------------------------
// Preços e alertas
// ---------------------------------------------------------------------------

function minNullable(...values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  return numbers.length > 0 ? Math.min(...numbers) : null;
}

type AlertReason = 'target' | 'low' | 'discount';

function buildPriceAlert(input: {
  game: GameRow;
  snapshot: RawPriceSnapshot;
  reason: AlertReason;
  discount: number;
  officialLow: number | null;
  publishedAt: string;
}): RawItem {
  const { game, snapshot, reason, discount, officialLow, publishedAt } = input;
  if (snapshot.officialCents === null) throw new Error('alerta sem preço');

  const bestCents =
    minNullable(snapshot.officialCents, snapshot.keyshopCents) ?? snapshot.officialCents;
  const price = formatMoney(bestCents, snapshot.currency);
  const official = formatMoney(snapshot.officialCents, snapshot.currency);
  const keyshop = formatMoney(snapshot.keyshopCents, snapshot.currency);
  const low = formatMoney(officialLow, snapshot.currency);
  const target = formatMoney(game.target_price_cents, snapshot.currency);

  const title =
    reason === 'target'
      ? `${game.name} por ${price} — atingiu seu alvo de ${target}`
      : reason === 'low'
        ? `${game.name} na mínima histórica: ${price}`
        : `${game.name} com ${discount}% de desconto: ${price}`;

  const url = snapshot.ggUrl ?? game.gg_url ?? `https://gg.deals/steam/app/${game.appid}/`;
  const image =
    game.header_url ??
    game.cover_url ??
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/header.jpg`;

  return {
    externalId: `game:${game.id}`,
    // Um item por jogo: os alertas seguintes atualizam o mesmo card do feed.
    dedupeKey: `price:${game.id}`,
    kind: 'price_drop',
    title,
    url,
    thumbnailUrl: image,
    description: `Menor preço atual ${price} · oficiais ${official} · keyshops ${keyshop} · mínima histórica ${low}`,
    author: null,
    publishedAt,
    meta: {
      gameId: game.id,
      appid: game.appid,
      priceCents: bestCents,
      officialCents: snapshot.officialCents,
      keyshopCents: snapshot.keyshopCents,
      discount,
      reason,
      currency: snapshot.currency
    }
  };
}

/**
 * Atualiza preços e devolve itens de alerta. A primeira verificação de cada
 * jogo não gera alerta (evita despejar a biblioteca inteira no feed).
 */
export function applyPriceSnapshots(snapshots: RawPriceSnapshot[], settings: SettingsDto): RawItem[] {
  const checkedAt = nowIso();
  const day = todayInZone(settings.timezone);
  const items: RawItem[] = [];

  for (const snapshot of snapshots) {
    const game = getGameByAppid(snapshot.appid);
    if (!game) continue;

    if (!snapshot.found) {
      // O gg.deals não conhece este appid (DLC, jogo removido): preserva os
      // preços anteriores e só registra a tentativa.
      updateGamePrices(game.id, {
        currency: game.currency,
        currentOfficialCents: game.current_official_cents,
        currentKeyshopCents: game.current_keyshop_cents,
        officialLowCents: game.official_low_cents,
        keyshopLowCents: game.keyshop_low_cents,
        isAtLow: game.is_at_low === 1,
        ggUrl: game.gg_url,
        lastPriceCheckAt: checkedAt
      });
      continue;
    }

    const previousOfficial = game.current_official_cents;
    const hadPreviousCheck = Boolean(game.last_price_check_at);

    const officialLow = snapshot.officialLowCents ?? minNullable(game.official_low_cents, snapshot.officialCents);
    const keyshopLow = snapshot.keyshopLowCents ?? minNullable(game.keyshop_low_cents, snapshot.keyshopCents);
    const isAtLow =
      snapshot.officialCents !== null && officialLow !== null && snapshot.officialCents <= officialLow + 1;

    recordPricePoint(game.id, day, snapshot);
    updateGamePrices(game.id, {
      currency: snapshot.currency,
      currentOfficialCents: snapshot.officialCents,
      currentKeyshopCents: snapshot.keyshopCents,
      officialLowCents: officialLow,
      keyshopLowCents: keyshopLow,
      isAtLow,
      ggUrl: snapshot.ggUrl ?? game.gg_url,
      lastPriceCheckAt: checkedAt
    });

    if (!hadPreviousCheck || snapshot.officialCents === null) continue;

    const discount = Math.max(
      discountPercent(snapshot.officialCents, game.steam_base_cents),
      game.steam_discount
    );
    const droppedBelowPrevious = previousOfficial === null || snapshot.officialCents < previousOfficial;

    let reason: AlertReason | null = null;
    if (game.target_price_cents !== null && snapshot.officialCents <= game.target_price_cents) {
      reason = 'target';
    } else if (isAtLow && droppedBelowPrevious) {
      reason = 'low';
    } else if (discount >= 50 && droppedBelowPrevious) {
      reason = 'discount';
    }

    if (reason) {
      items.push(
        buildPriceAlert({
          game,
          snapshot,
          reason,
          discount,
          officialLow,
          publishedAt: checkedAt
        })
      );
    }
  }

  return items;
}
