package com.minhabolha.android

import android.util.Log
import com.minhabolha.android.connectors.Http
import org.json.JSONArray
import org.json.JSONObject

/**
 * Verifica as releases do Android no GitHub.
 *
 * As builds usam tags `android-vX.Y.Z-alphaN`. A API de releases devolve
 * também os releases do desktop (`vX.Y.Z`) e pré-releases, então filtramos
 * apenas as tags do Android e escolhemos a maior versão.
 */
object UpdateChecker {

    private const val TAG = "MinhaBolha"
    private const val API =
        "https://api.github.com/repos/marciliofilho/minha-bolha/releases?per_page=30"
    private const val PREFIX = "android-v"
    private const val CACHE_MS = 10 * 60 * 1000L

    @Volatile private var cached: JSONObject? = null
    @Volatile private var cachedAt = 0L

    fun check(force: Boolean = false): JSONObject {
        val now = System.currentTimeMillis()
        cached?.let { if (!force && now - cachedAt < CACHE_MS) return it }

        val current = BuildConfig.VERSION_NAME
        val result = JSONObject().put("current", current).put("available", false)
        try {
            val response = Http.fetchText(
                API,
                accept = "application/vnd.github+json",
                headers = mapOf(
                    "User-Agent" to "MinhaBolha-Android",
                    "X-GitHub-Api-Version" to "2022-11-28"
                ),
                timeoutMs = 20_000
            )
            val releases = JSONArray(response.text)
            var bestVersion: String? = null
            var bestRelease: JSONObject? = null
            for (index in 0 until releases.length()) {
                val release = releases.optJSONObject(index) ?: continue
                val tag = release.optString("tag_name")
                if (!tag.startsWith(PREFIX)) continue
                val version = tag.removePrefix(PREFIX).trim()
                if (!isNewer(version, current)) continue
                if (bestVersion == null || isNewer(version, bestVersion)) {
                    bestVersion = version
                    bestRelease = release
                }
            }

            if (bestVersion != null && bestRelease != null) {
                val asset = findApkAsset(bestRelease)
                result
                    .put("available", true)
                    .put("version", bestVersion)
                    .put("url", bestRelease.optString("html_url"))
                    .put("apkUrl", asset?.optString("browser_download_url") ?: JSONObject.NULL)
                    .put("notes", bestRelease.optString("body"))
            }
        } catch (error: Exception) {
            Log.w(TAG, "falha ao verificar atualizações", error)
            result.put("error", error.message ?: "Falha ao verificar atualizações.")
        }

        cached = result
        cachedAt = now
        return result
    }

    private fun findApkAsset(release: JSONObject): JSONObject? {
        val assets = release.optJSONArray("assets") ?: return null
        // Universal instala em qualquer aparelho; arm64 é o fallback.
        for (suffix in listOf("universal-release.apk", "arm64-v8a-release.apk")) {
            for (index in 0 until assets.length()) {
                val asset = assets.optJSONObject(index) ?: continue
                if (asset.optString("name").endsWith(suffix)) return asset
            }
        }
        return null
    }

    private data class ParsedVersion(val parts: List<Int>, val stage: String, val build: Int)

    private fun parseVersion(value: String): ParsedVersion {
        val main = value.substringBefore('-').trim()
        val parts = main.split('.').map { it.toIntOrNull() ?: 0 }
        val suffix = value.substringAfter('-', "").trim()
        val stage = suffix.takeWhile { it.isLetter() }
        val build = suffix.dropWhile { it.isLetter() }.toIntOrNull() ?: 0
        return ParsedVersion(parts, stage, build)
    }

    private fun isNewer(candidate: String, current: String): Boolean {
        val next = parseVersion(candidate)
        val base = parseVersion(current)
        val size = maxOf(next.parts.size, base.parts.size)
        for (index in 0 until size) {
            val left = next.parts.getOrElse(index) { 0 }
            val right = base.parts.getOrElse(index) { 0 }
            if (left != right) return left > right
        }
        val stageRank = mapOf("" to 3, "rc" to 2, "beta" to 1, "alpha" to 0)
        val leftStage = stageRank[next.stage.lowercase()] ?: 0
        val rightStage = stageRank[base.stage.lowercase()] ?: 0
        if (leftStage != rightStage) return leftStage > rightStage
        return next.build > base.build
    }
}
