-- ---------------------------------------------------------------------------
-- Hub · migração 009 (cache persistente de streams)
--
-- Guarda o resultado normalizado de cada addon por tipo/vídeo. O cache em
-- memória continua para erros e para evitar refreshes concorrentes; este
-- cache sobrevive a reinícios e deixa a lista de streams instantânea.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stream_cache (
  addon_key     TEXT NOT NULL,              -- hash curto da URL/config do addon
  meta_type     TEXT NOT NULL,              -- movie | series | anime...
  video_id      TEXT NOT NULL,              -- tt..., tt...:S:E
  streams_json  TEXT NOT NULL,
  cached_at     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  PRIMARY KEY (addon_key, meta_type, video_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_cache_cached
  ON stream_cache (cached_at DESC);

CREATE INDEX IF NOT EXISTS idx_stream_cache_expires
  ON stream_cache (expires_at);
