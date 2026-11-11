-- ---------------------------------------------------------------------------
-- Hub · migração 010 (estado local da biblioteca do Stremio)
--
-- Favoritos e "assistir depois" ficam só no Hub e nunca são gravados na conta
-- do Stremio. A tabela é separada da biblioteca para sobreviver às
-- sincronizações (que atualizam/removem itens) sem apagar as marcações.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stremio_library_state (
  meta_id         TEXT PRIMARY KEY,
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  is_watch_later  INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stremio_library_state_flags
  ON stremio_library_state (is_favorite, is_watch_later);
