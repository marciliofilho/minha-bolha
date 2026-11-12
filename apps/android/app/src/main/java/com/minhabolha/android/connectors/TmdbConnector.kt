package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import com.minhabolha.android.optText
import org.json.JSONArray
import org.json.JSONObject

/**
 * Conector TMDB (filmes e séries).
 *
 * Aceita link do IMDB, referência `tmdb:movie:603` / `tmdb:tv:1399` ou busca
 * por nome. Nunca faz scraping do IMDB: usa `/find?external_source=imdb_id`.
 */
class TmdbConnector(private val secrets: SecretAccess) : Connector {

    companion object {
        const val PROVIDER = "tmdb"
        private const val IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
        internal const val SITE = "https://www.themoviedb.org"
        private const val BASE = "https://api.themoviedb.org/3"
    }

    override val type = "tmdb"
    override val defaultIntervalMinutes = 360
    override val minIntervalMinutes = 60

    fun hasKey(): Boolean = !secrets.value("TMDB_API_KEY").isNullOrBlank()

    // ---------------------------------------------------------------------
    // Cliente HTTP
    // ---------------------------------------------------------------------

    private fun apiKey(): String = secrets.value("TMDB_API_KEY")?.takeIf { it.isNotBlank() }
        ?: throw ConnectorError(
            "auth",
            "Chave do TMDB não configurada. Adicione em Configurações → Chaves de API."
        )

    internal fun get(path: String, params: Map<String, String> = emptyMap()): JSONObject {
        val key = apiKey()
        val bearer = key.startsWith("eyJ")
        val query = mutableListOf<String>()
        if (!bearer) query.add("api_key=" + enc(key))
        query.add("language=" + enc("pt-BR"))
        for ((name, value) in params) {
            if (value.isNotBlank()) query.add(enc(name) + "=" + enc(value))
        }
        val url = "$BASE$path" + if (query.isEmpty()) "" else "?" + query.joinToString("&")

        val response = Http.fetchText(
            url,
            accept = "application/json",
            headers = if (bearer) mapOf("authorization" to "Bearer $key") else emptyMap()
        )

        return try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "O TMDB devolveu uma resposta que não é JSON.")
        }
    }

    private fun enc(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")

    internal fun imageUrl(path: String?): String? {
        if (path.isNullOrBlank()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        return IMAGE_BASE + path
    }

    private fun yearOf(date: String?): Int? = date?.take(4)?.toIntOrNull()

    // ---------------------------------------------------------------------
    // Busca e resolução
    // ---------------------------------------------------------------------

    private fun searchMulti(query: String): List<JSONObject> {
        val data = get("/search/multi", mapOf("query" to query, "include_adult" to "false"))
        val results = data.optJSONArray("results") ?: return emptyList()
        val items = mutableListOf<JSONObject>()
        for (index in 0 until results.length()) {
            val item = results.optJSONObject(index) ?: continue
            val mediaType = item.optString("media_type")
            if (mediaType == "movie" || mediaType == "tv") items.add(item)
        }
        return items
    }

    override fun search(query: String, settings: JSONObject): List<MediaSearchResult> =
        searchMulti(query).take(10).mapNotNull { item ->
            val mediaType = item.optString("media_type")
            if (mediaType != "movie" && mediaType != "tv") return@mapNotNull null
            val isMovie = mediaType == "movie"
            val title = if (isMovie) item.optText("title") else item.optText("name")
            val date = if (isMovie) item.optString("release_date") else item.optString("first_air_date")
            val original = if (isMovie) item.optText("original_title") else item.optText("original_name")
            MediaSearchResult(
                provider = PROVIDER,
                ref = "tmdb:${if (isMovie) "movie" else "tv"}:${item.optInt("id")}",
                mediaType = if (isMovie) "movie" else "series",
                title = title ?: "Sem título",
                originalTitle = original,
                year = yearOf(date),
                posterUrl = imageUrl(item.optText("poster_path")),
                overview = item.optText("overview")?.let { TextUtil.truncate(TextUtil.stripHtml(it), 220) }
            )
        }

    private data class Target(val kind: String, val id: Int, val imdbId: String? = null)

    private fun resolveTarget(input: String): Target {
        val value = input.trim()

        Regex("tt\\d{7,10}", RegexOption.IGNORE_CASE).find(value)?.let { match ->
            val imdbId = match.value
            val data = get("/find/$imdbId", mapOf("external_source" to "imdb_id"))
            data.optJSONArray("movie_results")?.optJSONObject(0)?.let {
                return Target("movie", it.optInt("id"), imdbId)
            }
            data.optJSONArray("tv_results")?.optJSONObject(0)?.let {
                return Target("tv", it.optInt("id"), imdbId)
            }
            throw ConnectorError("not_found", "O IMDB $imdbId não foi encontrado no TMDB.")
        }

        Regex("^tmdb:(movie|tv|series):(\\d+)$", RegexOption.IGNORE_CASE).find(value)?.let { match ->
            val kind = if (match.groupValues[1].lowercase() == "movie") "movie" else "tv"
            val id = match.groupValues[2].toIntOrNull()
            if (id == null || id <= 0) throw ConnectorError("config", "ID do TMDB inválido.")
            return Target(kind, id)
        }

        if (Regex("^\\d+$").matches(value)) {
            return Target("movie", value.toInt())
        }

        val first = searchMulti(value).firstOrNull()
            ?: throw ConnectorError(
                "not_found",
                "Nenhum filme ou série encontrado. Tente outro nome ou cole o link do IMDB."
            )
        return Target(if (first.optString("media_type") == "tv") "tv" else "movie", first.optInt("id"))
    }

    // ---------------------------------------------------------------------
    // Detalhes → mídia + eventos
    // ---------------------------------------------------------------------

    private fun movieEvents(details: JSONObject, settings: JSONObject): List<RawReleaseEvent> {
        val results = details.optJSONObject("release_dates")?.optJSONArray("results") ?: JSONArray()
        val regionCode = settings.optString("region", "BR")

        var region: JSONObject? = null
        for (index in 0 until results.length()) {
            val entry = results.optJSONObject(index) ?: continue
            if (entry.optString("iso_3166_1") == regionCode) {
                region = entry
                break
            }
        }
        if (region == null) {
            for (index in 0 until results.length()) {
                val entry = results.optJSONObject(index) ?: continue
                if (entry.optString("iso_3166_1") == "US") {
                    region = entry
                    break
                }
            }
        }
        if (region == null) {
            for (index in 0 until results.length()) {
                val entry = results.optJSONObject(index) ?: continue
                if ((entry.optJSONArray("release_dates")?.length() ?: 0) > 0) {
                    region = entry
                    break
                }
            }
        }
        val chosen = region ?: return emptyList()

        fun pick(types: Set<Int>): String? {
            val dates = chosen.optJSONArray("release_dates") ?: return null
            var best: String? = null
            for (index in 0 until dates.length()) {
                val entry = dates.optJSONObject(index) ?: continue
                if (!types.contains(entry.optInt("type"))) continue
                val date = entry.optString("release_date")
                if (date.isEmpty()) continue
                if (best == null || date < best) best = date
            }
            return best
        }

        val id = details.optInt("id")
        val url = "$SITE/movie/$id?language=pt-BR"
        val regionIso = chosen.optString("iso_3166_1")
        val events = mutableListOf<RawReleaseEvent>()

        fun push(kind: String, date: String) {
            events.add(
                RawReleaseEvent(
                    externalKey = "tmdb:movie:$id:$kind:$regionIso",
                    kind = kind,
                    releaseDate = date.take(10),
                    timezone = settings.optString("timezone", "America/Sao_Paulo"),
                    region = regionIso,
                    url = url
                )
            )
        }

        pick(setOf(3, 2, 1))?.let { push("cinema", it) }
        pick(setOf(4))?.let { push("digital", it) }
        return events
    }

    private fun seriesEvents(details: JSONObject, settings: JSONObject): List<RawReleaseEvent> {
        val timezone = settings.optString("timezone", "America/Sao_Paulo")
        val today = Dates.todayInZone(timezone)
        val from = Dates.addDaysToDate(today, -14)
        val to = Dates.addDaysToDate(today, 120)

        val seasons = mutableListOf<JSONObject>()
        val seasonsArray = details.optJSONArray("seasons") ?: JSONArray()
        for (index in 0 until seasonsArray.length()) {
            val season = seasonsArray.optJSONObject(index) ?: continue
            if (season.optInt("season_number") > 0) seasons.add(season)
        }

        val next = details.optJSONObject("next_episode_to_air")
        val numbers = mutableSetOf<Int>()

        if (next != null && next.optInt("season_number") > 0) {
            val nextSeason = next.optInt("season_number")
            numbers.add(nextSeason)
            val upcoming = seasons.firstOrNull { it.optInt("season_number") == nextSeason + 1 }
            val airDate = upcoming?.optString("air_date").orEmpty()
            if (airDate.isNotEmpty() && airDate <= to) numbers.add(nextSeason + 1)
        } else {
            val latest = seasons.filter { it.optString("air_date").isNotEmpty() }
                .maxByOrNull { it.optString("air_date") }
            if (latest != null) numbers.add(latest.optInt("season_number"))
        }

        val id = details.optInt("id")
        val events = mutableListOf<RawReleaseEvent>()

        for (seasonNumber in numbers.sorted()) {
            val season = try {
                get("/tv/$id/season/$seasonNumber")
            } catch (error: ConnectorError) {
                // Temporada ainda sem detalhes publicados não derruba a fonte.
                if (error.code == "not_found") continue
                throw error
            }

            val episodes = season.optJSONArray("episodes") ?: continue
            for (index in 0 until episodes.length()) {
                val episode = episodes.optJSONObject(index) ?: continue
                val airDate = episode.optString("air_date")
                if (airDate.isEmpty()) continue
                val date = airDate.take(10)
                if (date < from || date > to) continue

                events.add(
                    RawReleaseEvent(
                        externalKey = "tmdb:tv:$id:s${seasonNumber}e${episode.optInt("episode_number")}",
                        kind = "episode",
                        releaseDate = date,
                        timezone = timezone,
                        season = seasonNumber,
                        episode = episode.optInt("episode_number"),
                        episodeTitle = episode.optText("name"),
                        url = "$SITE/tv/$id/season/$seasonNumber/episode/${episode.optInt("episode_number")}?language=pt-BR"
                    )
                )
            }
        }

        return events
    }

    private data class Bundle(val media: RawMedia, val events: List<RawReleaseEvent>)

    private fun bundle(kind: String, id: Int, settings: JSONObject): Bundle {
        return if (kind == "movie") {
            val details = get("/movie/$id", mapOf("append_to_response" to "release_dates,external_ids"))
            Bundle(
                media = RawMedia(
                    provider = PROVIDER,
                    externalId = "movie:$id",
                    kind = "movie",
                    title = details.optText("title") ?: "Sem título",
                    originalTitle = details.optText("original_title"),
                    posterUrl = imageUrl(details.optText("poster_path")),
                    backdropUrl = imageUrl(details.optText("backdrop_path")),
                    year = yearOf(details.optString("release_date")),
                    status = details.optText("status"),
                    nextEpisodeAt = null,
                    url = "$SITE/movie/$id?language=pt-BR",
                    imdbId = details.optJSONObject("external_ids")?.optString("imdb_id")?.ifEmpty { null },
                    raw = details
                ),
                events = movieEvents(details, settings)
            )
        } else {
            val details = get("/tv/$id", mapOf("append_to_response" to "external_ids"))
            val next = details.optJSONObject("next_episode_to_air")
            Bundle(
                media = RawMedia(
                    provider = PROVIDER,
                    externalId = "tv:$id",
                    kind = "series",
                    title = details.optText("name") ?: "Sem título",
                    originalTitle = details.optText("original_name"),
                    posterUrl = imageUrl(details.optText("poster_path")),
                    backdropUrl = imageUrl(details.optText("backdrop_path")),
                    year = yearOf(details.optString("first_air_date")),
                    status = details.optText("status"),
                    totalSeasons = details.optInt("number_of_seasons").takeIf { it > 0 },
                    nextEpisodeAt = next?.optString("air_date")?.take(10)?.let { Dates.dateToIso(it) },
                    url = "$SITE/tv/$id?language=pt-BR",
                    imdbId = details.optJSONObject("external_ids")?.optString("imdb_id")?.ifEmpty { null },
                    raw = details
                ),
                events = seriesEvents(details, settings)
            )
        }
    }

    private fun categoryOf(media: RawMedia): String {
        val genres = media.raw?.optJSONArray("genres")
        if (genres != null) {
            for (index in 0 until genres.length()) {
                val name = genres.optJSONObject(index)?.optString("name").orEmpty()
                if (Regex("anima[cç]", RegexOption.IGNORE_CASE).containsMatchIn(name)) return "anime"
            }
        }
        return if (media.kind == "movie") "movie" else "series"
    }

    private fun sampleLabel(event: RawReleaseEvent): String {
        val parts = event.releaseDate.split('-')
        val date = if (parts.size == 3) "${parts[2]}/${parts[1]}/${parts[0]}" else event.releaseDate
        return when (event.kind) {
            "cinema" -> "Estreia nos cinemas — $date"
            "digital" -> "Lançamento digital — $date"
            else -> {
                val code = "S${event.season ?: "?"}E${event.episode ?: "?"}"
                if (event.episodeTitle != null) "$code · ${event.episodeTitle} — $date"
                else "Episódio $code — $date"
            }
        }
    }

    override fun resolve(input: String, settings: JSONObject): ResolvedSource {
        val target = resolveTarget(input)
        val bundle = bundle(target.kind, target.id, settings)
        val today = Dates.todayInZone(settings.optString("timezone", "America/Sao_Paulo"))

        val samples = bundle.events
            .filter { it.releaseDate >= today }
            .sortedBy { it.releaseDate }
            .take(3)
            .map {
                ResolvedSample(
                    title = sampleLabel(it),
                    url = it.url ?: bundle.media.url.orEmpty(),
                    publishedAt = Dates.dateToIso(it.releaseDate)
                )
            }

        return ResolvedSource(
            name = bundle.media.title,
            categoryId = categoryOf(bundle.media),
            config = JSONObject()
                .put("provider", PROVIDER)
                .put("externalId", "${target.kind}:${target.id}")
                .put("tmdbId", target.id)
                .put("mediaType", target.kind)
                .put("imdbId", target.imdbId ?: JSONObject.NULL)
                .put("title", bundle.media.title)
                .put("input", input),
            samples = samples
        )
    }

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val tmdbId = config.optInt("tmdbId")
        val mediaType = if (config.optString("mediaType") == "tv") "tv" else "movie"
        if (tmdbId <= 0) throw ConnectorError("config", "Fonte TMDB sem tmdbId válido.")

        val bundle = bundle(mediaType, tmdbId, settings)
        return ConnectorResult(
            items = emptyList(),
            state = JSONObject().put("lastSyncAt", Dates.nowIso()),
            media = bundle.media,
            releaseEvents = bundle.events
        )
    }

    /** Descobre o IMDB de um título (usado por animes do AniList). */
    fun findImdbIdByTitle(query: String, prefer: String = "tv"): String? {
        if (secrets.value("TMDB_API_KEY").isNullOrBlank()) return null
        return try {
            val ordered = searchMulti(query).sortedBy { item ->
                val mediaType = item.optString("media_type")
                if ((prefer == "tv" && mediaType == "tv") || (prefer == "movie" && mediaType == "movie")) 0 else 1
            }
            for (item in ordered.take(4)) {
                val kind = if (item.optString("media_type") == "tv") "tv" else "movie"
                val details = get("/$kind/${item.optInt("id")}", mapOf("append_to_response" to "external_ids"))
                val imdb = details.optJSONObject("external_ids")?.optString("imdb_id").orEmpty()
                if (Regex("^tt\\d{7,10}$", RegexOption.IGNORE_CASE).matches(imdb)) return imdb
            }
            null
        } catch (error: Exception) {
            null
        }
    }
}

/** Acesso às chaves de API, injetado para manter o conector testável. */
interface SecretAccess {
    fun value(key: String): String?
}


