package com.minhabolha.android

import org.json.JSONArray
import org.json.JSONObject

/**
 * Backup/restauração local.
 *
 * O formato é o mesmo do desktop (`hub-backup` v2), então dá para exportar no
 * PC e importar no celular (e vice-versa). Seções cobertas nesta versão:
 * settings, categories, sources, games, calendar, feed, playback e
 * stremioLibrary. Credenciais (apiKeys/stremioAccount) e addons não são
 * exportados por padrão.
 */
object BackupService {

    const val FORMAT = "hub-backup"
    const val VERSION = 2

    private val DEFAULT_SECTIONS = listOf("settings", "categories", "sources")

    private val ALL_SECTIONS = listOf(
        "settings", "categories", "sources", "addons", "games", "calendar", "feed",
        "playback", "stremioLibrary", "localLibrary", "novels"
    )

    private val SENSITIVE = setOf("addons", "apiKeys", "stremioAccount")

    /** Seções de linhas cruas e as tabelas correspondentes. */
    private val RAW_TABLES = mapOf(
        "games" to listOf("games", "price_history"),
        "calendar" to listOf("media", "release_events", "global_releases"),
        "feed" to listOf("items"),
        "playback" to listOf("stremio_playback"),
        "stremioLibrary" to listOf("stremio_library"),
        "localLibrary" to listOf("stremio_library_state"),
        "novels" to listOf("novel_cache")
    )

    // ---------------------------------------------------------------------
    // Exportação
    // ---------------------------------------------------------------------

    fun export(database: HubDatabase, include: String?): JSONObject {
        val requested = include
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it in ALL_SECTIONS }
            ?.takeIf { it.isNotEmpty() }
            ?: DEFAULT_SECTIONS

        val selected = requested.toMutableSet()
        // Dependências: sem categorias, as fontes não têm para onde apontar.
        if ("sources" in selected) selected.add("categories")

        val document = JSONObject()
            .put("format", FORMAT)
            .put("version", VERSION)
            .put("exportedAt", Dates.nowIso())
            .put("sections", JSONArray(ALL_SECTIONS.filter { it in selected }))

        if ("settings" in selected) document.put("settings", database.settings())

        if ("categories" in selected) {
            val categories = JSONArray()
            val all = database.categories()
            for (index in 0 until all.length()) {
                val category = all.optJSONObject(index) ?: continue
                if (category.optBoolean("isSystem")) continue
                categories.put(
                    JSONObject()
                        .put("id", category.optString("id"))
                        .put("label", category.optString("label"))
                        .put("icon", category.optString("icon"))
                        .put("color", category.optString("color"))
                )
            }
            document.put("categories", categories)
        }

        if ("sources" in selected) {
            val sources = JSONArray()
            val all = database.sources()
            for (index in 0 until all.length()) {
                val source = all.optJSONObject(index) ?: continue
                val type = source.optString("type")
                // Fontes automáticas e de demonstração são recriadas sozinhas.
                if (type == "global-releases" || type == "stremio-library") continue
                if (source.optBoolean("isDemo")) continue
                sources.put(
                    JSONObject()
                        .put("id", source.optString("id"))
                        .put("type", type)
                        .put("name", source.optString("name"))
                        .put("categoryId", source.optString("categoryId"))
                        .put("config", source.optJSONObject("config") ?: JSONObject())
                        .put("enabled", source.optBoolean("enabled", true))
                        .put("intervalMinutes", source.optInt("intervalMinutes", 30))
                )
            }
            document.put("sources", sources)
        }

        for (section in RAW_TABLES.keys) {
            if (section !in selected) continue
            val tables = RAW_TABLES.getValue(section)
            for (table in tables) {
                val key = if (tables.size == 1) section else "$section:${table}"
                document.put(key, rowsOf(database, table))
            }
        }

        if ("addons" in selected) {
            val addons = JSONArray()
            for (addon in database.stremioAddons()) {
                if (addon.transportUrl.isEmpty()) continue
                addons.put(
                    JSONObject()
                        .put("transportUrl", addon.transportUrl)
                        .put("manifest", addon.manifest)
                        .put("name", addon.name)
                        .put("enabled", addon.enabled)
                        .put("priority", addon.priority)
                )
            }
            document.put("addons", addons)
        }

        return document
    }

    private fun rowsOf(database: HubDatabase, table: String): JSONArray {
        val result = JSONArray()
        database.rawRows(table).forEach { result.put(it) }
        return result
    }

    // ---------------------------------------------------------------------
    // Prévia
    // ---------------------------------------------------------------------

    fun preview(database: HubDatabase, document: JSONObject): JSONObject {
        val sections = documentSections(document)
        val existingCategories = database.categories()
            .let { array -> (0 until array.length()).map { array.getJSONObject(it).getString("id") }.toSet() }
        val existingSources = database.sources()
            .let { array -> (0 until array.length()).map { array.getJSONObject(it).getString("id") }.toSet() }

        val incomingCategories = document.optJSONArray("categories") ?: JSONArray()
        val incomingSources = document.optJSONArray("sources") ?: JSONArray()

        var newCategories = 0
        var existingCount = 0
        for (index in 0 until incomingCategories.length()) {
            val id = incomingCategories.optJSONObject(index)?.optString("id").orEmpty()
            if (id.isEmpty()) continue
            if (id in existingCategories) existingCount++ else newCategories++
        }

        var newSources = 0
        var existingSourceCount = 0
        for (index in 0 until incomingSources.length()) {
            val id = incomingSources.optJSONObject(index)?.optString("id").orEmpty()
            if (id.isEmpty()) continue
            if (id in existingSources) existingSourceCount++ else newSources++
        }

        val sectionPreviews = JSONArray()
        var settingsFields = 0
        for (section in ALL_SECTIONS) {
            if (section !in sections) continue
            val count = when (section) {
                "settings" -> {
                    settingsFields = document.optJSONObject("settings")?.length() ?: 0
                    settingsFields
                }

                "categories" -> incomingCategories.length()
                "sources" -> incomingSources.length()
                "addons" -> document.optJSONArray("addons")?.length() ?: 0
                else -> RAW_TABLES[section]?.sumOf { table ->
                    val key = if (RAW_TABLES.getValue(section).size == 1) section else "$section:$table"
                    document.optJSONArray(key)?.length() ?: 0
                } ?: 0
            }
            sectionPreviews.put(
                JSONObject()
                    .put("id", section)
                    .put("count", count)
                    .put("sensitive", section in SENSITIVE)
            )
        }

        return JSONObject()
            .put("exportedAt", document.optString("exportedAt"))
            .put(
                "sources",
                JSONObject()
                    .put("total", incomingSources.length())
                    .put("new", newSources)
                    .put("existing", existingSourceCount)
            )
            .put(
                "categories",
                JSONObject()
                    .put("total", incomingCategories.length())
                    .put("new", newCategories)
                    .put("existing", existingCount)
            )
            .put("settingsFields", settingsFields)
            .put("sections", sectionPreviews)
    }

    // ---------------------------------------------------------------------
    // Importação
    // ---------------------------------------------------------------------

    fun import(database: HubDatabase, document: JSONObject): JSONObject {
        val sections = documentSections(document)
        val sectionCounts = JSONObject()

        var sourcesCreated = 0
        var sourcesUpdated = 0
        var categoriesImported = 0
        var settingsUpdated = false

        if ("settings" in sections) {
            document.optJSONObject("settings")?.let { settings ->
                database.updateSettings(settings)
                settingsUpdated = true
                sectionCounts.put("settings", settings.length())
            }
        }

        if ("categories" in sections) {
            val categories = document.optJSONArray("categories") ?: JSONArray()
            for (index in 0 until categories.length()) {
                val category = categories.optJSONObject(index) ?: continue
                val id = category.optString("id")
                if (id.isEmpty()) continue
                database.upsertCategoryFromBackup(
                    id = id,
                    label = category.optString("label").ifEmpty { id },
                    icon = category.optString("icon").ifEmpty { "rss" },
                    color = category.optString("color").ifEmpty { "#8b96a8" }
                )
                categoriesImported++
            }
            sectionCounts.put("categories", categoriesImported)
        }

        if ("sources" in sections) {
            val sources = document.optJSONArray("sources") ?: JSONArray()
            for (index in 0 until sources.length()) {
                val source = sources.optJSONObject(index) ?: continue
                val id = source.optString("id")
                val type = source.optString("type")
                if (id.isEmpty() || type.isEmpty()) continue

                val existed = database.sourceRow(id) != null
                database.importSource(
                    id = id,
                    type = type,
                    name = source.optString("name").ifEmpty { type },
                    categoryId = source.optString("categoryId").ifEmpty { "other" },
                    config = source.optJSONObject("config") ?: JSONObject(),
                    enabled = source.optBoolean("enabled", true),
                    intervalMinutes = source.optInt("intervalMinutes", 30)
                )
                if (existed) sourcesUpdated++ else sourcesCreated++
            }
            sectionCounts.put("sources", sourcesCreated + sourcesUpdated)
        }

        for ((section, tables) in RAW_TABLES) {
            if (section !in sections) continue
            var total = 0
            for (table in tables) {
                val key = if (tables.size == 1) section else "$section:$table"
                val rows = document.optJSONArray(key) ?: continue
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    database.importRow(table, row)
                    total++
                }
            }
            sectionCounts.put(section, total)
        }

        if ("addons" in sections) {
            val addons = document.optJSONArray("addons") ?: JSONArray()
            var imported = 0
            for (index in 0 until addons.length()) {
                val addon = addons.optJSONObject(index) ?: continue
                val transportUrl = addon.optString("transportUrl")
                if (transportUrl.isEmpty()) continue
                database.importAddon(
                    transportUrl = transportUrl,
                    manifest = addon.optJSONObject("manifest") ?: JSONObject(),
                    name = addon.optString("name").ifEmpty { "Addon" },
                    enabled = addon.optBoolean("enabled", true),
                    priority = addon.optInt("priority", 100)
                )
                imported++
            }
            sectionCounts.put("addons", imported)
        }

        return JSONObject()
            .put("sourcesCreated", sourcesCreated)
            .put("sourcesUpdated", sourcesUpdated)
            .put("categoriesImported", categoriesImported)
            .put("settingsUpdated", settingsUpdated)
            .put("sections", sectionCounts)
    }

    private fun documentSections(document: JSONObject): Set<String> {
        if (document.optInt("version", 1) < 2) return DEFAULT_SECTIONS.toSet()
        val array = document.optJSONArray("sections") ?: return DEFAULT_SECTIONS.toSet()
        val result = mutableSetOf<String>()
        for (index in 0 until array.length()) {
            val value = array.optString(index)
            if (value in ALL_SECTIONS) result.add(value)
        }
        return result.ifEmpty { DEFAULT_SECTIONS.toSet() }
    }
}
