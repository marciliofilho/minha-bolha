package com.minhabolha.android

import android.content.Context
import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Registry
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Servidor local do Minha Bolha no Android.
 *
 * Serve a interface React empacotada no APK e implementa a API em
 * `127.0.0.1`, no mesmo processo do banco SQLite. Nenhuma porta é exposta
 * fora do aparelho.
 */
class HubServer(
    private val context: Context,
    private val port: Int,
    private val database: HubDatabase,
    private val scheduler: HubScheduler,
    private val events: EventHub,
    private val version: String
) : NanoHTTPD("127.0.0.1", port) {

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        if (BuildConfig.DEBUG) {
            android.util.Log.i("MinhaBolha", "req ${session.method.name} $uri")
        }
        return try {
            if (uri == "/api" || uri.startsWith("/api/")) {
                serveApi(session)
            } else {
                serveStatic(uri)
            }
        } catch (error: HubException) {
            jsonError(error.status, error.message ?: "Erro", error.code)
        } catch (error: ConnectorError) {
            jsonError(errorCodeToStatus(error.code), error.message ?: "Erro na fonte.", error.code)
        } catch (error: JSONException) {
            jsonError(400, "Corpo da requisição inválido.", "validation")
        } catch (error: Exception) {
            jsonError(500, error.message ?: "Erro interno.", "internal")
        }
    }

    // ---------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------

    private fun serveApi(session: IHTTPSession): Response {
        val path = session.uri.removePrefix("/api")
        val method = session.method
        val segments = path.trim('/').split('/').filter { it.isNotEmpty() }

        return when {
            segments == listOf("health") && method == Method.GET -> health()
            segments == listOf("status") && method == Method.GET -> status()
            segments == listOf("events") && method == Method.GET -> sse()

            segments == listOf("settings") && method == Method.GET -> json(database.settings())
            segments == listOf("settings") && (method == Method.PATCH || method == Method.PUT) ->
                json(database.updateSettings(readJsonBody(session)))

            segments == listOf("categories") && method == Method.GET ->
                json(JSONObject().put("categories", database.categories()))
            segments == listOf("categories") && method == Method.POST -> createCategory(session)

            segments == listOf("secrets") && method == Method.GET ->
                json(JSONObject().put("secrets", Secrets.list(database)))
            segments.size == 2 && segments[0] == "secrets" && (method == Method.PUT || method == Method.POST) ->
                setSecret(session, segments[1])
            segments.size == 2 && segments[0] == "secrets" && method == Method.DELETE ->
                deleteSecret(segments[1])

            segments == listOf("media", "search") && method == Method.GET -> mediaSearch(session)

            segments == listOf("stremio", "status") && method == Method.GET ->
                json(StremioCatalog.status(database))
            segments == listOf("stremio", "addons") && method == Method.GET ->
                json(JSONObject().put("addons", StremioCatalog.listAddons(database)))
            segments == listOf("stremio", "addons") && method == Method.POST -> addStremioAddon(session)
            segments.size == 3 && segments[0] == "stremio" && segments[1] == "addons" &&
                method == Method.DELETE -> removeStremioAddon(segments[2])
            segments == listOf("stremio", "catalogs") && method == Method.GET ->
                json(JSONObject().put("catalogs", StremioCatalog.catalogGroups(database)))
            segments == listOf("stremio", "catalog") && method == Method.GET -> stremioCatalog(session)
            segments == listOf("stremio", "search") && method == Method.GET -> stremioSearch(session)
            segments.size == 4 && segments[0] == "stremio" && segments[1] == "title" &&
                method == Method.GET -> json(
                StremioCatalog.title(database, segments[2], segments[3])
            )
            segments == listOf("stremio", "streams") && method == Method.GET -> stremioStreams(session)
            segments == listOf("stremio", "subtitles") && method == Method.GET -> stremioSubtitles(session)
            segments == listOf("stremio", "torrent", "prepare") && method == Method.POST ->
                prepareTorrent(session)
            segments == listOf("stremio", "torrent", "engine") && method == Method.GET ->
                json(
                    JSONObject()
                        .put("available", TorrentEngine.ensure(context))
                        .put("error", TorrentEngine.lastError ?: JSONObject.NULL)
                )
            segments.size == 4 && segments[0] == "stremio" && segments[1] == "torrent" &&
                segments[3] == "raw" && method == Method.GET -> torrentRaw(session, segments[2])
            segments.size == 4 && segments[0] == "stremio" && segments[1] == "torrent" &&
                segments[3] == "status" && method == Method.GET -> torrentStatus(segments[2])
            segments.size == 3 && segments[0] == "stremio" && segments[1] == "torrent" &&
                method == Method.DELETE -> torrentRemove(segments[2])
            segments == listOf("stremio", "server") && method == Method.GET ->
                json(
                    JSONObject()
                        .put("available", false)
                        .put("baseUrl", "")
                        .put("version", JSONObject.NULL)
                )

            segments == listOf("playback", "progress") && method == Method.GET -> getPlayback(session)
            segments == listOf("playback", "continue") && method == Method.GET -> continueWatching(session)
            segments == listOf("playback", "progress") &&
                (method == Method.PUT || method == Method.POST) -> savePlayback(session)
            segments == listOf("playback", "progress") && method == Method.DELETE -> removePlayback(session)
            segments == listOf("stremio", "library") && method == Method.GET ->
                json(
                    JSONObject()
                        .put("items", JSONArray())
                        .put("status", StremioCatalog.status(database))
                )
            segments == listOf("stremio", "card-info") && method == Method.POST ->
                json(JSONObject().put("items", JSONArray()))

            segments == listOf("calendar") && method == Method.GET -> calendar(session)
            segments == listOf("calendar", "search") && method == Method.GET -> calendarSearch(session)
            segments == listOf("calendar", "refresh") && method == Method.POST -> calendarRefresh()

            segments.firstOrNull() == "sources" -> serveSources(session, method, segments)

            segments == listOf("feed") && method == Method.GET -> feed(session)
            segments == listOf("feed", "counts") && method == Method.GET ->
                json(JSONObject().put("counts", database.counts()))
            segments == listOf("feed", "mark-all-read") && method == Method.POST -> markAllRead(session)

            segments == listOf("refresh") && method == Method.POST ->
                json(
                    JSONObject()
                        .put("queued", scheduler.enqueueAll(true))
                        .put("refresh", scheduler.refreshState()),
                    Response.Status.ACCEPTED
                )

            segments.firstOrNull() == "items" && segments.size == 2 -> serveItem(session, method, segments[1])

            else -> throw HubException(404, "not_found", "Rota não encontrada: ${session.uri}")
        }
    }

    // ---------------------------------------------------------------------
    // Fontes
    // ---------------------------------------------------------------------

    private fun serveSources(session: IHTTPSession, method: Method, segments: List<String>): Response {
        return when {
            segments.size == 1 && method == Method.GET ->
                json(JSONObject().put("sources", database.sources()))

            segments.size == 1 && method == Method.POST -> createSource(session)
            segments.size == 2 && segments[1] == "resolve" && method == Method.POST -> resolveSource(session)
            segments.size == 2 && segments[1] == "bulk-delete" && method == Method.POST -> bulkDeleteSources(session)
            segments.size == 2 && (method == Method.PATCH || method == Method.PUT) -> updateSource(session, segments[1])
            segments.size == 2 && method == Method.DELETE -> deleteSource(segments[1])

            segments.size == 3 && segments[2] == "refresh" && method == Method.POST -> refreshSource(segments[1])
            segments.size == 3 && segments[2] == "runs" && method == Method.GET -> sourceRuns(segments[1])

            else -> throw HubException(404, "not_found", "Rota não encontrada: ${session.uri}")
        }
    }

    private fun resolveSource(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val type = body.optString("type")
        val input = body.optString("input").trim()
        if (input.isEmpty()) throw HubException(400, "validation", "Informe a URL ou o canal.")

        val connector = requireConnector(type)
        val resolved = connector.resolve(input, database.settings())

        val samples = JSONArray()
        for (sample in resolved.samples) {
            samples.put(
                JSONObject()
                    .put("title", sample.title)
                    .put("url", sample.url)
                    .put("publishedAt", sample.publishedAt ?: JSONObject.NULL)
            )
        }

        return json(
            JSONObject()
                .put("name", resolved.name)
                .put("categoryId", resolved.categoryId)
                .put("config", resolved.config)
                .put("samples", samples)
        )
    }

    private fun createSource(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val type = body.optString("type")
        val input = body.optString("input").trim()
        val categoryId = body.optString("categoryId")
        if (input.isEmpty()) throw HubException(400, "validation", "Informe a URL ou o canal.")
        if (!database.categoryExists(categoryId)) {
            throw HubException(400, "validation", "Categoria inexistente.")
        }

        val connector = requireConnector(type)
        val settings = database.settings()
        val resolved = connector.resolve(input, settings)

        val defaultInterval = maxOf(
            settings.optInt("defaultIntervalMinutes", 30),
            connector.defaultIntervalMinutes
        )
        val requested = if (body.has("intervalMinutes")) body.optInt("intervalMinutes", defaultInterval) else defaultInterval
        val intervalMinutes = maxOf(requested, connector.minIntervalMinutes)

        val source = database.createSource(
            type = type,
            name = body.optString("name").trim().ifEmpty { resolved.name },
            categoryId = categoryId,
            config = resolved.config,
            intervalMinutes = intervalMinutes
        )

        scheduler.enqueueSource(source.getString("id"), true)
        return json(source, Response.Status.CREATED)
    }

    private fun updateSource(session: IHTTPSession, id: String): Response {
        val row = database.sourceRow(id) ?: throw HubException(404, "not_found", "Fonte não encontrada.")
        val body = readJsonBody(session)

        val categoryId = body.optString("categoryId").takeIf { it.isNotEmpty() }
        if (categoryId != null && !database.categoryExists(categoryId)) {
            throw HubException(400, "validation", "Categoria inexistente.")
        }

        val connector = requireConnector(row.type)
        var config: JSONObject? = null
        var name: String? = body.optString("name").trim().takeIf { it.isNotEmpty() }
        var reResolved = false

        val input = body.optString("input").trim()
        if (input.isNotEmpty()) {
            val resolved = connector.resolve(input, database.settings())
            config = resolved.config
            if (name == null) name = resolved.name
            reResolved = true
        }

        val intervalMinutes = if (body.has("intervalMinutes")) {
            maxOf(body.optInt("intervalMinutes"), connector.minIntervalMinutes)
        } else {
            null
        }

        val enabled = if (body.has("enabled")) body.optBoolean("enabled") else null

        val updated = database.updateSource(
            id = id,
            name = name,
            categoryId = categoryId,
            intervalMinutes = intervalMinutes,
            enabled = enabled,
            config = config
        ) ?: throw HubException(404, "not_found", "Fonte não encontrada.")

        if (reResolved) scheduler.enqueueSource(id, true)
        return json(updated)
    }

    private fun deleteSource(id: String): Response {
        if (!database.deleteSource(id)) {
            throw HubException(404, "not_found", "Fonte não encontrada.")
        }
        return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
    }

    private fun bulkDeleteSources(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val ids = body.optJSONArray("ids")
            ?: throw HubException(400, "validation", "Envie a lista de fontes.")
        val list = mutableListOf<String>()
        for (index in 0 until ids.length()) {
            val id = ids.optString(index).trim()
            if (id.isNotEmpty()) list.add(id)
        }
        if (list.isEmpty()) throw HubException(400, "validation", "Nenhuma fonte informada.")
        return json(JSONObject().put("deleted", database.deleteSources(list)))
    }

    private fun refreshSource(id: String): Response {
        if (database.source(id) == null) {
            throw HubException(404, "not_found", "Fonte não encontrada.")
        }
        return json(
            JSONObject().put("queued", scheduler.enqueueSource(id, true)),
            Response.Status.ACCEPTED
        )
    }

    private fun sourceRuns(id: String): Response {
        if (database.source(id) == null) {
            throw HubException(404, "not_found", "Fonte não encontrada.")
        }
        return json(JSONObject().put("runs", database.listRuns(id)))
    }

    private fun requireConnector(type: String): com.minhabolha.android.connectors.Connector {
        if (!Registry.has(type)) {
            throw HubException(
                400,
                "not_supported",
                "O tipo \"$type\" ainda não está disponível no Android."
            )
        }
        return Registry.get(type)
    }

    // ---------------------------------------------------------------------
    // Itens, feed e sistema
    // ---------------------------------------------------------------------

    private fun serveItem(session: IHTTPSession, method: Method, id: String): Response {
        return when (method) {
            Method.GET -> {
                val item = database.item(id)
                    ?: throw HubException(404, "not_found", "Item não encontrado.")
                json(item)
            }

            Method.PATCH, Method.PUT -> {
                val item = database.updateItemFlags(id, readJsonBody(session))
                    ?: throw HubException(404, "not_found", "Item não encontrado.")
                json(item)
            }

            else -> throw HubException(405, "method_not_allowed", "Método não permitido.")
        }
    }

    private fun health(): Response {
        val counts = database.healthCounts()
        val payload = JSONObject()
            .put("ok", true)
            .put("version", version)
            .put("phase", 6)
            .put("platform", "android")
            .put("keys", keyFlags())
            .put("demo", counts.optBoolean("demo"))
            .put(
                "counts",
                JSONObject()
                    .put("sources", counts.optInt("sources"))
                    .put("items", counts.optInt("items"))
                    .put("unread", counts.optInt("unread"))
                    .put("games", counts.optInt("games"))
            )
        return json(payload)
    }

    private fun status(): Response {
        val counts = database.healthCounts()
        return json(
            JSONObject()
                .put("refresh", scheduler.refreshState())
                .put("keys", keyFlags())
                .put("demo", counts.optBoolean("demo"))
        )
    }

    private fun keyFlags(): JSONObject = JSONObject()
        .put("tmdb", Secrets.has(database, "tmdb"))
        .put("steam", Secrets.has(database, "steam"))
        .put("ggdeals", Secrets.has(database, "ggdeals"))

    private fun sse(): Response {
        val response = newChunkedResponse(
            Response.Status.OK,
            "text/event-stream; charset=utf-8",
            events.createStream()
        )
        response.addHeader("Cache-Control", "no-cache")
        response.addHeader("X-Accel-Buffering", "no")
        return response
    }

    /**
     * O NanoHTTPD comprime respostas de texto quando o cliente aceita gzip.
     * Para SSE isso quebra o streaming: o GZIPOutputStream segura os dados
     * até fechar a conexão, então o navegador nunca recebe os eventos.
     */
    override fun useGzipWhenAccepted(response: Response): Boolean {
        val mime = response.mimeType?.lowercase().orEmpty()
        if (mime.contains("text/event-stream")) return false
        return super.useGzipWhenAccepted(response)
    }

    private fun feed(session: IHTTPSession): Response {
        val tab = param(session, "tab") ?: "all"
        val sourceId = param(session, "sourceId")
        val cursor = param(session, "cursor")
        val limit = param(session, "limit")?.toIntOrNull() ?: 30
        return json(database.feed(tab, sourceId, cursor, limit))
    }

    private fun markAllRead(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val tab = body.optString("tab", "all")
        val sourceId = if (body.has("sourceId") && !body.isNull("sourceId")) {
            body.optString("sourceId")
        } else {
            null
        }
        return json(JSONObject().put("updated", database.markAllRead(tab, sourceId)))
    }

    private fun createCategory(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val label = body.optString("label").trim()
        if (label.length < 2 || label.length > 40) {
            throw HubException(400, "validation", "Nome de categoria inválido.")
        }
        val icon = body.optString("icon").trim().ifEmpty { null }
        val color = body.optString("color").trim().ifEmpty { null }
        if (color != null && !COLOR_PATTERN.matches(color)) {
            throw HubException(400, "validation", "Cor inválida.")
        }
        return json(database.createCategory(label, icon, color), Response.Status.CREATED)
    }

    // ---------------------------------------------------------------------
    // Chaves de API
    // ---------------------------------------------------------------------

    private fun setSecret(session: IHTTPSession, id: String): Response {
        val definition = Secrets.definitionOf(id)
            ?: throw HubException(404, "not_found", "Chave desconhecida.")
        val body = readJsonBody(session)
        val value = body.optString("value").trim()
        if (value.length < 4 || value.length > 512) {
            throw HubException(400, "validation", "Informe uma chave válida.")
        }
        if (!Secrets.isValidFormat(id, value)) {
            throw HubException(
                422,
                "validation",
                "A chave da Steam deve ter 32 caracteres hexadecimais, sem espaços ou símbolos."
            )
        }

        database.setSecretValue(definition.envVar, value)
        events.broadcast("secrets:changed", JSONObject().put("id", id))

        // Reexecuta as fontes afetadas para aplicar a chave imediatamente.
        val affectedType = when (id) {
            "tmdb" -> "tmdb"
            "steam" -> "steam-wishlist"
            else -> null
        }
        if (affectedType != null) {
            val sources = database.sources()
            for (index in 0 until sources.length()) {
                val source = sources.optJSONObject(index) ?: continue
                if (source.optString("type") == affectedType && source.optBoolean("enabled")) {
                    scheduler.enqueueSource(source.optString("id"), true)
                }
            }
        }

        return json(JSONObject().put("secrets", Secrets.list(database)))
    }

    private fun deleteSecret(id: String): Response {
        val definition = Secrets.definitionOf(id)
            ?: throw HubException(404, "not_found", "Chave desconhecida.")
        database.deleteSecretValue(definition.envVar)
        events.broadcast("secrets:changed", JSONObject().put("id", id))
        return json(JSONObject().put("secrets", Secrets.list(database)))
    }

    // ---------------------------------------------------------------------
    // Mídia e calendário
    // ---------------------------------------------------------------------

    private fun mediaSearch(session: IHTTPSession): Response {
        val provider = param(session, "provider").orEmpty()
        val query = param(session, "q")?.trim().orEmpty()
        if (!Registry.has(provider) || (provider != "tmdb" && provider != "anilist")) {
            throw HubException(400, "validation", "Provedor inválido. Use \"tmdb\" ou \"anilist\".")
        }
        if (query.length < 2) {
            throw HubException(400, "validation", "Digite pelo menos 2 caracteres para buscar.")
        }

        val connector = Registry.get(provider)
        val results = connector.search(query, database.settings())
        val payload = JSONArray()
        for (result in results) {
            payload.put(
                JSONObject()
                    .put("provider", result.provider)
                    .put("ref", result.ref)
                    .put("mediaType", result.mediaType)
                    .put("title", result.title)
                    .put("originalTitle", result.originalTitle ?: JSONObject.NULL)
                    .put("year", result.year ?: JSONObject.NULL)
                    .put("posterUrl", result.posterUrl ?: JSONObject.NULL)
                    .put("overview", result.overview ?: JSONObject.NULL)
            )
        }
        return json(JSONObject().put("results", payload))
    }

    private fun calendar(session: IHTTPSession): Response {
        val settings = database.settings()
        val timezone = settings.optString("timezone", "America/Sao_Paulo")
        val today = Dates.todayInZone(timezone)

        val from = param(session, "from") ?: today
        val to = param(session, "to") ?: Dates.addDaysToDate(from, 30)

        if (!DATE_PATTERN.matches(from) || !DATE_PATTERN.matches(to)) {
            throw HubException(400, "validation", "Datas devem estar no formato YYYY-MM-DD.")
        }
        val span = daysBetween(from, to)
        if (span < 0) throw HubException(400, "validation", "\"from\" precisa ser anterior a \"to\".")
        if (span > 370) throw HubException(400, "validation", "Intervalo máximo de 370 dias.")

        val kinds = (param(session, "types") ?: "")
            .split(',')
            .map { it.trim() }
            .filter { it == "movie" || it == "series" || it == "anime" }

        val scope = if (param(session, "scope") == "library") "library" else "global"
        val items = if (scope == "library") {
            database.calendarEvents(from, to, kinds)
        } else {
            database.globalReleases(from, to, kinds)
        }

        if (BuildConfig.DEBUG) {
            android.util.Log.i(
                "MinhaBolha",
                "calendar scope=$scope from=$from to=$to kinds=$kinds eventos=${items.length()}"
            )
        }

        return json(JSONObject().put("from", from).put("to", to).put("events", items))
    }

    private fun calendarSearch(session: IHTTPSession): Response {
        val query = param(session, "q")?.trim().orEmpty()
        if (query.length < 2) {
            throw HubException(400, "validation", "Digite pelo menos 2 caracteres para buscar.")
        }
        if (query.length > 100) throw HubException(400, "validation", "Busca grande demais.")

        val timezone = database.settings().optString("timezone", "America/Sao_Paulo")
        val today = Dates.todayInZone(timezone)
        val from = Dates.addDaysToDate(today, -400)
        val to = Dates.addDaysToDate(today, 400)
        val scope = if (param(session, "scope") == "library") "library" else "global"

        val events = if (scope == "library") {
            database.calendarEvents(from, to, emptyList())
        } else {
            database.globalReleases(from, to, emptyList())
        }

        val needle = normalizeSearch(query)
        val matches = JSONArray()
        for (index in 0 until events.length()) {
            val event = events.optJSONObject(index) ?: continue
            val haystack = listOf(
                event.optString("title"),
                event.optString("originalTitle"),
                event.optString("episodeTitle"),
                event.optString("sourceName")
            ).filter { it.isNotEmpty() }.joinToString(" ")
            if (normalizeSearch(haystack).contains(needle)) {
                matches.put(event)
                if (matches.length() >= 100) break
            }
        }

        return json(JSONObject().put("from", from).put("to", to).put("events", matches))
    }

    private fun calendarRefresh(): Response {
        val source = GlobalReleasesSource.ensure(database)
        val queued = scheduler.enqueueSource(source.getString("id"), true)
        return json(JSONObject().put("queued", queued), Response.Status.ACCEPTED)
    }

    private fun daysBetween(from: String, to: String): Long = try {
        java.time.temporal.ChronoUnit.DAYS.between(
            java.time.LocalDate.parse(from),
            java.time.LocalDate.parse(to)
        )
    } catch (error: Exception) {
        -1
    }

    private fun normalizeSearch(value: String): String =
        java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .lowercase()

    // ---------------------------------------------------------------------
    // Stremio: addons e catálogos
    // ---------------------------------------------------------------------

    private fun addStremioAddon(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val url = body.optString("url").trim()
        if (url.length < 3) throw HubException(400, "validation", "Informe a URL do addon.")

        val addon = StremioCatalog.addAddon(database, url)
        events.broadcast("stremio:changed", JSONObject().put("addons", true))
        return json(JSONObject().put("addon", addon), Response.Status.CREATED)
    }

    private fun removeStremioAddon(id: String): Response {
        if (!StremioCatalog.removeAddon(database, id)) {
            throw HubException(404, "not_found", "Addon não encontrado.")
        }
        events.broadcast("stremio:changed", JSONObject().put("addons", true))
        return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
    }

    private fun stremioCatalog(session: IHTTPSession): Response {
        val addonId = param(session, "addonId") ?: throw HubException(400, "validation", "Informe o addon.")
        val type = param(session, "type") ?: throw HubException(400, "validation", "Informe o tipo.")
        val catalogId = param(session, "catalogId")
            ?: throw HubException(400, "validation", "Informe o catálogo.")
        val skip = param(session, "skip")?.toIntOrNull()?.coerceIn(0, 100_000) ?: 0

        return json(
            StremioCatalog.catalogPage(
                database = database,
                addonRowId = addonId,
                type = type,
                catalogId = catalogId,
                search = param(session, "search"),
                skip = skip,
                genre = param(session, "genre")
            )
        )
    }

    private fun stremioSearch(session: IHTTPSession): Response {
        val query = param(session, "query")?.trim().orEmpty()
        if (query.length < 2) {
            throw HubException(400, "validation", "Digite pelo menos 2 caracteres para buscar.")
        }
        return json(StremioCatalog.search(database, query, param(session, "type")))
    }

    private fun stremioStreams(session: IHTTPSession): Response {
        val type = param(session, "type")
            ?: throw HubException(400, "validation", "Informe o tipo do título.")
        val id = param(session, "id")
            ?: throw HubException(400, "validation", "Informe o título.")

        val season = param(session, "season")?.toIntOrNull()
        val episode = param(session, "episode")?.toIntOrNull()

        return json(
            StremioStreams.fetch(
                database = database,
                type = type,
                id = id,
                season = season,
                episode = episode,
                videoId = param(session, "videoId")
            )
        )
    }

    private fun stremioSubtitles(session: IHTTPSession): Response {
        val type = param(session, "type") ?: "movie"
        val id = param(session, "id") ?: ""
        val videoId = param(session, "videoId") ?: id
        return json(
            JSONObject()
                .put("type", type)
                .put("id", id)
                .put("videoId", videoId)
                .put("subtitles", JSONArray())
                .put("errors", JSONArray())
                .put("elapsedMs", 0)
        )
    }

    // ---------------------------------------------------------------------
    // Torrents
    // ---------------------------------------------------------------------

    private fun prepareTorrent(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val infoHash = body.optString("infoHash").trim()
        if (infoHash.isEmpty()) throw HubException(400, "validation", "Informe o info hash.")

        val fileIdx = if (body.has("fileIdx") && !body.isNull("fileIdx")) {
            body.optInt("fileIdx")
        } else {
            null
        }

        val sources = mutableListOf<String>()
        body.optJSONArray("sources")?.let { array ->
            for (index in 0 until array.length()) {
                val value = array.optString(index)
                if (value.isNotEmpty()) sources.add(value)
            }
        }

        val prepared = TorrentEngine.prepare(
            context = context,
            infoHash = infoHash,
            fileIdx = fileIdx,
            sources = sources
        )
        return json(prepared)
    }

    private fun torrentRaw(session: IHTTPSession, sessionId: String): Response {
        val torrent = TorrentEngine.session(sessionId)
            ?: throw HubException(404, "not_found", "Sessão de torrent não encontrada.")

        var start = 0L
        var endInclusive = torrent.fileLength - 1
        var partial = false

        val range = session.headers["range"]
        if (!range.isNullOrBlank() && range.startsWith("bytes=")) {
            val spec = range.removePrefix("bytes=").substringBefore(',').trim()
            val parts = spec.split('-', limit = 2)
            val from = parts.getOrNull(0)?.toLongOrNull()
            val to = parts.getOrNull(1)?.toLongOrNull()
            when {
                from != null -> {
                    start = from.coerceIn(0, torrent.fileLength - 1)
                    endInclusive = (to ?: endInclusive).coerceAtMost(torrent.fileLength - 1)
                    partial = true
                }

                to != null -> {
                    start = (torrent.fileLength - to).coerceAtLeast(0)
                    partial = true
                }
            }
        }

        if (endInclusive < start) {
            throw HubException(400, "validation", "Intervalo inválido.")
        }

        val length = (endInclusive - start + 1).coerceAtMost(torrent.fileLength - start)
        val mime = MIME_TYPES[torrent.fileName.substringAfterLast('.', "").lowercase()]
            ?: "application/octet-stream"

        val response = newFixedLengthResponse(
            if (partial) Response.Status.PARTIAL_CONTENT else Response.Status.OK,
            mime,
            TorrentRangeStream(torrent, start, length),
            length
        )
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Cache-Control", "no-store")
        if (partial) {
            response.addHeader(
                "Content-Range",
                "bytes $start-${start + length - 1}/${torrent.fileLength}"
            )
        }
        return response
    }

    private fun torrentStatus(sessionId: String): Response {
        val status = TorrentEngine.status(sessionId)
            ?: throw HubException(404, "not_found", "Sessão de torrent não encontrada.")
        return json(status)
    }

    private fun torrentRemove(sessionId: String): Response {
        TorrentEngine.remove(sessionId)
        return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
    }

    // ---------------------------------------------------------------------
    // Progresso de reprodução
    // ---------------------------------------------------------------------

    private fun getPlayback(session: IHTTPSession): Response {
        val metaId = param(session, "metaId")
            ?: throw HubException(400, "validation", "Informe o título.")
        val videoId = param(session, "videoId")
            ?: throw HubException(400, "validation", "Informe o vídeo.")
        return json(JSONObject().put("progress", database.playback(metaId, videoId) ?: JSONObject.NULL))
    }

    private fun continueWatching(session: IHTTPSession): Response {
        val limit = param(session, "limit")?.toIntOrNull() ?: 20
        return json(JSONObject().put("items", database.playbackContinue(limit)))
    }

    private fun savePlayback(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val metaId = body.optString("metaId").trim()
        val videoId = body.optString("videoId").trim()
        val type = if (body.optString("type") == "series") "series" else "movie"
        val name = body.optString("name").trim()
        if (metaId.isEmpty() || videoId.isEmpty() || name.isEmpty()) {
            throw HubException(400, "validation", "Dados de progresso incompletos.")
        }

        val position = body.optLong("positionMs").coerceAtLeast(0)
        val durationRaw = if (body.has("durationMs") && !body.isNull("durationMs")) {
            body.optLong("durationMs").takeIf { it > 0 }
        } else {
            null
        }
        val completed = if (body.has("completed")) {
            body.optBoolean("completed")
        } else {
            durationRaw != null && position.toDouble() / durationRaw >= 0.95
        }

        val progress = database.savePlayback(
            metaId = metaId,
            type = type,
            videoId = videoId,
            season = if (body.has("season") && !body.isNull("season")) body.optInt("season") else null,
            episode = if (body.has("episode") && !body.isNull("episode")) body.optInt("episode") else null,
            positionMs = position,
            durationMs = durationRaw,
            addonId = body.optString("addonId").ifEmpty { null },
            streamSignature = body.optString("streamSignature").ifEmpty { null },
            name = name,
            poster = body.optString("poster").ifEmpty { null },
            backdrop = body.optString("backdrop").ifEmpty { null },
            year = if (body.has("year") && !body.isNull("year")) body.optInt("year") else null,
            completed = completed
        )

        return json(JSONObject().put("progress", progress))
    }

    private fun removePlayback(session: IHTTPSession): Response {
        val metaId = param(session, "metaId")
            ?: throw HubException(400, "validation", "Informe o título.")
        val videoId = param(session, "videoId")
            ?: throw HubException(400, "validation", "Informe o vídeo.")
        database.deletePlayback(metaId, videoId)
        return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
    }

    // ---------------------------------------------------------------------
    // Arquivos estáticos
    // ---------------------------------------------------------------------

    private fun serveStatic(uri: String): Response {
        val clean = uri.substringBefore('?').trimStart('/')
        if (clean.contains("..")) throw HubException(400, "validation", "Caminho inválido.")

        val candidate = clean.ifEmpty { "index.html" }
        val asset = "web/$candidate"

        if (assetExists(asset)) {
            return assetResponse(asset, candidate)
        }

        // Rotas do React Router não têm extensão: devolve o index.html.
        if (!candidate.contains('.')) {
            return assetResponse("web/index.html", "index.html")
        }

        throw HubException(404, "not_found", "Arquivo não encontrado: $candidate")
    }

    private fun assetExists(path: String): Boolean {
        return try {
            context.assets.open(path).use { true }
        } catch (error: Exception) {
            false
        }
    }

    private fun assetResponse(assetPath: String, name: String): Response {
        val mime = MIME_TYPES[name.substringAfterLast('.', "").lowercase()]
            ?: "application/octet-stream"
        val stream = context.assets.open(assetPath)
        // Chunked evita depender de Content-Length de assets comprimidos no APK.
        val response = newChunkedResponse(Response.Status.OK, mime, stream)
        response.addHeader(
            "Cache-Control",
            if (name == "index.html") "no-cache" else "public, max-age=31536000, immutable"
        )
        return response
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private fun json(payload: JSONObject, status: Response.Status = Response.Status.OK): Response {
        return newFixedLengthResponse(status, "application/json; charset=utf-8", payload.toString())
    }

    private fun jsonError(status: Int, message: String, code: String): Response {
        if (status >= 500) {
            android.util.Log.e("MinhaBolha", "erro $status: $message")
        }
        val payload = JSONObject().put("error", message).put("code", code)
        return newFixedLengthResponse(
            Response.Status.lookup(status) ?: Response.Status.INTERNAL_ERROR,
            "application/json; charset=utf-8",
            payload.toString()
        )
    }

    private fun errorCodeToStatus(code: String): Int = when (code) {
        "config", "validation" -> 400
        "not_found" -> 404
        "not_supported" -> 400
        "auth" -> 401
        "blocked", "private" -> 403
        "rate_limited" -> 429
        else -> 502
    }

    /**
     * Lê o corpo JSON da requisição.
     *
     * O `parseBody` do NanoHTTPD só preenche `postData` em POST (PUT vira
     * arquivo temporário e PATCH é descartado), então lemos o corpo bruto pelo
     * `content-length` para funcionar em todos os métodos.
     */
    private fun readJsonBody(session: IHTTPSession): JSONObject {
        val raw = readRawBody(session)
        if (raw.isBlank()) return JSONObject()
        val parsed = JSONTokener(raw).nextValue()
        return parsed as? JSONObject
            ?: throw HubException(400, "validation", "Corpo da requisição deve ser um objeto JSON.")
    }

    private fun readRawBody(session: IHTTPSession): String {
        val length = session.headers["content-length"]?.trim()?.toLongOrNull() ?: 0L
        if (length <= 0L) return ""
        if (length > MAX_BODY_BYTES) {
            throw HubException(413, "validation", "Corpo da requisição grande demais.")
        }
        val stream = session.inputStream
        val buffer = ByteArray(length.toInt())
        var read = 0
        while (read < buffer.size) {
            val count = stream.read(buffer, read, buffer.size - read)
            if (count <= 0) break
            read += count
        }
        return String(buffer, 0, read, Charsets.UTF_8)
    }

    private fun param(session: IHTTPSession, name: String): String? {
        val values = session.parameters[name] ?: return null
        return values.firstOrNull()?.takeIf { it.isNotEmpty() }
    }

    private companion object {
        val COLOR_PATTERN = Regex("^#[0-9a-fA-F]{6}$")
        val DATE_PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        const val MAX_BODY_BYTES = 16L * 1024 * 1024

        val MIME_TYPES = mapOf(
            "html" to "text/html; charset=utf-8",
            "htm" to "text/html; charset=utf-8",
            "js" to "text/javascript; charset=utf-8",
            "mjs" to "text/javascript; charset=utf-8",
            "css" to "text/css; charset=utf-8",
            "json" to "application/json; charset=utf-8",
            "map" to "application/json; charset=utf-8",
            "svg" to "image/svg+xml",
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "webp" to "image/webp",
            "gif" to "image/gif",
            "ico" to "image/x-icon",
            "woff" to "font/woff",
            "woff2" to "font/woff2",
            "ttf" to "font/ttf",
            "otf" to "font/otf",
            "txt" to "text/plain; charset=utf-8",
            "webmanifest" to "application/manifest+json",
            "mp4" to "video/mp4",
            "m4v" to "video/mp4",
            "mkv" to "video/x-matroska",
            "webm" to "video/webm",
            "mov" to "video/quicktime",
            "avi" to "video/x-msvideo",
            "m3u8" to "application/vnd.apple.mpegurl",
            "vtt" to "text/vtt; charset=utf-8"
        )
    }
}
