package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import com.minhabolha.android.optText
import org.json.JSONArray
import org.json.JSONObject

/**
 * Conector AniList (animes) via GraphQL público.
 *
 * Traz o próximo episódio com horário exato e a agenda futura. Não exige
 * chave de API.
 */
class AnilistConnector(
    private val tmdb: TmdbConnector?,
    private val secrets: SecretAccess,
    private val mediaLookup: (String) -> MediaRow?
) : Connector {

    companion object {
        private const val API = "https://graphql.anilist.co"
        private const val SITE = "https://anilist.co"

        private const val SEARCH_QUERY = """
            query (${'$'}search: String) {
              Page(page: 1, perPage: 10) {
                media(search: ${'$'}search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
                  id
                  title { romaji english native }
                  coverImage { large extraLarge }
                  description(asHtml: false)
                  format
                  status
                  episodes
                  seasonYear
                  startDate { year }
                  nextAiringEpisode { episode airingAt }
                }
              }
            }
        """

        private const val DETAILS_QUERY = """
            query (${'$'}id: Int) {
              Media(id: ${'$'}id, type: ANIME) {
                id
                title { romaji english native }
                coverImage { large extraLarge }
                bannerImage
                description(asHtml: false)
                format
                status
                episodes
                seasonYear
                startDate { year }
                nextAiringEpisode { episode airingAt }
                airingSchedule(notYetAired: true, perPage: 50) {
                  nodes { episode airingAt }
                }
              }
            }
        """

        private const val GLOBAL_AIRING_QUERY = """
            query (${'$'}page: Int, ${'$'}from: Int, ${'$'}to: Int) {
              Page(page: ${'$'}page, perPage: 50) {
                pageInfo { hasNextPage }
                airingSchedules(airingAt_greater: ${'$'}from, airingAt_lesser: ${'$'}to, sort: TIME) {
                  airingAt
                  episode
                  media {
                    id
                    isAdult
                    title { romaji english native }
                    coverImage { large extraLarge }
                    siteUrl
                  }
                }
              }
            }
        """
    }

    override val type = "anilist"
    override val defaultIntervalMinutes = 180
    override val minIntervalMinutes = 60

    // ---------------------------------------------------------------------
    // GraphQL
    // ---------------------------------------------------------------------

    private fun query(queryText: String, variables: JSONObject): JSONObject {
        val body = JSONObject().put("query", queryText).put("variables", variables).toString()
        val response = Http.postJson(API, body)

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "O AniList devolveu uma resposta que não é JSON.")
        }

        val errors = payload.optJSONArray("errors")
        if (errors != null && errors.length() > 0) {
            val message = (0 until errors.length())
                .mapNotNull { errors.optJSONObject(it)?.optString("message") }
                .joinToString("; ")
            if (Regex("rate.?limit", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
                throw ConnectorError("rate_limited", "O AniList limitou as requisições. Tente mais tarde.")
            }
            if (Regex("not found|404", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
                throw ConnectorError("not_found", "Anime não encontrado no AniList.")
            }
            throw ConnectorError("layout_changed", "AniList: $message")
        }

        return payload.optJSONObject("data")
            ?: throw ConnectorError("layout_changed", "Resposta vazia do AniList.")
    }

    private fun searchMedia(text: String): List<JSONObject> {
        val data = query(SEARCH_QUERY, JSONObject().put("search", text))
        val media = data.optJSONObject("Page")?.optJSONArray("media") ?: return emptyList()
        return (0 until media.length()).mapNotNull { media.optJSONObject(it) }
    }

    private fun getMedia(id: Int): JSONObject {
        val data = query(DETAILS_QUERY, JSONObject().put("id", id))
        return data.optJSONObject("Media")
            ?: throw ConnectorError("not_found", "Anime não encontrado no AniList.")
    }

    private fun titleOf(media: JSONObject): String {
        val title = media.optJSONObject("title")
        return title?.optText("english")
            ?: title?.optText("romaji")
            ?: title?.optText("native")
            ?: "Anime ${media.optInt("id")}"
    }

    private fun imageUrl(media: JSONObject): String? {
        val cover = media.optJSONObject("coverImage") ?: return null
        return cover.optText("extraLarge") ?: cover.optText("large")
    }

    private fun yearOf(media: JSONObject): Int? {
        val year = media.optInt("seasonYear").takeIf { it > 0 }
            ?: media.optJSONObject("startDate")?.optInt("year")?.takeIf { it > 0 }
        return year
    }

    // ---------------------------------------------------------------------
    // Busca e resolução
    // ---------------------------------------------------------------------

    override fun search(query: String, settings: JSONObject): List<MediaSearchResult> =
        searchMedia(query).take(10).map { media ->
            MediaSearchResult(
                provider = "anilist",
                ref = "anilist:${media.optInt("id")}",
                mediaType = "anime",
                title = titleOf(media),
                originalTitle = media.optJSONObject("title")?.optText("native"),
                year = yearOf(media),
                posterUrl = imageUrl(media),
                overview = TextUtil.truncate(
                    TextUtil.stripHtml(media.optString("description")),
                    220
                ).ifEmpty { null }
            )
        }

    private fun resolveId(input: String): Int {
        val value = input.trim()
        Regex("^anilist:(\\d+)$", RegexOption.IGNORE_CASE).find(value)?.let {
            return it.groupValues[1].toInt()
        }
        Regex("anilist\\.co/anime/(\\d+)", RegexOption.IGNORE_CASE).find(value)?.let {
            return it.groupValues[1].toInt()
        }
        if (Regex("^\\d+$").matches(value)) return value.toInt()

        val first = searchMedia(value).firstOrNull()
            ?: throw ConnectorError("not_found", "Nenhum anime encontrado. Tente outro nome.")
        return first.optInt("id")
    }

    private fun eventsOf(media: JSONObject, settings: JSONObject): List<RawReleaseEvent> {
        val timezone = settings.optString("timezone", "America/Sao_Paulo")
        val nodes = media.optJSONObject("airingSchedule")?.optJSONArray("nodes") ?: JSONArray()
        val id = media.optInt("id")
        val events = mutableListOf<RawReleaseEvent>()

        for (index in 0 until nodes.length()) {
            val node = nodes.optJSONObject(index) ?: continue
            val airingAt = node.optLong("airingAt")
            val episode = node.optInt("episode")
            if (airingAt <= 0 || episode <= 0) continue
            val instant = java.time.Instant.ofEpochSecond(airingAt)
            events.add(
                RawReleaseEvent(
                    externalKey = "anilist:$id:ep:$episode",
                    kind = "airing",
                    releaseDate = Dates.dateInZone(instant, timezone),
                    releaseTime = Dates.timeInZone(instant, timezone),
                    releaseAt = instant.toString(),
                    timezone = timezone,
                    episode = episode,
                    url = "$SITE/anime/$id"
                )
            )
        }

        return events.sortedBy { it.releaseAt.orEmpty() }
    }

    private fun mediaOf(media: JSONObject, imdbId: String?): RawMedia {
        val next = media.optJSONObject("nextAiringEpisode")
        return RawMedia(
            provider = "anilist",
            externalId = media.optInt("id").toString(),
            kind = "anime",
            title = titleOf(media),
            originalTitle = media.optJSONObject("title")?.optText("native"),
            posterUrl = imageUrl(media),
            backdropUrl = media.optText("bannerImage"),
            year = yearOf(media),
            status = media.optText("status"),
            nextEpisodeAt = next?.optLong("airingAt")?.takeIf { it > 0 }
                ?.let { java.time.Instant.ofEpochSecond(it).toString() },
            url = "$SITE/anime/${media.optInt("id")}",
            imdbId = imdbId,
            raw = media
        )
    }

    override fun resolve(input: String, settings: JSONObject): ResolvedSource {
        val id = resolveId(input)
        val media = getMedia(id)
        val events = eventsOf(media, settings)

        return ResolvedSource(
            name = titleOf(media),
            categoryId = "anime",
            config = JSONObject()
                .put("provider", "anilist")
                .put("externalId", id.toString())
                .put("anilistId", id)
                .put("title", titleOf(media))
                .put("input", input),
            samples = events.take(3).map { event ->
                val time = event.releaseTime?.let { " às $it" }.orEmpty()
                ResolvedSample(
                    title = "Episódio ${event.episode} — ${formatDate(event.releaseDate)}$time",
                    url = event.url ?: "$SITE/anime/$id",
                    publishedAt = event.releaseAt
                )
            }
        )
    }

    private fun formatDate(date: String): String {
        val parts = date.split('-')
        return if (parts.size == 3) "${parts[2]}/${parts[1]}/${parts[0]}" else date
    }

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val id = config.optInt("anilistId")
        if (id <= 0) throw ConnectorError("config", "Fonte AniList sem anilistId válido.")

        val media = getMedia(id)
        val events = eventsOf(media, settings)

        // IMDB: override manual > cache da mídia > busca no TMDB (best-effort).
        val override = config.optString("imdbIdOverride")
            .takeIf { Regex("^tt\\d{7,10}$", RegexOption.IGNORE_CASE).matches(it) }
        val cached = mediaLookup(source.id)
        var imdbId = override ?: cached?.imdbId
        var imdbTriedAt = state?.optString("imdbTriedAt")?.ifEmpty { null }

        if (imdbId == null) {
            val lastTry = Dates.parseIsoMillis(imdbTriedAt) ?: 0L
            if (System.currentTimeMillis() - lastTry > 7L * 24 * 60 * 60_000L) {
                imdbId = tmdb?.findImdbIdByTitle(titleOf(media), "tv")
                imdbTriedAt = Dates.nowIso()
            }
        }

        return ConnectorResult(
            items = emptyList(),
            state = JSONObject()
                .put("lastSyncAt", Dates.nowIso())
                .put("imdbTriedAt", imdbTriedAt ?: JSONObject.NULL),
            media = mediaOf(media, imdbId),
            releaseEvents = events
        )
    }

    /** Todos os episódios de anime no intervalo, sem depender das fontes seguidas. */
    fun globalAnimeReleases(fromDate: String, toDate: String, timezone: String): List<RawGlobalRelease> {
        val from = try {
            java.time.LocalDate.parse(fromDate).atStartOfDay().toEpochSecond(java.time.ZoneOffset.UTC)
        } catch (error: Exception) {
            return emptyList()
        }
        val to = try {
            java.time.LocalDate.parse(toDate).atTime(23, 59, 59).toEpochSecond(java.time.ZoneOffset.UTC)
        } catch (error: Exception) {
            return emptyList()
        }

        val releases = mutableListOf<RawGlobalRelease>()
        for (page in 1..6) {
            if (page > 1) Thread.sleep(3000)
            val data = query(
                GLOBAL_AIRING_QUERY,
                JSONObject().put("page", page).put("from", from).put("to", to)
            )
            val pageData = data.optJSONObject("Page") ?: break
            val nodes = pageData.optJSONArray("airingSchedules") ?: break

            for (index in 0 until nodes.length()) {
                val node = nodes.optJSONObject(index) ?: continue
                val media = node.optJSONObject("media") ?: continue
                if (media.optBoolean("isAdult")) continue
                val airingAt = node.optLong("airingAt")
                val episode = node.optInt("episode")
                if (airingAt <= 0 || episode <= 0) continue

                val instant = java.time.Instant.ofEpochSecond(airingAt)
                val id = media.optInt("id")
                releases.add(
                    RawGlobalRelease(
                        externalKey = "anilist:$id:ep:$episode",
                        provider = "anilist",
                        mediaKind = "anime",
                        title = titleOf(media),
                        originalTitle = media.optJSONObject("title")?.optText("native"),
                        posterUrl = imageUrl(media),
                        kind = "airing",
                        releaseDate = Dates.dateInZone(instant, timezone),
                        releaseTime = Dates.timeInZone(instant, timezone),
                        releaseAt = instant.toString(),
                        timezone = timezone,
                        episode = episode,
                        url = media.optString("siteUrl").ifEmpty { "$SITE/anime/$id" }
                    )
                )
            }

            if (pageData.optJSONObject("pageInfo")?.optBoolean("hasNextPage") != true) break
        }

        return releases
    }
}
