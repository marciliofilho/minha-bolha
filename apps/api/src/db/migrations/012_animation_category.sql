-- Classifica filmes/séries de animação (TMDB) na categoria Animação/Anime.
-- Vale para fontes já existentes e para os itens que elas geraram no feed.

UPDATE sources
SET category_id = 'anime'
WHERE type = 'tmdb'
  AND EXISTS (
    SELECT 1
    FROM media m, json_each(CASE WHEN json_valid(m.raw) THEN m.raw ELSE '{}' END, '$.genres') g
    WHERE m.source_id = sources.id
      AND lower(COALESCE(json_extract(g.value, '$.name'), '')) LIKE '%anima%'
  );

UPDATE items
SET category_id = 'anime'
WHERE source_id IN (
  SELECT s.id
  FROM sources s
  WHERE s.type = 'tmdb'
    AND EXISTS (
      SELECT 1
      FROM media m, json_each(CASE WHEN json_valid(m.raw) THEN m.raw ELSE '{}' END, '$.genres') g
      WHERE m.source_id = s.id
        AND lower(COALESCE(json_extract(g.value, '$.name'), '')) LIKE '%anima%'
    )
);

