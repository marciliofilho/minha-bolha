package com.minhabolha.android

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Download de capítulos de novels para leitura offline.
 *
 * Usa o mesmo extrator (WebView) do leitor, um capítulo por vez, e guarda o
 * texto em `novel_cache` com validade longa — assim o capítulo abre sem rede.
 */
object NovelDownloads {

    private const val MAX_CHAPTERS = 100
    private const val OFFLINE_YEARS_MS = 10L * 365 * 24 * 60 * 60 * 1000

    data class ChapterState(
        val url: String,
        val name: String,
        val index: Int?
    ) {
        @Volatile var status: String = "queued"
        @Volatile var error: String? = null
    }

    class Job(
        val id: String,
        val title: String,
        val total: Int,
        val chapters: List<Triple<String, String, Int?>>,
        val startedAt: String = Dates.nowIso()
    ) {
        @Volatile var done: Int = 0
        @Volatile var failed: Int = 0
        @Volatile var current: String? = null
        @Volatile var status: String = "running"
        @Volatile var error: String? = null
        @Volatile var finishedAt: String? = null
        val states: List<ChapterState> = chapters.map { (url, name, index) ->
            ChapterState(url, name, index)
        }
    }

    private val jobs = ConcurrentHashMap<String, Job>()
    private val executor = Executors.newSingleThreadExecutor()

    fun start(
        extractor: NovelExtractor,
        database: HubDatabase,
        title: String,
        chapters: List<Triple<String, String, Int?>>
    ): Job {
        if (chapters.isEmpty()) throw HubException(400, "validation", "Nenhum capítulo para baixar.")
        val limited = chapters.take(MAX_CHAPTERS)
        val job = Job(UUID.randomUUID().toString(), title.ifEmpty { "Novel" }, limited.size, limited)
        jobs[job.id] = job

        executor.execute {
            try {
                for ((position, chapter) in limited.withIndex()) {
                    if (job.status != "running") break
                    val (url, name, index) = chapter
                    val state = job.states.getOrNull(position)
                    job.current = name
                    state?.status = "downloading"
                    val extracted = try {
                        extractor.extract(url)
                    } catch (error: Exception) {
                        state?.error = error.message
                        null
                    }
                    if (extracted == null) {
                        job.failed++
                        state?.status = "failed"
                        if (state?.error.isNullOrBlank()) state?.error = "Falhou ao baixar."
                        continue
                    }
                    database.cacheNovelChapter(
                        url = url,
                        title = extracted.title.ifEmpty { name },
                        text = extracted.text,
                        bookTitle = job.title,
                        chapterIndex = index,
                        expiresAt = Dates.iso(System.currentTimeMillis() + OFFLINE_YEARS_MS)
                    )
                    job.done++
                    state?.status = "done"
                }
                if (job.status == "running") job.status = "done"
            } catch (error: Exception) {
                job.error = error.message
                job.status = "failed"
            } finally {
                job.current = null
                job.finishedAt = Dates.nowIso()
            }
        }

        return job
    }

    /** Recomeça um job parado/falho com os mesmos capítulos. */
    fun retry(extractor: NovelExtractor, database: HubDatabase, id: String): Job? {
        val job = jobs[id] ?: return null
        if (job.status == "running") return job
        return start(extractor, database, job.title, job.chapters)
    }

    fun status(id: String): JSONObject? {
        val job = jobs[id] ?: return null
        val chapters = JSONArray()
        val errors = JSONArray()
        for (state in job.states) {
            chapters.put(
                JSONObject()
                    .put("url", state.url)
                    .put("name", state.name)
                    .put("status", state.status)
                    .put("error", state.error ?: JSONObject.NULL)
            )
            state.error?.let { errors.put("${state.name}: $it") }
        }
        return JSONObject()
            .put("id", job.id)
            .put("title", job.title)
            .put("status", job.status)
            .put("language", "pt")
            .put("total", job.total)
            .put("completed", job.done)
            .put("done", job.done)
            .put("failed", job.failed)
            .put("current", job.current ?: JSONObject.NULL)
            .put("error", job.error ?: JSONObject.NULL)
            .put("chapters", chapters)
            .put("errors", errors)
            .put("startedAt", job.startedAt)
            .put("finishedAt", job.finishedAt ?: JSONObject.NULL)
    }

    fun cancel(id: String) {
        jobs[id]?.status = "canceled"
    }

    fun jobsSnapshot(): JSONArray {
        val array = JSONArray()
        for (job in jobs.values) {
            array.put(
                JSONObject()
                    .put("id", job.id)
                    .put("title", job.title)
                    .put("status", job.status)
                    .put("total", job.total)
                    .put("done", job.done)
                    .put("failed", job.failed)
            )
        }
        return array
    }
}
