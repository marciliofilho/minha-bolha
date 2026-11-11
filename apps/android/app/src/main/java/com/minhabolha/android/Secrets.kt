package com.minhabolha.android

import org.json.JSONArray
import org.json.JSONObject

/**
 * Chaves de API: status mascarado para a interface, valor nunca devolvido.
 *
 * Os valores ficam cifrados com o Android Keystore na tabela `secrets`, usando
 * as mesmas chaves do desktop (`TMDB_API_KEY`, `STEAM_API_KEY`, …).
 */
object Secrets {

    data class Definition(val id: String, val envVar: String, val label: String)

    val definitions = listOf(
        Definition("tmdb", "TMDB_API_KEY", "TMDB"),
        Definition("steam", "STEAM_API_KEY", "Steam"),
        Definition("ggdeals", "GGDEALS_API_KEY", "gg.deals")
    )

    fun definitionOf(id: String): Definition? = definitions.firstOrNull { it.id == id }

    fun isValidFormat(id: String, value: String): Boolean =
        if (id == "steam") Regex("^[0-9A-Fa-f]{32}$").matches(value.trim()) else true

    fun mask(value: String): String =
        if (value.length <= 4) "••••" else "••••" + value.takeLast(4)

    fun value(database: HubDatabase, id: String): String? {
        val definition = definitionOf(id) ?: return null
        return database.secretValue(definition.envVar)?.takeIf { it.isNotBlank() }
    }

    fun has(database: HubDatabase, id: String): Boolean = value(database, id) != null

    fun status(database: HubDatabase, definition: Definition): JSONObject {
        val stored = value(database, definition.id)
        return if (stored == null) {
            JSONObject()
                .put("id", definition.id)
                .put("label", definition.label)
                .put("envVar", definition.envVar)
                .put("configured", false)
                .put("source", JSONObject.NULL)
                .put("masked", JSONObject.NULL)
                .put("formatValid", JSONObject.NULL)
        } else {
            JSONObject()
                .put("id", definition.id)
                .put("label", definition.label)
                .put("envVar", definition.envVar)
                .put("configured", true)
                .put("source", "app")
                .put("masked", mask(stored))
                .put("formatValid", isValidFormat(definition.id, stored))
        }
    }

    fun list(database: HubDatabase): JSONArray {
        val result = JSONArray()
        for (definition in definitions) result.put(status(database, definition))
        return result
    }
}
