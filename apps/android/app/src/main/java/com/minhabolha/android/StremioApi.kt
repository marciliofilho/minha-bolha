package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Http
import org.json.JSONArray
import org.json.JSONObject

/** Item da biblioteca do Stremio (somente leitura). */
data class StremioLibraryItem(
    val metaId: String,
    val imdbId: String?,
    val type: String,
    val name: String,
    val poster: String?,
    val videoId: String?,
    val season: Int?,
    val episode: Int?,
    val timeOffsetMs: Long?,
    val durationMs: Long?,
    val watchedVideoId: String?,
    val lastWatchedAt: String?,
    val removed: Boolean,
    val temp: Boolean,
    val raw: String?
)

/**
 * Cliente da conta do Stremio (endpoints usados pelo app oficial).
 *
 * Só faz login e leitura da biblioteca; a senha nunca é persistida e o authKey
 * fica cifrado com o Android Keystore.
 */
object StremioApi {

    private const val BASE = "https://api.strem.io/api"

    private fun postRaw(path: String, body: JSONObject): Any? {
        val response = try {
            Http.postJson(
                "$BASE/$path",
                body.toString(),
                headers = mapOf("accept" to "application/json"),
                retries = 1
            )
        } catch (error: Exception) {
            throw ConnectorError("network", "Não foi possível falar com o Stremio. Verifique a conexão.")
        }

        val payload = try {
            JSONObject(response.text)
        } catch (error: Exception) {
            throw ConnectorError("layout_changed", "O Stremio devolveu uma resposta inesperada.")
        }

        val error = payload.optJSONObject("error")
        if (error != null) {
            val message = error.optString("message")
            val authFailure = path == "login" || path == "datastoreGet" ||
                Regex("auth|credential|password|login|user|session|token|key|expired", RegexOption.IGNORE_CASE)
                    .containsMatchIn(message)
            throw ConnectorError(
                if (authFailure) "auth" else "network",
                if (authFailure) "E-mail, senha ou chave de sessão inválidos."
                else "O Stremio recusou a requisição."
            )
        }

        return payload.opt("result")
    }

    private fun postObject(path: String, body: JSONObject): JSONObject =
        postRaw(path, body) as? JSONObject
            ?: throw ConnectorError("layout_changed", "O Stremio não devolveu dados.")

    fun login(email: String, password: String): Pair<String, String> {
        val result = postObject("login", JSONObject().put("email", email).put("password", password))
        val authKey = result.optString("authKey")
        if (authKey.isEmpty()) {
            throw ConnectorError("auth", "O Stremio não retornou uma chave de sessão.")
        }
        val userEmail = result.optJSONObject("user")?.optString("email").orEmpty().ifEmpty { email }
        return authKey to userEmail
    }

    fun fetchLibrary(authKey: String): List<StremioLibraryItem> {
        val result = postRaw(
            "datastoreGet",
            JSONObject()
                .put("authKey", authKey)
                .put("collection", "libraryItem")
                .put("all", true)
        )

        val entries: JSONArray = when (result) {
            is JSONArray -> result
            is JSONObject -> result.optJSONArray("library")
                ?: result.optJSONArray("items")
                ?: JSONArray()
            else -> JSONArray()
        }

        val mapped = mutableListOf<StremioLibraryItem>()
        for (index in 0 until entries.length()) {
            val item = entries.optJSONObject(index) ?: continue
            mapItem(item)?.let { mapped.add(it) }
        }
        return mapped
    }

    private fun mapItem(item: JSONObject): StremioLibraryItem? {
        val metaId = item.optString("_id").trim()
        if (metaId.isEmpty()) return null
        val type = item.optString("type")
        if (type != "movie" && type != "series") return null

        val state = item.optJSONObject("state")
        val videoId = state?.optString("video_id")?.takeIf { it.isNotEmpty() }
        val parts = videoId?.split(':').orEmpty()
        val seasonFromVideo = if (parts.size >= 3) parts[1].toIntOrNull() else null
        val episodeFromVideo = if (parts.size >= 3) parts[2].toIntOrNull() else null

        val imdbCandidate = metaId.substringBefore(':')
        val imdbId = if (Regex("^tt\\d{7,10}$", RegexOption.IGNORE_CASE).matches(imdbCandidate)) {
            imdbCandidate
        } else {
            null
        }

        return StremioLibraryItem(
            metaId = metaId,
            imdbId = imdbId,
            type = type,
            name = item.optText("name") ?: metaId,
            poster = item.optText("poster"),
            videoId = videoId,
            season = state?.optInt("season")?.takeIf { it > 0 } ?: seasonFromVideo,
            episode = state?.optInt("episode")?.takeIf { it > 0 } ?: episodeFromVideo,
            timeOffsetMs = state?.optLong("timeOffset")?.takeIf { it > 0 },
            durationMs = state?.optLong("duration")?.takeIf { it > 0 },
            watchedVideoId = state?.optString("watched")?.takeIf { it.isNotEmpty() },
            lastWatchedAt = state?.optString("lastWatched")?.takeIf { it.isNotEmpty() },
            removed = item.optBoolean("removed"),
            temp = item.optBoolean("temp"),
            raw = item.toString()
        )
    }
}
