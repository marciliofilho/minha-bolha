package com.minhabolha.android

import android.util.Log
import com.minhabolha.android.connectors.Connector
import com.minhabolha.android.connectors.ConnectorError
import com.minhabolha.android.connectors.Registry
import com.minhabolha.android.connectors.SourceRow
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Scheduler próprio, espelhando `apps/api/src/scheduler.ts`:
 * - tick a cada 30s procurando fontes vencidas;
 * - concorrência limitada (2 por vez);
 * - jitter para não bater tudo no mesmo segundo;
 * - backoff exponencial em caso de falha;
 * - intervalo mínimo por tipo de conector.
 */
class HubScheduler(
    private val database: HubDatabase,
    private val events: EventHub
) {

    private companion object {
        const val TAG = "MinhaBolha"
        const val MAX_CONCURRENT = 2
        const val TICK_SECONDS = 30L
        const val MAX_BACKOFF_MS = 24 * 60 * 60 * 1000L
        val FEED_REFRESH_TYPES = setOf("youtube", "rss", "webnovel", "custom")
    }

    private val workers = Executors.newFixedThreadPool(MAX_CONCURRENT)
    private val running = ConcurrentHashMap.newKeySet<String>()
    private val queue = ArrayDeque<String>()
    private var active = 0
    private var ticker: ScheduledExecutorService? = null

    @Volatile
    private var started = false

    fun start() {
        if (started) return
        started = true
        spreadInitialSchedule()
        tick()

        ticker = Executors.newSingleThreadScheduledExecutor().also { scheduler ->
            scheduler.scheduleWithFixedDelay(
                { tick() },
                TICK_SECONDS,
                TICK_SECONDS,
                TimeUnit.SECONDS
            )
        }
        Log.i(TAG, "scheduler ativo (tick ${TICK_SECONDS}s, concorrência $MAX_CONCURRENT)")
    }

    fun stop() {
        ticker?.shutdownNow()
        ticker = null
        workers.shutdownNow()
        started = false
    }

    @Synchronized
    fun refreshState(): JSONObject = JSONObject()
        .put("active", active)
        .put("queued", queue.size)

    @Synchronized
    fun enqueueSource(sourceId: String, manual: Boolean): Boolean {
        if (running.contains(sourceId) || queue.contains(sourceId)) return false
        queue.addLast(sourceId)
        events.broadcast("refresh:state", refreshState())
        pump()
        return true
    }

    fun enqueueAll(manual: Boolean): Int {
        var count = 0
        for (row in database.allSourceRows()) {
            // Fontes de demonstração não entram no "atualizar tudo".
            if (row.isDemo) continue
            if (enqueueSource(row.id, manual)) count++
        }
        return count
    }

    @Synchronized
    private fun pump() {
        while (active < MAX_CONCURRENT && queue.isNotEmpty()) {
            val sourceId = queue.removeFirst()
            if (running.contains(sourceId)) continue

            active++
            running.add(sourceId)
            events.broadcast("refresh:state", refreshState())

            workers.execute {
                try {
                    runSource(sourceId)
                } catch (error: Exception) {
                    Log.e(TAG, "erro não tratado no job $sourceId", error)
                } finally {
                    synchronized(this) {
                        running.remove(sourceId)
                        active--
                        events.broadcast("refresh:state", refreshState())
                        pump()
                    }
                }
            }
        }
    }

    private fun tick() {
        try {
            for (row in database.dueSources(10)) {
                enqueueSource(row.id, false)
            }
        } catch (error: Exception) {
            Log.e(TAG, "falha no tick do scheduler", error)
        }
    }

    /** Ao iniciar, espalha as fontes atrasadas para evitar uma rajada. */
    private fun spreadInitialSchedule() {
        val now = System.currentTimeMillis()
        for (row in database.allSourceRows()) {
            val next = Dates.parseIsoMillis(row.nextRunAt)
            if (next != null && next > now) continue
            val delay = 5_000L + (Math.random() * 120_000).toLong()
            database.setNextRun(row.id, Dates.iso(now + delay))
        }
    }

    private fun runSource(sourceId: String) {
        val row = database.sourceRow(sourceId) ?: return
        if (!row.enabled) return

        val connector: Connector = try {
            Registry.get(row.type)
        } catch (error: ConnectorError) {
            recordUnsupported(row, error.message ?: "Conector indisponível.")
            return
        }

        val settings = database.settings()
        val startedAt = Dates.nowIso()
        val startMs = System.currentTimeMillis()
        val runId = database.startRun(sourceId, startedAt)
        val intervalMs = effectiveIntervalMs(row, connector, settings.optInt("feedRefreshSeconds", 300))

        try {
            val config = parseObject(row.config)
            val state = row.state?.let { parseObject(it) }
            val result = connector.fetch(row, config, state, settings)

            // Títulos acompanhados alimentam o calendário e podem gerar itens
            // de feed quando um lançamento/episódio acontece.
            val generated = result.items.toMutableList()
            val timezone = settings.optString("timezone", "America/Sao_Paulo")
            if (result.media != null) {
                val media = database.upsertMedia(row.id, result.media)
                if (result.releaseEvents.isNotEmpty()) {
                    database.upsertReleaseEvents(
                        media.id,
                        result.releaseEvents,
                        Dates.todayInZone(timezone)
                    )
                    generated.addAll(
                        ReleaseItems.forSource(database, row, media, result.releaseEvents, timezone)
                    )
                    events.broadcast(
                        "calendar:changed",
                        JSONObject().put("sourceId", row.id)
                    )
                }
            }

            // Calendário global: substitui apenas os provedores que responderam.
            if (result.globalReleases.isNotEmpty() && result.globalReleaseProviders.isNotEmpty()) {
                val saved = database.replaceGlobalReleases(
                    result.globalReleases,
                    result.globalReleaseProviders
                )
                events.broadcast(
                    "calendar:changed",
                    JSONObject().put("saved", saved).put("sourceId", row.id)
                )
                Log.i(TAG, "calendário global: $saved lançamento(s)")
            }

            if (result.warnings.isNotEmpty()) {
                Log.w(TAG, "${row.name}: ${result.warnings.joinToString(" ")}")
            }

            val inserted = database.insertItems(row.id, row.categoryId, generated)
            val checkedAt = Dates.nowIso()

            database.recordSuccess(
                id = row.id,
                state = result.state.toString(),
                nextRunAt = jitteredNextRun(intervalMs),
                checkedAt = checkedAt
            )
            database.finishRun(
                id = runId,
                ok = true,
                itemsFound = result.items.size,
                itemsNew = inserted,
                errorCode = null,
                errorMessage = null,
                durationMs = System.currentTimeMillis() - startMs
            )

            events.broadcast(
                "source:status",
                JSONObject()
                    .put("sourceId", row.id)
                    .put("ok", true)
                    .put("itemsNew", inserted)
                    .put("lastCheckedAt", checkedAt)
            )
            if (inserted > 0) {
                events.broadcast(
                    "items:new",
                    JSONObject()
                        .put("sourceId", row.id)
                        .put("count", inserted)
                )
            }

            Log.i(TAG, "${row.name}: ${generated.size} item(ns), $inserted novo(s)")
        } catch (error: Exception) {
            val code = if (error is ConnectorError) error.code else "unknown"
            val message = error.message ?: error.javaClass.simpleName
            val failures = row.consecutiveFailures + 1
            val checkedAt = Dates.nowIso()

            database.recordFailure(
                id = row.id,
                code = code,
                message = message,
                consecutiveFailures = failures,
                nextRunAt = failureNextRun(intervalMs, failures, code),
                checkedAt = checkedAt
            )
            database.finishRun(
                id = runId,
                ok = false,
                itemsFound = 0,
                itemsNew = 0,
                errorCode = code,
                errorMessage = message,
                durationMs = System.currentTimeMillis() - startMs
            )

            events.broadcast(
                "source:status",
                JSONObject()
                    .put("sourceId", row.id)
                    .put("ok", false)
                    .put("errorCode", code)
                    .put("errorMessage", message)
                    .put("lastCheckedAt", checkedAt)
            )

            Log.w(TAG, "${row.name}: $code — $message")
        }
    }

    private fun recordUnsupported(row: SourceRow, message: String) {
        val checkedAt = Dates.nowIso()
        database.recordFailure(
            id = row.id,
            code = "not_supported",
            message = message,
            consecutiveFailures = row.consecutiveFailures + 1,
            nextRunAt = failureNextRun(60 * 60_000L, row.consecutiveFailures + 1, "not_supported"),
            checkedAt = checkedAt
        )
        events.broadcast(
            "source:status",
            JSONObject()
                .put("sourceId", row.id)
                .put("ok", false)
                .put("errorCode", "not_supported")
                .put("errorMessage", message)
                .put("lastCheckedAt", checkedAt)
        )
    }

    private fun effectiveInterval(row: SourceRow, connector: Connector): Int =
        maxOf(row.intervalMinutes, connector.defaultIntervalMinutes, connector.minIntervalMinutes, 5)

    private fun effectiveIntervalMs(row: SourceRow, connector: Connector, feedRefreshSeconds: Int): Long {
        if (FEED_REFRESH_TYPES.contains(row.type)) {
            return maxOf(feedRefreshSeconds, 60) * 1000L
        }
        return effectiveInterval(row, connector) * 60_000L
    }

    private fun jitteredNextRun(intervalMs: Long, extraDelayMs: Long = 0): String {
        val jitter = 0.9 + Math.random() * 0.2
        val initialSpread = extraDelayMs + Math.random() * minOf(120_000L, (intervalMs * 0.2).toLong())
        return Dates.iso(System.currentTimeMillis() + (intervalMs * jitter).toLong() + initialSpread.toLong())
    }

    private fun failureNextRun(intervalMs: Long, failures: Int, code: String): String {
        val exponent = (failures - 1).coerceIn(0, 5)
        var delay = intervalMs * (1L shl exponent)
        if (code == "blocked" || code == "private" || code == "layout_changed") {
            delay = maxOf(delay, 6 * 60 * 60_000L)
        }
        delay = minOf(delay, MAX_BACKOFF_MS)
        return Dates.iso(System.currentTimeMillis() + delay + (Math.random() * 60_000).toLong())
    }

    private fun parseObject(value: String): JSONObject = try {
        JSONTokener(value).nextValue() as? JSONObject ?: JSONObject()
    } catch (error: Exception) {
        JSONObject()
    }
}
