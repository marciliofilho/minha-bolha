package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import com.minhabolha.android.StremioApi
import org.json.JSONObject

/**
 * Conector da biblioteca do Stremio.
 *
 * Roda pelo scheduler a cada hora enquanto a conta estiver conectada; o
 * resultado é sincronizado na tabela local pelo [com.minhabolha.android.HubScheduler].
 */
class StremioLibraryConnector(
    private val authKeyProvider: () -> String?
) : Connector {

    override val type = "stremio-library"
    override val defaultIntervalMinutes = 60
    override val minIntervalMinutes = 30

    override fun resolve(input: String, settings: JSONObject): ResolvedSource =
        throw ConnectorError("not_supported", "A biblioteca do Stremio é criada ao conectar a conta.")

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val authKey = authKeyProvider()
            ?: throw ConnectorError("auth", "Conta do Stremio não conectada. Entre novamente em Configurações.")

        val items = StremioApi.fetchLibrary(authKey)
        return ConnectorResult(
            items = emptyList(),
            state = JSONObject().put("lastSyncAt", Dates.nowIso()),
            stremioLibrary = items
        )
    }
}
