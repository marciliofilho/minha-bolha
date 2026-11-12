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

    // ---------------------------------------------------------------------
    // Datas locais (fuso configurado) — o calendário agrupa por dia local.
    // ---------------------------------------------------------------------

    private fun zoneOf(timeZone: String?): java.time.ZoneId = try {
        if (timeZone.isNullOrBlank()) ZoneOffset.UTC else java.time.ZoneId.of(timeZone)
    } catch (error: Exception) {
        ZoneOffset.UTC
    }

    /** Data YYYY-MM-DD de um instante no fuso informado. */
    fun dateInZone(instant: Instant, timeZone: String?): String =
        DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(zoneOf(timeZone)).format(instant)

    /** Hora HH:mm de um instante no fuso informado. */
    fun timeInZone(instant: Instant, timeZone: String?): String =
        DateTimeFormatter.ofPattern("HH:mm").withZone(zoneOf(timeZone)).format(instant)

    fun todayInZone(timeZone: String?): String = dateInZone(Instant.now(), timeZone)

    /** Soma dias a uma data YYYY-MM-DD. */
    fun addDaysToDate(date: String, days: Long): String = try {
        java.time.LocalDate.parse(date).plusDays(days).toString()
    } catch (error: Exception) {
        date
    }

    /** Converte YYYY-MM-DD (meio-dia UTC) em ISO. */
    fun dateToIso(date: String): String = try {
        java.time.LocalDate.parse(date).atStartOfDay().plusHours(12).toInstant(ZoneOffset.UTC).let { ISO.format(it) }
    } catch (error: Exception) {
        "$date" + "T12:00:00.000Z"
    }

    /**
     * Normaliza datas em vários formatos para ISO UTC.
     *
     * Feeds RSS costumam usar RFC 822/1123 ("Thu, 12 Nov 2026 09:28:00 GMT"),
     * enquanto Atom usa ISO 8601. Sem o RFC 1123 todos os itens de um feed RSS
     * ficavam com a data de descoberta.
     */
    fun safeIso(value: String?, fallback: String): String {
        if (value.isNullOrBlank()) return fallback
        return parseInstant(value.trim())?.let { ISO.format(it) } ?: fallback
    }

    private fun parseInstant(value: String): Instant? {
        val attempts = listOf<() -> Instant>(
            { java.time.OffsetDateTime.parse(value).toInstant() },
            { java.time.ZonedDateTime.parse(value).toInstant() },
            {
                java.time.ZonedDateTime
                    .parse(value, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)
                    .toInstant()
            },
            {
                java.time.LocalDateTime
                    .parse(value, java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                    .toInstant(ZoneOffset.UTC)
            },
            { java.time.LocalDateTime.parse(value).toInstant(ZoneOffset.UTC) },
            {
                java.time.LocalDate.parse(value.take(10))
                    .atStartOfDay()
                    .toInstant(ZoneOffset.UTC)
            }
        )

        for (attempt in attempts) {
            try {
                return attempt()
            } catch (error: Exception) {
                // tenta o próximo formato
            }
        }
        return null
    }
}
