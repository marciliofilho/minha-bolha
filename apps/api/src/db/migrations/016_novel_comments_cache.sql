-- Reextrai capítulos salvos para separar o texto limpo do texto com contadores
-- de comentários (Webnovel). Assim a opção do leitor funciona desde a primeira
-- abertura após a atualização.
DELETE FROM novel_cache WHERE kind = 'chapter';
