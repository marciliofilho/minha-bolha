package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Http
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Streams dos addons do Stremio.
 *
 * Agrega o recurso `stream` de todos os addons habilitados e normaliza o
 * resultado para a interface. Streams diretas (HTTP/HLS) já saem com
 * `playbackUrl`; torrents ficam listados, mas sem reprodução enquanto o motor
 * nativo não existe no Android.
 */
object StremioStreams {

    private const val STREAM_TIMEOUT_MS = 15_000L
    private const val STREAM_CACHE_MS = 3 * 60_000L
    private val streamExecutor = Executors.newFixedThreadPool(8)

    private data class CacheEntry(val payload: JSONObject, val expiresAt: Long)

    private val streamCache = ConcurrentHashMap<String, CacheEntry>()

    private data class AddonResult(
        val streams: List<JSONObject>,
        val error: JSONObject?
    )

    private data class AddonJob(
        val addon: StremioAddonRow,
        val queryType: String,
        val future: java.util.concurrent.Future<AddonResult>
    )

    fun fetch(
        database: HubDatabase,
        type: String,
        id: String,
        season: Int?,
        episode: Int?,
        videoId: String?,
        forceRefresh: Boolean = false
    ): JSONObject {
        val effectiveVideoId = videoId?.takeIf { it.isNotBlank() }
            ?: seriesVideoId(type, id, season, episode)

        val cacheKey = "$type|$effectiveVideoId"
        val cached = streamCache[cacheKey]
        if (!forceRefresh && cached != null && cached.expiresAt > System.currentTimeMillis()) {
            return JSONObject(cached.payload.toString())
                .put("cache", JSONObject().put("used", true).put("refreshing", false))
        }

        val started = System.currentTimeMillis()

        // Addons de anime (FenixFlix) esperam type=anime, mas parte dos addons
        // de torrent só responde com type=series. Consulta os dois e mescla.
        val queryTypes = if (type == "anime") listOf("anime", "series") else listOf(type)
        val jobs = mutableListOf<AddonJob>()
        for (queryType in queryTypes) {
            for (addon in database.stremioAddons()) {
                if (!addon.enabled || !supportsStream(addon.manifest, queryType)) continue
                jobs.add(
                    AddonJob(
                        addon = addon,
                        queryType = queryType,
                        future = streamExecutor.submit<AddonResult> {
                            fetchAddon(addon, queryType, effectiveVideoId)
                        }
                    )
                )
            }
        }

        val collected = mutableListOf<JSONObject>()
        val errorEntries = mutableListOf<JSONObject>()
        val addonsWithStreams = mutableSetOf<String>()
        // Um único prazo para todos os addons; evita esperar 15s por cada um.
        val deadline = started + STREAM_TIMEOUT_MS + 1_500

        for (job in jobs) {
            val remaining = deadline - System.currentTimeMillis()
            val result = if (remaining <= 0) {
                job.future.cancel(true)
                timeoutResult(job.addon)
            } else {
                try {
                    job.future.get(remaining, TimeUnit.MILLISECONDS)
                } catch (error: Exception) {
                    job.future.cancel(true)
                    timeoutResult(job.addon)
                }
            }
            if (result.streams.isNotEmpty()) addonsWithStreams.add(job.addon.id)
            collected.addAll(result.streams)
            result.error?.let { errorEntries.add(it) }
        }

        val errors = JSONArray()
        val seenErrors = mutableSetOf<String>()
        for (entry in errorEntries) {
            val addonId = entry.optString("addonId")
            // Se o mesmo addon respondeu por outro tipo, não mostra erro redundante.
            if (addonId in addonsWithStreams || !seenErrors.add(addonId)) continue
            errors.put(entry)
        }

        val seenStreams = mutableSetOf<String>()
        val unique = collected.filter { stream ->
            val key = streamKey(stream)
            key.isNotEmpty() && seenStreams.add(key)
        }

        // Diretos primeiro; depois os torrents com mais seeds. Sem isso o
        // Torrentio devolve primeiro streams de 4K com 3 peers e o player
        // demora/ falha antes de chegar nos 1080p bem semeados.
        val ordered = unique.sortedWith(
            compareByDescending<JSONObject> { if (it.optString("kind") == "direct") 1 else 0 }
                .thenByDescending { it.optInt("seeds", 0) }
                .thenByDescending { qualityRank(it.optText("quality")) }
        )
        val streams = JSONArray()
        for (stream in ordered) streams.put(stream)

        val payload = JSONObject()
            .put("type", type)
            .put("id", id)
            .put("videoId", effectiveVideoId)
            .put("streams", streams)
            .put("errors", errors)
            .put("cache", JSONObject().put("used", false).put("refreshing", false))
            .put("elapsedMs", System.currentTimeMillis() - started)
        // Lista vazia pode ser um addon lento/bloqueado; não a cacheia para
        // não prender o usuário em "0 opções" pelos próximos 3 minutos.
        if (streams.length() > 0) {
            streamCache[cacheKey] = CacheEntry(
                JSONObject(payload.toString()),
                System.currentTimeMillis() + STREAM_CACHE_MS
            )
        } else {
            streamCache.remove(cacheKey)
        }
        return payload
    }

    private fun fetchAddon(
        addon: StremioAddonRow,
        queryType: String,
        videoId: String
    ): AddonResult {
        return try {
            val base = addon.transportUrl.removeSuffix("/manifest.json").trimEnd('/')
            val response = Http.fetchText(
                "$base/stream/$queryType/${enc(videoId)}.json",
                accept = "application/json",
                retries = 0,
                timeoutMs = STREAM_TIMEOUT_MS
            )
            val payload = JSONObject(response.text)
            val items = payload.optJSONArray("streams") ?: JSONArray()
            val list = mutableListOf<JSONObject>()
            for (index in 0 until items.length()) {
                val stream = items.optJSONObject(index) ?: continue
                list.add(normalize(addon, stream, index, queryType))
            }
            AddonResult(list, null)
        } catch (error: Exception) {
            val message = when (error) {
                is ConnectorError -> error.message ?: error.code
                else -> error.message ?: "falha ao consultar o addon"
            }
            AddonResult(
                emptyList(),
                JSONObject()
                    .put("addonId", addon.id)
                    .put("addonName", addon.name)
                    .put("message", message)
                    .put("helpUrl", JSONObject.NULL)
                    .put("code", AddonDiagnostics.codeOf(error))
                    .put("host", AddonDiagnostics.hostOf(addon.transportUrl) ?: JSONObject.NULL)
            )
        }
    }

    private fun timeoutResult(addon: StremioAddonRow): AddonResult = AddonResult(
        emptyList(),
        JSONObject()
            .put("addonId", addon.id)
            .put("addonName", addon.name)
            .put("message", "timeout")
            .put("helpUrl", JSONObject.NULL)
            .put("code", "timeout")
            .put("host", AddonDiagnostics.hostOf(addon.transportUrl) ?: JSONObject.NULL)
    )

    private fun streamKey(stream: JSONObject): String {
        val playback = stream.opt("playbackUrl") as? String
        val external = stream.opt("externalUrl") as? String
        val infoHash = stream.opt("infoHash") as? String
        return playback ?: external ?: infoHash ?: stream.optString("id")
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
        if (type != "movie" && season != null && episode != null) {
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

    private fun normalize(
        addon: StremioAddonRow,
        stream: JSONObject,
        index: Int,
        queryType: String
    ): JSONObject {
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
            .put("id", "${addon.id}:$queryType:$index")
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
