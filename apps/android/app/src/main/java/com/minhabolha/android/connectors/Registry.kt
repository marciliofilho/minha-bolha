package com.minhabolha.android.connectors

/**
 * Registro central dos conectores disponíveis no Android.
 *
 * Adicionar um tipo novo é só incluí-lo em [configure] — o scheduler e as
 * rotas usam `get`/`has`.
 */
object Registry {

    private val connectors = mutableMapOf<String, Connector>()

    /**
     * Monta os conectores com acesso às chaves de API e ao banco.
     * Idempotente: chamadas repetidas não recriam instâncias.
     */
    @Synchronized
    fun configure(
        secrets: SecretAccess,
        mediaLookup: (String) -> MediaRow?,
        stremioAuthKey: () -> String? = { null }
    ) {
        val tmdb = TmdbConnector(secrets)
        val anilist = AnilistConnector(tmdb, secrets, mediaLookup)

        connectors.clear()
        connectors["youtube"] = YoutubeConnector()
        connectors["rss"] = RssConnector()
        connectors["tmdb"] = tmdb
        connectors["anilist"] = anilist
        connectors["global-releases"] = GlobalReleasesConnector(tmdb, anilist)
        connectors["stremio-library"] = StremioLibraryConnector(stremioAuthKey)
    }

    fun has(type: String): Boolean = connectors.containsKey(type)

    fun get(type: String): Connector = connectors[type]
        ?: throw ConnectorError(
            "not_supported",
            "O tipo \"$type\" ainda não está disponível no Android."
        )

    fun types(): Set<String> = connectors.keys.toSet()

    fun tmdb(): TmdbConnector? = connectors["tmdb"] as? TmdbConnector
}
