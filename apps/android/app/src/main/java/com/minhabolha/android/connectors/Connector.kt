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
    val lastSuccessAt: String?
)

/** Resultado de uma sincronização. */
data class ConnectorResult(
    val items: List<RawItem>,
    val state: JSONObject
)

interface Connector {
    val type: String
    val defaultIntervalMinutes: Int

    /** Piso rígido: nenhuma fonte deste tipo roda mais rápido que isso. */
    val minIntervalMinutes: Int

    /** Transforma o que o usuário colou em configuração validada. */
    fun resolve(input: String, settings: JSONObject): ResolvedSource

    fun fetch(source: SourceRow, config: JSONObject, state: JSONObject?, settings: JSONObject): ConnectorResult
}

/**
 * Erro padronizado: o código define como a UI avisa e como o scheduler
 * calcula o backoff.
 */
class ConnectorError(
    val code: String,
    message: String
) : Exception(message)
