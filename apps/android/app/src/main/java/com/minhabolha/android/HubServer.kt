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
    private val extractor: NovelExtractor,
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

            segments == listOf("backup", "export") && method == Method.GET ->
                json(BackupService.export(database, param(session, "include")))
            segments == listOf("backup", "preview") && method == Method.POST ->
                json(BackupService.preview(database, readJsonBody(session)))
            segments == listOf("backup", "import") && method == Method.POST ->
                backupImport(session)

            segments == listOf("novels", "chapter") && method == Method.GET -> novelChapter(session)
            segments == listOf("articles", "content") && method == Method.GET -> articleContent(session)
            segments == listOf("novels", "download") && method == Method.POST -> novelDownload(session)
            segments.size == 3 && segments[0] == "novels" && segments[1] == "download" &&
                method == Method.GET -> novelDownloadStatus(segments[2])
            segments.size == 4 && segments[0] == "novels" && segments[1] == "download" &&
                segments[3] == "cancel" && method == Method.POST -> novelDownloadCancel(segments[2])
            segments == listOf("novels", "offline") && method == Method.GET ->
                json(JSONObject().put("books", database.novelOfflineBooks()))
            segments.size == 4 && segments[0] == "novels" && segments[1] == "offline" &&
                segments[2] == "books" && method == Method.GET ->
                json(
                    database.novelOfflineBook(segments[3])
                        ?: throw HubException(404, "not_found", "Livro offline não encontrado.")
                )
            segments == listOf("novels", "offline", "delete") && method == Method.POST ->
                novelOfflineDelete(session)

            segments.size == 3 && segments[0] == "sources" && segments[2] == "novel" &&
                method == Method.GET -> novelDetails(segments[1])
            segments.size == 3 && segments[0] == "sources" && segments[2] == "novel-progress" &&
                method == Method.PUT -> setNovelProgress(session, segments[1])
            segments.size == 3 && segments[0] == "sources" && segments[2] == "novel-progress" &&
                method == Method.DELETE -> clearNovelProgress(segments[1])

            segments == listOf("games") && method == Method.GET -> gamesList(session)
            segments == listOf("games", "search") && method == Method.GET -> gamesSearch(session)
            segments == listOf("games", "import") && method == Method.POST -> gamesImport(session)
            segments == listOf("games") && method == Method.POST -> gamesAdd(session)
            segments.size == 3 && segments[0] == "games" && segments[2] == "refresh-price" &&
                method == Method.POST -> gamesRefreshPrice(segments[1])
            segments.size == 2 && segments[0] == "games" && method == Method.GET ->
                json(
                    database.gameDetail(segments[1])
                        ?: throw HubException(404, "not_found", "Jogo não encontrado.")
                )
            segments.size == 2 && segments[0] == "games" && (method == Method.PATCH || method == Method.PUT) ->
                gamesUpdate(session, segments[1])
            segments.size == 2 && segments[0] == "games" && method == Method.DELETE ->
                gamesDelete(segments[1])

            segments == listOf("stremio", "status") && method == Method.GET ->
                json(StremioAccount.status(database))
            segments == listOf("stremio", "login") && method == Method.POST -> stremioLogin(session)
            segments == listOf("stremio", "auth-key") && method == Method.POST -> stremioAuthKey(session)
            segments == listOf("stremio", "disconnect") && method == Method.POST ->
                stremioDisconnect()
            segments == listOf("stremio", "sync") && method == Method.POST -> stremioSync()
            segments == listOf("stremio", "library") && method == Method.GET -> stremioLibrary(session)
            segments.size == 4 && segments[0] == "stremio" && segments[1] == "library" &&
                segments[3] == "state" && (method == Method.PATCH || method == Method.PUT) ->
                stremioLibraryState(session, segments[2])
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
            segments == listOf("stremio", "subtitle") && method == Method.GET -> stremioSubtitle(session)
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

    // ---------------------------------------------------------------------
    // Jogos
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Leitura de novels e artigos (extração via WebView)
    // ---------------------------------------------------------------------

    private fun novelChapter(session: IHTTPSession): Response {
        val url = param(session, "url")
            ?: throw HubException(400, "validation", "Informe a URL do capítulo.")

        // Offline primeiro: capítulos baixados abrem sem rede.
        val cached = database.cachedNovelChapter(url)
        if (cached != null) {
            return json(
                JSONObject()
                    .put("url", url)
                    .put("title", cached.optString("title"))
                    .put("text", cached.optString("text"))
                    .put("textWithComments", JSONObject.NULL)
                    .put("translatedText", JSONObject.NULL)
                    .put("translatedLanguage", JSONObject.NULL)
                    .put("fetchedAt", Dates.nowIso())
            )
        }

        val extracted = extractor.extract(url)
            ?: throw HubException(
                502,
                "novel",
                "Não foi possível extrair o capítulo (site bloqueado, lento ou sem texto)."
            )

        return json(
            JSONObject()
                .put("url", url)
                .put("title", extracted.title)
                .put("text", extracted.text)
                .put("textWithComments", JSONObject.NULL)
                .put("translatedText", JSONObject.NULL)
                .put("translatedLanguage", JSONObject.NULL)
                .put("fetchedAt", Dates.nowIso())
        )
    }

    // ---------------------------------------------------------------------
    // Download/offline de novels
    // ---------------------------------------------------------------------

    private fun novelDownload(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val title = body.optString("title").trim()
        val array = body.optJSONArray("chapters")
            ?: throw HubException(400, "validation", "Nenhum capítulo para baixar.")

        val chapters = mutableListOf<Triple<String, String, Int?>>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val url = item.optString("url")
            if (url.isEmpty()) continue
            chapters.add(
                Triple(
                    url,
                    item.optString("name").ifEmpty { "Capítulo" },
                    if (item.has("index") && !item.isNull("index")) item.optInt("index") else null
                )
            )
        }

        val job = NovelDownloads.start(extractor, database, title, chapters)
        val status = NovelDownloads.status(job.id)
            ?: throw HubException(500, "database", "Não foi possível iniciar o download.")
        return json(status, Response.Status.ACCEPTED)
    }

    private fun novelDownloadStatus(id: String): Response {
        val status = NovelDownloads.status(id)
            ?: throw HubException(404, "not_found", "Download não encontrado.")
        return json(status)
    }

    private fun novelDownloadCancel(id: String): Response {
        NovelDownloads.cancel(id)
        return json(NovelDownloads.status(id) ?: JSONObject().put("id", id))
    }

    private fun novelOfflineDelete(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val array = body.optJSONArray("urls") ?: JSONArray()
        val urls = mutableListOf<String>()
        for (index in 0 until array.length()) {
            val value = array.optString(index)
            if (value.isNotEmpty()) urls.add(value)
        }
        return json(JSONObject().put("removed", database.deleteNovelChapters(urls)))
    }

    // ---------------------------------------------------------------------
    // Novels: detalhes e progresso de leitura
    // ---------------------------------------------------------------------

    private fun novelDetails(sourceId: String): Response {
        val row = database.sourceRow(sourceId)
            ?: throw HubException(404, "not_found", "Fonte não encontrada.")
        if (row.type != "webnovel") {
            throw HubException(400, "not_supported", "Esta fonte não é uma novel.")
        }

        val config = parseConfig(row.config)
        val url = config.optString("url")
        if (url.isEmpty()) throw HubException(400, "validation", "A fonte não tem URL da novel.")

        val page = extractor.chapters(url)
            ?: throw HubException(502, "novel", "Não foi possível listar os capítulos agora.")
        val title = page.title.ifEmpty { config.optString("title", row.name) }

        val chapters = JSONArray()
        page.links.forEachIndexed { index, link ->
            chapters.put(
                JSONObject()
                    .put("id", link.url)
                    .put("index", index)
                    .put("name", link.title)
                    .put("publishedAt", JSONObject.NULL)
                    .put("isVip", false)
                    .put("url", link.url)
            )
        }

        val latest = page.links.lastOrNull()
        val book = JSONObject()
            .put("bookId", sourceId)
            .put("title", title)
            .put("author", JSONObject.NULL)
            .put("coverUrl", JSONObject.NULL)
            .put("description", JSONObject.NULL)
            .put("category", "Novel")
            .put("tags", JSONArray())
            .put("chapterCount", page.links.size)
            .put(
                "latestChapter",
                if (latest == null) JSONObject.NULL else JSONObject()
                    .put("id", latest.url)
                    .put("index", page.links.size - 1)
                    .put("name", latest.title)
                    .put("publishedAt", JSONObject.NULL)
                    .put("isVip", false)
                    .put("url", latest.url)
            )
            .put("url", url)

        return json(
            JSONObject()
                .put("book", book)
                .put("chapters", chapters)
                .put("progress", readNovelProgress(config) ?: JSONObject.NULL)
        )
    }

    private fun setNovelProgress(session: IHTTPSession, sourceId: String): Response {
        val row = database.sourceRow(sourceId)
            ?: throw HubException(404, "not_found", "Fonte não encontrada.")
        if (row.type != "webnovel") {
            throw HubException(400, "not_supported", "Esta fonte não é uma novel.")
        }

        val body = readJsonBody(session)
        val chapterId = body.optString("chapterId").trim()
        val chapterName = body.optString("chapterName").trim()
        if (chapterId.isEmpty() || chapterName.isEmpty()) {
            throw HubException(400, "validation", "Informe o capítulo.")
        }

        val config = parseConfig(row.config)
        config.put(
            "lastReadChapter",
            JSONObject()
                .put("chapterId", chapterId)
                .put("chapterIndex", body.optInt("chapterIndex").takeIf { body.has("chapterIndex") } ?: JSONObject.NULL)
                .put("chapterName", chapterName)
                .put("updatedAt", Dates.nowIso())
        )
        database.updateSource(sourceId, config = config)
        return json(
            database.source(sourceId)
                ?: throw HubException(500, "database", "Fonte não encontrada após salvar.")
        )
    }

    private fun clearNovelProgress(sourceId: String): Response {
        val row = database.sourceRow(sourceId)
            ?: throw HubException(404, "not_found", "Fonte não encontrada.")

        val config = parseConfig(row.config)
        config.remove("lastReadChapter")
        database.updateSource(sourceId, config = config)
        return json(
            database.source(sourceId)
                ?: throw HubException(500, "database", "Fonte não encontrada após limpar.")
        )
    }

    private fun readNovelProgress(config: JSONObject): JSONObject? {
        val value = config.optJSONObject("lastReadChapter") ?: return null
        val chapterId = value.optString("chapterId")
        val chapterName = value.optString("chapterName")
        if (chapterId.isEmpty() || chapterName.isEmpty()) return null
        return JSONObject()
            .put("chapterId", chapterId)
            .put("chapterIndex", if (value.has("chapterIndex")) value.opt("chapterIndex") else JSONObject.NULL)
            .put("chapterName", chapterName)
            .put("updatedAt", value.optString("updatedAt"))
    }

    private fun parseConfig(value: String?): JSONObject = try {
        if (value.isNullOrBlank()) JSONObject() else JSONObject(value)
    } catch (error: Exception) {
        JSONObject()
    }

    private fun articleContent(session: IHTTPSession): Response {        val url = param(session, "url")
            ?: throw HubException(400, "validation", "Informe a URL do artigo.")

        val extracted = extractor.extract(url)
            ?: throw HubException(
                502,
                "article",
                "Não foi possível extrair o artigo (site bloqueado, lento ou sem texto)."
            )

        val siteName = try {
            java.net.URL(url).host.removePrefix("www.")
        } catch (error: Exception) {
            JSONObject.NULL
        }

        return json(
            JSONObject()
                .put("url", url)
                .put("title", extracted.title)
                .put("siteName", siteName)
                .put("text", extracted.text)
                .put("fetchedAt", Dates.nowIso())
        )
    }

    private fun backupImport(session: IHTTPSession): Response {        val document = readJsonBody(session)
        if (document.optString("format") != BackupService.FORMAT) {
            throw HubException(
                400,
                "validation",
                "Arquivo de backup inválido: formato esperado \"${BackupService.FORMAT}\"."
            )
        }

        val result = BackupService.import(database, document)
        events.broadcast("backup:imported", JSONObject())
        return json(result)
    }
    private fun gamesList(session: IHTTPSession): Response {
        val filter = param(session, "filter") ?: "all"
        val sort = param(session, "sort") ?: "discount"
        val query = param(session, "q").orEmpty()

        // Com chave do gg.deals, atualiza em segundo plano os preços mais antigos.
        val key = Secrets.value(database, "ggdeals")
        if (key != null && ggRefreshing.compareAndSet(false, true)) {
            Thread {
                try {
                    val appids = database.gamesForPriceCheck(20)
                    if (appids.isNotEmpty()) {
                        val region = database.settings().optString("region", "BR")
                        database.applyGgPrices(GgDeals.fetch(appids, key, region))
                    }
                } catch (error: Exception) {
                    android.util.Log.w("MinhaBolha", "gg.deals em segundo plano falhou", error)
                } finally {
                    ggRefreshing.set(false)
                }
            }.start()
        }

        return json(database.listGames(filter, sort, query))
    }

    private fun gamesSearch(session: IHTTPSession): Response {
        val query = param(session, "q")?.trim().orEmpty()
        if (query.length < 2) {
            throw HubException(400, "validation", "Digite pelo menos 2 caracteres para buscar.")
        }
        val region = database.settings().optString("region", "BR")
        return json(JSONObject().put("results", SteamGames.search(query, region)))
    }

    private fun gamesAdd(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val appid = body.optInt("appid")
        if (appid <= 0) throw HubException(400, "validation", "Informe o appid da Steam.")

        val region = database.settings().optString("region", "BR")
        val app = SteamGames.appDetails(appid, region)
            ?: throw HubException(404, "not_found", "Jogo não encontrado na Steam.")

        val id = database.upsertSteamGame(app, inWishlist = false)
        if (body.has("targetPriceCents")) {
            val target = if (body.isNull("targetPriceCents")) null else body.optInt("targetPriceCents")
            database.updateGameTarget(id, target?.takeIf { it > 0 })
        }

        events.broadcast("games:changed", JSONObject().put("appid", appid))
        val game = database.gameDetail(id) ?: throw HubException(500, "database", "Jogo não foi salvo.")
        return json(game, Response.Status.CREATED)
    }

    private fun gamesUpdate(session: IHTTPSession, id: String): Response {
        val body = readJsonBody(session)
        val target = if (body.has("targetPriceCents")) {
            if (body.isNull("targetPriceCents")) null else body.optInt("targetPriceCents").takeIf { it > 0 }
        } else {
            throw HubException(400, "validation", "Nada para atualizar.")
        }

        val game = database.updateGameTarget(id, target)
            ?: throw HubException(404, "not_found", "Jogo não encontrado.")
        events.broadcast("games:changed", JSONObject().put("id", id))
        return json(game)
    }

    private fun gamesDelete(id: String): Response {
        if (!database.deleteGame(id)) {
            throw HubException(404, "not_found", "Jogo não encontrado.")
        }
        events.broadcast("games:changed", JSONObject().put("deleted", id))
        return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
    }

    private fun gamesRefreshPrice(id: String): Response {
        val game = database.gameDetail(id)
            ?: throw HubException(404, "not_found", "Jogo não encontrado.")
        val appid = game.optInt("appid")
        val region = database.settings().optString("region", "BR")
        val warnings = JSONArray()

        val app = SteamGames.appDetails(appid, region)
        if (app == null) {
            warnings.put("A Steam não devolveu o preço agora.")
        } else {
            database.upsertSteamGame(app, inWishlist = game.optBoolean("inWishlist"))
        }

        val key = Secrets.value(database, "ggdeals")
        if (key != null) {
            try {
                database.applyGgPrices(GgDeals.fetch(listOf(appid), key, region))
            } catch (error: Exception) {
                warnings.put("gg.deals: ${error.message}")
            }
        }

        val updated = database.gameDetail(id)
            ?: throw HubException(500, "database", "Jogo não encontrado após a atualização.")
        events.broadcast("games:changed", JSONObject().put("id", id))
        return json(JSONObject().put("game", updated).put("warnings", warnings))
    }

    private fun gamesImport(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val input = body.optString("input").trim()
        if (input.isEmpty()) throw HubException(400, "validation", "Informe o perfil da Steam.")

        val steamId = try {
            SteamGames.resolveSteamId(input)
        } catch (error: Exception) {
            throw HubException(400, "validation", error.message ?: "Perfil da Steam inválido.")
        } ?: throw HubException(400, "validation", "Perfil da Steam inválido.")

        val existing = database.sourceByType("steam-wishlist")
        val source = if (existing != null) {
            database.updateSource(existing.getString("id"), enabled = true, config = JSONObject().put("steamId", steamId))
                ?: existing
        } else {
            database.createSource(
                type = "steam-wishlist",
                name = "Wishlist da Steam",
                categoryId = "game",
                config = JSONObject().put("steamId", steamId),
                intervalMinutes = 360
            )
        }

        val queued = scheduler.enqueueSource(source.getString("id"), true)
        return json(
            JSONObject()
                .put("queued", queued)
                .put("sourceId", source.getString("id"))
                .put("name", source.optString("name")),
            Response.Status.ACCEPTED
        )
    }

    // ---------------------------------------------------------------------
    // Conta e biblioteca do Stremio
    // ---------------------------------------------------------------------

    private fun stremioLogin(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val status = StremioAccount.login(
            database,
            body.optString("email"),
            body.optString("password")
        )
        events.broadcast("stremio:changed", JSONObject().put("connected", status.optBoolean("connected")))
        StremioAccount.ensureSource(database)?.let { scheduler.enqueueSource(it.getString("id"), true) }
        return json(JSONObject().put("status", status))
    }

    private fun stremioAuthKey(session: IHTTPSession): Response {
        val body = readJsonBody(session)
        val status = StremioAccount.saveAuthKey(
            database,
            body.optString("authKey"),
            body.optString("email").takeIf { it.isNotBlank() }
        )
        events.broadcast("stremio:changed", JSONObject().put("connected", status.optBoolean("connected")))
        return json(JSONObject().put("status", status))
    }

    private fun stremioDisconnect(): Response {
        val status = StremioAccount.disconnect(database)
        events.broadcast("stremio:changed", JSONObject().put("connected", false))
        return json(status)
    }

    private fun stremioSync(): Response {
        val source = StremioAccount.ensureSource(database)
            ?: throw HubException(400, "validation", "Conecte a conta do Stremio antes de sincronizar.")
        val queued = scheduler.enqueueSource(source.getString("id"), true)
        if (!queued) {
            // Sem scheduler livre: sincroniza na hora.
            Thread {
                try {
                    StremioAccount.syncLibrary(database)
                } catch (error: Exception) {
                    android.util.Log.w("MinhaBolha", "falha ao sincronizar a biblioteca", error)
                }
            }.start()
        }
        return json(JSONObject().put("queued", queued), Response.Status.ACCEPTED)
    }

    private fun stremioLibrary(session: IHTTPSession): Response {
        val search = param(session, "search")
        return json(
            JSONObject()
                .put("items", database.stremioLibrary(search))
                .put("status", StremioAccount.status(database))
        )
    }

    private fun stremioLibraryState(session: IHTTPSession, metaId: String): Response {
        val body = readJsonBody(session)
        val result = database.setStremioLibraryState(
            metaId = metaId,
            favorite = if (body.has("isFavorite")) body.optBoolean("isFavorite") else null,
            watchLater = if (body.has("isWatchLater")) body.optBoolean("isWatchLater") else null,
            inLibrary = if (body.has("inLibrary")) body.optBoolean("inLibrary") else null,
            type = body.optString("type").ifEmpty { null },
            name = body.optString("name").ifEmpty { null },
            poster = body.optString("poster").ifEmpty { null }
        )
        events.broadcast("stremio:changed", JSONObject().put("state", metaId))
        return json(result)
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
        val type = param(session, "type")
            ?: throw HubException(400, "validation", "Informe o tipo do título.")
        val id = param(session, "id")
            ?: throw HubException(400, "validation", "Informe o título.")

        return json(
            StremioSubtitles.fetch(
                database = database,
                type = type,
                id = id,
                season = param(session, "season")?.toIntOrNull(),
                episode = param(session, "episode")?.toIntOrNull(),
                videoId = param(session, "videoId")
            )
        )
    }

    private fun stremioSubtitle(session: IHTTPSession): Response {
        val url = param(session, "url")
            ?: throw HubException(400, "validation", "Informe a URL da legenda.")
        val vtt = StremioSubtitles.proxy(url)
        val response = newFixedLengthResponse(
            Response.Status.OK,
            "text/vtt; charset=utf-8",
            vtt
        )
        response.addHeader("Cache-Control", "private, max-age=3600")
        return response
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
        const val MAX_BODY_BYTES = 32L * 1024 * 1024
        val ggRefreshing = java.util.concurrent.atomic.AtomicBoolean(false)

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
