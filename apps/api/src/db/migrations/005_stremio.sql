-- ---------------------------------------------------------------------------
-- Hub · migração 005 (Stremio)
-- IMDB nos títulos acompanhados, conta Stremio (token criptografado) e
-- biblioteca sincronizada (somente leitura).
-- ---------------------------------------------------------------------------

ALTER TABLE media ADD COLUMN imdb_id TEXT;
CREATE INDEX IF NOT EXISTS idx_media_imdb ON media (imdb_id);

CREATE TABLE IF NOT EXISTS stremio_account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  email         TEXT,
  auth_key      TEXT,                     -- payload AES-256-GCM (nunca em texto puro)
  connected_at  TEXT,
  last_sync_at  TEXT,
  expired       INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stremio_library (
  imdb_id         TEXT PRIMARY KEY,
  type            TEXT NOT NULL,          -- movie | series
  name            TEXT NOT NULL,
  poster          TEXT,
  video_id        TEXT,                   -- tt...:temporada:episódio
  season          INTEGER,
  episode         INTEGER,
  time_offset     INTEGER,
  duration        INTEGER,
  last_watched_at TEXT,
  removed         INTEGER NOT NULL DEFAULT 0,
  temp            INTEGER NOT NULL DEFAULT 0,
  raw             TEXT,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stremio_library_watched ON stremio_library (last_watched_at DESC);
