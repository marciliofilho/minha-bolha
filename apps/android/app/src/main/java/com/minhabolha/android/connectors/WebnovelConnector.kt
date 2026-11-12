package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import com.minhabolha.android.NovelExtractor
import org.json.JSONObject

/**
 * Conector de novels (web).
 *
 * Usa o WebView do app para listar capítulos (sem Puppeteer). O feed mostra o
 * capítulo mais recente; abrir o card leva ao leitor, que extrai o texto pelo
 * mesmo caminho (`/api/novels/chapter`).
 */
class WebnovelConnector(
    private val extractorProvider: () -> NovelExtractor?
) : Connector {

    override val type = "webnovel"
    override val defaultIntervalMinutes = 60
    override val minIntervalMinutes = 30

    private fun extractor(): NovelExtractor =
        extractorProvider() ?: throw ConnectorError(
            "not_supported",
            "O extrator de novels não está disponível agora."
        )

    override fun resolve(input: String, settings: JSONObject): ResolvedSource {
        val url = input.trim()
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw ConnectorError("config", "Cole a URL da novel (http/https).")
        }

        val page = extractor().chapters(url)
            ?: throw ConnectorError(
                "not_found",
                "Não encontrei capítulos nesta página. Use a página de índice da novel."
            )

        return ResolvedSource(
            name = page.title,
            categoryId = "novel",
            config = JSONObject()
                .put("url", url)
                .put("title", page.title)
                .put("chapterCount", page.links.size)
                .put("coverUrl", page.cover ?: JSONObject.NULL)
                .put("input", input),
            samples = page.links.takeLast(3).map {
                ResolvedSample(it.title, it.url, null)
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
        if (url.isEmpty()) throw ConnectorError("config", "Fonte de novel sem URL.")

        val page = extractor().chapters(url)
            ?: throw ConnectorError("layout_changed", "A página da novel não devolveu capítulos.")

        val latest = page.links.last()
        val bookTitle = page.title

        val item = RawItem(
            externalId = latest.url,
            dedupeKey = "novel:${source.id}:${latest.url}",
            kind = "chapter",
            title = latest.title,
            url = latest.url,
            thumbnailUrl = page.cover,
            description = "$bookTitle · ${page.links.size} capítulo(s)",
            author = null,
            publishedAt = Dates.nowIso(),
            meta = JSONObject()
                .put("bookTitle", bookTitle)
                .put("chapterId", latest.url)
                .put("chapterName", latest.title)
                .put("chapterUrl", latest.url)
                .put("chapterIndex", page.links.size - 1)
                .put("chapterCount", page.links.size)
                .put("coverUrl", page.cover ?: JSONObject.NULL)
        )

        return ConnectorResult(
            items = listOf(item),
            state = JSONObject()
                .put("lastSyncAt", Dates.nowIso())
                .put("chapterCount", page.links.size)
        )
    }
}
