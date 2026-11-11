-- ---------------------------------------------------------------------------
-- Hub · migração 002 (Fase 2)
-- Títulos acompanhados (TMDB/AniList) e eventos de lançamento/episódio.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,              -- tmdb | anilist
  external_id     TEXT NOT NULL,              -- movie:603 | tv:1399 | 21
  kind            TEXT NOT NULL,              -- movie | series | anime
  title           TEXT NOT NULL,
  original_title  TEXT,
  poster_url      TEXT,
  backdrop_url    TEXT,
  year            INTEGER,
  status          TEXT,
  total_seasons   INTEGER,
  next_episode_at TEXT,
  url             TEXT,
  raw             TEXT,
  fetched_at      TEXT NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_media_kind ON media (kind);

CREATE TABLE IF NOT EXISTS release_events (
  id            TEXT PRIMARY KEY,
  media_id      TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  external_key  TEXT NOT NULL UNIQUE,         -- chave estável: tmdb:tv:1399:s1e3
  kind          TEXT NOT NULL,                -- cinema | digital | episode | airing
  season        INTEGER,
  episode       INTEGER,
  episode_title TEXT,
  release_date  TEXT NOT NULL,                -- YYYY-MM-DD no fuso configurado
  release_time  TEXT,                         -- HH:mm no fuso configurado
  release_at    TEXT,                         -- ISO 8601 em UTC, quando exato
  timezone      TEXT NOT NULL,
  region        TEXT,
  url           TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_date ON release_events (release_date, release_time);
CREATE INDEX IF NOT EXISTS idx_release_media ON release_events (media_id, release_date);
