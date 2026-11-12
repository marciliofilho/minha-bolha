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

    class Job(val id: String, val title: String, val total: Int) {
        @Volatile var done: Int = 0
        @Volatile var failed: Int = 0
        @Volatile var current: String? = null
        @Volatile var status: String = "running"
        @Volatile var error: String? = null
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
        val job = Job(UUID.randomUUID().toString(), title.ifEmpty { "Novel" }, limited.size)
        jobs[job.id] = job

        executor.execute {
            try {
                for ((url, name, index) in limited) {
                    if (job.status != "running") break
                    job.current = name
                    val extracted = try {
                        extractor.extract(url)
                    } catch (error: Exception) {
                        null
                    }
                    if (extracted == null) {
                        job.failed++
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
                }
                if (job.status == "running") job.status = "done"
            } catch (error: Exception) {
                job.error = error.message
                job.status = "failed"
            } finally {
                job.current = null
            }
        }

        return job
    }

    fun status(id: String): JSONObject? {
        val job = jobs[id] ?: return null
        return JSONObject()
            .put("id", job.id)
            .put("title", job.title)
            .put("status", job.status)
            .put("total", job.total)
            .put("done", job.done)
            .put("failed", job.failed)
            .put("current", job.current ?: JSONObject.NULL)
            .put("error", job.error ?: JSONObject.NULL)
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
