package com.minhabolha.android

import com.minhabolha.android.connectors.MediaRow
import com.minhabolha.android.connectors.RawItem
import com.minhabolha.android.connectors.RawReleaseEvent
import com.minhabolha.android.connectors.ReleaseEventRow
import com.minhabolha.android.connectors.SourceRow

/**
 * Materializa eventos de calendário em itens do feed.
 *
 * Roda depois de cada sincronização de TMDB/AniList: pega os eventos dos
 * últimos 7 dias (ou só o dia de hoje, na primeira sincronização) e cria itens
 * com dedupe por chave do evento — nunca duplica.
 */
object ReleaseItems {

    private const val WINDOW_DAYS = 7L

    private fun releaseLabel(event: ReleaseEventRow): String = when (event.kind) {
        "cinema" -> "Estreia nos cinemas"
        "digital" -> "Lançamento digital"
        "episode" -> "Novo episódio"
        "airing" -> "Episódio no ar"
        else -> "Lançamento"
    }

    private fun buildTitle(media: MediaRow, event: ReleaseEventRow): String {
        if (event.kind == "cinema") return "${media.title} — estreia nos cinemas"
        if (event.kind == "digital") return "${media.title} — lançamento digital"

        val season = event.season?.let { "S$it" }.orEmpty()
        val episode = event.episode?.let { "E$it" }.orEmpty()
        val code = "$season$episode"
        return if (code.isNotEmpty()) "${media.title} — $code no ar" else "${media.title} — novo episódio no ar"
    }

    private fun buildDescription(event: ReleaseEventRow): String {
        val parts = mutableListOf(releaseLabel(event))
        if (!event.episodeTitle.isNullOrEmpty()) parts.add(0, event.episodeTitle)
        if (!event.releaseTime.isNullOrEmpty()) parts.add("às ${event.releaseTime}")
        if (!event.region.isNullOrEmpty() && (event.kind == "cinema" || event.kind == "digital")) {
            parts.add("região ${event.region}")
        }
        return parts.joinToString(" · ")
    }

    fun build(
        database: HubDatabase,
        source: SourceRow,
        media: MediaRow,
        timezone: String,
        firstSync: Boolean
    ): List<RawItem> {
        val today = Dates.todayInZone(timezone)
        val from = Dates.addDaysToDate(today, -WINDOW_DAYS)
        val events = database.eventsForMedia(media.id, from, today)

        val selected = if (firstSync) events.filter { it.releaseDate == today } else events
        val now = System.currentTimeMillis()
        val items = mutableListOf<RawItem>()

        for (event in selected) {
            // Episódio com horário exato só vira item depois de ir ao ar.
            val releaseAt = Dates.parseIsoMillis(event.releaseAt)
            if (releaseAt != null && releaseAt > now) continue

            val url = event.url ?: media.url ?: continue

            items.add(
                RawItem(
                    externalId = event.externalKey,
                    dedupeKey = "release:${event.externalKey}",
                    kind = if (event.kind == "cinema" || event.kind == "digital") "release" else "episode",
                    title = buildTitle(media, event),
                    url = url,
                    thumbnailUrl = media.backdropUrl ?: media.posterUrl,
                    description = buildDescription(event),
                    author = null,
                    publishedAt = event.releaseAt ?: Dates.dateToIso(event.releaseDate),
                    meta = org.json.JSONObject()
                        .put("mediaId", media.id)
                        .put("provider", media.provider)
                        .put("releaseKind", event.kind)
                        .put("season", event.season ?: org.json.JSONObject.NULL)
                        .put("episode", event.episode ?: org.json.JSONObject.NULL)
                        .put("region", event.region ?: org.json.JSONObject.NULL)
                )
            )
        }

        return items
    }

    /** Eventos recém-criados viram itens de feed para a fonte informada. */
    fun forSource(
        database: HubDatabase,
        source: SourceRow,
        media: MediaRow,
        events: List<RawReleaseEvent>,
        timezone: String
    ): List<RawItem> {
        if (events.isEmpty()) return emptyList()
        return build(database, source, media, timezone, firstSync = source.lastSuccessAt == null)
    }
}
