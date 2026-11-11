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
            .put("keys", JSONObject().put("tmdb", false).put("steam", false).put("ggdeals", false))
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
                .put("keys", JSONObject().put("tmdb", false).put("steam", false).put("ggdeals", false))
                .put("demo", counts.optBoolean("demo"))
        )
    }

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

    private fun readJsonBody(session: IHTTPSession): JSONObject {
        val files = HashMap<String, String>()
        try {
            session.parseBody(files)
        } catch (error: Exception) {
            throw HubException(400, "validation", "Não foi possível ler o corpo da requisição.")
        }
        val raw = files["postData"].orEmpty()
        if (raw.isBlank()) return JSONObject()
        val parsed = JSONTokener(raw).nextValue()
        return parsed as? JSONObject
            ?: throw HubException(400, "validation", "Corpo da requisição deve ser um objeto JSON.")
    }

    private fun param(session: IHTTPSession, name: String): String? {
        val values = session.parameters[name] ?: return null
        return values.firstOrNull()?.takeIf { it.isNotEmpty() }
    }

    private companion object {
        val COLOR_PATTERN = Regex("^#[0-9a-fA-F]{6}$")

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
            "m3u8" to "application/vnd.apple.mpegurl",
            "vtt" to "text/vtt; charset=utf-8"
        )
    }
}
