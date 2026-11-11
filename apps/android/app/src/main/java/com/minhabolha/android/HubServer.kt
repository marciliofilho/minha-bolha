package com.minhabolha.android

import android.content.Context
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

        return when {
            path == "/health" && method == Method.GET -> health()
            path == "/status" && method == Method.GET -> status()
            path == "/events" && method == Method.GET -> events()

            path == "/settings" && method == Method.GET -> json(database.settings())
            path == "/settings" && (method == Method.PATCH || method == Method.PUT) ->
                json(database.updateSettings(readJsonBody(session)))

            path == "/categories" && method == Method.GET ->
                json(JSONObject().put("categories", database.categories()))
            path == "/categories" && method == Method.POST -> createCategory(session)

            path == "/sources" && method == Method.GET ->
                json(JSONObject().put("sources", database.sources()))

            path == "/feed" && method == Method.GET -> feed(session)
            path == "/feed/counts" && method == Method.GET ->
                json(JSONObject().put("counts", database.counts()))
            path == "/feed/mark-all-read" && method == Method.POST -> markAllRead(session)

            path.startsWith("/items/") && method == Method.GET -> {
                val id = path.removePrefix("/items/")
                val item = database.item(id)
                    ?: throw HubException(404, "not_found", "Item não encontrado.")
                json(item)
            }

            path.startsWith("/items/") && (method == Method.PATCH || method == Method.PUT) -> {
                val id = path.removePrefix("/items/")
                val item = database.updateItemFlags(id, readJsonBody(session))
                    ?: throw HubException(404, "not_found", "Item não encontrado.")
                json(item)
            }

            path in KNOWN_API_PATHS || path.startsWith("/items/") ->
                throw HubException(405, "method_not_allowed", "Método não permitido.")

            else -> throw HubException(
                404,
                "not_found",
                "Rota não encontrada: ${session.uri}"
            )
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
                .put("refresh", JSONObject().put("active", 0).put("queued", 0))
                .put("keys", JSONObject().put("tmdb", false).put("steam", false).put("ggdeals", false))
                .put("demo", counts.optBoolean("demo"))
        )
    }

    private fun events(): Response {
        val response = newChunkedResponse(
            Response.Status.OK,
            "text/event-stream; charset=utf-8",
            EventStream()
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
        val category = database.createCategory(label, icon, color)
        return json(category, Response.Status.CREATED)
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

    private fun json(payload: JSONArray): Response {
        return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", payload.toString())
    }

    private fun jsonError(status: Int, message: String, code: String): Response {
        val payload = JSONObject().put("error", message).put("code", code)
        return newFixedLengthResponse(
            Response.Status.lookup(status) ?: Response.Status.INTERNAL_ERROR,
            "application/json; charset=utf-8",
            payload.toString()
        )
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

        val KNOWN_API_PATHS = setOf(
            "/health",
            "/status",
            "/events",
            "/settings",
            "/categories",
            "/sources",
            "/feed",
            "/feed/counts",
            "/feed/mark-all-read"
        )
    }
}
