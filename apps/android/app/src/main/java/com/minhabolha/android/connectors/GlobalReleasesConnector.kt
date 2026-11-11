package com.minhabolha.android.connectors

import com.minhabolha.android.Dates
import org.json.JSONObject

/**
 * Calendário global: junta lançamentos de filmes/séries (TMDB) e a agenda
 * global de animes (AniList), sem depender das fontes que o usuário acompanha.
 */
class GlobalReleasesConnector(
    private val tmdb: TmdbConnector,
    private val anilist: AnilistConnector
) : Connector {

    private companion object {
        const val WINDOW_PAST_DAYS = 45L
        const val WINDOW_FUTURE_DAYS = 75L
        const val ANIME_FUTURE_DAYS = 30L
        const val TMDB_MOVIE_PAGES = 4
        const val TMDB_TV_PAGES = 1
        const val TMDB_SERIES_DETAIL_LIMIT = 20
    }

    override val type = "global-releases"
    override val defaultIntervalMinutes = 360
    override val minIntervalMinutes = 60

    override fun resolve(input: String, settings: JSONObject): ResolvedSource =
        throw ConnectorError("not_supported", "A fonte do calendário global é criada automaticamente.")

    override fun fetch(
        source: SourceRow,
        config: JSONObject,
        state: JSONObject?,
        settings: JSONObject
    ): ConnectorResult {
        val timezone = settings.optString("timezone", "America/Sao_Paulo")
        val today = Dates.todayInZone(timezone)
        val from = Dates.addDaysToDate(today, -WINDOW_PAST_DAYS)
        val to = Dates.addDaysToDate(today, WINDOW_FUTURE_DAYS)
        val animeFrom = Dates.addDaysToDate(today, -7)
        val animeTo = Dates.addDaysToDate(today, ANIME_FUTURE_DAYS)

        val releases = mutableListOf<RawGlobalRelease>()
        val providers = mutableListOf<String>()
        val warnings = mutableListOf<String>()

        // TMDB exige chave; AniList é público.
        if (!tmdb.hasKey()) {
            warnings.add("TMDB: chave não configurada; filmes e séries globais não serão atualizados.")
        } else {
            try {
                releases.addAll(fetchMovies(settings, from, to))
                releases.addAll(fetchSeries(settings, from, to))
                providers.add("tmdb")
            } catch (error: Exception) {
                warnings.add("TMDB: ${error.message ?: "falha ao buscar lançamentos."}")
            }
        }

        try {
            releases.addAll(anilist.globalAnimeReleases(animeFrom, animeTo, timezone))
            providers.add("anilist")
        } catch (error: Exception) {
            warnings.add("AniList: ${error.message ?: "falha ao buscar a agenda."}")
        }

        if (providers.isEmpty()) {
            throw ConnectorError(
                "network",
                warnings.joinToString(" ").ifEmpty { "Nenhum provedor do calendário respondeu." }
            )
        }

        // Deduplica por chave (estreia de temporada pode aparecer duas vezes).
        val unique = LinkedHashMap<String, RawGlobalRelease>()
        for (release in releases) unique[release.externalKey] = release

        return ConnectorResult(
            items = emptyList(),
            state = JSONObject()
                .put("lastSyncAt", Dates.nowIso())
                .put("count", unique.size)
                .put("providers", providers.joinToString(",")),
            globalReleases = unique.values.toList(),
            globalReleaseProviders = providers,
            warnings = warnings
        )
    }

    // ---------------------------------------------------------------------
    // TMDB
    // ---------------------------------------------------------------------

    private fun inRange(date: String?, from: String, to: String): Boolean =
        !date.isNullOrEmpty() && date >= from && date <= to

    private fun fetchMovies(settings: JSONObject, from: String, to: String): List<RawGlobalRelease> {
        val timezone = settings.optString("timezone", "America/Sao_Paulo")
        val region = settings.optString("region", "BR")
        val releases = mutableListOf<RawGlobalRelease>()

        for (page in 1..TMDB_MOVIE_PAGES) {
            val data = tmdb.get(
                "/discover/movie",
                mapOf(
                    "sort_by" to "popularity.desc",
                    "primary_release_date.gte" to from,
                    "primary_release_date.lte" to to,
                    "with_release_type" to "2|3|4",
                    "region" to region,
                    "include_adult" to "false",
                    "page" to page.toString()
                )
            )
            val results = data.optJSONArray("results") ?: break
            for (index in 0 until results.length()) {
                val movie = results.optJSONObject(index) ?: continue
                val date = movie.optString("release_date")
                if (!inRange(date, from, to)) continue
                val id = movie.optInt("id")
                releases.add(
                    RawGlobalRelease(
                        externalKey = "tmdb:movie:$id:cinema:$region",
                        provider = "tmdb",
                        mediaKind = "movie",
                        title = movie.optString("title").ifEmpty { "Sem título" },
                        originalTitle = movie.optString("original_title").ifEmpty { null },
                        posterUrl = tmdb.imageUrl(movie.optString("poster_path").ifEmpty { null }),
                        kind = "cinema",
                        releaseDate = date,
                        timezone = timezone,
                        region = region,
                        url = "${TmdbConnector.SITE}/movie/$id?language=pt-BR"
                    )
                )
            }
            val totalPages = data.optInt("total_pages")
            if (totalPages <= 0 || page >= totalPages) break
        }

        return releases
    }

    private fun fetchSeries(settings: JSONObject, from: String, to: String): List<RawGlobalRelease> {
        val timezone = settings.optString("timezone", "America/Sao_Paulo")
        val region = settings.optString("region", "BR")
        val releases = mutableListOf<RawGlobalRelease>()

        // Próximos episódios das séries em exibição.
        val candidates = mutableListOf<JSONObject>()
        val seen = mutableSetOf<Int>()
        for (page in 1..TMDB_TV_PAGES) {
            val data = tmdb.get("/tv/on_the_air", mapOf("page" to page.toString(), "region" to region))
            val results = data.optJSONArray("results") ?: break
            for (index in 0 until results.length()) {
                val show = results.optJSONObject(index) ?: continue
                if (!seen.add(show.optInt("id"))) continue
                candidates.add(show)
            }
            val totalPages = data.optInt("total_pages")
            if (totalPages <= 0 || page >= totalPages) break
        }

        for (show in candidates.take(TMDB_SERIES_DETAIL_LIMIT)) {
            val details = try {
                tmdb.get("/tv/${show.optInt("id")}", mapOf("append_to_response" to "external_ids"))
            } catch (error: Exception) {
                continue
            }
            val next = details.optJSONObject("next_episode_to_air") ?: continue
            val date = next.optString("air_date")
            if (!inRange(date, from, to)) continue
            val id = details.optInt("id")
            releases.add(
                RawGlobalRelease(
                    externalKey = "tmdb:tv:$id:s${next.optInt("season_number")}e${next.optInt("episode_number")}",
                    provider = "tmdb",
                    mediaKind = "series",
                    title = details.optString("name").ifEmpty { "Sem título" },
                    originalTitle = details.optString("original_name").ifEmpty { null },
                    posterUrl = tmdb.imageUrl(details.optString("poster_path").ifEmpty { null }),
                    kind = "episode",
                    releaseDate = date,
                    timezone = timezone,
                    region = region,
                    season = next.optInt("season_number"),
                    episode = next.optInt("episode_number"),
                    episodeTitle = next.optString("name").ifEmpty { null },
                    url = "${TmdbConnector.SITE}/tv/$id?language=pt-BR",
                    imdbId = details.optJSONObject("external_ids")?.optString("imdb_id")?.ifEmpty { null }
                )
            )
        }

        // Estreias de séries (temporada 1, episódio 1).
        for (page in 1..2) {
            val data = tmdb.get(
                "/discover/tv",
                mapOf(
                    "sort_by" to "popularity.desc",
                    "first_air_date.gte" to from,
                    "first_air_date.lte" to to,
                    "include_adult" to "false",
                    "page" to page.toString()
                )
            )
            val results = data.optJSONArray("results") ?: break
            for (index in 0 until results.length()) {
                val show = results.optJSONObject(index) ?: continue
                val date = show.optString("first_air_date")
                if (!inRange(date, from, to)) continue
                val id = show.optInt("id")
                releases.add(
                    RawGlobalRelease(
                        externalKey = "tmdb:tv:$id:s1e1",
                        provider = "tmdb",
                        mediaKind = "series",
                        title = show.optString("name").ifEmpty { "Sem título" },
                        originalTitle = show.optString("original_name").ifEmpty { null },
                        posterUrl = tmdb.imageUrl(show.optString("poster_path").ifEmpty { null }),
                        kind = "episode",
                        releaseDate = date,
                        timezone = timezone,
                        region = region,
                        season = 1,
                        episode = 1,
                        episodeTitle = show.optString("name").ifEmpty { null },
                        url = "${TmdbConnector.SITE}/tv/$id?language=pt-BR"
                    )
                )
            }
            val totalPages = data.optInt("total_pages")
            if (totalPages <= 0 || page >= totalPages) break
        }

        return releases
    }
}
