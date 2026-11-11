-- Índices para as abas Favoritos e Ver depois (filtram por flag + data).
CREATE INDEX IF NOT EXISTS idx_items_favorites
  ON items (is_favorite, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_items_watch_later
  ON items (is_watch_later, published_at DESC);
