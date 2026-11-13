package com.minhabolha.android

import android.util.Log
import com.minhabolha.android.connectors.Http
import com.minhabolha.android.connectors.PublicUrl
import org.json.JSONObject
import java.net.URL
import java.net.URLEncoder

/**
 * Imagem/logo de uma fonte, resolvida sob demanda e guardada por 3 dias no
 * próprio config da fonte. YouTube usa o avatar do canal; RSS usa a imagem do
 * feed ou o favicon do site.
 */
object SourceImage {

    private const val TAG = "MinhaBolha"
    private const val TTL_MS = 3L * 24 * 60 * 60 * 1000
    private const val PAGE_ACCEPT = "text/html,application/xhtml+xml"

    fun resolve(database: HubDatabase, id: String): String? {
        val source = database.source(id) ?: return null
        val config = source.optJSONObject("config") ?: JSONObject()
        val cached = config.optString("imageUrl").takeIf { it.isNotEmpty() }
        val checkedAt = config.optLong("imageCheckedAt", 0L)
        if (cached != null && System.currentTimeMillis() - checkedAt < TTL_MS) return cached

        val imageUrl = try {
            fetch(source.optString("type"), config)
        } catch (error: Exception) {
            Log.w(TAG, "falha ao resolver imagem da fonte $id", error)
            null
        }

        val next = JSONObject(config.toString())
        if (imageUrl != null) next.put("imageUrl", imageUrl) else next.remove("imageUrl")
        next.put("imageCheckedAt", System.currentTimeMillis())
        database.updateSource(id, config = next)
        return imageUrl
    }

    private fun fetch(type: String, config: JSONObject): String? {
        val cover = config.optString("coverUrl")
        if (cover.isNotEmpty()) return cover

        if (type == "youtube") {
            val channelId = config.optString("channelId").trim()
            if (channelId.isEmpty()) return null
            val page = Http.fetchText(
                "https://www.youtube.com/channel/${URLEncoder.encode(channelId, "UTF-8")}",
                accept = PAGE_ACCEPT,
                headers = mapOf(
                    "accept-language" to "en-US,en;q=0.9",
                    "cookie" to "CONSENT=YES+cb"
                ),
                timeoutMs = 20_000,
                retries = 1
            ).text
            return firstMatch(
                page,
                listOf(
                    Regex("<meta property=\"og:image\" content=\"([^\"]+)\"", RegexOption.IGNORE_CASE),
                    Regex("\"avatar\":\\{\"thumbnails\":\\[\\{\"url\":\"([^\"]+)\"", RegexOption.IGNORE_CASE)
                )
            )
        }

        if (type == "rss") {
            val input = config.optString("input")
                .ifEmpty { config.optString("url") }
                .ifEmpty { config.optString("feedUrl") }
            if (input.isEmpty()) return null
            val safe = try {
                PublicUrl.assert(input).toString()
            } catch (error: Exception) {
                return null
            }
            val feed = Http.fetchText(
                safe,
                accept = "application/rss+xml, application/atom+xml, application/xml, text/xml",
                timeoutMs = 20_000,
                retries = 1
            ).text
            val found = firstMatch(
                feed,
                listOf(
                    Regex("<itunes:image[^>]+href=\"([^\"]+)\"", RegexOption.IGNORE_CASE),
                    Regex("<image>[\\s\\S]*?<url>([^<]+)</url>", RegexOption.IGNORE_CASE),
                    Regex("<media:thumbnail[^>]+url=\"([^\"]+)\"", RegexOption.IGNORE_CASE),
                    Regex("<logo>([^<]+)</logo>", RegexOption.IGNORE_CASE)
                )
            )
            if (found != null) return found
            return try {
                "https://${URL(safe).host}/favicon.ico"
            } catch (error: Exception) {
                null
            }
        }

        return null
    }

    private fun firstMatch(text: String, patterns: List<Regex>): String? {
        for (pattern in patterns) {
            val value = pattern.find(text)?.groupValues?.getOrNull(1)?.trim()
            if (!value.isNullOrEmpty()) return value.replace("&amp;", "&")
        }
        return null
    }
}
