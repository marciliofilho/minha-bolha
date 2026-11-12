package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Http
import org.json.JSONArray
import org.json.JSONObject

/**
 * Streams dos addons do Stremio.
 *
 * Agrega o recurso `stream` de todos os addons habilitados e normaliza o
 * resultado para a interface. Streams diretas (HTTP/HLS) já saem com
 * `playbackUrl`; torrents ficam listados, mas sem reprodução enquanto o motor
 * nativo não existe no Android.
 */
object StremioStreams {

    fun fetch(
        database: HubDatabase,
        type: String,
        id: String,
        season: Int?,
        episode: Int?,
        videoId: String?
    ): JSONObject {
        val effectiveVideoId = videoId?.takeIf { it.isNotBlank() }
            ?: seriesVideoId(type, id, season, episode)

        val started = System.currentTimeMillis()
        val collected = mutableListOf<JSONObject>()
        val errors = JSONArray()

        for (addon in database.stremioAddons()) {
            if (!addon.enabled) continue
            if (!supportsStream(addon.manifest, type)) continue

            try {
                val base = addon.transportUrl.removeSuffix("/manifest.json").trimEnd('/')
                val response = Http.fetchText(
                    "$base/stream/$type/${enc(effectiveVideoId)}.json",
                    accept = "application/json",
                    retries = 1
                )
                val payload = JSONObject(response.text)
                val items = payload.optJSONArray("streams") ?: continue

                for (index in 0 until items.length()) {
                    val stream = items.optJSONObject(index) ?: continue
                    collected.add(normalize(addon, stream, index))
                }
            } catch (error: Exception) {
                val message = when (error) {
                    is ConnectorError -> error.message ?: error.code
                    else -> error.message ?: "falha ao consultar o addon"
                }
                errors.put(
                    JSONObject()
                        .put("addonId", addon.id)
                        .put("addonName", addon.name)
                        .put("message", message)
                        .put("helpUrl", JSONObject.NULL)
                )
            }
        }

        // Diretos primeiro; depois os torrents com mais seeds. Sem isso o
        // Torrentio devolve primeiro streams de 4K com 3 peers e o player
        // demora/ falha antes de chegar nos 1080p bem semeados.
        val ordered = collected.sortedWith(
            compareByDescending<JSONObject> { if (it.optString("kind") == "direct") 1 else 0 }
                .thenByDescending { it.optInt("seeds", 0) }
                .thenByDescending { qualityRank(it.optText("quality")) }
        )
        val streams = JSONArray()
        for (stream in ordered) streams.put(stream)

        return JSONObject()
            .put("type", type)
            .put("id", id)
            .put("videoId", effectiveVideoId)
            .put("streams", streams)
            .put("errors", errors)
            .put("cache", JSONObject().put("used", false).put("refreshing", false))
            .put("elapsedMs", System.currentTimeMillis() - started)
    }

    private fun qualityRank(quality: String?): Int = when {
        quality == null -> 0
        quality.contains("4k", true) || quality.contains("2160") -> 4
        quality.contains("1080") -> 3
        quality.contains("720") -> 2
        quality.contains("480") -> 1
        else -> 0
    }

    private fun seriesVideoId(type: String, id: String, season: Int?, episode: Int?): String {
        if (type == "series" && season != null && episode != null) {
            return "$id:$season:$episode"
        }
        return id
    }

    private fun supportsStream(manifest: JSONObject, type: String): Boolean {
        val resources = manifest.optJSONArray("resources") ?: return false
        var hasStream = false
        for (index in 0 until resources.length()) {
            val value = resources.opt(index)
            val name = when (value) {
                is String -> value
                is JSONObject -> value.optString("name")
                else -> ""
            }
            if (name != "stream") continue
            hasStream = true
            if (value is JSONObject) {
                val types = value.optJSONArray("types") ?: continue
                for (typeIndex in 0 until types.length()) {
                    if (types.optString(typeIndex) == type) return true
                }
            }
        }
        if (!hasStream) return false

        val types = manifest.optJSONArray("types") ?: return true
        for (index in 0 until types.length()) {
            if (types.optString(index) == type) return true
        }
        return false
    }

    private fun normalize(addon: StremioAddonRow, stream: JSONObject, index: Int): JSONObject {
        val url = stream.optString("url").takeIf { it.isNotBlank() }
        val externalUrl = stream.optString("externalUrl").takeIf { it.isNotBlank() }
        val ytId = stream.optString("ytId").takeIf { it.isNotBlank() }
        val infoHash = stream.optString("infoHash").takeIf { it.isNotBlank() }
        val name = stream.optString("name").takeIf { it.isNotBlank() }
        val title = stream.optString("title").takeIf { it.isNotBlank() }
        val description = stream.optString("description").takeIf { it.isNotBlank() }

        val kind = when {
            ytId != null -> "external"
            infoHash != null -> "torrent"
            url != null -> "direct"
            externalUrl != null -> "external"
            else -> "unknown"
        }

        val playbackUrl = when (kind) {
            "direct" -> url
            "external" -> externalUrl
            else -> null
        }

        val searchText = listOfNotNull(name, title, description).joinToString(" ")
        val sources = JSONArray()
        stream.optJSONArray("sources")?.let { array ->
            for (sourceIndex in 0 until array.length()) {
                val value = array.optString(sourceIndex)
                if (value.isNotEmpty()) sources.put(value)
            }
        }

        val fileIdx = if (stream.has("fileIdx") && !stream.isNull("fileIdx")) {
            stream.optInt("fileIdx")
        } else {
            null
        }

        return JSONObject()
            .put("id", "${addon.id}:$index")
            .put("addonId", addon.id)
            .put("addonName", addon.name)
            .put("name", name ?: JSONObject.NULL)
            .put("title", title ?: JSONObject.NULL)
            .put("description", description ?: JSONObject.NULL)
            .put("kind", kind)
            .put("url", url ?: JSONObject.NULL)
            .put("playbackUrl", playbackUrl ?: JSONObject.NULL)
            .put("externalUrl", externalUrl ?: JSONObject.NULL)
            .put("ytId", ytId ?: JSONObject.NULL)
            .put("infoHash", infoHash ?: JSONObject.NULL)
            .put("fileIdx", fileIdx ?: JSONObject.NULL)
            .put("sources", sources)
            .put("quality", detectQuality(searchText) ?: JSONObject.NULL)
            .put("sizeBytes", detectSize(searchText) ?: JSONObject.NULL)
            .put("seeds", detectSeeds(searchText) ?: JSONObject.NULL)
            .put("behaviorHints", stream.optJSONObject("behaviorHints") ?: JSONObject.NULL)
    }

    private fun detectQuality(text: String): String? {
        val match = QUALITY_PATTERN.find(text) ?: return null
        return match.value.uppercase()
    }

    private fun detectSize(text: String): Long? {
        val match = SIZE_PATTERN.find(text) ?: return null
        val value = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
        val unit = match.groupValues[2].uppercase()
        val factor = when (unit) {
            "TB", "TIB" -> 1024.0 * 1024 * 1024 * 1024
            "GB", "GIB" -> 1024.0 * 1024 * 1024
            "MB", "MIB" -> 1024.0 * 1024
            else -> 1024.0
        }
        return (value * factor).toLong()
    }

    private fun detectSeeds(text: String): Int? {
        val patterns = listOf(
            Regex("(?:👤|👥|seeds?|seeders?)\\s*[:：]?\\s*(\\d+)", RegexOption.IGNORE_CASE),
            Regex("(\\d+)\\s*(?:seeds?|seeders?)", RegexOption.IGNORE_CASE)
        )
        for (pattern in patterns) {
            val match = pattern.find(text) ?: continue
            return match.groupValues[1].toIntOrNull()
        }
        return null
    }

    private fun enc(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")

    private val QUALITY_PATTERN = Regex(
        "\\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hdr|bluray|brrip|web-?dl|webrip|hdtv|cam)\\b",
        RegexOption.IGNORE_CASE
    )

    private val SIZE_PATTERN = Regex(
        "(\\d+(?:[.,]\\d+)?)\\s*(tb|tib|gb|gib|mb|mib|kb|kib)\\b",
        RegexOption.IGNORE_CASE
    )
}
