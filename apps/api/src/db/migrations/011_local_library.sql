-- ---------------------------------------------------------------------------
-- Hub · migração 011 (biblioteca local + estado unificado)
--
-- A tabela de estado passa a guardar também títulos que existem só no Hub:
-- nome, tipo, capa e o flag `in_library` (Minha biblioteca). Assim o botão
-- "Adicionar à biblioteca" funciona sem escrever na conta do Stremio.
-- ---------------------------------------------------------------------------

ALTER TABLE stremio_library_state ADD COLUMN in_library INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stremio_library_state ADD COLUMN meta_type TEXT;
ALTER TABLE stremio_library_state ADD COLUMN name TEXT;
ALTER TABLE stremio_library_state ADD COLUMN poster TEXT;
ALTER TABLE stremio_library_state ADD COLUMN added_at TEXT;

CREATE INDEX IF NOT EXISTS idx_stremio_library_state_local
  ON stremio_library_state (in_library, is_favorite, is_watch_later);
