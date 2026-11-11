package com.minhabolha.android

import org.json.JSONObject

/** Fonte automática do calendário global. */
object GlobalReleasesSource {

    const val TYPE = "global-releases"

    fun find(database: HubDatabase): JSONObject? = database.sourceByType(TYPE)

    /** Cria/ativa a fonte do calendário global, sem depender de chaves. */
    fun ensure(database: HubDatabase): JSONObject {
        val existing = find(database)
        if (existing != null) {
            if (!existing.optBoolean("enabled", true)) {
                database.updateSource(existing.getString("id"), enabled = true)
            }
            return database.source(existing.getString("id")) ?: existing
        }

        return database.createSource(
            type = TYPE,
            name = "Calendário global",
            categoryId = "other",
            config = JSONObject().put("provider", "global"),
            intervalMinutes = 360
        )
    }
}
