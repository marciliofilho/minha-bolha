package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URL
import java.net.URLEncoder

/**
 * Conector do YouTube.
 *
 * Descobre o `channel_id` a partir da URL do canal e lê o feed RSS público
 * (`youtube.com/feeds/videos.xml`) — sem API key. Quando o feed falha, usa a
 * página `/videos` do canal como reserva, igual ao desktop.
 */
class YoutubeConnector : Connector {

    override val type = "youtube"
    override val defaultIntervalMinutes = 30
    override val minIntervalMinutes = 15

    private val channelIdPattern = Regex("^UC[\\w-]{22}$")

    private data class ParsedFeed(
        val channelTitle: String?,
        val entries: List<RawItem>
    )

    private val pageHeaders = mapOf(
        "accept" to "text/html,application/xhtml+xml",
        "accept-language" to "en-US,en;q=0.9",
        "cookie" to "CONSENT=YES+cb"
    )

    private fun feedUrl(channelId: String): String =
        "https://www.youtube.com/feeds/videos.xml?channel_id=${URLEncoder.encode(channelId, "UTF-8")}"

    private fun channelVideosUrl(channelId: String): String =
        "https://www.youtube.com/channel/${URLEncoder.encode(channelId, "UTF-8")}/videos"

    // ---------------------------------------------------------------------
    // Resolução do canal
    // ---------------------------------------------------------------------

    override fun resolve(input: String, settings: JSONObject): ResolvedSource {
        val raw = input.trim()
        if (raw.isEmpty()) throw ConnectorError("config", "Informe a URL do canal.")

        var channelId: String? = if (channelIdPattern.matches(raw)) raw else null
        var pageTitle: String? = null
        var pageUrl: String? = null

        if (channelId == null) {
            val url = normalizeChannelUrl(raw)
            pageUrl = url
            val page = Http.fetchText(url, accept = pageHeaders["accept"] ?: "*/*", headers = pageHeaders)
            channelId = extractChannelId(page.text)
            pageTitle = extractPageTitle(page.text)
            if (channelId == null) {
                throw ConnectorError(
                    "not_found",
                    "Não consegui identificar o canal. Tente a URL no formato youtube.com/channel/UC…"
                )
            }
        }

        var parsed: ParsedFeed? = try {
            val feed = Http.fetchText(
                feedUrl(channelId),
                accept = "application/atom+xml,application/xml"
            )
            parseFeed(feed.text, channelId)
        } catch (error: ConnectorError) {
            if (error.code == "blocked" || error.code == "rate_limited" || error.code == "auth") {
                throw error
            }
            null
        }

        if (parsed == null || parsed.entries.isEmpty()) {
            parsed = try {
                fetchPageFeed(channelId)
            } catch (error: Exception) {
                null
            }
            if (parsed == null || parsed.entries.isEmpty()) {
                throw ConnectorError(
                    "not_found",
                    "O canal foi encontrado, mas o YouTube não devolveu vídeos agora. Tente de novo em instantes."
                )
            }
        }

        return ResolvedSource(
            name = pageTitle ?: parsed.channelTitle ?: "Canal $channelId",
            categoryId = "youtube",
            config = JSONObject()
                .put("channelId", channelId)
                .put("channelUrl", pageUrl ?: "https://www.youtube.com/channel/$channelId")
                .put("input", raw),
            samples = parsed.entries.take(3).map {
                ResolvedSample(it.title, it.url, it.publishedAt)
            }
        )
    }

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val channelId = config.optString("channelId")
        if (!channelIdPattern.matches(channelId)) {
            throw ConnectorError("config", "Canal do YouTube sem channel_id válido.")
        }

        var parsed: ParsedFeed? = try {
            val response = Http.fetchText(
                feedUrl(channelId),
                accept = "application/atom+xml,application/xml"
            )
            parseFeed(response.text, channelId)
        } catch (error: ConnectorError) {
            if (error.code == "blocked" || error.code == "rate_limited" || error.code == "auth") {
                throw error
            }
            null
        }

        if (parsed == null || parsed.entries.isEmpty()) {
            parsed = fetchPageFeed(channelId)
        }
        if (parsed.channelTitle == null && parsed.entries.isEmpty()) {
            throw ConnectorError("not_found", "Canal não encontrado ou sem vídeos públicos.")
        }

        val lastPublishedAt = parsed.entries.maxOfOrNull { it.publishedAt }
        val cutoff = Dates.feedCutoffIso(settings.optInt("feedWindowHours", 48))
        val recent = parsed.entries.filter { it.publishedAt >= cutoff }

        return ConnectorResult(
            items = recent,
            state = JSONObject().put("lastPublishedAt", lastPublishedAt ?: JSONObject.NULL)
        )
    }

    // ---------------------------------------------------------------------
    // Feed Atom
    // ---------------------------------------------------------------------

    private fun parseFeed(xml: String, channelId: String): ParsedFeed {
        val root = try {
            Xml.parse(xml)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "O feed do YouTube veio em formato inesperado.")
        }
        if (root == null || root.name != "feed") {
            throw ConnectorError("layout_changed", "O feed do YouTube não retornou vídeos.")
        }

        val channelTitle = root.textOf("title").ifEmpty { null }
        val items = mutableListOf<RawItem>()

        for (entry in root.childrenNamed("entry")) {
            val videoId = entry.textOf("yt:videoId").ifEmpty { extractVideoIdFromEntry(entry) }
            if (videoId.isEmpty()) continue

            val mediaGroup = entry.child("media:group")
            val link = pickLink(entry.child("link"))
                ?: "https://www.youtube.com/watch?v=$videoId"
            val publishedAt = Dates.safeIso(entry.textOf("published"), Dates.nowIso())
            val thumbnail = mediaGroup?.child("media:thumbnail")?.attr("url")
                ?: "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"
            val description = TextUtil.truncate(
                TextUtil.stripHtml(mediaGroup?.textOf("media:description")),
                280
            )
            val author = channelTitle
                ?: TextUtil.stripHtml(entry.child("author")?.textOf("name")).ifEmpty { null }

            items.add(
                RawItem(
                    externalId = videoId,
                    dedupeKey = "yt:$videoId",
                    kind = "video",
                    title = TextUtil.stripHtml(entry.textOf("title")).ifEmpty { "Vídeo sem título" },
                    url = link,
                    thumbnailUrl = thumbnail,
                    description = description.ifEmpty { null },
                    author = author,
                    publishedAt = publishedAt,
                    meta = JSONObject().put("channelId", channelId).put("videoId", videoId)
                )
            )
        }

        return ParsedFeed(channelTitle, items)
    }

    private fun extractVideoIdFromEntry(entry: XmlNode): String {
        val match = Regex("video:([\\w-]{11})").find(entry.textOf("id"))
        return match?.groupValues?.get(1).orEmpty()
    }

    private fun pickLink(link: XmlNode?): String? {
        if (link == null) return null
        if (link.text.isNotBlank()) return link.text.trim()
        return link.attr("href")?.takeIf { it.isNotBlank() }
    }

    // ---------------------------------------------------------------------
    // Fallback: página /videos
    // ---------------------------------------------------------------------

    private data class PageVideo(
        val videoId: String,
        val title: String,
        val publishedText: String,
        val thumbnailUrl: String?
    )

    private fun fetchPageFeed(channelId: String): ParsedFeed {
        val page = Http.fetchText(
            channelVideosUrl(channelId),
            accept = pageHeaders["accept"] ?: "*/*",
            headers = pageHeaders
        )
        return parseChannelPage(page.text, channelId)
    }

    private fun parseChannelPage(html: String, channelId: String): ParsedFeed {
        val data = extractInitialData(html)
        val channelTitle = data?.optJSONObject("metadata")
            ?.optJSONObject("channelMetadataRenderer")
            ?.optString("title")
            ?.ifEmpty { null }
            ?: extractPageTitle(html)

        val videos = data?.let { collectPageVideos(it) }.orEmpty()
        val now = System.currentTimeMillis()

        val entries = videos.map { video ->
            RawItem(
                externalId = video.videoId,
                dedupeKey = "yt:${video.videoId}",
                kind = "video",
                title = video.title.ifEmpty { "Vídeo sem título" },
                url = "https://www.youtube.com/watch?v=${video.videoId}",
                thumbnailUrl = video.thumbnailUrl
                    ?: "https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg",
                description = null,
                author = channelTitle,
                publishedAt = if (video.publishedText.isNotEmpty()) {
                    relativeToIso(video.publishedText, now)
                } else {
                    Dates.iso(now)
                },
                meta = JSONObject()
                    .put("channelId", channelId)
                    .put("videoId", video.videoId)
                    .put("via", "channel-page")
            )
        }

        return ParsedFeed(channelTitle, entries)
    }

    private fun extractInitialData(html: String): JSONObject? {
        val markers = listOf("var ytInitialData = ", "window[\"ytInitialData\"] = ", "ytInitialData = ")
        for (marker in markers) {
            val index = html.indexOf(marker)
            if (index == -1) continue
            val start = html.indexOf('{', index + marker.length)
            if (start == -1) continue
            val end = findJsonEnd(html, start)
            if (end == -1) continue
            return try {
                JSONTokener(html.substring(start, end)).nextValue() as? JSONObject
            } catch (error: Exception) {
                null
            }
        }
        return null
    }

    private fun findJsonEnd(text: String, start: Int): Int {
        var depth = 0
        var inString = false
        var escaped = false
        var index = start
        while (index < text.length) {
            val char = text[index]
            if (inString) {
                when {
                    escaped -> escaped = false
                    char == '\\' -> escaped = true
                    char == '"' -> inString = false
                }
                index++
                continue
            }
            when (char) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return index + 1
                }
            }
            index++
        }
        return -1
    }

    private fun nodeText(node: JSONObject?): String {
        if (node == null) return ""
        node.optString("simpleText").takeIf { it.isNotEmpty() }?.let { return it }
        node.optString("content").takeIf { it.isNotEmpty() }?.let { return it }
        val runs = node.optJSONArray("runs") ?: return ""
        val builder = StringBuilder()
        for (index in 0 until runs.length()) {
            builder.append(runs.optJSONObject(index)?.optString("text").orEmpty())
        }
        return builder.toString()
    }

    private fun lastThumbnail(thumbnails: JSONArray?): String? {
        if (thumbnails == null || thumbnails.length() == 0) return null
        return thumbnails.optJSONObject(thumbnails.length() - 1)?.optString("url")
            ?.takeIf { it.isNotEmpty() }
    }

    private fun lockupMetadata(lockup: JSONObject): Triple<String, String, String?> {
        val metadata = lockup.optJSONObject("metadata")?.optJSONObject("lockupMetadataViewModel")
        val title = nodeText(metadata?.optJSONObject("title"))

        var publishedText = ""
        val rows = metadata?.optJSONObject("metadata")
            ?.optJSONObject("contentMetadataViewModel")
            ?.optJSONArray("metadataRows")
        if (rows != null) {
            for (index in 0 until rows.length()) {
                val parts = rows.optJSONObject(index)?.optJSONArray("metadataParts") ?: continue
                for (partIndex in 0 until parts.length()) {
                    val text = parts.optJSONObject(partIndex)?.optJSONObject("text")?.optString("content")
                        .orEmpty()
                    if (publishedText.isEmpty() && isRelativeDate(text)) publishedText = text
                }
            }
        }

        val sources = lockup.optJSONObject("contentImage")
            ?.optJSONObject("thumbnailViewModel")
            ?.optJSONObject("image")
            ?.optJSONArray("sources")

        return Triple(title, publishedText, lastThumbnail(sources))
    }

    private fun collectPageVideos(data: JSONObject): List<PageVideo> {
        val found = mutableListOf<PageVideo>()
        val seen = mutableSetOf<String>()

        fun push(video: PageVideo) {
            if (video.videoId.isEmpty() || video.title.isEmpty() || seen.contains(video.videoId)) return
            seen.add(video.videoId)
            found.add(video)
        }

        fun walk(value: Any?) {
            when (value) {
                is JSONObject -> {
                    val lockup = value.optJSONObject("lockupViewModel")
                    if (lockup != null &&
                        lockup.optString("contentType") == "LOCKUP_CONTENT_TYPE_VIDEO" &&
                        lockup.optString("contentId").isNotEmpty()
                    ) {
                        val (title, published, thumbnail) = lockupMetadata(lockup)
                        push(PageVideo(lockup.optString("contentId"), title, published, thumbnail))
                    }

                    val video = value.optJSONObject("videoRenderer")
                    if (video != null && video.optString("videoId").isNotEmpty()) {
                        push(
                            PageVideo(
                                videoId = video.optString("videoId"),
                                title = nodeText(video.optJSONObject("title")),
                                publishedText = nodeText(video.optJSONObject("publishedTimeText")),
                                thumbnailUrl = lastThumbnail(
                                    video.optJSONObject("thumbnail")?.optJSONArray("thumbnails")
                                )
                            )
                        )
                    }

                    val keys = value.keys()
                    while (keys.hasNext()) walk(value.opt(keys.next()))
                }

                is JSONArray -> {
                    for (index in 0 until value.length()) walk(value.opt(index))
                }
            }
        }

        walk(data)
        return found
    }

    private fun isRelativeDate(text: String): Boolean =
        Regex("(\\d+)\\s*[a-zà-ú]+\\s+ago", RegexOption.IGNORE_CASE).containsMatchIn(text) ||
            Regex("há\\s+\\d+", RegexOption.IGNORE_CASE).containsMatchIn(text) ||
            Regex("\\d+\\s*[a-zà-ú]+\\s+atrás", RegexOption.IGNORE_CASE).containsMatchIn(text)

    private fun relativeToIso(text: String, now: Long): String {
        val patterns = listOf(
            Regex("(\\d+)\\s*(second|minute|hour|day|week|month|year)s?\\s+ago", RegexOption.IGNORE_CASE),
            Regex("(\\d+)\\s*(mo|[smhdwy])\\s+ago", RegexOption.IGNORE_CASE),
            Regex(
                "há\\s+(\\d+)\\s*(segundos?|seg|minutos?|min|horas?|h|dias?|d|semanas?|sem|meses|mês|mes|anos?|a)\\b",
                RegexOption.IGNORE_CASE
            ),
            Regex("(\\d+)\\s*(seg|min|h|dias?|d|sem|meses|mês|mes|anos?)\\s+atrás", RegexOption.IGNORE_CASE)
        )

        val match = patterns.firstNotNullOfOrNull { it.find(text) } ?: return Dates.iso(now)
        val amount = match.groupValues[1].toIntOrNull() ?: return Dates.iso(now)
        val unit = match.groupValues[2].lowercase()

        val minute = 60_000L
        val hour = 60 * minute
        val day = 24 * hour
        val week = 7 * day
        val month = 30 * day
        val year = 365 * day
        val factor = when (unit) {
            "s", "seg", "segundo", "segundos", "second", "seconds" -> 1_000L
            "m", "min", "minuto", "minutos", "minute", "minutes" -> minute
            "h", "hora", "horas", "hour", "hours" -> hour
            "d", "dia", "dias", "day", "days" -> day
            "w", "sem", "semana", "semanas", "week", "weeks" -> week
            "mo", "mês", "mes", "meses", "month", "months" -> month
            "y", "a", "ano", "anos", "year", "years" -> year
            else -> day
        }

        return Dates.iso(now - factor * amount)
    }

    // ---------------------------------------------------------------------
    // HTML helpers
    // ---------------------------------------------------------------------

    private fun normalizeChannelUrl(raw: String): String {
        val value = raw.trim()
        val url = when {
            value.startsWith("http://", true) || value.startsWith("https://", true) -> URL(value)
            Regex("^(www\\.)?youtube\\.com/", RegexOption.IGNORE_CASE).containsMatchIn(value) ->
                URL("https://$value")

            value.startsWith("@") -> URL("https://www.youtube.com/$value")
            Regex("^[A-Za-z0-9._-]+$").matches(value) -> URL("https://www.youtube.com/@$value")
            else -> throw ConnectorError(
                "config",
                "Não reconheci a URL. Use /@nome, /channel/ID ou /c/nome."
            )
        }

        val host = url.host.lowercase().removePrefix("www.")
        if (host != "youtube.com" && host != "m.youtube.com") {
            throw ConnectorError("config", "A URL precisa ser de um canal do YouTube (youtube.com).")
        }
        return url.toString()
    }

    private fun extractChannelId(html: String): String? {
        val patterns = listOf(
            Regex("<meta[^>]+itemprop=[\"']identifier[\"'][^>]+content=[\"'](UC[\\w-]{22})[\"']", RegexOption.IGNORE_CASE),
            Regex("<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"'][^\"']*/(UC[\\w-]{22})[\"']", RegexOption.IGNORE_CASE),
            Regex("\"channelId\"\\s*:\\s*\"(UC[\\w-]{22})\""),
            Regex("\"externalId\"\\s*:\\s*\"(UC[\\w-]{22})\""),
            Regex("channel_id=(UC[\\w-]{22})"),
            Regex("youtube\\.com/channel/(UC[\\w-]{22})")
        )
        for (pattern in patterns) {
            val match = pattern.find(html) ?: continue
            return match.groupValues[1]
        }
        return null
    }

    private fun extractPageTitle(html: String): String? {
        val meta = Regex(
            "<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']",
            RegexOption.IGNORE_CASE
        ).find(html)
        if (meta != null) return TextUtil.stripHtml(meta.groupValues[1])
        val title = Regex("<title>([^<]+)</title>", RegexOption.IGNORE_CASE).find(html)
        if (title != null) {
            return TextUtil.stripHtml(title.groupValues[1].replace(Regex("\\s*-\\s*YouTube\\s*$"), ""))
        }
        return null
    }
}
