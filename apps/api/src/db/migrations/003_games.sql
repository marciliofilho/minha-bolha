-- ---------------------------------------------------------------------------
-- Hub · migração 003 (Fase 3)
-- Jogos acompanhados e histórico de preços.
--
-- Observação: a API gratuita do gg.deals retorna o menor preço por mercado
-- (lojas oficiais e keyshops), não ofertas por loja. Por isso guardamos dois
-- preços correntes e dois mínimos históricos, além do link da página do jogo.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS games (
  id                    TEXT PRIMARY KEY,
  appid                 INTEGER NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  cover_url             TEXT,
  header_url            TEXT,
  currency              TEXT NOT NULL DEFAULT 'BRL',
  target_price_cents    INTEGER,
  steam_base_cents      INTEGER,
  steam_final_cents     INTEGER,
  steam_discount        INTEGER NOT NULL DEFAULT 0,
  current_official_cents INTEGER,
  current_keyshop_cents  INTEGER,
  official_low_cents    INTEGER,
  keyshop_low_cents     INTEGER,
  is_at_low             INTEGER NOT NULL DEFAULT 0,
  in_wishlist           INTEGER NOT NULL DEFAULT 0,
  origin                TEXT NOT NULL DEFAULT 'wishlist',
  priority              INTEGER,
  gg_url                TEXT,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  added_at              TEXT NOT NULL,
  removed_at            TEXT,
  metadata_fetched_at   TEXT,
  last_price_check_at   TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_wishlist ON games (in_wishlist);
CREATE INDEX IF NOT EXISTS idx_games_price_order ON games (last_price_check_at);
CREATE INDEX IF NOT EXISTS idx_games_demo ON games (is_demo);

CREATE TABLE IF NOT EXISTS price_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  day            TEXT NOT NULL,             -- YYYY-MM-DD no fuso configurado
  official_cents INTEGER,
  keyshop_cents  INTEGER,
  currency       TEXT,
  UNIQUE (game_id, day)
);

CREATE INDEX IF NOT EXISTS idx_price_history_game ON price_history (game_id, day);
