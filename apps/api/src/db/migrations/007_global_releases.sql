-- ---------------------------------------------------------------------------
-- Hub · migração 007 (calendário global)
-- Lançamentos de filmes/séries/animes independentes das fontes acompanhadas.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS global_releases (
  id             TEXT PRIMARY KEY,
  external_key   TEXT NOT NULL UNIQUE,   -- mesma chave usada pelos eventos locais quando possível
  provider       TEXT NOT NULL,          -- tmdb | anilist
  media_kind     TEXT NOT NULL,          -- movie | series | anime
  title          TEXT NOT NULL,
  original_title TEXT,
  poster_url     TEXT,
  kind           TEXT NOT NULL,          -- cinema | digital | episode | airing
  release_date   TEXT NOT NULL,          -- YYYY-MM-DD
  release_time   TEXT,                   -- HH:mm
  release_at     TEXT,                   -- ISO UTC
  timezone       TEXT NOT NULL,
  region         TEXT,
  season         INTEGER,
  episode        INTEGER,
  episode_title  TEXT,
  url            TEXT,
  imdb_id        TEXT,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_global_releases_date
  ON global_releases (release_date, release_time);
CREATE INDEX IF NOT EXISTS idx_global_releases_kind
  ON global_releases (media_kind, release_date);
CREATE INDEX IF NOT EXISTS idx_global_releases_provider
  ON global_releases (provider, release_date);
