package com.minhabolha.android.connectors

/**
 * Registro central dos conectores disponíveis no Android.
 *
 * Adicionar um tipo novo é só incluí-lo aqui — o scheduler e as rotas usam
 * `get`/`has`.
 */
object Registry {

    private val connectors: Map<String, Connector> = listOf(
        YoutubeConnector(),
        RssConnector()
    ).associateBy { it.type }

    fun has(type: String): Boolean = connectors.containsKey(type)

    fun get(type: String): Connector = connectors[type]
        ?: throw ConnectorError(
            "not_supported",
            "O tipo \"$type\" ainda não está disponível no Android."
        )

    fun types(): Set<String> = connectors.keys
}
