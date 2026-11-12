package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Http
import org.json.JSONArray
import org.json.JSONObject

/** Metadados de um jogo na Steam. */
data class SteamApp(
    val appid: Int,
    val name: String,
    val headerUrl: String?,
    val coverUrl: String?,
    val currency: String,
    val baseCents: Int?,
    val finalCents: Int?,
    val discount: Int
)

/**
 * Metadados e wishlist da Steam.
 *
 * `appdetails` e `storesearch` são públicos; a wishlist usa o endpoint
 * `IWishlistService` (perfis públicos) e o ID é resolvido pelo XML do perfil,
 * sem precisar de chave de API.
 */
object SteamGames {

    private const val STORE = "https://store.steampowered.com/api"
    private const val WISHLIST = "https://api.steampowered.com/IWishlistService/GetWishlist/v1"

    fun appDetails(appid: Int, region: String): SteamApp? {
        if (appid <= 0) return null
        val url = "$STORE/appdetails?appids=$appid&filters=basic,price_overview&cc=$region&l=portuguese"
        val response = try {
            Http.fetchText(url, accept = "application/json", retries = 1)
        } catch (error: Exception) {
            return null
        }

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            return null
        }

        val entry = payload.optJSONObject(appid.toString()) ?: return null
        if (!entry.optBoolean("success")) return null
        val data = entry.optJSONObject("data") ?: return null

        val price = data.optJSONObject("price_overview")
        val base = price?.optInt("initial")?.takeIf { it > 0 }
        val final = price?.optInt("final")?.takeIf { it > 0 }
        val discount = price?.optInt("discount_percent") ?: 0

        return SteamApp(
            appid = appid,
            name = data.optText("name") ?: "App $appid",
            headerUrl = data.optText("header_image"),
            coverUrl = data.optText("capsule_image"),
            currency = price?.optString("currency").orEmpty().ifEmpty { "BRL" },
            baseCents = base,
            finalCents = final,
            discount = discount
        )
    }

    fun search(term: String, region: String): JSONArray {
        val query = term.trim()
        if (query.length < 2) return JSONArray()
        val url = "$STORE/storesearch/?term=" + java.net.URLEncoder.encode(query, "UTF-8") +
            "&l=portuguese&cc=$region"
        val response = try {
            Http.fetchText(url, accept = "application/json", retries = 1)
        } catch (error: Exception) {
            return JSONArray()
        }

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            return JSONArray()
        }

        val items = payload.optJSONArray("items") ?: return JSONArray()
        val result = JSONArray()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val appid = item.optInt("id")
            if (appid <= 0) continue
            val price = item.optJSONObject("price")
            result.put(
                JSONObject()
                    .put("appid", appid)
                    .put("name", item.optText("name") ?: "App $appid")
                    .put("imageUrl", item.optText("tiny_image") ?: JSONObject.NULL)
                    .put("priceLabel", formatPrice(price))
            )
        }
        return result
    }

    private fun formatPrice(price: JSONObject?): Any {
        if (price == null) return JSONObject.NULL
        val final = price.optInt("final")
        val currency = price.optString("currency").ifEmpty { "BRL" }
        if (final <= 0) return JSONObject.NULL
        return formatCents(final, currency)
    }

    fun formatCents(cents: Int, currency: String): String {
        val value = cents / 100.0
        return when (currency.uppercase()) {
            "BRL" -> "R$ " + String.format(java.util.Locale.US, "%.2f", value).replace('.', ',')
            "USD" -> "$" + String.format(java.util.Locale.US, "%.2f", value)
            else -> String.format(java.util.Locale.US, "%.2f %s", value, currency)
        }
    }

    // ---------------------------------------------------------------------
    // Wishlist
    // ---------------------------------------------------------------------

    /** Aceita SteamID64, URL do perfil ou vanity name. */
    fun resolveSteamId(input: String): String? {
        val value = input.trim()
        if (value.isEmpty()) return null
        if (Regex("^\\d{17}$").matches(value)) return value

        Regex("/profiles/(\\d{17})").find(value)?.let { return it.groupValues[1] }

        val vanity = when {
            value.startsWith("http", true) && value.contains("/id/") ->
                value.substringAfter("/id/").substringBefore('/').substringBefore('?')
            value.startsWith("@") -> value.removePrefix("@")
            else -> value
        }
        if (Regex("^[A-Za-z0-9_-]{2,64}$").matches(vanity)) {
            try {
                val response = Http.fetchText(
                    "https://steamcommunity.com/id/${java.net.URLEncoder.encode(vanity, "UTF-8")}/?xml=1",
                    accept = "text/xml",
                    retries = 1
                )
                Regex("<steamID64>(\\d{17})</steamID64>").find(response.text)?.let {
                    return it.groupValues[1]
                }
            } catch (error: Exception) {
                // cai para o erro abaixo
            }
        }

        throw ConnectorError(
            "config",
            "Não consegui identificar o perfil da Steam. Use o link do perfil ou o SteamID64."
        )
    }

    fun wishlistAppIds(steamId: String): List<Int> {
        val url = "$WISHLIST/?steamid=" + java.net.URLEncoder.encode(steamId, "UTF-8")
        val response = try {
            Http.fetchText(url, accept = "application/json", retries = 1)
        } catch (error: Exception) {
            throw ConnectorError("network", "Não foi possível ler a wishlist da Steam.")
        }

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "A Steam devolveu uma resposta inesperada.")
        }

        val items = payload.optJSONObject("response")?.optJSONArray("items") ?: return emptyList()
        val appids = mutableListOf<Int>()
        for (index in 0 until items.length()) {
            val appid = items.optJSONObject(index)?.optInt("appid") ?: continue
            if (appid > 0) appids.add(appid)
        }
        return appids
    }

    /** Importa a wishlist para o banco e devolve quantos jogos foram salvos. */
    fun syncWishlist(database: HubDatabase, steamId: String, region: String): Int {
        val appids = wishlistAppIds(steamId)
        if (appids.isEmpty()) return 0

        var saved = 0
        for (appid in appids.take(120)) {
            val app = appDetails(appid, region) ?: continue
            database.upsertSteamGame(app, inWishlist = true)
            saved++
        }
        return saved
    }
}
