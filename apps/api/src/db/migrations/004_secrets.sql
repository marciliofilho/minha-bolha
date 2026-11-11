-- ---------------------------------------------------------------------------
-- Hub · migração 004
-- Chaves de API salvas pelo app (tela de Configurações).
-- O .env continua funcionando como fallback; o banco tem precedência.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS secrets (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
