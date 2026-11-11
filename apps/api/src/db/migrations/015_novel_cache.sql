-- Cache persistente das novels: lista de capítulos (prévia) e conteúdos.
-- `expires_at` controla quando o dado é considerado "fresco"; entradas
-- vencidas ainda podem ser usadas como fallback quando o site bloqueia.
CREATE TABLE IF NOT EXISTS novel_cache (
  cache_key  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,            -- details | chapter
  data       TEXT NOT NULL,            -- JSON
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_novel_cache_kind
  ON novel_cache (kind, expires_at);

CREATE INDEX IF NOT EXISTS idx_novel_cache_fetched
  ON novel_cache (fetched_at);
