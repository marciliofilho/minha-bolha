-- ---------------------------------------------------------------------------
-- Hub · migração 006 (Stremio: biblioteca genérica, addons e progresso local)
--
-- A biblioteca antiga usava o IMDB como chave e descartava itens com outros
-- formatos de ID. Aqui ela é recriada com `meta_id` como chave, preservando
-- todos os registros. A tabela antiga é mantida como `_legacy` para rollback.
-- ---------------------------------------------------------------------------

ALTER TABLE stremio_library RENAME TO stremio_library_legacy;

CREATE TABLE stremio_library (
  meta_id         TEXT PRIMARY KEY,       -- ID do Stremio (tt..., kitsu:...)
  imdb_id         TEXT,                    -- preenchido apenas para tt...
  type            TEXT NOT NULL,           -- movie | series
  name            TEXT NOT NULL,
  poster          TEXT,
  video_id        TEXT,                    -- tt...:temporada:episódio
  season          INTEGER,
  episode         INTEGER,
  time_offset     INTEGER,
  duration        INTEGER,
  watched_video_id TEXT,                   -- state.watched (somente leitura)
  last_watched_at TEXT,
  removed         INTEGER NOT NULL DEFAULT 0,
  temp            INTEGER NOT NULL DEFAULT 0,
  raw             TEXT,
  updated_at      TEXT NOT NULL
);

INSERT INTO stremio_library (
  meta_id, imdb_id, type, name, poster, video_id, season, episode,
  time_offset, duration, watched_video_id, last_watched_at, removed, temp, raw,
  updated_at
)
SELECT
  imdb_id, imdb_id, type, name, poster, video_id, season, episode,
  time_offset, duration, json_extract(raw, '$.state.watched'), last_watched_at,
  removed, temp, raw, updated_at
FROM stremio_library_legacy;

CREATE INDEX idx_stremio_library_watched_v2 ON stremio_library (last_watched_at DESC);
CREATE INDEX idx_stremio_library_imdb ON stremio_library (imdb_id);
CREATE INDEX idx_stremio_library_active ON stremio_library (removed, temp);

-- Addons cadastrados manualmente. A URL do manifest pode conter chaves e
-- configuração embutida: fica criptografada e nunca volta para o frontend.
CREATE TABLE IF NOT EXISTS stremio_addons (
  id                  TEXT PRIMARY KEY,
  url_hash            TEXT NOT NULL UNIQUE,  -- SHA-256 da URL normalizada (dedupe)
  transport_url_enc   TEXT NOT NULL,         -- URL completa criptografada
  addon_id            TEXT,                  -- manifest.id (não é único: pode haver configs)
  name                TEXT NOT NULL,
  version             TEXT,
  description         TEXT,
  manifest_json       TEXT NOT NULL,         -- manifest público, sem a URL
  enabled             INTEGER NOT NULL DEFAULT 1,
  priority            INTEGER NOT NULL DEFAULT 100,
  last_test_at        TEXT,
  last_test_ok        INTEGER,
  last_test_error     TEXT,
  last_test_summary   TEXT,                  -- JSON com tempos/contagens, sem tokens
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_stremio_addons_priority ON stremio_addons (enabled, priority);

-- Progresso reproduzido no próprio Hub (nunca gravado na conta do Stremio).
CREATE TABLE IF NOT EXISTS stremio_playback (
  id                TEXT PRIMARY KEY,
  meta_id           TEXT NOT NULL,
  meta_type         TEXT NOT NULL,           -- movie | series
  video_id          TEXT NOT NULL,           -- id do vídeo/episódio no meta
  season            INTEGER,
  episode           INTEGER,
  position_ms       INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER,
  addon_id          TEXT,                    -- escolha lembrada
  stream_signature  TEXT,                    -- qualidade/addon escolhidos
  updated_at        TEXT NOT NULL,
  UNIQUE (meta_id, video_id)
);

CREATE INDEX idx_stremio_playback_updated ON stremio_playback (updated_at DESC);
