package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Http
import com.minhabolha.android.connectors.TextUtil
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * Addons do Stremio: manifest, catálogos e busca.
 *
 * A URL de transporte pode conter configuração/chaves, então fica cifrada no
 * banco e nunca volta para a interface. O que a UI recebe é o manifest público
 * e uma URL mascarada.
 */
object StremioCatalog {

    private const val MAX_MANIFEST_BYTES = 512 * 1024

    // ---------------------------------------------------------------------
    // Addons
    // ---------------------------------------------------------------------

    fun listAddons(database: HubDatabase): JSONArray {
        val result = JSONArray()
        for (addon in database.stremioAddons()) result.put(toAddonDto(addon))
        return result
    }

    private fun toAddonDto(addon: StremioAddonRow): JSONObject {
        val manifest = addon.manifest
        return JSONObject()
            .put("id", addon.id)
            .put("addonId", addon.addonId ?: JSONObject.NULL)
            .put("name", addon.name)
            .put("version", addon.version ?: JSONObject.NULL)
            .put("description", addon.description ?: JSONObject.NULL)
            .put("logo", manifest.optString("logo").ifEmpty { null } ?: JSONObject.NULL)
            .put("background", manifest.optString("background").ifEmpty { null } ?: JSONObject.NULL)
            .put("maskedUrl", maskUrl(addon.transportUrl))
            .put("resources", resourcesOf(manifest))
            .put("types", stringArray(manifest.optJSONArray("types")))
            .put("idPrefixes", stringArray(manifest.optJSONArray("idPrefixes")))
            .put("catalogs", catalogsOf(manifest))
            .put("enabled", addon.enabled)
            .put("priority", addon.priority)
            .put("lastTestAt", JSONObject.NULL)
            .put("lastTestOk", JSONObject.NULL)
            .put("lastTestError", JSONObject.NULL)
            .put("lastTestSummary", JSONObject.NULL)
            .put("createdAt", addon.createdAt)
    }

    private fun maskUrl(url: String): String {
        return try {
            val parsed = java.net.URL(url)
            val base = "${parsed.protocol}://${parsed.host}${parsed.path}"
            if (url.length > base.length) "$base…" else base
        } catch (error: Exception) {
            "addon"
        }
    }

    private fun stringArray(array: JSONArray?): JSONArray {
        val result = JSONArray()
        if (array == null) return result
        for (index in 0 until array.length()) {
            val value = array.optString(index)
            if (value.isNotEmpty()) result.put(value)
        }
        return result
    }

    private fun resourcesOf(manifest: JSONObject): JSONArray {
        val result = JSONArray()
        val resources = manifest.optJSONArray("resources") ?: return result
        for (index in 0 until resources.length()) {
            val value = resources.opt(index)
            when (value) {
                is String -> result.put(
                    JSONObject().put("name", value).put("types", JSONArray()).put("idPrefixes", JSONArray())
                )

                is JSONObject -> result.put(
                    JSONObject()
                        .put("name", value.optString("name"))
                        .put("types", stringArray(value.optJSONArray("types")))
                        .put("idPrefixes", stringArray(value.optJSONArray("idPrefixes")))
                )
            }
        }
        return result
    }

    private fun catalogsOf(manifest: JSONObject): JSONArray {
        val result = JSONArray()
        val catalogs = manifest.optJSONArray("catalogs") ?: return result
        for (index in 0 until catalogs.length()) {
            val catalog = catalogs.optJSONObject(index) ?: continue
            val extra = catalog.optJSONArray("extra")
            val supported = mutableListOf<String>()
            val required = mutableListOf<String>()
            var canSearch = false
            if (extra != null) {
                for (extraIndex in 0 until extra.length()) {
                    val item = extra.opt(extraIndex)
                    when (item) {
                        is String -> {
                            supported.add(item)
                            if (item == "search") canSearch = true
                        }

                        is JSONObject -> {
                            val name = item.optString("name")
                            if (name.isEmpty()) continue
                            supported.add(name)
                            if (item.optBoolean("isRequired")) required.add(name)
                            if (name == "search") canSearch = true
                        }
                    }
                }
            }

            result.put(
                JSONObject()
                    .put("type", catalog.optString("type"))
                    .put("id", catalog.optString("id"))
                    .put("name", catalog.optString("name").ifEmpty { catalog.optString("id") })
                    .put("extraSupported", JSONArray(supported))
                    .put("extraRequired", JSONArray(required))
                    .put("canSearch", canSearch)
            )
        }
        return result
    }

    /** Adiciona um addon a partir da URL do manifest. */
    fun addAddon(database: HubDatabase, rawUrl: String): JSONObject {
        val transportUrl = normalizeManifestUrl(rawUrl)
        val hash = sha256(transportUrl)
        database.findStremioAddonByHash(hash)?.let {
            throw HubException(409, "conflict", "Este addon já está instalado.")
        }

        val manifest = fetchManifest(transportUrl)
        val addonId = manifest.optString("id").ifEmpty { null }
        val name = manifest.optString("name").ifEmpty { addonId ?: "Addon" }

        val rowId = UUID.randomUUID().toString()
        val priority = database.countStremioAddons() + 100
        database.insertStremioAddon(
            id = rowId,
            urlHash = hash,
            transportUrl = transportUrl,
            addonId = addonId,
            name = name,
            version = manifest.optString("version").ifEmpty { null },
            description = manifest.optString("description").ifEmpty { null },
            manifest = manifest,
            priority = priority
        )

        val addon = database.stremioAddon(rowId)
            ?: throw HubException(500, "database", "Addon não foi salvo.")
        return toAddonDto(addon)
    }

    fun removeAddon(database: HubDatabase, id: String): Boolean = database.deleteStremioAddon(id)

    private fun normalizeManifestUrl(raw: String): String {
        val value = raw.trim()
        if (value.isEmpty()) throw HubException(400, "validation", "Informe a URL do addon.")

        val withProtocol = if (value.startsWith("http://") || value.startsWith("https://")) {
            value
        } else {
            "https://$value"
        }
        val url = com.minhabolha.android.connectors.PublicUrl.assert(withProtocol)
        val text = url.toString()
        return if (text.endsWith("/manifest.json")) text else text.trimEnd('/') + "/manifest.json"
    }

    private fun fetchManifest(transportUrl: String): JSONObject {
        val response = Http.fetchText(
            transportUrl,
            accept = "application/json",
            headers = mapOf("accept" to "application/json"),
            retries = 1
        )
        if (response.text.length > MAX_MANIFEST_BYTES) {
            throw HubException(400, "validation", "O manifest do addon é grande demais.")
        }
        val manifest = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw HubException(
                400,
                "validation",
                "O endereço não devolveu um manifest de addon do Stremio."
            )
        }
        if (manifest.optString("id").isEmpty() || manifest.optString("name").isEmpty()) {
            throw HubException(400, "validation", "Manifest inválido: faltam id/nome.")
        }
        if (manifest.optJSONArray("resources") == null) {
            throw HubException(400, "validation", "Manifest inválido: sem recursos.")
        }
        return manifest
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    // ---------------------------------------------------------------------
    // Catálogos
    // ---------------------------------------------------------------------

    fun catalogGroups(database: HubDatabase): JSONArray {
        val result = JSONArray()
        for (addon in database.stremioAddons()) {
            if (!addon.enabled) continue
            val catalogs = addon.manifest.optJSONArray("catalogs") ?: continue
            for (index in 0 until catalogs.length()) {
                val catalog = catalogs.optJSONObject(index) ?: continue
                val type = catalog.optString("type")
                val id = catalog.optString("id")
                if (type.isEmpty() || id.isEmpty()) continue

                val dto = catalogsOf(JSONObject().put("catalogs", JSONArray().put(catalog)))
                    .optJSONObject(0) ?: continue

                result.put(
                    JSONObject()
                        .put("addonId", addon.id)
                        .put("addonName", addon.name)
                        .put("type", type)
                        .put("catalogId", id)
                        .put("name", dto.optString("name"))
                        .put("canSearch", dto.optBoolean("canSearch"))
                        .put("extraSupported", dto.optJSONArray("extraSupported"))
                        .put("extraRequired", dto.optJSONArray("extraRequired"))
                        .put("priority", addon.priority)
                )
            }
        }
        return result
    }

    fun catalogPage(
        database: HubDatabase,
        addonRowId: String,
        type: String,
        catalogId: String,
        search: String?,
        skip: Int,
        genre: String?
    ): JSONObject {
        val addon = database.stremioAddon(addonRowId)
            ?: throw HubException(404, "not_found", "Addon não encontrado.")
        if (!addon.enabled) throw HubException(400, "validation", "Este addon está desativado.")

        val started = System.currentTimeMillis()
        val base = addon.transportUrl.removeSuffix("/manifest.json").trimEnd('/')
        val query = mutableListOf<String>()
        if (!search.isNullOrBlank()) query.add("search=" + enc(search))
        if (!genre.isNullOrBlank()) query.add("genre=" + enc(genre))
        if (skip > 0) query.add("skip=" + skip)
        val url = "$base/catalog/$type/$catalogId.json" +
            if (query.isEmpty()) "" else "?" + query.joinToString("&")

        val response = try {
            Http.fetchText(url, accept = "application/json", retries = 1)
        } catch (error: ConnectorError) {
            throw HubException(502, error.code, error.message ?: "Falha ao consultar o addon.")
        }

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw HubException(502, "layout_changed", "O addon devolveu uma resposta inválida.")
        }

        val metas = payload.optJSONArray("metas") ?: JSONArray()
        val items = JSONArray()
        for (index in 0 until metas.length()) {
            val meta = metas.optJSONObject(index) ?: continue
            val id = meta.optString("id")
            if (id.isEmpty()) continue
            items.put(
                JSONObject()
                    .put("addonId", addon.id)
                    .put("addonName", addon.name)
                    .put("type", meta.optString("type").ifEmpty { type })
                    .put("id", id)
                    .put("name", meta.optString("name").ifEmpty { id })
                    .put("poster", meta.optString("poster").ifEmpty { null } ?: JSONObject.NULL)
                    .put("year", meta.optInt("year").takeIf { it > 0 } ?: JSONObject.NULL)
                    .put("imdbRating", meta.optString("imdbRating").ifEmpty { null } ?: JSONObject.NULL)
                    .put(
                        "description",
                        TextUtil.truncate(TextUtil.stripHtml(meta.optString("description")), 220)
                            .ifEmpty { null } ?: JSONObject.NULL
                    )
            )
        }

        return JSONObject()
            .put("items", items)
            .put("nextSkip", if (metas.length() >= 20) skip + metas.length() else JSONObject.NULL)
            .put("elapsedMs", System.currentTimeMillis() - started)
    }

    /** Busca o termo em todos os catálogos que suportam `search`. */
    fun search(database: HubDatabase, query: String, type: String?): JSONObject {
        val items = JSONArray()
        val errors = JSONArray()
        val seen = mutableSetOf<String>()

        for (addon in database.stremioAddons()) {
            if (!addon.enabled) continue
            val manifests = addon.manifest.optJSONArray("catalogs") ?: continue
            for (index in 0 until manifests.length()) {
                val catalog = manifests.optJSONObject(index) ?: continue
                val catalogType = catalog.optString("type")
                if (!type.isNullOrBlank() && catalogType != type) continue
                if (!supportsSearch(catalog)) continue

                try {
                    val page = catalogPage(
                        database,
                        addon.id,
                        catalogType,
                        catalog.optString("id"),
                        search = query,
                        skip = 0,
                        genre = null
                    )
                    val pageItems = page.optJSONArray("items") ?: continue
                    for (itemIndex in 0 until pageItems.length()) {
                        val item = pageItems.optJSONObject(itemIndex) ?: continue
                        val key = "${item.optString("type")}:${item.optString("id")}"
                        if (!seen.add(key)) continue
                        items.put(item)
                    }
                } catch (error: Exception) {
                    errors.put(
                        JSONObject()
                            .put("addonName", addon.name)
                            .put("message", error.message ?: "falha ao buscar")
                    )
                }
            }
        }

        return JSONObject()
            .put("items", items)
            .put("errors", errors)
            .put("approximate", false)
    }

    private fun supportsSearch(catalog: JSONObject): Boolean {
        val extra = catalog.optJSONArray("extra") ?: return false
        for (index in 0 until extra.length()) {
            val item = extra.opt(index)
            val name = when (item) {
                is String -> item
                is JSONObject -> item.optString("name")
                else -> ""
            }
            if (name == "search") return true
        }
        return false
    }

    fun status(database: HubDatabase): JSONObject = JSONObject()
        .put("connected", false)
        .put("email", JSONObject.NULL)
        .put("expired", false)
        .put("lastSyncAt", JSONObject.NULL)
        .put("libraryCount", 0)
        .put("appSecretConfigured", false)

    // ---------------------------------------------------------------------
    // Detalhes do título
    // ---------------------------------------------------------------------

    private fun supportsMeta(manifest: JSONObject, type: String): Boolean {
        val resources = manifest.optJSONArray("resources") ?: return false
        var hasMeta = false
        for (index in 0 until resources.length()) {
            val value = resources.opt(index)
            val name = when (value) {
                is String -> value
                is JSONObject -> value.optString("name")
                else -> ""
            }
            if (name == "meta") hasMeta = true
        }
        if (!hasMeta) return false

        val types = manifest.optJSONArray("types") ?: return true
        for (index in 0 until types.length()) {
            if (types.optString(index) == type) return true
        }
        return types.length() == 0
    }

    fun title(database: HubDatabase, type: String, id: String): JSONObject {
        var lastError: String? = null
        for (addon in database.stremioAddons()) {
            if (!addon.enabled) continue
            if (!supportsMeta(addon.manifest, type)) continue
            try {
                val base = addon.transportUrl.removeSuffix("/manifest.json").trimEnd('/')
                val response = Http.fetchText(
                    "$base/meta/$type/${enc(id)}.json",
                    accept = "application/json",
                    retries = 1
                )
                val meta = JSONObject(response.text).optJSONObject("meta") ?: continue
                return toTitleDto(meta, addon, type, id)
            } catch (error: Exception) {
                lastError = error.message
            }
        }

        throw HubException(
            404,
            "not_found",
            lastError ?: "Título não encontrado nos addons instalados."
        )
    }

    private fun toTitleDto(
        meta: JSONObject,
        addon: StremioAddonRow,
        requestedType: String,
        fallbackId: String
    ): JSONObject {
        val metaType = meta.optString("type").ifEmpty { requestedType }
        val videos = meta.optJSONArray("videos")
        val isSeries = requestedType == "series" || requestedType == "tv" ||
            (videos != null && videos.length() > 0)

        val seasons = JSONArray()
        if (videos != null && videos.length() > 0) {
            val grouped = LinkedHashMap<Int, Int>()
            for (index in 0 until videos.length()) {
                val video = videos.optJSONObject(index) ?: continue
                val season = video.optInt("season")
                if (season <= 0) continue
                grouped[season] = (grouped[season] ?: 0) + 1
            }
            for ((season, count) in grouped.toSortedMap()) {
                seasons.put(
                    JSONObject()
                        .put("season", season)
                        .put("name", "Temporada $season")
                        .put("episodeCount", count)
                        .put("airDate", JSONObject.NULL)
                        .put("posterUrl", meta.optString("poster").ifEmpty { null } ?: JSONObject.NULL)
                        .put("overview", JSONObject.NULL)
                )
            }
        }

        val releaseInfo = meta.optString("releaseInfo")
        val year = Regex("(19|20)\\d{2}").find(releaseInfo)?.value?.toIntOrNull()
            ?: meta.optInt("year").takeIf { it > 0 }

        val runtime = try {
            meta.optInt("runtime").takeIf { it > 0 }
        } catch (error: Exception) {
            null
        }

        val genres = JSONArray()
        val genreArray = stringArray(meta.optJSONArray("genres"))
        for (index in 0 until genreArray.length()) {
            genres.put(genreArray.optString(index))
        }

        return JSONObject()
            .put("id", meta.optString("id").ifEmpty { fallbackId })
            .put("type", if (isSeries) "series" else "movie")
            .put("metaType", metaType)
            .put("name", meta.optString("name").ifEmpty { fallbackId })
            .put("originalName", meta.optString("originalName").ifEmpty { null } ?: JSONObject.NULL)
            .put(
                "overview",
                TextUtil.stripHtml(meta.optString("description")).ifEmpty { null } ?: JSONObject.NULL
            )
            .put("posterUrl", meta.optString("poster").ifEmpty { null } ?: JSONObject.NULL)
            .put("backdropUrl", meta.optString("background").ifEmpty { null } ?: JSONObject.NULL)
            .put("year", year ?: JSONObject.NULL)
            .put("genres", genres)
            .put("runtimeMinutes", runtime ?: JSONObject.NULL)
            .put("status", meta.optString("status").ifEmpty { null } ?: JSONObject.NULL)
            .put(
                "imdbId",
                (if (meta.optString("id").startsWith("tt")) meta.optString("id") else null)
                    ?: JSONObject.NULL
            )
            .put("tmdbId", JSONObject.NULL)
            .put("source", "addon")
            .put("addonId", addon.id)
            .put("addonName", addon.name)
            .put("tmdbConfigured", false)
            .put("tmdbError", JSONObject.NULL)
            .put("seasons", seasons)
            .put("inStremioLibrary", false)
            .put("progress", JSONObject.NULL)
    }

    private fun enc(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
}
