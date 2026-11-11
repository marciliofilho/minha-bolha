-- Jogos no feed: um único card por jogo.
-- Mantém o alerta com o menor preço (mais recente em caso de empate), preserva
-- favoritos/ver depois marcados em qualquer duplicata e normaliza a chave.

WITH ranked AS (
  SELECT i.id,
         ROW_NUMBER() OVER (
           PARTITION BY json_extract(i.meta, '$.gameId')
           ORDER BY CAST(COALESCE(json_extract(i.meta, '$.priceCents'), 9223372036854775807) AS INTEGER) ASC,
                    i.published_at DESC,
                    i.id ASC
         ) AS rn,
         json_extract(i.meta, '$.gameId') AS game_id
  FROM items i
  WHERE i.kind = 'price_drop'
    AND json_extract(i.meta, '$.gameId') IS NOT NULL
),
keep AS (
  SELECT id FROM ranked WHERE rn = 1
)
UPDATE items
SET is_favorite = (
      SELECT MAX(x.is_favorite) FROM items x
      WHERE x.kind = 'price_drop'
        AND json_extract(x.meta, '$.gameId') = json_extract(items.meta, '$.gameId')
    ),
    is_watch_later = (
      SELECT MAX(x.is_watch_later) FROM items x
      WHERE x.kind = 'price_drop'
        AND json_extract(x.meta, '$.gameId') = json_extract(items.meta, '$.gameId')
    ),
    is_read = (
      SELECT MIN(x.is_read) FROM items x
      WHERE x.kind = 'price_drop'
        AND json_extract(x.meta, '$.gameId') = json_extract(items.meta, '$.gameId')
    )
WHERE id IN (SELECT id FROM keep);

WITH ranked AS (
  SELECT i.id,
         ROW_NUMBER() OVER (
           PARTITION BY json_extract(i.meta, '$.gameId')
           ORDER BY CAST(COALESCE(json_extract(i.meta, '$.priceCents'), 9223372036854775807) AS INTEGER) ASC,
                    i.published_at DESC,
                    i.id ASC
         ) AS rn
  FROM items i
  WHERE i.kind = 'price_drop'
    AND json_extract(i.meta, '$.gameId') IS NOT NULL
)
DELETE FROM items WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE items
SET dedupe_key = 'price:' || json_extract(meta, '$.gameId'),
    external_id = 'game:' || json_extract(meta, '$.gameId')
WHERE kind = 'price_drop'
  AND json_extract(meta, '$.gameId') IS NOT NULL;
