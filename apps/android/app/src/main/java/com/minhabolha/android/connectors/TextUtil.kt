package com.minhabolha.android.connectors

import java.net.URL
import java.security.MessageDigest

/** Helpers de texto/HTML compartilhados entre conectores (espelho de `util.ts`). */
object TextUtil {

    private val ENTITIES = mapOf(
        "amp" to "&",
        "lt" to "<",
        "gt" to ">",
        "quot" to "\"",
        "apos" to "'",
        "nbsp" to " ",
        "hellip" to "…",
        "mdash" to "—",
        "ndash" to "–",
        "rsquo" to "’",
        "lsquo" to "‘",
        "ldquo" to "“",
        "rdquo" to "”"
    )

    private val ENTITY_PATTERN = Regex("&(#x?[0-9a-fA-F]+|[a-zA-Z]+);")

    fun decodeEntities(value: String): String = ENTITY_PATTERN.replace(value) { match ->
        val entity = match.groupValues[1]
        when {
            entity.startsWith("#x", true) -> {
                val code = entity.substring(2).toIntOrNull(16)
                code?.let { String(Character.toChars(it)) } ?: match.value
            }

            entity.startsWith("#") -> {
                val code = entity.substring(1).toIntOrNull()
                code?.let { String(Character.toChars(it)) } ?: match.value
            }

            else -> ENTITIES[entity.lowercase()] ?: match.value
        }
    }

    private val SCRIPT_STYLE = Regex("<(script|style)[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE)
    private val TAGS = Regex("<[^>]+>")
    private val SPACES = Regex("\\s+")

    /** Remove tags e normaliza espaços, para descrições em texto puro. */
    fun stripHtml(value: String?): String {
        if (value.isNullOrEmpty()) return ""
        val withoutTags = TAGS.replace(SCRIPT_STYLE.replace(value, " "), " ")
        return SPACES.replace(decodeEntities(withoutTags), " ").trim()
    }

    fun truncate(value: String, max: Int = 320): String {
        if (value.length <= max) return value
        return value.substring(0, max - 1).trimEnd() + "…"
    }

    fun absoluteUrl(value: String?, baseUrl: String?): String? {
        if (value.isNullOrBlank()) return null
        return try {
            if (baseUrl.isNullOrBlank()) URL(value).toString() else URL(URL(baseUrl), value).toString()
        } catch (error: Exception) {
            null
        }
    }

    /** Hash curto e estável usado em dedupe de links/guids. */
    fun shortHash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xFF) }.take(20)
    }

    private val IMG_SRC = Regex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)

    fun firstImageFromHtml(html: String?, baseUrl: String?): String? {
        if (html.isNullOrBlank()) return null
        val match = IMG_SRC.find(html) ?: return null
        return absoluteUrl(match.groupValues[1], baseUrl)
    }

    fun looksLikeHtml(body: String): Boolean {
        val head = body.take(600).lowercase()
        if (head.contains("<rss") || head.contains("<feed") || head.contains("<rdf")) return false
        return head.contains("<!doctype html") || head.contains("<html")
    }
}
