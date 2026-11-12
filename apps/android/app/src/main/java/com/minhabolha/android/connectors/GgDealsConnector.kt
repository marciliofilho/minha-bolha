package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import com.minhabolha.android.GgDeals
import org.json.JSONObject

/**
 * Monitor de preços do gg.deals.
 *
 * Roda pelo scheduler (fonte `ggdeals`, criada quando a chave existe) e devolve
 * os preços atuais; o scheduler aplica na biblioteca de jogos.
 */
class GgDealsConnector(
    private val secrets: SecretAccess,
    private val gamesProvider: () -> List<Int>
) : Connector {

    override val type = "ggdeals"
    override val defaultIntervalMinutes = 360
    override val minIntervalMinutes = 360

    override fun resolve(input: String, settings: JSONObject): ResolvedSource =
        throw ConnectorError("not_supported", "A fonte de preços é criada automaticamente.")

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val key = secrets.value("GGDEALS_API_KEY")?.takeIf { it.isNotBlank() }
            ?: throw ConnectorError(
                "auth",
                "Chave do gg.deals não configurada em Configurações → Chaves de API."
            )

        val appids = gamesProvider()
        if (appids.isEmpty()) {
            return ConnectorResult(items = emptyList(), state = JSONObject().put("checked", 0))
        }

        val region = settings.optString("region", "BR")
        val prices = GgDeals.fetch(appids, key, region)
        return ConnectorResult(
            items = emptyList(),
            state = JSONObject()
                .put("checked", prices.size)
                .put("lastSyncAt", Dates.nowIso()),
            prices = prices
        )
    }
}
