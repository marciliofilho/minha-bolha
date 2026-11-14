package com.minhabolha.android.connectors

import org.json.JSONObject

/** Item normalizado devolvido por qualquer conector. */
data class RawItem(
    val externalId: String?,
    /** Chave única global que evita duplicatas (ex.: yt:VIDEO_ID). */
    val dedupeKey: String,
    val kind: String,
    val title: String,
    val url: String,
    val thumbnailUrl: String? = null,
    val description: String? = null,
    val author: String? = null,
    /** ISO 8601 em UTC. */
    val publishedAt: String,
    val meta: JSONObject? = null
)

/** Amostra exibida ao adicionar a fonte. */
data class ResolvedSample(
    val title: String,
    val url: String,
    val publishedAt: String?
)

/** Fonte resolvida a partir do que o usuário colou. */
data class ResolvedSource(
    val name: String,
    val categoryId: String,
    val config: JSONObject,
    val samples: List<ResolvedSample> = emptyList()
)

/** Linha da tabela `sources` usada pelos conectores. */
data class SourceRow(
    val id: String,
    val type: String,
    val name: String,
    val categoryId: String,
    val config: String,
    val state: String?,
    val enabled: Boolean,
    val intervalMinutes: Int,
    val nextRunAt: String?,
    val consecutiveFailures: Int,
    val isDemo: Boolean,
    val lastSuccessAt: String?,
    val lastCheckedAt: String?
)

/** Resultado de uma sincronização. */
data class ConnectorResult(
    val items: List<RawItem>,
    val state: JSONObject,
    val media: RawMedia? = null,
    val releaseEvents: List<RawReleaseEvent> = emptyList(),
    val globalReleases: List<RawGlobalRelease> = emptyList(),
    val globalReleaseProviders: List<String> = emptyList(),
    val stremioLibrary: List<com.minhabolha.android.StremioLibraryItem> = emptyList(),
    val steamWishlist: List<com.minhabolha.android.SteamApp> = emptyList(),
    val prices: List<com.minhabolha.android.GgPrice> = emptyList(),
    val warnings: List<String> = emptyList()
)

/** Título acompanhado (filme, série ou anime). */
data class RawMedia(
    val provider: String,
    val externalId: String,
    val kind: String,
    val title: String,
    val originalTitle: String? = null,
    val posterUrl: String? = null,
    val backdropUrl: String? = null,
    val year: Int? = null,
    val status: String? = null,
    val totalSeasons: Int? = null,
    val nextEpisodeAt: String? = null,
    val url: String? = null,
    val imdbId: String? = null,
    val raw: JSONObject? = null
)

/** Lançamento ou episódio de um título acompanhado. */
data class RawReleaseEvent(
    val externalKey: String,
    val kind: String,
    /** YYYY-MM-DD no fuso configurado. */
    val releaseDate: String,
    val releaseTime: String? = null,
    val releaseAt: String? = null,
    val timezone: String,
    val region: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val episodeTitle: String? = null,
    val url: String? = null
)

/** Lançamento do calendário global, independente das fontes seguidas. */
data class RawGlobalRelease(
    val externalKey: String,
    val provider: String,
    val mediaKind: String,
    val title: String,
    val originalTitle: String? = null,
    val posterUrl: String? = null,
    val kind: String,
    val releaseDate: String,
    val releaseTime: String? = null,
    val releaseAt: String? = null,
    val timezone: String,
    val region: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val episodeTitle: String? = null,
    val url: String? = null,
    val imdbId: String? = null
)

/** Resultado da busca de títulos (TMDB/AniList). */
data class MediaSearchResult(
    val provider: String,
    val ref: String,
    val mediaType: String,
    val title: String,
    val originalTitle: String?,
    val year: Int?,
    val posterUrl: String?,
    val overview: String?
)

/** Título acompanhado já persistido no banco. */
data class MediaRow(
    val id: String,
    val sourceId: String,
    val provider: String,
    val externalId: String,
    val kind: String,
    val title: String,
    val posterUrl: String?,
    val backdropUrl: String?,
    val url: String?,
    val imdbId: String?
)

/** Evento de calendário já persistido no banco. */
data class ReleaseEventRow(
    val id: String,
    val externalKey: String,
    val kind: String,
    val season: Int?,
    val episode: Int?,
    val episodeTitle: String?,
    val releaseDate: String,
    val releaseTime: String?,
    val releaseAt: String?,
    val region: String?,
    val url: String?
)

interface Connector {
    val type: String
    val defaultIntervalMinutes: Int

    /** Piso rígido: nenhuma fonte deste tipo roda mais rápido que isso. */
    val minIntervalMinutes: Int

    /** Transforma o que o usuário colou em configuração validada. */
    fun resolve(input: String, settings: JSONObject): ResolvedSource

    /** Busca títulos por nome (TMDB/AniList). */
    fun search(query: String, settings: JSONObject): List<MediaSearchResult> =
        throw ConnectorError("not_supported", "Este tipo de fonte não aceita busca.")

    fun fetch(source: SourceRow, config: JSONObject, state: JSONObject?, settings: JSONObject): ConnectorResult
}

/**
 * Erro padronizado: o código define como a UI avisa e como o scheduler
 * calcula o backoff.
 */
class ConnectorError(
    val code: String,
    message: String,
    /** Diagnóstico específico para addons (dns, timeout, auth, http...). */
    val diagnostic: String? = null
) : Exception(message)
