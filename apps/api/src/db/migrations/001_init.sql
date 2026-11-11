-- ---------------------------------------------------------------------------
-- Hub · migração inicial (Fase 1)
-- Banco: SQLite em modo WAL. Datas em UTC (ISO 8601), dinheiro em centavos.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'rss',
  color       TEXT NOT NULL DEFAULT '#94a3b8',
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_system   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category_id           TEXT NOT NULL REFERENCES categories(id),
  config                TEXT NOT NULL,              -- JSON específico do conector
  state                 TEXT,                       -- JSON cursor (último item visto, etag…)
  enabled               INTEGER NOT NULL DEFAULT 1,
  interval_minutes      INTEGER NOT NULL DEFAULT 30,
  next_run_at           TEXT,
  last_checked_at       TEXT,
  last_success_at       TEXT,
  last_error_at         TEXT,
  last_error_code       TEXT,
  last_error_message    TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_due ON sources (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_sources_category ON sources (category_id);

CREATE TABLE IF NOT EXISTS source_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  ok             INTEGER NOT NULL DEFAULT 0,
  items_found    INTEGER NOT NULL DEFAULT 0,
  items_new      INTEGER NOT NULL DEFAULT 0,
  error_code     TEXT,
  error_message  TEXT,
  duration_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_runs_source ON source_runs (source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS items (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id    TEXT,
  dedupe_key     TEXT NOT NULL UNIQUE,
  category_id    TEXT NOT NULL REFERENCES categories(id),
  kind           TEXT NOT NULL DEFAULT 'article',
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  thumbnail_url  TEXT,
  description    TEXT,
  author         TEXT,
  published_at   TEXT NOT NULL,
  discovered_at  TEXT NOT NULL,
  is_read        INTEGER NOT NULL DEFAULT 0,
  read_at        TEXT,
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  is_watch_later INTEGER NOT NULL DEFAULT 0,
  is_hidden      INTEGER NOT NULL DEFAULT 0,
  meta           TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_feed ON items (published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category_id, is_read, is_hidden);
CREATE INDEX IF NOT EXISTS idx_items_source ON items (source_id, published_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,       -- JSON
  updated_at  TEXT NOT NULL
);
