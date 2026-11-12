package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Http
import org.json.JSONObject

/** Preço de um jogo no gg.deals (loja oficial e keyshops). */
data class GgPrice(
    val appid: Int,
    val found: Boolean,
    val currency: String,
    val officialCents: Int?,
    val keyshopCents: Int?,
    val officialLowCents: Int?,
    val keyshopLowCents: Int?,
    val ggUrl: String?
)

/**
 * Preços do gg.deals (loja oficial + keyshops + mínimas históricas).
 *
 * A API gratuita devolve só o menor preço por mercado. Requer chave, então o
 * app degrada bem quando ela não existe (mantém o preço oficial da Steam).
 */
object GgDeals {

    private const val BASE = "https://api.gg.deals/v1"
    private const val MAX_PER_REQUEST = 50

    fun fetch(appids: List<Int>, key: String, region: String): List<GgPrice> {
        val unique = appids.filter { it > 0 }.distinct().take(MAX_PER_REQUEST)
        if (unique.isEmpty()) return emptyList()

        val url = buildString {
            append(BASE).append("/prices/by-steam-app-id/?ids=")
            append(unique.joinToString(","))
            append("&key=").append(java.net.URLEncoder.encode(key, "UTF-8"))
            append("&region=").append(java.net.URLEncoder.encode(region.lowercase(), "UTF-8"))
        }

        val response = try {
            Http.fetchText(url, accept = "application/json", retries = 1, timeoutMs = 30_000)
        } catch (error: Exception) {
            throw ConnectorError("network", "Não foi possível consultar o gg.deals.")
        }

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "O gg.deals devolveu uma resposta inesperada.")
        }

        if (payload.has("success") && !payload.optBoolean("success", true)) {
            throw ConnectorError("layout_changed", "O gg.deals recusou a requisição.")
        }

        val data = payload.optJSONObject("data") ?: return emptyList()
        val result = mutableListOf<GgPrice>()
        for (appid in unique) {
            val entry = data.optJSONObject(appid.toString())
            val prices = entry?.optJSONObject("prices")
            result.add(
                GgPrice(
                    appid = appid,
                    found = entry != null,
                    currency = prices?.optString("currency").orEmpty().ifEmpty { "BRL" },
                    officialCents = cents(prices, "currentRetail"),
                    keyshopCents = cents(prices, "currentKeyshops"),
                    officialLowCents = cents(prices, "historicalRetail"),
                    keyshopLowCents = cents(prices, "historicalKeyshops"),
                    ggUrl = entry?.optString("url")?.takeIf { it.isNotEmpty() }
                )
            )
        }
        return result
    }

    private fun cents(prices: JSONObject?, field: String): Int? {
        if (prices == null || !prices.has(field) || prices.isNull(field)) return null
        val value = prices.optDouble(field, Double.NaN)
        if (value.isNaN() || value <= 0) return null
        return Math.round(value * 100).toInt()
    }
}
