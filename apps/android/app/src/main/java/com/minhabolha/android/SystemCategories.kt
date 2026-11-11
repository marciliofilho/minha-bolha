package com.minhabolha.android

/**
 * Categorias do sistema.
 *
 * Espelho de `SYSTEM_CATEGORIES` em `packages/shared/src/index.ts`. O script
 * `scripts/check-android-parity.mjs` compara as duas listas no CI e falha se
 * elas divergirem.
 */
internal data class SystemCategory(
    val id: String,
    val label: String,
    val icon: String,
    val color: String,
    val sortOrder: Int
)

internal val SYSTEM_CATEGORIES = listOf(
    SystemCategory("youtube", "YouTube", "youtube", "#ef4444", 10),
    SystemCategory("novel", "Novels", "book-open", "#a855f7", 20),
    SystemCategory("anime", "Animação/Anime", "sparkles", "#f472b6", 30),
    SystemCategory("movie", "Filmes", "film", "#f59e0b", 40),
    SystemCategory("series", "Séries", "monitor-play", "#38bdf8", 50),
    SystemCategory("game", "Jogos", "gamepad-2", "#22c55e", 60),
    SystemCategory("news", "Notícias", "newspaper", "#60a5fa", 70),
    SystemCategory("other", "Outros", "link", "#94a3b8", 80)
)
