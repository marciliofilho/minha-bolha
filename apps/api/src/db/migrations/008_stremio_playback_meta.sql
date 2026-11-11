-- ---------------------------------------------------------------------------
-- Hub · migração 008 (progresso local de reprodução)
--
-- A tabela stremio_playback já existia para guardar a posição local, mas sem
-- os dados de exibição necessários para os cards "Continuar assistindo" e sem
-- o estado de concluído. Estes campos são preenchidos pelo player.
-- ---------------------------------------------------------------------------

ALTER TABLE stremio_playback ADD COLUMN name TEXT;
ALTER TABLE stremio_playback ADD COLUMN poster TEXT;
ALTER TABLE stremio_playback ADD COLUMN backdrop TEXT;
ALTER TABLE stremio_playback ADD COLUMN year INTEGER;
ALTER TABLE stremio_playback ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_stremio_playback_continue
  ON stremio_playback (completed, updated_at DESC);
