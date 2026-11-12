package com.minhabolha.android

import com.minhabolha.android.connectors.Http
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Diagnóstico de um addon, equivalente ao botão "Testar" do desktop.
 *
 * Recarrega o manifest, tenta um título de exemplo em até três catálogos e,
 * se o addon declarar `stream`, consulta os streams desse título. O resumo é
 * salvo em `stremio_addons.last_test_*` e devolvido para a interface.
 */
object StremioAddonTest {

    private data class Sample(val type: String, val id: String, val name: String?)

    private val QUALITY = Regex("(?i)\\b(2160p?|4k|1080p?|720p?|480p?|360p?)\\b")
    private val SEEDS = Regex("(?i)(?:seeds?|👤)\\D{0,4}(\\d{1,6})")
    private val SIZE = Regex("(?i)(\\d+(?:[.,]\\d+)?)\\s*(tb|tib|gb|gib|mb|mib)")

    fun run(database: HubDatabase, id: String): JSONObject {
        val addon = database.stremioAddon(id)
            ?: throw HubException(404, "not_found", "Addon não encontrado.")

        val started = System.currentTimeMillis()
        val warnings = JSONArray()
        val summary = JSONObject()
            .put("ok", false)
            .put("elapsedMs", 0)
            .put("manifestMs", 0)
            .put("catalogsDeclared", 0)
            .put("catalogsTested", 0)
            .put("streams", JSONObject.NULL)
            .put("warnings", warnings)

        if (addon.transportUrl.isBlank()) {
            warnings.put("Não foi possível descriptografar a URL do addon. Reconecte/recadastre.")
            return finish(database, addon.id, summary, started, warnings)
        }

        val manifestStarted = System.currentTimeMillis()
        val manifest = try {
            StremioCatalog.fetchManifest(addon.transportUrl)
        } catch (error: Exception) {
            warnings.put(error.message ?: "Não foi possível carregar o manifest do addon.")
            return finish(database, addon.id, summary, started, warnings)
        }
        summary.put("manifestMs", System.currentTimeMillis() - manifestStarted)

        val catalogs = manifest.optJSONArray("catalogs") ?: JSONArray()
        summary.put("catalogsDeclared", catalogs.length())

        val base = addon.transportUrl.removeSuffix("/manifest.json").trimEnd('/')
        val (catalogSample, tested) = pickSample(base, catalogs)
        // Addons só de streams (Torrentio) não têm catálogo: usa um título
        // público comum para testar o endpoint de streams.
        val sample = catalogSample ?: fallbackSample(manifest)
        summary.put("catalogsTested", tested)
        if (sample == null) {
            warnings.put("Não encontrei um título de exemplo nos catálogos.")
        }

        if (hasResource(manifest, "stream")) {
            if (sample != null) {
                val streams = testStreams(base, sample)
                summary.put("streams", streams)
                val error = streams.optString("error").ifEmpty { null }
                if (error != null) {
                    warnings.put(error)
                } else if (streams.optInt("count") == 0) {
                    warnings.put("O addon respondeu, mas não retornou streams para o exemplo.")
                }
                summary.put("ok", error == null)
            }
        } else {
            warnings.put("Este addon não declara o recurso \"stream\".")
            summary.put("ok", sample != null || catalogs.length() == 0)
        }

        return finish(database, addon.id, summary, started, warnings)
    }

    private fun finish(
        database: HubDatabase,
        id: String,
        summary: JSONObject,
        started: Long,
        warnings: JSONArray
    ): JSONObject {
        summary.put("elapsedMs", System.currentTimeMillis() - started)
        val ok = summary.optBoolean("ok")
        val error = if (ok) null else warnings.optString(0).ifEmpty { "Falha no teste" }
        database.updateStremioAddonTest(id, ok, error, summary)
        return summary
    }

    private fun hasResource(manifest: JSONObject, name: String): Boolean {
        val resources = manifest.optJSONArray("resources") ?: return false
        for (index in 0 until resources.length()) {
            when (val value = resources.opt(index)) {
                is String -> if (value == name) return true
                is JSONObject -> if (value.optString("name") == name) return true
            }
        }
        return false
    }

    /** Título público usado quando o addon não declara catálogos. */
    private fun fallbackSample(manifest: JSONObject): Sample? {
        val types = manifest.optJSONArray("types") ?: return null
        var supportsMovie = false
        for (index in 0 until types.length()) {
            if (types.optString(index) == "movie") supportsMovie = true
        }
        if (!supportsMovie) return null

        val prefixes = manifest.optJSONArray("idPrefixes")
        if (prefixes == null || prefixes.length() == 0) {
            return Sample("movie", "tt0111161", "The Shawshank Redemption")
        }
        for (index in 0 until prefixes.length()) {
            val prefix = prefixes.optString(index)
            if (prefix == "tt" || "tt0111161".startsWith(prefix)) {
                return Sample("movie", "tt0111161", "The Shawshank Redemption")
            }
        }
        return null
    }

    private fun pickSample(base: String, catalogs: JSONArray): Pair<Sample?, Int> {
        var tested = 0
        for (index in 0 until catalogs.length()) {
            if (tested >= 3) break
            val catalog = catalogs.optJSONObject(index) ?: continue
            val required = catalog.optJSONArray("extraRequired") ?: JSONArray()
            if (required.length() > 0) continue
            val type = catalog.optText("type") ?: continue
            val catalogId = catalog.optText("id") ?: continue
            tested++

            val body = runCatching {
                Http.fetchText(
                    "$base/catalog/$type/${encode(catalogId)}.json",
                    accept = "application/json",
                    retries = 0,
                    timeoutMs = 15_000
                ).text
            }.getOrNull() ?: continue

            val metas = runCatching {
                JSONObject(body).optJSONArray("metas")
            }.getOrNull() ?: continue
            val meta = metas.optJSONObject(0) ?: continue
            val metaId = meta.optText("id") ?: continue
            return Sample(type, metaId, meta.optText("name")) to tested
        }
        return null to tested
    }

    private fun testStreams(base: String, sample: Sample): JSONObject {
        val started = System.currentTimeMillis()
        val kinds = JSONObject()
            .put("direct", 0)
            .put("torrent", 0)
            .put("external", 0)
            .put("unknown", 0)
        val qualities = JSONArray()
        var maxSeeds: Int? = null
        var totalBytes = 0L
        var largestBytes = 0L
        var count = 0
        var error: String? = null

        try {
            val body = Http.fetchText(
                "$base/stream/${sample.type}/${encode(sample.id)}.json",
                accept = "application/json",
                retries = 0,
                timeoutMs = 20_000
            ).text
            val streams = JSONObject(body).optJSONArray("streams") ?: JSONArray()
            count = streams.length()

            for (index in 0 until streams.length()) {
                val stream = streams.optJSONObject(index) ?: continue
                val url = stream.optText("url")
                val infoHash = stream.optText("infoHash")
                val external = stream.optText("externalUrl") ?: stream.optText("ytId")
                when {
                    !infoHash.isNullOrEmpty() ->
                        kinds.put("torrent", kinds.optInt("torrent") + 1)
                    !url.isNullOrEmpty() ->
                        kinds.put("direct", kinds.optInt("direct") + 1)
                    !external.isNullOrEmpty() ->
                        kinds.put("external", kinds.optInt("external") + 1)
                    else -> kinds.put("unknown", kinds.optInt("unknown") + 1)
                }

                val label = listOfNotNull(stream.optText("name"), stream.optText("title"))
                    .joinToString(" ")
                qualityOf(label)?.let { quality ->
                    if (!containsQuality(qualities, quality)) qualities.put(quality)
                }
                seedsOf(label)?.let { seeds ->
                    val current = maxSeeds
                    if (current == null || seeds > current) maxSeeds = seeds
                }
                bytesOf(label)?.let { bytes ->
                    totalBytes += bytes
                    if (bytes > largestBytes) largestBytes = bytes
                }
            }
        } catch (caught: Exception) {
            error = caught.message ?: "Falha ao consultar streams."
        }

        return JSONObject()
            .put("sampleTitle", sample.name ?: JSONObject.NULL)
            .put("sampleId", sample.id)
            .put("sampleType", sample.type)
            .put("count", count)
            .put("kinds", kinds)
            .put("qualities", qualities)
            .put("maxSeeds", maxSeeds ?: JSONObject.NULL)
            .put("totalBytes", if (totalBytes > 0) totalBytes else JSONObject.NULL)
            .put("largestBytes", if (largestBytes > 0) largestBytes else JSONObject.NULL)
            .put("elapsedMs", System.currentTimeMillis() - started)
            .put("error", error ?: JSONObject.NULL)
    }

    private fun qualityOf(label: String): String? =
        QUALITY.find(label)?.value?.uppercase()

    private fun containsQuality(array: JSONArray, value: String): Boolean {
        for (index in 0 until array.length()) {
            if (array.optString(index) == value) return true
        }
        return false
    }

    private fun seedsOf(label: String): Int? =
        SEEDS.find(label)?.groupValues?.getOrNull(1)?.toIntOrNull()

    private fun bytesOf(label: String): Long? {
        val match = SIZE.find(label) ?: return null
        val amount = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
        val unit = match.groupValues[2].lowercase()
        val factor = when {
            unit.startsWith("t") -> 1024.0 * 1024.0 * 1024.0 * 1024.0
            unit.startsWith("g") -> 1024.0 * 1024.0 * 1024.0
            else -> 1024.0 * 1024.0
        }
        return (amount * factor).toLong()
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
