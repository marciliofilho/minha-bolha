package com.minhabolha.android

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.CodingErrorAction
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Legendas dos addons do Stremio.
 *
 * O navegador só aceita WebVTT no `<track>`, então baixamos o arquivo original
 * (SRT/VTT), detectamos o charset e convertemos para VTT num proxy same-origin.
 */
object StremioSubtitles {

    private const val MAX_BYTES = 8 * 1024 * 1024
    private const val CACHE_TTL_MS = 60L * 60_000L
    private const val MAX_HOPS = 4
    private const val SUBTITLE_TIMEOUT_MS = 6_000L

    private data class CacheEntry(val value: Any, val expiresAt: Long)

    private data class AddonSubtitleResult(
        val items: List<JSONObject>,
        val error: JSONObject?
    )

    private val subtitleExecutor = Executors.newFixedThreadPool(6)

    private val cache = ConcurrentHashMap<String, CacheEntry>()

    private val LANGUAGE_NAMES = mapOf(
        "afr" to "Africâner", "alb" to "Albanês", "ara" to "Árabe", "arm" to "Armênio",
        "baq" to "Basco", "ben" to "Bengali", "bos" to "Bósnio", "bre" to "Bretão",
        "bul" to "Búlgaro", "bur" to "Birmanês", "cat" to "Catalão", "chi" to "Chinês",
        "zho" to "Chinês", "cze" to "Tcheco", "ces" to "Tcheco", "dan" to "Dinamarquês",
        "dut" to "Holandês", "nld" to "Holandês", "eng" to "Inglês", "epo" to "Esperanto",
        "est" to "Estoniano", "fin" to "Finlandês", "fre" to "Francês", "fra" to "Francês",
        "geo" to "Georgiano", "kat" to "Georgiano", "ger" to "Alemão", "deu" to "Alemão",
        "glg" to "Galego", "gre" to "Grego", "ell" to "Grego", "heb" to "Hebraico",
        "hin" to "Hindi", "hrv" to "Croata", "hun" to "Húngaro", "ice" to "Islandês",
        "isl" to "Islandês", "ind" to "Indonésio", "ita" to "Italiano", "jpn" to "Japonês",
        "kaz" to "Cazaque", "khm" to "Khmer", "kor" to "Coreano", "lav" to "Letão",
        "lit" to "Lituano", "mac" to "Macedônio", "mkd" to "Macedônio", "may" to "Malaio",
        "msa" to "Malaio", "mal" to "Malaiala", "mon" to "Mongol", "nor" to "Norueguês",
        "nob" to "Norueguês (Bokmål)", "per" to "Persa", "fas" to "Persa", "pol" to "Polonês",
        "pob" to "Português (Brasil)", "por" to "Português", "pt" to "Português",
        "pt-br" to "Português (Brasil)", "pt-pt" to "Português (Portugal)",
        "rum" to "Romeno", "ron" to "Romeno", "rus" to "Russo", "scc" to "Sérvio",
        "srp" to "Sérvio", "slo" to "Eslovaco", "slk" to "Eslovaco", "slv" to "Esloveno",
        "spa" to "Espanhol", "es" to "Espanhol", "swa" to "Suaíli", "swe" to "Sueco",
        "tam" to "Tâmil", "tel" to "Telugu", "tha" to "Tailandês", "tur" to "Turco",
        "ukr" to "Ucraniano", "urd" to "Urdu", "vie" to "Vietnamita", "wel" to "Galês",
        "cym" to "Galês"
    )

    fun languageName(code: String): String {
        val key = code.trim().lowercase()
        return LANGUAGE_NAMES[key] ?: code.uppercase()
    }

    // ---------------------------------------------------------------------
    // Busca nos addons
    // ---------------------------------------------------------------------

    fun fetch(
        database: HubDatabase,
        type: String,
        id: String,
        season: Int?,
        episode: Int?,
        videoId: String?
    ): JSONObject {
        val effectiveVideoId = videoId?.takeIf { it.isNotBlank() }
            ?: if (type == "series" && season != null && episode != null) "$id:$season:$episode" else id

        val started = System.currentTimeMillis()
        val subtitles = org.json.JSONArray()
        val errors = org.json.JSONArray()

        val addons = database.stremioAddons().filter { addon ->
            addon.enabled && supportsResource(addon.manifest, "subtitles", type)
        }

        val futures = addons.map { addon ->
            addon to subtitleExecutor.submit<AddonSubtitleResult> {
                try {
                    val base = addon.transportUrl.removeSuffix("/manifest.json").trimEnd('/')
                    val response = com.minhabolha.android.connectors.Http.fetchText(
                        "$base/subtitles/$type/${enc(effectiveVideoId)}.json",
                        accept = "application/json",
                        retries = 0,
                        timeoutMs = SUBTITLE_TIMEOUT_MS
                    )
                    val items = JSONObject(response.text).optJSONArray("subtitles")
                        ?: org.json.JSONArray()
                    val list = mutableListOf<JSONObject>()
                    for (index in 0 until items.length()) {
                        val item = items.optJSONObject(index) ?: continue
                        val url = item.optString("url")
                        if (url.isEmpty()) continue
                        val lang = item.optString("lang").ifEmpty { "und" }
                        list.add(
                            JSONObject()
                                .put("id", item.optString("id").ifEmpty { "${addon.id}:$index" })
                                .put("addonId", addon.id)
                                .put("addonName", addon.name)
                                .put("lang", lang)
                                .put("language", languageName(lang))
                                .put("url", url)
                                .put("proxyUrl", "/api/stremio/subtitle?url=" + enc(url))
                        )
                    }
                    AddonSubtitleResult(list, null)
                } catch (error: Exception) {
                    AddonSubtitleResult(
                        emptyList(),
                        JSONObject()
                            .put("addonId", addon.id)
                            .put("addonName", addon.name)
                            .put("message", error.message ?: "falha ao consultar legendas")
                    )
                }
            }
        }

        val seenUrls = mutableSetOf<String>()
        for ((addon, future) in futures) {
            val result = try {
                future.get(SUBTITLE_TIMEOUT_MS + 1_500, TimeUnit.MILLISECONDS)
            } catch (error: Exception) {
                future.cancel(true)
                AddonSubtitleResult(
                    emptyList(),
                    JSONObject()
                        .put("addonId", addon.id)
                        .put("addonName", addon.name)
                        .put("message", "timeout")
                )
            }
            result.error?.let { errors.put(it) }
            for (item in result.items) {
                // Remove apenas duplicatas exatas; faixas com URLs diferentes
                // continuam disponíveis para resolver dessincronização.
                if (!seenUrls.add(item.optString("url"))) continue
                subtitles.put(item)
            }
        }

        return JSONObject()
            .put("type", type)
            .put("id", id)
            .put("videoId", effectiveVideoId)
            .put("subtitles", subtitles)
            .put("errors", errors)
            .put("elapsedMs", System.currentTimeMillis() - started)
    }

    private fun supportsResource(manifest: JSONObject, resource: String, type: String): Boolean {
        val resources = manifest.optJSONArray("resources") ?: return false
        var found = false
        for (index in 0 until resources.length()) {
            val value = resources.opt(index)
            val name = when (value) {
                is String -> value
                is JSONObject -> value.optString("name")
                else -> ""
            }
            if (name != resource) continue
            found = true
            if (value is JSONObject) {
                val types = value.optJSONArray("types") ?: continue
                for (typeIndex in 0 until types.length()) {
                    if (types.optString(typeIndex) == type) return true
                }
            }
        }
        if (!found) return false

        val types = manifest.optJSONArray("types") ?: return true
        for (index in 0 until types.length()) {
            if (types.optString(index) == type) return true
        }
        return false
    }

    // ---------------------------------------------------------------------
    // Proxy SRT/VTT → WebVTT
    // ---------------------------------------------------------------------

    fun proxy(rawUrl: String): String {
        val cached = cache[rawUrl]
        if (cached != null && cached.expiresAt > System.currentTimeMillis()) {
            return cached.value as String
        }

        val bytes = download(rawUrl)
        val text = decode(bytes)
        val vtt = toVtt(text)
        cache[rawUrl] = CacheEntry(vtt, System.currentTimeMillis() + CACHE_TTL_MS)
        return vtt
    }

    private fun download(rawUrl: String): ByteArray {
        var current = rawUrl
        repeat(MAX_HOPS) {
            val url = try {
                com.minhabolha.android.connectors.PublicUrl.assert(current)
            } catch (error: Exception) {
                throw HubException(400, "validation", "URL de legenda inválida.")
            }

            val connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 20_000
                instanceFollowRedirects = false
                setRequestProperty("accept", "text/vtt, application/x-subrip, text/plain, */*;q=0.5")
                setRequestProperty("accept-language", "pt-BR,pt;q=0.9,en;q=0.7")
            }

            val status = connection.responseCode
            if (status in 300..399) {
                val location = connection.getHeaderField("location")
                connection.disconnect()
                if (location.isNullOrBlank()) {
                    throw HubException(502, "addon", "Redirecionamento sem destino.")
                }
                current = URL(url, location).toString()
                return@repeat
            }
            if (status !in 200..299) {
                connection.disconnect()
                throw HubException(502, "addon", "O addon de legendas respondeu HTTP $status.")
            }

            connection.inputStream.use { stream ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                var total = 0
                while (true) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (total > MAX_BYTES) {
                        throw HubException(502, "addon", "A legenda é grande demais.")
                    }
                    output.write(buffer, 0, read)
                }
                return output.toByteArray()
            }
        }

        throw HubException(502, "addon", "Muitos redirecionamentos na legenda.")
    }

    /** Detecta UTF-8 (com/sem BOM) e cai para Windows-1252 em arquivos antigos. */
    fun decode(bytes: ByteArray): String {
        if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) {
            return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
        }
        if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
            return String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
        }
        if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
            return String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
        }

        return try {
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        } catch (error: Exception) {
            String(bytes, charset("windows-1252"))
        }
    }

    fun toVtt(raw: String): String {
        var text = raw.replace("\uFEFF", "").replace("\r\n", "\n").replace('\r', '\n')
        text = text.trimStart()

        if (text.startsWith("WEBVTT")) return text

        // ASS/SSA: mantém apenas as falas, com os tempos convertidos.
        if (text.contains("[Script Info]") || text.contains("[Events]")) {
            return assToVtt(text)
        }

        val converted = Regex("(\\d{1,2}:\\d{2}:\\d{2}),(\\d{1,3})").replace(text) { match ->
            val millis = match.groupValues[2].padEnd(3, '0')
            "${match.groupValues[1]}.$millis"
        }

        return "WEBVTT\n\n" + converted
    }

    private fun assToVtt(text: String): String {
        val builder = StringBuilder("WEBVTT\n\n")
        for (line in text.split('\n')) {
            if (!line.startsWith("Dialogue:")) continue
            val parts = line.removePrefix("Dialogue:").split(',', limit = 10)
            if (parts.size < 10) continue
            val start = assTime(parts[1].trim()) ?: continue
            val end = assTime(parts[2].trim()) ?: continue
            val speech = parts[9]
                .replace(Regex("\\{[^}]*}"), "")
                .replace("\\N", "\n")
                .replace("\\n", "\n")
                .trim()
            if (speech.isEmpty()) continue
            builder.append(start).append(" --> ").append(end).append('\n')
            builder.append(speech).append("\n\n")
        }
        return builder.toString()
    }

    private fun assTime(value: String): String? {
        val match = Regex("^(\\d+):(\\d{2}):(\\d{2})\\.(\\d{1,2})$").find(value) ?: return null
        val hours = match.groupValues[1].toIntOrNull() ?: return null
        val minutes = match.groupValues[2]
        val seconds = match.groupValues[3]
        val centis = match.groupValues[4].padEnd(3, '0')
        return "${hours.toString().padStart(2, '0')}:$minutes:$seconds.$centis"
    }

    private fun enc(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
}
