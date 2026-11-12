package com.minhabolha.android

import org.json.JSONObject

/** Fonte automática de preços do gg.deals (criada quando há chave). */
object GgDealsSource {

    const val TYPE = "ggdeals"

    fun find(database: HubDatabase): JSONObject? = database.sourceByType(TYPE)

    fun ensure(database: HubDatabase): JSONObject? {
        if (!Secrets.has(database, "ggdeals")) return null

        val existing = find(database)
        if (existing != null) {
            if (!existing.optBoolean("enabled")) {
                database.updateSource(existing.getString("id"), enabled = true)
            }
            return database.source(existing.getString("id")) ?: existing
        }

        return database.createSource(
            type = TYPE,
            name = "Preços gg.deals",
            categoryId = "game",
            config = JSONObject().put("provider", "ggdeals"),
            intervalMinutes = 360
        )
    }
}
