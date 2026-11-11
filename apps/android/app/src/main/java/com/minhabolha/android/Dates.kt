package com.minhabolha.android

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Datas em UTC no formato ISO 8601, igual ao desktop. */
object Dates {

    private val ISO: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun nowIso(): String = ISO.format(Instant.now())

    fun iso(millis: Long): String = ISO.format(Instant.ofEpochMilli(millis))

    /** Limite ISO para filtrar itens antigos do feed. */
    fun feedCutoffIso(hours: Int): String {
        val safeHours = hours.coerceIn(1, 168)
        return ISO.format(Instant.now().minusSeconds(safeHours * 3600L))
    }

    /** Interpreta um ISO 8601 e devolve millis, ou null se inválido. */
    fun parseIsoMillis(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return try {
            Instant.parse(value).toEpochMilli()
        } catch (error: Exception) {
            null
        }
    }

    /** Normaliza datas em vários formatos para ISO UTC. */
    fun safeIso(value: String?, fallback: String): String {
        if (value.isNullOrBlank()) return fallback
        val trimmed = value.trim()
        val parsed = try {
            java.time.OffsetDateTime.parse(trimmed).toInstant()
        } catch (error: Exception) {
            try {
                java.time.LocalDateTime.parse(trimmed).toInstant(ZoneOffset.UTC)
            } catch (error2: Exception) {
                try {
                    java.time.LocalDate.parse(trimmed.take(10))
                        .atStartOfDay()
                        .toInstant(ZoneOffset.UTC)
                } catch (error3: Exception) {
                    null
                }
            }
        }
        return parsed?.let { ISO.format(it) } ?: fallback
    }
}
