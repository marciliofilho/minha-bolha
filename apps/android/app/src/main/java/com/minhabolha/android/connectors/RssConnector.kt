package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import org.json.JSONObject

/**
 * Conector RSS/Atom genérico (notícias, blogs, podcasts).
 * Suporta RSS 2.0, Atom e RSS 1.0 (RDF), como o conector do desktop.
 */
class RssConnector : Connector {

    override val type = "rss"
    override val defaultIntervalMinutes = 30
    override val minIntervalMinutes = 15

    private data class Entry(
        val title: String,
        val link: String,
        val guid: String,
        val publishedAt: String?,
        val summary: String,
        val author: String?,
        val image: String?
    )

    private data class ParsedFeed(
        val title: String,
        val siteUrl: String?,
        val entries: List<Entry>
    )

    override fun resolve(input: String, settings: JSONObject): ResolvedSource {
        val trimmed = input.trim()
        val withProtocol = if (trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true)) {
            trimmed
        } else {
            "https://$trimmed"
        }
        val url = PublicUrl.assert(withProtocol)

        val response = Http.fetchText(
            url.toString(),
            accept = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
        )

        if (TextUtil.looksLikeHtml(response.text)) {
            throw ConnectorError(
                "config",
                "Essa URL devolve uma página HTML, não um feed. Procure o link \"RSS\" do site."
            )
        }

        val parsed = parseFeed(response.text, response.finalUrl)
        if (parsed.title.isEmpty() && parsed.entries.isEmpty()) {
            throw ConnectorError(
                "not_found",
                "Nenhum item encontrado. Confirme se a URL é de um feed RSS/Atom."
            )
        }

        return ResolvedSource(
            name = parsed.title.ifEmpty { url.host },
            categoryId = "news",
            config = JSONObject()
                .put("url", response.finalUrl)
                .put("siteUrl", parsed.siteUrl ?: JSONObject.NULL)
                .put("input", input),
            samples = parsed.entries.take(3).map {
                ResolvedSample(it.title, it.link, it.publishedAt)
            }
        )
    }

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val url = config.optString("url")
        if (url.isEmpty()) throw ConnectorError("config", "Feed RSS sem URL configurada.")

        val response = Http.fetchText(
            url,
            accept = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
        )

        if (TextUtil.looksLikeHtml(response.text)) {
            throw ConnectorError("layout_changed", "O endereço passou a devolver HTML em vez de feed.")
        }

        val parsed = parseFeed(response.text, response.finalUrl)
        val now = Dates.nowIso()

        val items = parsed.entries.take(200).map { entry ->
            val publishedAt = entry.publishedAt ?: now
            RawItem(
                externalId = entry.guid,
                dedupeKey = "rss:${source.id}:${TextUtil.shortHash(entry.guid.ifEmpty { entry.link })}",
                kind = "article",
                title = entry.title,
                url = entry.link,
                thumbnailUrl = entry.image,
                description = TextUtil.truncate(TextUtil.stripHtml(entry.summary), 320).ifEmpty { null },
                author = entry.author,
                publishedAt = publishedAt,
                meta = JSONObject().put("feedTitle", parsed.title)
            )
        }

        val lastPublishedAt = items.maxOfOrNull { it.publishedAt }

        return ConnectorResult(
            items = items,
            state = JSONObject()
                .put("lastFetchedAt", now)
                .put("lastPublishedAt", lastPublishedAt ?: JSONObject.NULL)
        )
    }

    // -----------------------------------------------------------------
    // Parsing
    // -----------------------------------------------------------------

    private fun parseFeed(xml: String, fallbackBase: String?): ParsedFeed {
        val root = try {
            Xml.parse(xml)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "O feed não pôde ser lido como XML.")
        } ?: throw ConnectorError("layout_changed", "O feed não pôde ser lido como XML.")

        val rss = if (root.name == "rss") root else null
        val rdf = if (root.name == "rdf:RDF" || root.name == "RDF") root else null
        val atom = if (root.name == "feed") root else null

        val channel = rss?.child("channel") ?: rdf?.child("channel")
        val rawEntries: List<XmlNode> = when {
            channel != null -> channel.childrenNamed("item")
            atom != null -> atom.childrenNamed("entry")
            rdf != null -> rdf.childrenNamed("item")
            else -> emptyList()
        }

        val title = when {
            channel != null -> TextUtil.stripHtml(channel.textOf("title"))
            atom != null -> TextUtil.stripHtml(atom.textOf("title"))
            else -> ""
        }

        val siteLink = when {
            channel != null -> TextUtil.absoluteUrl(channel.textOf("link"), fallbackBase)
            atom != null -> pickAtomLink(atom.child("link"))?.let {
                TextUtil.absoluteUrl(it, fallbackBase)
            }
            else -> null
        } ?: fallbackBase

        val entries = rawEntries.mapNotNull { item -> parseEntry(item, siteUrl = siteLink) }

        return ParsedFeed(title, siteLink, entries)
    }

    private fun parseEntry(item: XmlNode, siteUrl: String?): Entry? {
        val titleText = TextUtil.stripHtml(item.textOf("title")).ifEmpty { "Sem título" }

        val rawLink = item.textOf("link").ifEmpty { pickAtomLink(item.child("link")).orEmpty() }
            .ifEmpty { item.textOf("guid") }
            .ifEmpty { item.attr("rdf:about").orEmpty() }
            .ifEmpty { item.textOf("id") }

        val resolvedLink = TextUtil.absoluteUrl(rawLink, siteUrl) ?: return null

        val guid = item.textOf("guid").ifEmpty { item.textOf("id") }.ifEmpty { resolvedLink }

        val summaryHtml = item.textOf("description")
            .ifEmpty { item.textOf("summary") }
            .ifEmpty { item.textOf("content:encoded") }
            .ifEmpty { item.textOf("content") }

        val author = TextUtil.stripHtml(item.textOf("author"))
            .ifEmpty { TextUtil.stripHtml(item.textOf("dc:creator")) }
            .ifEmpty { TextUtil.stripHtml(item.textOf("itunes:author")) }
            .ifEmpty { null }

        val dateText = item.textOf("pubDate")
            .ifEmpty { item.textOf("published") }
            .ifEmpty { item.textOf("updated") }
            .ifEmpty { item.textOf("dc:date") }

        val publishedAt = Dates.safeIso(dateText, "").ifEmpty { null }

        return Entry(
            title = TextUtil.truncate(titleText, 240),
            link = resolvedLink,
            guid = guid,
            publishedAt = publishedAt,
            summary = summaryHtml,
            author = author,
            image = pickImage(item, summaryHtml, siteUrl)
        )
    }

    private fun pickImage(item: XmlNode, summary: String, baseUrl: String?): String? {
        val candidates = listOf(
            item.child("media:thumbnail")?.attr("url"),
            item.child("media:content")?.attr("url"),
            item.child("enclosure")?.attr("url"),
            item.child("itunes:image")?.attr("href"),
            item.child("image")?.attr("url")
        )
        for (candidate in candidates) {
            if (candidate.isNullOrBlank()) continue
            TextUtil.absoluteUrl(candidate, baseUrl)?.let { return it }
        }
        return TextUtil.firstImageFromHtml(summary, baseUrl)
    }

    private fun pickAtomLink(link: XmlNode?): String? {
        if (link == null) return null
        if (link.text.isNotBlank()) return link.text.trim()
        return link.attr("href")?.takeIf { it.isNotBlank() }
    }
}
