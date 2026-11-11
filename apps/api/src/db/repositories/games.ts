/** Repositório da biblioteca de jogos e do histórico de preços. */
import { randomUUID } from 'node:crypto';
import { db } from '../database';
import type { GameRow, PriceHistoryRow } from '../types';
import type { RawPriceSnapshot, RawWishlistGame } from '../../connectors/types';
import { nowIso } from '../../lib/dates';

export interface SteamAppMeta {
  appid: number;
  name: string;
  coverUrl: string | null;
  headerUrl: string | null;
  steamBaseCents: number | null;
  steamFinalCents: number | null;
  steamDiscount: number;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export function listGameRows(): GameRow[] {
  return db
    .prepare('SELECT * FROM games ORDER BY in_wishlist DESC, last_price_check_at IS NULL DESC, updated_at DESC')
    .all() as unknown as GameRow[];
}

export function getGameById(id: string): GameRow | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as unknown as GameRow | undefined;
  return row ?? null;
}

export function getGameByAppid(appid: number): GameRow | null {
  const row = db.prepare('SELECT * FROM games WHERE appid = ?').get(appid) as unknown as GameRow | undefined;
  return row ?? null;
}

export function getGamesByAppids(appids: number[]): GameRow[] {
  if (appids.length === 0) return [];
  const placeholders = appids.map(() => '?').join(', ');
  return db
    .prepare(`SELECT * FROM games WHERE appid IN (${placeholders})`)
    .all(...appids) as unknown as GameRow[];
}

/** Jogos ordenados para verificação: nunca checados primeiro, depois os mais antigos. */
export function listGamesForPriceCheck(limit: number): GameRow[] {
  return db
    .prepare(
      `SELECT * FROM games
       WHERE is_demo = 0
       ORDER BY (last_price_check_at IS NOT NULL) ASC, last_price_check_at ASC, priority ASC
       LIMIT ?`
    )
    .all(limit) as unknown as GameRow[];
}

export function listPriceHistory(gameId: string, fromDay: string): PriceHistoryRow[] {
  return db
    .prepare('SELECT * FROM price_history WHERE game_id = ? AND day >= ? ORDER BY day ASC')
    .all(gameId, fromDay) as unknown as PriceHistoryRow[];
}

/** Histórico de todos os jogos em uma janela (para sparklines do grid). */
export function listPriceHistorySince(fromDay: string): Map<string, PriceHistoryRow[]> {
  const rows = db
    .prepare('SELECT * FROM price_history WHERE day >= ? ORDER BY day ASC')
    .all(fromDay) as unknown as PriceHistoryRow[];

  const map = new Map<string, PriceHistoryRow[]>();
  for (const row of rows) {
    const list = map.get(row.game_id);
    if (list) list.push(row);
    else map.set(row.game_id, [row]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export function upsertWishlistGames(games: RawWishlistGame[]): { added: number; updated: number } {
  const now = nowIso();
  let added = 0;
  let updated = 0;

  const insert = db.prepare(
    `INSERT INTO games (
       id, appid, name, cover_url, header_url, currency, target_price_cents,
       steam_base_cents, steam_final_cents, steam_discount,
       in_wishlist, origin, priority, is_demo, added_at, metadata_fetched_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'BRL', NULL, ?, ?, ?, 1, 'wishlist', ?, 0, ?, ?, ?, ?)`
  );

  const updateFresh = db.prepare(
    `UPDATE games SET
       name = ?, cover_url = COALESCE(?, cover_url), header_url = COALESCE(?, header_url),
       steam_base_cents = COALESCE(?, steam_base_cents),
       steam_final_cents = COALESCE(?, steam_final_cents),
       steam_discount = ?,
       priority = ?, in_wishlist = 1, removed_at = NULL,
       metadata_fetched_at = ?, updated_at = ?
     WHERE appid = ?`
  );

  const updateCached = db.prepare(
    `UPDATE games SET priority = ?, in_wishlist = 1, removed_at = NULL, updated_at = ? WHERE appid = ?`
  );

  db.exec('BEGIN');
  try {
    for (const game of games) {
      const existing = getGameByAppid(game.appid);
      if (!existing) {
        insert.run(
          randomUUID(),
          game.appid,
          game.name,
          game.coverUrl,
          game.headerUrl,
          game.steamBaseCents,
          game.steamFinalCents,
          game.steamDiscount,
          game.priority,
          game.dateAdded ?? now,
          game.metadataFresh ? now : null,
          now,
          now
        );
        added++;
      } else if (game.metadataFresh) {
        updateFresh.run(
          game.name,
          game.coverUrl,
          game.headerUrl,
          game.steamBaseCents,
          game.steamFinalCents,
          game.steamDiscount,
          game.priority,
          now,
          now,
          game.appid
        );
        updated++;
      } else {
        updateCached.run(game.priority, now, game.appid);
        updated++;
      }
    }

    if (games.length > 0) {
      const placeholders = games.map(() => '?').join(', ');
      db.prepare(
        `UPDATE games SET in_wishlist = 0, removed_at = ?, updated_at = ?
         WHERE in_wishlist = 1 AND appid NOT IN (${placeholders})`
      ).run(now, now, ...games.map((game) => game.appid));
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { added, updated };
}

/** Jogo manual (ou reimportado): cria preservando preços/histórico existentes. */
export function insertManualGame(meta: SteamAppMeta, targetPriceCents: number | null): GameRow {
  const now = nowIso();
  db.prepare(
    `INSERT INTO games (
       id, appid, name, cover_url, header_url, currency, target_price_cents,
       steam_base_cents, steam_final_cents, steam_discount,
       in_wishlist, origin, is_demo, added_at, metadata_fetched_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, ?, ?, 0, 'manual', 0, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    meta.appid,
    meta.name,
    meta.coverUrl,
    meta.headerUrl,
    targetPriceCents,
    meta.steamBaseCents,
    meta.steamFinalCents,
    meta.steamDiscount,
    now,
    now,
    now,
    now
  );
  return getGameByAppid(meta.appid) as GameRow;
}

// ---------------------------------------------------------------------------
// Preços
// ---------------------------------------------------------------------------

export interface PriceUpdate {
  currency: string;
  currentOfficialCents: number | null;
  currentKeyshopCents: number | null;
  officialLowCents: number | null;
  keyshopLowCents: number | null;
  isAtLow: boolean;
  ggUrl: string | null;
  lastPriceCheckAt: string;
}

export function updateGamePrices(id: string, update: PriceUpdate): void {
  db.prepare(
    `UPDATE games SET currency = ?, current_official_cents = ?, current_keyshop_cents = ?,
       official_low_cents = ?, keyshop_low_cents = ?, is_at_low = ?, gg_url = ?,
       last_price_check_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    update.currency,
    update.currentOfficialCents,
    update.currentKeyshopCents,
    update.officialLowCents,
    update.keyshopLowCents,
    update.isAtLow ? 1 : 0,
    update.ggUrl,
    update.lastPriceCheckAt,
    nowIso(),
    id
  );
}

/** Mantém o menor preço do dia (várias verificações por dia não inflam o gráfico). */
export function recordPricePoint(gameId: string, day: string, snapshot: RawPriceSnapshot): void {
  db.prepare(
    `INSERT INTO price_history (game_id, day, official_cents, keyshop_cents, currency)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(game_id, day) DO UPDATE SET
       official_cents = CASE
         WHEN price_history.official_cents IS NULL THEN excluded.official_cents
         WHEN excluded.official_cents IS NULL THEN price_history.official_cents
         ELSE MIN(price_history.official_cents, excluded.official_cents)
       END,
       keyshop_cents = CASE
         WHEN price_history.keyshop_cents IS NULL THEN excluded.keyshop_cents
         WHEN excluded.keyshop_cents IS NULL THEN price_history.keyshop_cents
         ELSE MIN(price_history.keyshop_cents, excluded.keyshop_cents)
       END,
       currency = excluded.currency`
  ).run(gameId, day, snapshot.officialCents, snapshot.keyshopCents, snapshot.currency);
}

export function updateTargetPrice(id: string, targetPriceCents: number | null): GameRow | null {
  db.prepare('UPDATE games SET target_price_cents = ?, updated_at = ? WHERE id = ?').run(
    targetPriceCents,
    nowIso(),
    id
  );
  return getGameById(id);
}

export function deleteGame(id: string): boolean {
  const result = db.prepare('DELETE FROM games WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

// ---------------------------------------------------------------------------
// Contadores / demonstração
// ---------------------------------------------------------------------------

export function countGames(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM games').get() as { total: number };
  return Number(row.total);
}

export function countDemoGames(): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM games WHERE is_demo = 1').get() as { total: number };
  return Number(row.total);
}

export function deleteDemoGames(): number {
  const result = db.prepare('DELETE FROM games WHERE is_demo = 1').run();
  return Number(result.changes);
}
