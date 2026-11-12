package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import com.minhabolha.android.SteamApp
import com.minhabolha.android.SteamGames
import org.json.JSONObject

/**
 * Wishlist da Steam: importa os jogos e mantém metadados/preços atualizados.
 *
 * A wishlist pública não exige chave; o SteamID é resolvido no cadastro.
 */
class SteamWishlistConnector : Connector {

    override val type = "steam-wishlist"
    override val defaultIntervalMinutes = 360
    override val minIntervalMinutes = 60

    override fun resolve(input: String, settings: JSONObject): ResolvedSource {
        val steamId = SteamGames.resolveSteamId(input)
            ?: throw ConnectorError("config", "Não consegui identificar o perfil da Steam.")
        return ResolvedSource(
            name = "Wishlist da Steam",
            categoryId = "game",
            config = JSONObject().put("steamId", steamId).put("input", input),
            samples = emptyList()
        )
    }

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val steamId = config.optString("steamId")
        if (steamId.isEmpty()) throw ConnectorError("config", "Fonte sem SteamID configurado.")

        val region = settings.optString("region", "BR")
        val appids = SteamGames.wishlistAppIds(steamId)
        val apps = mutableListOf<SteamApp>()
        for (appid in appids.take(120)) {
            SteamGames.appDetails(appid, region)?.let { apps.add(it) }
        }

        return ConnectorResult(
            items = emptyList(),
            state = JSONObject().put("lastSyncAt", Dates.nowIso()),
            steamWishlist = apps
        )
    }
}
