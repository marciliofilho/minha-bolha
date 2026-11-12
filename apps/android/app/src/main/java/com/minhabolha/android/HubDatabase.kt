package com.minhabolha.android

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import io.requery.android.database.sqlite.SQLiteDatabase
import android.util.Base64
import com.minhabolha.android.connectors.MediaRow
import com.minhabolha.android.connectors.RawGlobalRelease
import com.minhabolha.android.connectors.RawItem
import com.minhabolha.android.connectors.RawMedia
import com.minhabolha.android.connectors.RawReleaseEvent
import com.minhabolha.android.connectors.ReleaseEventRow
import com.minhabolha.android.connectors.SourceRow
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Banco local do Minha Bolha no Android.
 *
 * O esquema é o mesmo do desktop: as migrations SQL de `apps/api/src/db/migrations`
 * são empacotadas no APK e aplicadas na primeira abertura, com controle em
 * `_migrations`. Isso mantém o banco do Android compatível com exportações e
 * backups do desktop.
 */
class HubDatabase(private val context: Context) {

    private val db: SQLiteDatabase = open()

    // ---------------------------------------------------------------------
    // Abertura e migrations
    // ---------------------------------------------------------------------

    private fun open(): SQLiteDatabase {
        val file = context.getDatabasePath(DB_NAME)
        file.parentFile?.mkdirs()

        val database = SQLiteDatabase.openOrCreateDatabase(file, null)
        // PRAGMAs devolvem linha (journal_mode) e o execSQL do Android recusa
        // comandos que retornam resultados, então usamos rawQuery.
        pragma(database, "PRAGMA journal_mode = WAL")
        pragma(database, "PRAGMA foreign_keys = ON")
        pragma(database, "PRAGMA busy_timeout = 5000")
        pragma(database, "PRAGMA synchronous = NORMAL")

        migrate(database)
        ensureSystemCategories(database)

        val capabilities = capabilities(database)
        android.util.Log.i(
            "MinhaBolha",
            "sqlite ${capabilities.optString("version")} json1=${capabilities.optBoolean("json1")} " +
                "window=${capabilities.optBoolean("windowFunctions")}"
        )
        return database
    }

    /**
     * Versão e recursos do SQLite em uso.
     *
     * As migrations são compartilhadas com o desktop e usam JSON1; o SQLite de
     * algumas imagens Android (BlueStacks, por exemplo) vem sem essa extensão.
     * O app empacota sua própria versão, e isto confirma em execução.
     */
    private fun capabilities(database: SQLiteDatabase): JSONObject {
        fun scalar(sql: String): String? = database.rawQuery(sql, null).use { cursor ->
            if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null
        }

        val version = runCatching { scalar("SELECT sqlite_version()") }.getOrNull() ?: "desconhecida"
        val json1 = runCatching {
            scalar("""SELECT json_extract('{"a":1}', '$.a')""")
        }.getOrNull() == "1"
        val window = runCatching {
            scalar("SELECT ROW_NUMBER() OVER (ORDER BY 1)")
        }.isSuccess

        return JSONObject()
            .put("version", version)
            .put("json1", json1)
            .put("windowFunctions", window)
    }

    /** Diagnóstico exposto em `/api/health` (usado pelo smoke test). */
    fun diagnostics(): JSONObject = capabilities(db).put("engine", "bundled")

    private fun pragma(database: SQLiteDatabase, sql: String) {
        database.rawQuery(sql, null).use { cursor -> cursor.moveToFirst() }
    }

    private fun migrate(database: SQLiteDatabase) {
        database.execSQL(
            """
            CREATE TABLE IF NOT EXISTS _migrations (
              name       TEXT PRIMARY KEY,
              applied_at TEXT NOT NULL
            )
            """.trimIndent()
        )

        val applied = mutableSetOf<String>()
        database.rawQuery("SELECT name FROM _migrations", null).use { cursor ->
            while (cursor.moveToNext()) applied.add(cursor.getString(0))
        }

        val migrations = context.assets.list(MIGRATIONS_DIR)?.sorted().orEmpty()
        for (name in migrations) {
            if (!name.endsWith(".sql") || name in applied) continue
            val script = context.assets.open("$MIGRATIONS_DIR/$name")
                .bufferedReader()
                .use { it.readText() }

            database.beginTransaction()
            try {
                for (statement in SqlScript.split(script)) {
                    database.execSQL(statement)
                }
                database.execSQL(
                    "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
                    arrayOf(name, nowIso())
                )
                database.setTransactionSuccessful()
            } finally {
                database.endTransaction()
            }
        }
    }

    private fun ensureSystemCategories(database: SQLiteDatabase) {
        for (category in SYSTEM_CATEGORIES) {
            database.execSQL(
                """
                INSERT INTO categories (id, label, icon, color, sort_order, is_system)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(id) DO UPDATE SET
                  label = excluded.label,
                  icon = excluded.icon,
                  color = excluded.color,
                  sort_order = excluded.sort_order
                """.trimIndent(),
                arrayOf(category.id, category.label, category.icon, category.color, category.sortOrder)
            )
        }
    }

    // ---------------------------------------------------------------------
    // Configurações
    // ---------------------------------------------------------------------

    fun settings(): JSONObject {
        val stored = mutableMapOf<String, Any?>()
        db.rawQuery("SELECT key, value FROM settings", null).use { cursor ->
            while (cursor.moveToNext()) {
                stored[cursor.getString(0)] = parseJsonValue(cursor.getString(1))
            }
        }

        return JSONObject().apply {
            put("theme", parseTheme(stored["theme"]))
            put("language", parseAppLanguage(stored["language"]))
            put("introEnabled", boolean(stored["introEnabled"], DEFAULTS.introEnabled))
            put("introAudio", boolean(stored["introAudio"], DEFAULTS.introAudio))
            put("defaultIntervalMinutes", clamp(stored["defaultIntervalMinutes"], DEFAULTS.defaultIntervalMinutes, 5, 1440))
            put("feedRefreshSeconds", clamp(stored["feedRefreshSeconds"], DEFAULTS.feedRefreshSeconds, 60, 3600))
            put("hoverPreviewSeconds", clamp(stored["hoverPreviewSeconds"], DEFAULTS.hoverPreviewSeconds, 0, 15))
            put("feedWindowHours", clamp(stored["feedWindowHours"], DEFAULTS.feedWindowHours, 1, 168))
            put("novelCacheRetentionHours", clamp(stored["novelCacheRetentionHours"], DEFAULTS.novelCacheRetentionHours, 1, 720))
            put("novelCacheCleanupHours", clamp(stored["novelCacheCleanupHours"], DEFAULTS.novelCacheCleanupHours, 1, 168))
            put("novelChaptersOffline", boolean(stored["novelChaptersOffline"], DEFAULTS.novelChaptersOffline))
            put("novelOfflineRetentionDays", clamp(stored["novelOfflineRetentionDays"], DEFAULTS.novelOfflineRetentionDays, 1, 365))
            put("timezone", string(stored["timezone"], DEFAULTS.timezone))
            put("region", string(stored["region"], DEFAULTS.region))
            put("currency", string(stored["currency"], DEFAULTS.currency))
            put("streamCacheTtlHours", clamp(stored["streamCacheTtlHours"], DEFAULTS.streamCacheTtlHours, 1, 168))
            put("torrentCacheRetentionDays", clamp(stored["torrentCacheRetentionDays"], DEFAULTS.torrentCacheRetentionDays, 0, 365))
            put("autoMaintenanceEnabled", boolean(stored["autoMaintenanceEnabled"], DEFAULTS.autoMaintenanceEnabled))
            put("playerSkipSeconds", clamp(stored["playerSkipSeconds"], DEFAULTS.playerSkipSeconds, 1, 120))
            put("subtitleLanguage", language(stored["subtitleLanguage"]))
            put("subtitleFontSize", clamp(stored["subtitleFontSize"], DEFAULTS.subtitleFontSize, 12, 48))
            put("subtitleColor", color(stored["subtitleColor"], DEFAULTS.subtitleColor))
            put("subtitleBackgroundColor", color(stored["subtitleBackgroundColor"], DEFAULTS.subtitleBackgroundColor))
            put("subtitleBackgroundOpacity", clamp(stored["subtitleBackgroundOpacity"], DEFAULTS.subtitleBackgroundOpacity, 0, 100))
            put("subtitleLineHeight", clampDecimal(stored["subtitleLineHeight"], DEFAULTS.subtitleLineHeight, 0.8, 2.5))
            put("subtitlePosition", clamp(stored["subtitlePosition"], DEFAULTS.subtitlePosition, 40, 95))
        }
    }

    fun updateSettings(patch: JSONObject): JSONObject {
        val updatedAt = nowIso()
        db.beginTransaction()
        try {
            for (key in SETTINGS_KEYS) {
                if (!patch.has(key)) continue
                db.insertWithOnConflict(
                    "settings",
                    null,
                    ContentValues().apply {
                        put("key", key)
                        put("value", encodeSettingValue(patch.get(key)))
                        put("updated_at", updatedAt)
                    },
                    SQLiteDatabase.CONFLICT_REPLACE
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return settings()
    }

    // ---------------------------------------------------------------------
    // Categorias
    // ---------------------------------------------------------------------

    fun categoryExists(id: String): Boolean {
        if (id.isEmpty()) return false
        db.rawQuery("SELECT 1 FROM categories WHERE id = ?", arrayOf(id)).use { cursor ->
            return cursor.moveToFirst()
        }
    }

    fun categories(): JSONArray {
        val result = JSONArray()
        db.rawQuery(
            "SELECT id, label, icon, color, sort_order, is_system FROM categories ORDER BY sort_order ASC, label ASC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) {
                result.put(
                    JSONObject()
                        .put("id", cursor.getString(0))
                        .put("label", cursor.getString(1))
                        .put("icon", cursor.getString(2))
                        .put("color", cursor.getString(3))
                        .put("sortOrder", cursor.getInt(4))
                        .put("isSystem", cursor.getInt(5) == 1)
                )
            }
        }
        return result
    }

    fun createCategory(label: String, icon: String?, color: String?): JSONObject {
        val id = slugify(label)
        if (id.isEmpty()) throw HubException(400, "validation", "Nome de categoria inválido.")
        existingCategory(id)?.let { existing ->
            if (existing.getBoolean("isSystem")) {
                throw HubException(409, "conflict", "Já existe uma categoria do sistema com esse nome.")
            }
            return existing
        }
        val sortOrder = 100 + (0..799).random()
        db.execSQL(
            """
            INSERT INTO categories (id, label, icon, color, sort_order, is_system)
            VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label, icon = excluded.icon, color = excluded.color
            """.trimIndent(),
            arrayOf(id, label, icon ?: "rss", color ?: "#8b96a8", sortOrder)
        )
        return existingCategory(id) ?: throw HubException(500, "database", "Categoria não foi criada.")
    }

    private fun existingCategory(id: String): JSONObject? {
        db.rawQuery(
            "SELECT id, label, icon, color, sort_order, is_system FROM categories WHERE id = ?",
            arrayOf(id)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return JSONObject()
                .put("id", cursor.getString(0))
                .put("label", cursor.getString(1))
                .put("icon", cursor.getString(2))
                .put("color", cursor.getString(3))
                .put("sortOrder", cursor.getInt(4))
                .put("isSystem", cursor.getInt(5) == 1)
        }
    }

    // ---------------------------------------------------------------------
    // Fontes
    // ---------------------------------------------------------------------

    fun sources(): JSONArray = querySources("", emptyArray())

    fun source(id: String): JSONObject? {
        val rows = querySources("WHERE s.id = ?", arrayOf(id))
        return if (rows.length() > 0) rows.getJSONObject(0) else null
    }

    fun sourceByType(type: String): JSONObject? {
        val rows = querySources("WHERE s.type = ?", arrayOf(type))
        return if (rows.length() > 0) rows.getJSONObject(0) else null
    }

    private fun querySources(whereClause: String, args: Array<String>): JSONArray {
        val cutoff = feedCutoffIso(48)
        val queryArgs = arrayOf(cutoff, cutoff, cutoff, cutoff) + args
        val result = JSONArray()
        db.rawQuery(
            """
            SELECT s.*,
              (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND $VISIBLE_ITEM_FILTER) AS item_count,
              (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.is_read = 0 AND $VISIBLE_ITEM_FILTER) AS unread_count,
              (SELECT i.title FROM items i WHERE i.source_id = s.id AND $VISIBLE_ITEM_FILTER
                ORDER BY i.published_at DESC, i.id DESC LIMIT 1) AS latest_item_title,
              (SELECT i.published_at FROM items i WHERE i.source_id = s.id AND $VISIBLE_ITEM_FILTER
                ORDER BY i.published_at DESC, i.id DESC LIMIT 1) AS latest_item_published_at
            FROM sources s
            $whereClause
            ORDER BY s.is_demo ASC, s.name ASC
            """.trimIndent(),
            queryArgs
        ).use { cursor ->
            while (cursor.moveToNext()) result.put(sourceFromCursor(cursor))
        }
        return result
    }

    /** Linha crua da tabela `sources`, usada pelo scheduler e conectores. */
    fun sourceRow(id: String): SourceRow? {
        db.rawQuery("SELECT * FROM sources WHERE id = ?", arrayOf(id)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return sourceRowFromCursor(cursor)
        }
    }

    fun dueSources(limit: Int): List<SourceRow> {
        val rows = mutableListOf<SourceRow>()
        db.rawQuery(
            """
            SELECT * FROM sources
            WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
            ORDER BY next_run_at ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(nowIso(), limit.coerceIn(1, 100).toString())
        ).use { cursor ->
            while (cursor.moveToNext()) rows.add(sourceRowFromCursor(cursor))
        }
        return rows
    }

    fun allSourceRows(): List<SourceRow> {
        val rows = mutableListOf<SourceRow>()
        db.rawQuery("SELECT * FROM sources WHERE enabled = 1", null).use { cursor ->
            while (cursor.moveToNext()) rows.add(sourceRowFromCursor(cursor))
        }
        return rows
    }

    private fun sourceRowFromCursor(cursor: Cursor): SourceRow = SourceRow(
        id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
        type = cursor.getString(cursor.getColumnIndexOrThrow("type")),
        name = cursor.getString(cursor.getColumnIndexOrThrow("name")),
        categoryId = cursor.getString(cursor.getColumnIndexOrThrow("category_id")),
        config = cursor.getString(cursor.getColumnIndexOrThrow("config")),
        state = cursor.getString(cursor.getColumnIndexOrThrow("state")),
        enabled = cursor.getInt(cursor.getColumnIndexOrThrow("enabled")) == 1,
        intervalMinutes = cursor.getInt(cursor.getColumnIndexOrThrow("interval_minutes")),
        nextRunAt = cursor.getString(cursor.getColumnIndexOrThrow("next_run_at")),
        consecutiveFailures = cursor.getInt(cursor.getColumnIndexOrThrow("consecutive_failures")),
        isDemo = cursor.getInt(cursor.getColumnIndexOrThrow("is_demo")) == 1,
        lastSuccessAt = cursor.getString(cursor.getColumnIndexOrThrow("last_success_at"))
    )

    fun createSource(
        type: String,
        name: String,
        categoryId: String,
        config: JSONObject,
        intervalMinutes: Int,
        isDemo: Boolean = false
    ): JSONObject {
        val id = UUID.randomUUID().toString()
        val now = nowIso()
        db.execSQL(
            """
            INSERT INTO sources (id, type, name, category_id, config, state, enabled, interval_minutes,
               next_run_at, is_demo, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?, ?)
            """.trimIndent(),
            arrayOf(id, type, name, categoryId, config.toString(), intervalMinutes, now, if (isDemo) 1 else 0, now, now)
        )
        return source(id) ?: throw HubException(500, "database", "Fonte não foi criada.")
    }

    fun updateSource(
        id: String,
        name: String? = null,
        categoryId: String? = null,
        intervalMinutes: Int? = null,
        enabled: Boolean? = null,
        config: JSONObject? = null
    ): JSONObject? {
        val sets = mutableListOf<String>()
        val args = mutableListOf<Any?>()

        name?.let { sets.add("name = ?"); args.add(it) }
        categoryId?.let { sets.add("category_id = ?"); args.add(it) }
        intervalMinutes?.let { sets.add("interval_minutes = ?"); args.add(it) }
        enabled?.let { sets.add("enabled = ?"); args.add(if (it) 1 else 0) }
        config?.let { sets.add("config = ?"); args.add(it.toString()) }

        if (sets.isNotEmpty()) {
            sets.add("updated_at = ?")
            args.add(nowIso())
            args.add(id)
            db.execSQL("UPDATE sources SET ${sets.joinToString(", ")} WHERE id = ?", args.toTypedArray())
        }
        return source(id)
    }

    fun deleteSource(id: String): Boolean {
        if (countSourcesWhere("id = ?", arrayOf(id)) == 0) return false
        db.execSQL("DELETE FROM sources WHERE id = ?", arrayOf(id))
        return true
    }

    fun deleteSources(ids: List<String>): Int {
        if (ids.isEmpty()) return 0
        val unique = ids.distinct()
        val placeholders = unique.joinToString(", ") { "?" }
        val before = countSourcesWhere(null, null)
        db.execSQL("DELETE FROM sources WHERE id IN ($placeholders)", unique.toTypedArray())
        return before - countSourcesWhere(null, null)
    }

    private fun countSourcesWhere(where: String?, args: Array<String>?): Int {
        val sql = if (where == null) "SELECT COUNT(*) FROM sources" else "SELECT COUNT(*) FROM sources WHERE $where"
        db.rawQuery(sql, args).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    fun setNextRun(id: String, nextRunAt: String) {
        db.execSQL(
            "UPDATE sources SET next_run_at = ?, updated_at = ? WHERE id = ?",
            arrayOf(nextRunAt, nowIso(), id)
        )
    }

    fun recordSuccess(id: String, state: String, nextRunAt: String, checkedAt: String) {
        db.execSQL(
            """
            UPDATE sources SET
              state = ?, last_checked_at = ?, last_success_at = ?,
              last_error_at = NULL, last_error_code = NULL, last_error_message = NULL,
              consecutive_failures = 0, next_run_at = ?, updated_at = ?
            WHERE id = ?
            """.trimIndent(),
            arrayOf(state, checkedAt, checkedAt, nextRunAt, nowIso(), id)
        )
    }

    fun recordFailure(
        id: String,
        code: String,
        message: String,
        consecutiveFailures: Int,
        nextRunAt: String,
        checkedAt: String
    ) {
        db.execSQL(
            """
            UPDATE sources SET
              last_checked_at = ?, last_error_at = ?, last_error_code = ?, last_error_message = ?,
              consecutive_failures = ?, next_run_at = ?, updated_at = ?
            WHERE id = ?
            """.trimIndent(),
            arrayOf(
                checkedAt,
                checkedAt,
                code,
                message.take(500),
                consecutiveFailures,
                nextRunAt,
                nowIso(),
                id
            )
        )
    }

    fun startRun(sourceId: String, startedAt: String): Long {
        db.execSQL(
            "INSERT INTO source_runs (source_id, started_at, ok) VALUES (?, ?, 0)",
            arrayOf(sourceId, startedAt)
        )
        db.rawQuery("SELECT last_insert_rowid()", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        }
    }

    fun finishRun(
        id: Long,
        ok: Boolean,
        itemsFound: Int,
        itemsNew: Int,
        errorCode: String?,
        errorMessage: String?,
        durationMs: Long
    ) {
        db.execSQL(
            """
            UPDATE source_runs SET finished_at = ?, ok = ?, items_found = ?, items_new = ?,
              error_code = ?, error_message = ?, duration_ms = ?
            WHERE id = ?
            """.trimIndent(),
            arrayOf(
                nowIso(),
                if (ok) 1 else 0,
                itemsFound,
                itemsNew,
                errorCode,
                errorMessage,
                durationMs,
                id
            )
        )
    }

    fun listRuns(sourceId: String, limit: Int = 10): JSONArray {
        val result = JSONArray()
        db.rawQuery(
            "SELECT * FROM source_runs WHERE source_id = ? ORDER BY started_at DESC LIMIT ?",
            arrayOf(sourceId, limit.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                result.put(
                    JSONObject()
                        .put("id", cursor.getLong(cursor.getColumnIndexOrThrow("id")))
                        .put("startedAt", cursor.getString(cursor.getColumnIndexOrThrow("started_at")))
                        .put("finishedAt", cursor.getString(cursor.getColumnIndexOrThrow("finished_at")) ?: JSONObject.NULL)
                        .put("ok", cursor.getInt(cursor.getColumnIndexOrThrow("ok")) == 1)
                        .put("itemsFound", cursor.getInt(cursor.getColumnIndexOrThrow("items_found")))
                        .put("itemsNew", cursor.getInt(cursor.getColumnIndexOrThrow("items_new")))
                        .put("errorCode", cursor.getString(cursor.getColumnIndexOrThrow("error_code")) ?: JSONObject.NULL)
                        .put("errorMessage", cursor.getString(cursor.getColumnIndexOrThrow("error_message")) ?: JSONObject.NULL)
                        .put("durationMs", cursor.getLong(cursor.getColumnIndexOrThrow("duration_ms")))
                )
            }
        }
        return result
    }

    /** Insere itens ignorando duplicatas; devolve quantos são realmente novos. */
    fun insertItems(sourceId: String, categoryId: String, items: List<RawItem>): Int {
        if (items.isEmpty()) return 0
        val discoveredAt = nowIso()
        var inserted = 0

        db.beginTransaction()
        try {
            for (item in items) {
                val values = ContentValues().apply {
                    put("id", UUID.randomUUID().toString())
                    put("source_id", sourceId)
                    put("external_id", item.externalId)
                    put("dedupe_key", item.dedupeKey)
                    put("category_id", categoryId)
                    put("kind", item.kind)
                    put("title", item.title)
                    put("url", item.url)
                    put("thumbnail_url", item.thumbnailUrl)
                    put("description", item.description)
                    put("author", item.author)
                    put("published_at", item.publishedAt)
                    put("discovered_at", discoveredAt)
                    put("meta", item.meta?.toString())
                }
                val rowId = db.insertWithOnConflict(
                    "items",
                    null,
                    values,
                    SQLiteDatabase.CONFLICT_IGNORE
                )
                if (rowId != -1L) inserted++
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }

        return inserted
    }

    private fun sourceFromCursor(cursor: Cursor): JSONObject {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        fun required(column: String): String =
            cursor.getString(cursor.getColumnIndexOrThrow(column))

        fun stringOrNull(column: String): Any = text(column) ?: JSONObject.NULL

        return JSONObject()
            .put("id", required("id"))
            .put("type", required("type"))
            .put("name", required("name"))
            .put("categoryId", required("category_id"))
            .put("config", jsonObjectOrEmpty(text("config")))
            .put("enabled", cursor.getInt(cursor.getColumnIndexOrThrow("enabled")) == 1)
            .put("intervalMinutes", cursor.getInt(cursor.getColumnIndexOrThrow("interval_minutes")))
            .put("nextRunAt", stringOrNull("next_run_at"))
            .put("lastCheckedAt", stringOrNull("last_checked_at"))
            .put("lastSuccessAt", stringOrNull("last_success_at"))
            .put("lastErrorAt", stringOrNull("last_error_at"))
            .put("lastErrorCode", stringOrNull("last_error_code"))
            .put("lastErrorMessage", stringOrNull("last_error_message"))
            .put("consecutiveFailures", cursor.getInt(cursor.getColumnIndexOrThrow("consecutive_failures")))
            .put("isDemo", cursor.getInt(cursor.getColumnIndexOrThrow("is_demo")) == 1)
            .put("createdAt", text("created_at"))
            .put("unreadCount", cursor.getInt(cursor.getColumnIndexOrThrow("unread_count")))
            .put("itemCount", cursor.getInt(cursor.getColumnIndexOrThrow("item_count")))
            .put("latestItemTitle", stringOrNull("latest_item_title"))
            .put("latestItemPublishedAt", stringOrNull("latest_item_published_at"))
    }

    // ---------------------------------------------------------------------
    // Feed
    // ---------------------------------------------------------------------

    fun feed(tab: String, sourceId: String?, cursorToken: String?, limit: Int): JSONObject {
        val safeLimit = limit.coerceIn(1, 100)
        val args = mutableListOf<String>()
        val where = mutableListOf(
            "i.is_hidden = 0",
            "((s.type <> 'youtube' AND i.category_id <> 'news') OR i.published_at >= ?)"
        )
        args.add(feedCutoffIso(settings().optInt("feedWindowHours", 48)))

        when (tab) {
            FAVORITES_TAB_ID -> where.add("i.is_favorite = 1")
            WATCH_LATER_TAB_ID -> where.add("i.is_watch_later = 1")
            "", "all" -> Unit
            else -> {
                where.add("i.category_id = ?")
                args.add(tab)
            }
        }
        if (!sourceId.isNullOrEmpty()) {
            where.add("i.source_id = ?")
            args.add(sourceId)
        }
        decodeCursor(cursorToken)?.let { cursor ->
            where.add("(i.published_at < ? OR (i.published_at = ? AND i.id < ?))")
            args.add(cursor.first)
            args.add(cursor.first)
            args.add(cursor.second)
        }
        args.add((safeLimit + 1).toString())

        val items = JSONArray()
        var lastPublishedAt: String? = null
        var lastId: String? = null
        var count = 0
        var hasMore = false

        db.rawQuery(
            """
            SELECT i.*, s.name AS source_name, s.type AS source_type, c.label AS category_label,
                   m.imdb_id AS media_imdb_id, m.kind AS media_kind,
                   EXISTS (
                     SELECT 1 FROM stremio_library l
                     WHERE l.removed = 0 AND l.imdb_id = m.imdb_id
                   ) OR EXISTS (
                     SELECT 1 FROM stremio_library_state st
                     WHERE st.in_library = 1 AND m.imdb_id IS NOT NULL AND st.meta_id = m.imdb_id
                   ) AS in_stremio_library
            FROM items i
            JOIN sources s ON s.id = i.source_id
            JOIN categories c ON c.id = i.category_id
            LEFT JOIN media m ON m.id = json_extract(i.meta, '$.mediaId')
            WHERE ${where.joinToString(" AND ")}
            ORDER BY i.published_at DESC, i.id DESC
            LIMIT ?
            """.trimIndent(),
            args.toTypedArray()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                if (count == safeLimit) {
                    hasMore = true
                    break
                }
                items.put(feedItemFromCursor(cursor))
                lastPublishedAt = cursor.getString(cursor.getColumnIndexOrThrow("published_at"))
                lastId = cursor.getString(cursor.getColumnIndexOrThrow("id"))
                count++
            }
        }

        val nextCursor = if (hasMore && lastPublishedAt != null && lastId != null) {
            encodeCursor(lastPublishedAt, lastId)
        } else {
            null
        }

        return JSONObject()
            .put("items", items)
            .put("nextCursor", nextCursor ?: JSONObject.NULL)
    }

    private fun feedItemFromCursor(cursor: Cursor): JSONObject {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        fun required(column: String): String =
            cursor.getString(cursor.getColumnIndexOrThrow(column))

        return JSONObject()
            .put("id", required("id"))
            .put("sourceId", required("source_id"))
            .put("sourceName", required("source_name"))
            .put("sourceType", required("source_type"))
            .put("categoryId", required("category_id"))
            .put("categoryLabel", required("category_label"))
            .put("kind", required("kind"))
            .put("title", required("title"))
            .put("url", required("url"))
            .put("thumbnailUrl", text("thumbnail_url") ?: JSONObject.NULL)
            .put("description", text("description") ?: JSONObject.NULL)
            .put("author", text("author") ?: JSONObject.NULL)
            .put("publishedAt", required("published_at"))
            .put("isRead", cursor.getInt(cursor.getColumnIndexOrThrow("is_read")) == 1)
            .put("isFavorite", cursor.getInt(cursor.getColumnIndexOrThrow("is_favorite")) == 1)
            .put("isWatchLater", cursor.getInt(cursor.getColumnIndexOrThrow("is_watch_later")) == 1)
            .put("meta", jsonObjectOrNull(text("meta")) ?: JSONObject.NULL)
            .put("imdbId", text("media_imdb_id") ?: JSONObject.NULL)
            .put("mediaKind", text("media_kind") ?: JSONObject.NULL)
            .put("inStremioLibrary", cursor.getInt(cursor.getColumnIndexOrThrow("in_stremio_library")) == 1)
    }

    fun item(id: String): JSONObject? {
        db.rawQuery(
            """
            SELECT i.*, s.name AS source_name, s.type AS source_type, c.label AS category_label,
                   m.imdb_id AS media_imdb_id, m.kind AS media_kind,
                   EXISTS (
                     SELECT 1 FROM stremio_library l
                     WHERE l.removed = 0 AND l.imdb_id = m.imdb_id
                   ) AS in_stremio_library
            FROM items i
            JOIN sources s ON s.id = i.source_id
            JOIN categories c ON c.id = i.category_id
            LEFT JOIN media m ON m.id = json_extract(i.meta, '$.mediaId')
            WHERE i.id = ?
            """.trimIndent(),
            arrayOf(id)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return feedItemFromCursor(cursor)
        }
    }

    fun updateItemFlags(id: String, patch: JSONObject): JSONObject? {
        val sets = mutableListOf<String>()
        val args = mutableListOf<Any?>()

        if (patch.has("isRead")) {
            val isRead = patch.optBoolean("isRead")
            sets.add("is_read = ?")
            sets.add("read_at = ?")
            args.add(if (isRead) 1 else 0)
            args.add(if (isRead) nowIso() else null)
        }
        if (patch.has("isFavorite")) {
            sets.add("is_favorite = ?")
            args.add(if (patch.optBoolean("isFavorite")) 1 else 0)
        }
        if (patch.has("isWatchLater")) {
            sets.add("is_watch_later = ?")
            args.add(if (patch.optBoolean("isWatchLater")) 1 else 0)
        }
        if (sets.isEmpty()) return item(id)

        args.add(id)
        db.execSQL("UPDATE items SET ${sets.joinToString(", ")} WHERE id = ?", args.toTypedArray())
        return item(id)
    }

    fun counts(): JSONArray {
        val cutoff = feedCutoffIso(settings().optInt("feedWindowHours", 48))
        val grouped = mutableMapOf<String, Array<Int>>()

        db.rawQuery(
            """
            SELECT i.category_id,
                   COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN i.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread,
                   COALESCE(SUM(i.is_favorite), 0) AS favorites,
                   COALESCE(SUM(CASE WHEN i.is_favorite = 1 AND i.is_read = 0 THEN 1 ELSE 0 END), 0) AS favorites_unread,
                   COALESCE(SUM(i.is_watch_later), 0) AS later,
                   COALESCE(SUM(CASE WHEN i.is_watch_later = 1 AND i.is_read = 0 THEN 1 ELSE 0 END), 0) AS later_unread
            FROM items i
            JOIN sources s ON s.id = i.source_id
            WHERE i.is_hidden = 0
              AND ((s.type <> 'youtube' AND i.category_id <> 'news') OR i.published_at >= ?)
            GROUP BY i.category_id
            """.trimIndent(),
            arrayOf(cutoff)
        ).use { cursor ->
            while (cursor.moveToNext()) {
                grouped[cursor.getString(0)] = intArrayOf(
                    cursor.getInt(1),
                    cursor.getInt(2),
                    cursor.getInt(3),
                    cursor.getInt(4),
                    cursor.getInt(5),
                    cursor.getInt(6)
                ).toTypedArray()
            }
        }

        val categories = JSONArray()
        var totalUnread = 0
        var totalItems = 0
        var favorites = 0
        var favoritesUnread = 0
        var later = 0
        var laterUnread = 0

        db.rawQuery(
            "SELECT id, label FROM categories ORDER BY sort_order ASC, label ASC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getString(0)
                val label = cursor.getString(1)
                val row = grouped[id]
                val unread = row?.get(1) ?: 0
                val total = row?.get(0) ?: 0
                categories.put(
                    JSONObject().put("id", id).put("label", label).put("unread", unread).put("total", total)
                )
                totalUnread += unread
                totalItems += total
                row?.let {
                    favorites += it[2]
                    favoritesUnread += it[3]
                    later += it[4]
                    laterUnread += it[5]
                }
            }
        }

        val result = JSONArray()
        result.put(
            JSONObject().put("id", "all").put("label", "Todos")
                .put("unread", totalUnread).put("total", totalItems)
        )
        for (index in 0 until categories.length()) result.put(categories.get(index))
        result.put(
            JSONObject().put("id", FAVORITES_TAB_ID).put("label", "Favoritos")
                .put("unread", favoritesUnread).put("total", favorites)
        )
        result.put(
            JSONObject().put("id", WATCH_LATER_TAB_ID).put("label", "Ver depois")
                .put("unread", laterUnread).put("total", later)
        )
        return result
    }

    fun markAllRead(tab: String, sourceId: String?): Int {
        val where = mutableListOf("is_read = 0", "is_hidden = 0")
        val args = mutableListOf<String>()

        when (tab) {
            FAVORITES_TAB_ID -> where.add("is_favorite = 1")
            WATCH_LATER_TAB_ID -> where.add("is_watch_later = 1")
            "", "all" -> Unit
            else -> {
                where.add("category_id = ?")
                args.add(tab)
            }
        }
        if (!sourceId.isNullOrEmpty()) {
            where.add("source_id = ?")
            args.add(sourceId)
        }

        val values = ContentValues().apply {
            put("is_read", 1)
            put("read_at", nowIso())
        }
        return db.update("items", values, where.joinToString(" AND "), args.toTypedArray())
    }

    // ---------------------------------------------------------------------
    // Chaves de API (criptografadas com o Android Keystore)
    // ---------------------------------------------------------------------

    fun secretValue(key: String): String? {
        db.rawQuery("SELECT value FROM secrets WHERE key = ?", arrayOf(key)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val stored = cursor.getString(0)
            return SecretCrypto.decrypt(stored)
        }
    }

    fun setSecretValue(key: String, value: String) {
        db.execSQL(
            """
            INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """.trimIndent(),
            arrayOf(key, SecretCrypto.encrypt(value.trim()), nowIso())
        )
    }

    fun deleteSecretValue(key: String) {
        db.execSQL("DELETE FROM secrets WHERE key = ?", arrayOf(key))
    }

    // ---------------------------------------------------------------------
    // Títulos acompanhados (TMDB/AniList)
    // ---------------------------------------------------------------------

    fun mediaBySource(sourceId: String): MediaRow? {
        db.rawQuery("SELECT * FROM media WHERE source_id = ?", arrayOf(sourceId)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return mediaFromCursor(cursor)
        }
    }

    fun findMediaByExternal(provider: String, externalId: String): MediaRow? {
        db.rawQuery(
            "SELECT * FROM media WHERE provider = ? AND external_id = ?",
            arrayOf(provider, externalId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return mediaFromCursor(cursor)
        }
    }

    fun mediaByImdb(imdbId: String): MediaRow? {
        db.rawQuery("SELECT * FROM media WHERE imdb_id = ? LIMIT 1", arrayOf(imdbId)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return mediaFromCursor(cursor)
        }
    }

    private fun mediaFromCursor(cursor: Cursor): MediaRow {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        return MediaRow(
            id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
            sourceId = cursor.getString(cursor.getColumnIndexOrThrow("source_id")),
            provider = cursor.getString(cursor.getColumnIndexOrThrow("provider")),
            externalId = cursor.getString(cursor.getColumnIndexOrThrow("external_id")),
            kind = cursor.getString(cursor.getColumnIndexOrThrow("kind")),
            title = cursor.getString(cursor.getColumnIndexOrThrow("title")),
            posterUrl = text("poster_url"),
            backdropUrl = text("backdrop_url"),
            url = text("url"),
            imdbId = text("imdb_id")
        )
    }

    /** Cria ou atualiza o título vinculado a uma fonte (1:1). */
    fun upsertMedia(sourceId: String, raw: RawMedia): MediaRow {
        val now = nowIso()
        val existing = mediaBySource(sourceId)
        val imdbId = raw.imdbId ?: existing?.imdbId

        val values = arrayOf<Any?>(
            raw.provider,
            raw.externalId,
            raw.kind,
            raw.title,
            raw.originalTitle,
            raw.posterUrl,
            raw.backdropUrl,
            raw.year,
            raw.status,
            raw.totalSeasons,
            raw.nextEpisodeAt,
            raw.url,
            imdbId,
            raw.raw?.toString(),
            now
        )

        if (existing != null) {
            db.execSQL(
                """
                UPDATE media SET provider = ?, external_id = ?, kind = ?, title = ?, original_title = ?,
                  poster_url = ?, backdrop_url = ?, year = ?, status = ?, total_seasons = ?,
                  next_episode_at = ?, url = ?, imdb_id = ?, raw = ?, fetched_at = ?
                WHERE id = ?
                """.trimIndent(),
                values + existing.id
            )
        } else {
            val insertValues = mutableListOf<Any?>(UUID.randomUUID().toString(), sourceId)
            insertValues.addAll(values.toList())
            db.execSQL(
                """
                INSERT INTO media (id, source_id, provider, external_id, kind, title, original_title,
                  poster_url, backdrop_url, year, status, total_seasons, next_episode_at, url,
                  imdb_id, raw, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                insertValues.toTypedArray()
            )
        }

        return mediaBySource(sourceId) ?: throw HubException(500, "database", "Título não foi salvo.")
    }

    // ---------------------------------------------------------------------
    // Calendário
    // ---------------------------------------------------------------------

    fun upsertReleaseEvents(mediaId: String, events: List<RawReleaseEvent>, today: String): Int {
        val now = nowIso()
        db.beginTransaction()
        try {
            for (event in events) {
                db.execSQL(
                    """
                    INSERT INTO release_events (
                      id, media_id, external_key, kind, season, episode, episode_title,
                      release_date, release_time, release_at, timezone, region, url, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(external_key) DO UPDATE SET
                      media_id = excluded.media_id,
                      kind = excluded.kind,
                      season = excluded.season,
                      episode = excluded.episode,
                      episode_title = excluded.episode_title,
                      release_date = excluded.release_date,
                      release_time = excluded.release_time,
                      release_at = excluded.release_at,
                      timezone = excluded.timezone,
                      region = excluded.region,
                      url = excluded.url,
                      updated_at = excluded.updated_at
                    """.trimIndent(),
                    arrayOf(
                        UUID.randomUUID().toString(),
                        mediaId,
                        event.externalKey,
                        event.kind,
                        event.season,
                        event.episode,
                        event.episodeTitle,
                        event.releaseDate,
                        event.releaseTime,
                        event.releaseAt,
                        event.timezone,
                        event.region,
                        event.url,
                        now,
                        now
                    )
                )
            }

            // Só apaga eventos estritamente futuros que sumiram da fonte.
            if (events.isEmpty()) {
                db.execSQL(
                    "DELETE FROM release_events WHERE media_id = ? AND release_date > ?",
                    arrayOf(mediaId, today)
                )
            } else {
                val placeholders = events.joinToString(", ") { "?" }
                val deleteArgs = mutableListOf<Any?>(mediaId, today)
                deleteArgs.addAll(events.map { it.externalKey })
                db.execSQL(
                    "DELETE FROM release_events WHERE media_id = ? AND release_date > ? AND external_key NOT IN ($placeholders)",
                    deleteArgs.toTypedArray()
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        if (BuildConfig.DEBUG) {
            android.util.Log.i("MinhaBolha", "calendário: ${events.size} evento(s) para mídia $mediaId")
        }
        return events.size
    }

    fun eventsForMedia(mediaId: String, from: String, to: String): List<ReleaseEventRow> {
        val rows = mutableListOf<ReleaseEventRow>()
        db.rawQuery(
            """
            SELECT * FROM release_events
            WHERE media_id = ? AND release_date >= ? AND release_date <= ?
            ORDER BY release_date ASC, COALESCE(release_time, '99:99') ASC
            """.trimIndent(),
            arrayOf(mediaId, from, to)
        ).use { cursor ->
            while (cursor.moveToNext()) rows.add(releaseEventFromCursor(cursor))
        }
        return rows
    }

    private fun releaseEventFromCursor(cursor: Cursor): ReleaseEventRow {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        fun intOrNull(column: String): Int? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getInt(index)
        }

        return ReleaseEventRow(
            id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
            externalKey = cursor.getString(cursor.getColumnIndexOrThrow("external_key")),
            kind = cursor.getString(cursor.getColumnIndexOrThrow("kind")),
            season = intOrNull("season"),
            episode = intOrNull("episode"),
            episodeTitle = text("episode_title"),
            releaseDate = cursor.getString(cursor.getColumnIndexOrThrow("release_date")),
            releaseTime = text("release_time"),
            releaseAt = text("release_at"),
            region = text("region"),
            url = text("url")
        )
    }

    /** Eventos dos títulos acompanhados, já no formato da interface. */
    fun calendarEvents(from: String, to: String, kinds: List<String>): JSONArray {
        val where = mutableListOf("e.release_date >= ?", "e.release_date <= ?")
        val args = mutableListOf<String>(from, to)
        if (kinds.isNotEmpty()) {
            where.add("m.kind IN (${kinds.joinToString(", ") { "?" }})")
            args.addAll(kinds)
        }

        val result = JSONArray()
        db.rawQuery(
            """
            SELECT e.*, m.source_id, s.name AS source_name, m.provider, m.kind AS media_kind,
                   m.title AS media_title, m.original_title AS media_original_title,
                   m.poster_url AS media_poster_url, m.url AS media_url, m.imdb_id AS media_imdb_id,
                   EXISTS (
                     SELECT 1 FROM stremio_library l
                     WHERE l.removed = 0 AND l.imdb_id = m.imdb_id
                   ) OR EXISTS (
                     SELECT 1 FROM stremio_library_state st
                     WHERE st.in_library = 1 AND m.imdb_id IS NOT NULL AND st.meta_id = m.imdb_id
                   ) AS in_stremio_library
            FROM release_events e
            JOIN media m ON m.id = e.media_id
            JOIN sources s ON s.id = m.source_id
            WHERE ${where.joinToString(" AND ")}
            ORDER BY e.release_date ASC, COALESCE(e.release_time, '99:99') ASC, m.title ASC
            """.trimIndent(),
            args.toTypedArray()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                fun text(column: String): String? {
                    val index = cursor.getColumnIndex(column)
                    return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
                }

                fun intOrNull(column: String): Int? {
                    val index = cursor.getColumnIndex(column)
                    return if (index < 0 || cursor.isNull(index)) null else cursor.getInt(index)
                }

                result.put(
                    JSONObject()
                        .put("id", text("id"))
                        .put("mediaId", text("media_id"))
                        .put("sourceId", text("source_id"))
                        .put("sourceName", text("source_name"))
                        .put("provider", text("provider"))
                        .put("mediaKind", text("media_kind"))
                        .put("title", text("media_title"))
                        .put("originalTitle", text("media_original_title") ?: JSONObject.NULL)
                        .put("posterUrl", text("media_poster_url") ?: JSONObject.NULL)
                        .put("episodeTitle", text("episode_title") ?: JSONObject.NULL)
                        .put("kind", text("kind"))
                        .put("season", intOrNull("season") ?: JSONObject.NULL)
                        .put("episode", intOrNull("episode") ?: JSONObject.NULL)
                        .put("releaseDate", text("release_date"))
                        .put("releaseTime", text("release_time") ?: JSONObject.NULL)
                        .put("releaseAt", text("release_at") ?: JSONObject.NULL)
                        .put("timezone", text("timezone"))
                        .put("region", text("region") ?: JSONObject.NULL)
                        .put("url", text("url") ?: text("media_url") ?: JSONObject.NULL)
                        .put("imdbId", text("media_imdb_id") ?: JSONObject.NULL)
                        .put("inStremioLibrary", cursor.getInt(cursor.getColumnIndexOrThrow("in_stremio_library")) == 1)
                )
            }
        }
        return result
    }

    fun replaceGlobalReleases(events: List<RawGlobalRelease>, providers: List<String>): Int {
        if (providers.isEmpty()) return 0
        val now = nowIso()
        db.beginTransaction()
        try {
            db.execSQL(
                "DELETE FROM global_releases WHERE provider IN (${providers.joinToString(", ") { "?" }})",
                providers.toTypedArray()
            )
            var saved = 0
            for (item in events) {
                if (!providers.contains(item.provider)) continue
                db.execSQL(
                    """
                    INSERT INTO global_releases (
                      id, external_key, provider, media_kind, title, original_title, poster_url,
                      kind, release_date, release_time, release_at, timezone, region,
                      season, episode, episode_title, url, imdb_id, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(external_key) DO UPDATE SET
                      provider = excluded.provider,
                      media_kind = excluded.media_kind,
                      title = excluded.title,
                      original_title = excluded.original_title,
                      poster_url = excluded.poster_url,
                      kind = excluded.kind,
                      release_date = excluded.release_date,
                      release_time = excluded.release_time,
                      release_at = excluded.release_at,
                      timezone = excluded.timezone,
                      region = excluded.region,
                      season = excluded.season,
                      episode = excluded.episode,
                      episode_title = excluded.episode_title,
                      url = excluded.url,
                      imdb_id = excluded.imdb_id,
                      updated_at = excluded.updated_at
                    """.trimIndent(),
                    arrayOf(
                        UUID.randomUUID().toString(),
                        item.externalKey,
                        item.provider,
                        item.mediaKind,
                        item.title,
                        item.originalTitle,
                        item.posterUrl,
                        item.kind,
                        item.releaseDate,
                        item.releaseTime,
                        item.releaseAt,
                        item.timezone,
                        item.region,
                        item.season,
                        item.episode,
                        item.episodeTitle,
                        item.url,
                        item.imdbId,
                        now
                    )
                )
                saved++
            }
            db.setTransactionSuccessful()
            return saved
        } finally {
            db.endTransaction()
        }
    }

    fun globalReleases(from: String, to: String, kinds: List<String>): JSONArray {
        val where = mutableListOf("release_date >= ?", "release_date <= ?")
        val args = mutableListOf<String>(from, to)
        if (kinds.isNotEmpty()) {
            where.add("media_kind IN (${kinds.joinToString(", ") { "?" }})")
            args.addAll(kinds)
        }

        val result = JSONArray()
        db.rawQuery(
            """
            SELECT * FROM global_releases
            WHERE ${where.joinToString(" AND ")}
            ORDER BY release_date ASC, COALESCE(release_time, '99:99') ASC, title ASC
            """.trimIndent(),
            args.toTypedArray()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                fun text(column: String): String? {
                    val index = cursor.getColumnIndex(column)
                    return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
                }

                fun intOrNull(column: String): Int? {
                    val index = cursor.getColumnIndex(column)
                    return if (index < 0 || cursor.isNull(index)) null else cursor.getInt(index)
                }

                val provider = text("provider").orEmpty()
                val id = text("id")
                result.put(
                    JSONObject()
                        .put("id", id)
                        .put("mediaId", id)
                        .put("sourceId", "global:$provider")
                        .put("sourceName", if (provider == "anilist") "AniList — exibições" else "TMDB — lançamentos")
                        .put("provider", provider)
                        .put("mediaKind", text("media_kind"))
                        .put("title", text("title"))
                        .put("originalTitle", text("original_title") ?: JSONObject.NULL)
                        .put("posterUrl", text("poster_url") ?: JSONObject.NULL)
                        .put("episodeTitle", text("episode_title") ?: JSONObject.NULL)
                        .put("kind", text("kind"))
                        .put("season", intOrNull("season") ?: JSONObject.NULL)
                        .put("episode", intOrNull("episode") ?: JSONObject.NULL)
                        .put("releaseDate", text("release_date"))
                        .put("releaseTime", text("release_time") ?: JSONObject.NULL)
                        .put("releaseAt", text("release_at") ?: JSONObject.NULL)
                        .put("timezone", text("timezone"))
                        .put("region", text("region") ?: JSONObject.NULL)
                        .put("url", text("url") ?: JSONObject.NULL)
                        .put("imdbId", text("imdb_id") ?: JSONObject.NULL)
                        .put("inStremioLibrary", false)
                )
            }
        }
        return result
    }

    // ---------------------------------------------------------------------
    // Addons do Stremio
    // ---------------------------------------------------------------------

    fun stremioAddons(): List<StremioAddonRow> {
        val rows = mutableListOf<StremioAddonRow>()
        db.rawQuery(
            "SELECT * FROM stremio_addons ORDER BY enabled DESC, priority ASC, created_at ASC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) rows.add(stremioAddonFromCursor(cursor))
        }
        return rows
    }

    fun stremioAddon(id: String): StremioAddonRow? {
        db.rawQuery("SELECT * FROM stremio_addons WHERE id = ?", arrayOf(id)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return stremioAddonFromCursor(cursor)
        }
    }

    fun findStremioAddonByHash(urlHash: String): StremioAddonRow? {
        db.rawQuery("SELECT * FROM stremio_addons WHERE url_hash = ?", arrayOf(urlHash)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return stremioAddonFromCursor(cursor)
        }
    }

    private fun stremioAddonFromCursor(cursor: Cursor): StremioAddonRow {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        val encrypted = cursor.getString(cursor.getColumnIndexOrThrow("transport_url_enc"))
        val transportUrl = SecretCrypto.decrypt(encrypted).orEmpty()
        val manifestText = cursor.getString(cursor.getColumnIndexOrThrow("manifest_json"))
        val manifest = try {
            JSONObject(manifestText)
        } catch (error: Exception) {
            JSONObject()
        }

        return StremioAddonRow(
            id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
            addonId = text("addon_id"),
            name = cursor.getString(cursor.getColumnIndexOrThrow("name")),
            version = text("version"),
            description = text("description"),
            manifest = manifest,
            transportUrl = transportUrl,
            enabled = cursor.getInt(cursor.getColumnIndexOrThrow("enabled")) == 1,
            priority = cursor.getInt(cursor.getColumnIndexOrThrow("priority")),
            createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at"))
        )
    }

    fun insertStremioAddon(
        id: String,
        urlHash: String,
        transportUrl: String,
        addonId: String?,
        name: String,
        version: String?,
        description: String?,
        manifest: JSONObject,
        priority: Int
    ) {
        val now = nowIso()
        db.execSQL(
            """
            INSERT INTO stremio_addons (
              id, url_hash, transport_url_enc, addon_id, name, version, description,
              manifest_json, enabled, priority, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """.trimIndent(),
            arrayOf(
                id,
                urlHash,
                SecretCrypto.encrypt(transportUrl),
                addonId,
                name,
                version,
                description,
                manifest.toString(),
                priority,
                now,
                now
            )
        )
    }

    fun setStremioAddonEnabled(id: String, enabled: Boolean) {
        db.execSQL(
            "UPDATE stremio_addons SET enabled = ?, updated_at = ? WHERE id = ?",
            arrayOf(if (enabled) 1 else 0, nowIso(), id)
        )
    }

    fun deleteStremioAddon(id: String): Boolean {
        db.rawQuery("SELECT 1 FROM stremio_addons WHERE id = ?", arrayOf(id)).use { cursor ->
            if (!cursor.moveToFirst()) return false
        }
        db.execSQL("DELETE FROM stremio_addons WHERE id = ?", arrayOf(id))
        return true
    }

    fun countStremioAddons(): Int {
        db.rawQuery("SELECT COUNT(*) FROM stremio_addons", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    // ---------------------------------------------------------------------
    // Progresso local de reprodução
    // ---------------------------------------------------------------------

    fun playback(metaId: String, videoId: String): JSONObject? {
        db.rawQuery(
            "SELECT * FROM stremio_playback WHERE meta_id = ? AND video_id = ?",
            arrayOf(metaId, videoId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return playbackFromCursor(cursor)
        }
    }

    /** Progresso recente; 1 s já conta para "Continuar assistindo". */
    fun playbackContinue(limit: Int): JSONArray {
        val result = JSONArray()
        db.rawQuery(
            """
            SELECT * FROM stremio_playback
            WHERE completed = 0 AND position_ms > 1000
            ORDER BY updated_at DESC
            LIMIT ?
            """.trimIndent(),
            arrayOf(limit.coerceIn(1, 50).toString())
        ).use { cursor ->
            while (cursor.moveToNext()) result.put(playbackFromCursor(cursor))
        }
        return result
    }

    private fun playbackFromCursor(cursor: Cursor): JSONObject {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        fun intOrNull(column: String): Int? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getInt(index)
        }

        val position = cursor.getLong(cursor.getColumnIndexOrThrow("position_ms")).coerceAtLeast(0)
        val duration = intOrNull("duration_ms")?.toLong()
        val completed = intOrNull("completed") == 1
        val progress = if (duration != null && duration > 0) {
            (position.toDouble() / duration).coerceIn(0.0, 1.0)
        } else {
            0.0
        }

        return JSONObject()
            .put("metaId", cursor.getString(cursor.getColumnIndexOrThrow("meta_id")))
            .put("type", cursor.getString(cursor.getColumnIndexOrThrow("meta_type")))
            .put("videoId", cursor.getString(cursor.getColumnIndexOrThrow("video_id")))
            .put("season", intOrNull("season") ?: JSONObject.NULL)
            .put("episode", intOrNull("episode") ?: JSONObject.NULL)
            .put("positionMs", position)
            .put("durationMs", duration ?: JSONObject.NULL)
            .put("addonId", text("addon_id") ?: JSONObject.NULL)
            .put("streamSignature", text("stream_signature") ?: JSONObject.NULL)
            .put("name", text("name") ?: "")
            .put("poster", text("poster") ?: JSONObject.NULL)
            .put("backdrop", text("backdrop") ?: JSONObject.NULL)
            .put("year", intOrNull("year") ?: JSONObject.NULL)
            .put("progress", progress)
            .put("completed", completed)
            .put("updatedAt", cursor.getString(cursor.getColumnIndexOrThrow("updated_at")))
    }

    fun savePlayback(
        metaId: String,
        type: String,
        videoId: String,
        season: Int?,
        episode: Int?,
        positionMs: Long,
        durationMs: Long?,
        addonId: String?,
        streamSignature: String?,
        name: String,
        poster: String?,
        backdrop: String?,
        year: Int?,
        completed: Boolean
    ): JSONObject {
        val now = nowIso()
        db.execSQL(
            """
            INSERT INTO stremio_playback (
              id, meta_id, meta_type, video_id, season, episode, position_ms, duration_ms,
              addon_id, stream_signature, name, poster, backdrop, year, completed, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(meta_id, video_id) DO UPDATE SET
              meta_type = excluded.meta_type,
              season = excluded.season,
              episode = excluded.episode,
              position_ms = excluded.position_ms,
              duration_ms = excluded.duration_ms,
              addon_id = excluded.addon_id,
              stream_signature = excluded.stream_signature,
              name = excluded.name,
              poster = excluded.poster,
              backdrop = excluded.backdrop,
              year = excluded.year,
              completed = excluded.completed,
              updated_at = excluded.updated_at
            """.trimIndent(),
            arrayOf(
                "$metaId::$videoId",
                metaId,
                type,
                videoId,
                season,
                episode,
                positionMs.coerceAtLeast(0),
                durationMs?.takeIf { it > 0 },
                addonId,
                streamSignature,
                name,
                poster,
                backdrop,
                year,
                if (completed) 1 else 0,
                now
            )
        )
        return playback(metaId, videoId)
            ?: throw HubException(500, "database", "Não foi possível salvar o progresso.")
    }

    fun deletePlayback(metaId: String, videoId: String) {
        db.execSQL(
            "DELETE FROM stremio_playback WHERE meta_id = ? AND video_id = ?",
            arrayOf(metaId, videoId)
        )
    }

    // ---------------------------------------------------------------------
    // Conta e biblioteca do Stremio
    // ---------------------------------------------------------------------

    fun stremioAccountRow(): JSONObject? {
        db.rawQuery("SELECT * FROM stremio_account WHERE id = 1", null).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return JSONObject()
                .put("email", cursor.getString(cursor.getColumnIndexOrThrow("email")) ?: JSONObject.NULL)
                .put("authKey", cursor.getString(cursor.getColumnIndexOrThrow("auth_key")) ?: JSONObject.NULL)
                .put("expired", cursor.getInt(cursor.getColumnIndexOrThrow("expired")) == 1)
                .put("lastSyncAt", cursor.getString(cursor.getColumnIndexOrThrow("last_sync_at")) ?: JSONObject.NULL)
        }
    }

    fun stremioAuthKey(): String? {
        val row = stremioAccountRow() ?: return null
        val stored = row.optString("auth_key").takeIf { it.isNotEmpty() } ?: return null
        return SecretCrypto.decrypt(stored)
    }

    fun saveStremioAccount(email: String?, authKey: String) {
        val now = nowIso()
        db.execSQL(
            """
            INSERT INTO stremio_account (id, email, auth_key, connected_at, last_sync_at, expired, updated_at)
            VALUES (1, ?, ?, ?, NULL, 0, ?)
            ON CONFLICT(id) DO UPDATE SET
              email = excluded.email,
              auth_key = excluded.auth_key,
              connected_at = excluded.connected_at,
              expired = 0,
              updated_at = excluded.updated_at
            """.trimIndent(),
            arrayOf(email, SecretCrypto.encrypt(authKey), now, now)
        )
    }

    fun markStremioExpired() {
        db.execSQL("UPDATE stremio_account SET expired = 1, updated_at = ? WHERE id = 1", arrayOf(nowIso()))
    }

    fun touchStremioSync() {
        db.execSQL("UPDATE stremio_account SET last_sync_at = ?, updated_at = ? WHERE id = 1", arrayOf(nowIso(), nowIso()))
    }

    fun disconnectStremio() {
        db.execSQL("DELETE FROM stremio_account")
        db.execSQL("DELETE FROM stremio_library")
        db.execSQL("DELETE FROM stremio_library_state")
    }

    fun countStremioLibrary(): Int {
        db.rawQuery("SELECT COUNT(*) FROM stremio_library WHERE removed = 0", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    fun syncStremioLibrary(items: List<StremioLibraryItem>): Int {
        if (items.isEmpty()) return 0
        val now = nowIso()
        db.beginTransaction()
        try {
            for (item in items) {
                db.execSQL(
                    """
                    INSERT INTO stremio_library (
                      meta_id, imdb_id, type, name, poster, video_id, season, episode,
                      time_offset, duration, watched_video_id, last_watched_at, removed, temp, raw, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(meta_id) DO UPDATE SET
                      imdb_id = excluded.imdb_id,
                      type = excluded.type,
                      name = excluded.name,
                      poster = excluded.poster,
                      video_id = excluded.video_id,
                      season = excluded.season,
                      episode = excluded.episode,
                      time_offset = excluded.time_offset,
                      duration = excluded.duration,
                      watched_video_id = excluded.watched_video_id,
                      last_watched_at = excluded.last_watched_at,
                      removed = excluded.removed,
                      temp = excluded.temp,
                      raw = excluded.raw,
                      updated_at = excluded.updated_at
                    """.trimIndent(),
                    arrayOf(
                        item.metaId,
                        item.imdbId,
                        item.type,
                        item.name,
                        item.poster,
                        item.videoId,
                        item.season,
                        item.episode,
                        item.timeOffsetMs,
                        item.durationMs,
                        item.watchedVideoId,
                        item.lastWatchedAt,
                        if (item.removed) 1 else 0,
                        if (item.temp) 1 else 0,
                        item.raw,
                        now
                    )
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        touchStremioSync()
        return items.size
    }

    fun stremioLibrary(search: String?, limit: Int = 500): JSONArray {
        val query = search?.trim().orEmpty()
        val safeLimit = limit.coerceIn(1, 1000)
        val args = if (query.isEmpty()) {
            arrayOf(safeLimit.toString())
        } else {
            arrayOf("%${query.lowercase()}%", safeLimit.toString())
        }
        val where = if (query.isEmpty()) {
            "l.removed = 0"
        } else {
            "l.removed = 0 AND lower(l.name) LIKE ?"
        }

        val result = JSONArray()
        db.rawQuery(
            """
            SELECT l.*, COALESCE(s.is_favorite, 0) AS is_favorite,
                   COALESCE(s.is_watch_later, 0) AS is_watch_later,
                   EXISTS (
                     SELECT 1 FROM media m
                     WHERE m.imdb_id = l.imdb_id AND lower(m.raw) LIKE '%anima%'
                   ) AS media_animation
            FROM stremio_library l
            LEFT JOIN stremio_library_state s ON s.meta_id = l.meta_id
            WHERE $where
            ORDER BY COALESCE(l.last_watched_at, l.updated_at) DESC, l.name ASC
            LIMIT ?
            """.trimIndent(),
            args
        ).use { cursor ->
            while (cursor.moveToNext()) result.put(stremioItemFromCursor(cursor))
        }

        // Títulos salvos apenas no aparelho (favoritos, assistir depois e
        // Minha biblioteca) que não vieram da conta do Stremio.
        val stateArgs = if (query.isEmpty()) {
            arrayOf(safeLimit.toString())
        } else {
            arrayOf("%${query.lowercase()}%", safeLimit.toString())
        }
        db.rawQuery(
            """
            SELECT s.*,
                   EXISTS (
                     SELECT 1 FROM media m
                     WHERE m.imdb_id = s.meta_id AND lower(m.raw) LIKE '%anima%'
                   ) AS media_animation
            FROM stremio_library_state s
            WHERE NOT EXISTS (SELECT 1 FROM stremio_library l WHERE l.meta_id = s.meta_id)
              AND (s.in_library = 1 OR s.is_favorite = 1 OR s.is_watch_later = 1)
              ${if (query.isEmpty()) "" else "AND lower(COALESCE(s.name, s.meta_id)) LIKE ?"}
            ORDER BY COALESCE(s.added_at, s.updated_at) DESC
            LIMIT ?
            """.trimIndent(),
            stateArgs
        ).use { cursor ->
            while (cursor.moveToNext()) result.put(stremioLocalItemFromCursor(cursor))
        }

        return result
    }

    fun stremioLibraryItem(metaId: String): JSONObject? {
        db.rawQuery(
            """
            SELECT l.*, COALESCE(s.is_favorite, 0) AS is_favorite,
                   COALESCE(s.is_watch_later, 0) AS is_watch_later,
                   EXISTS (
                     SELECT 1 FROM media m
                     WHERE m.imdb_id = l.imdb_id AND lower(m.raw) LIKE '%anima%'
                   ) AS media_animation
            FROM stremio_library l
            LEFT JOIN stremio_library_state s ON s.meta_id = l.meta_id
            WHERE l.meta_id = ?
            """.trimIndent(),
            arrayOf(metaId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return stremioItemFromCursor(cursor)
        }
    }

    private fun isAnimeMetaId(metaId: String): Boolean =
        Regex("^(kitsu|anilist|mal|myanimelist|anidb):", RegexOption.IGNORE_CASE)
            .containsMatchIn(metaId)

    private fun stremioItemFromCursor(cursor: Cursor): JSONObject {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        fun intOrNull(column: String): Int? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getInt(index)
        }

        val metaId = cursor.getString(cursor.getColumnIndexOrThrow("meta_id"))
        val offset = cursor.getLong(cursor.getColumnIndexOrThrow("time_offset")).takeIf { it > 0 }
        val duration = intOrNull("duration")?.toLong()?.takeIf { it > 0 }
        val progress = if (offset != null && duration != null) {
            (offset.toDouble() / duration).coerceIn(0.0, 1.0)
        } else {
            0.0
        }
        val mediaAnimation = cursor.getColumnIndex("media_animation")
            .let { index -> index >= 0 && cursor.getInt(index) == 1 }

        return JSONObject()
            .put("metaId", metaId)
            .put("imdbId", text("imdb_id") ?: JSONObject.NULL)
            .put("videoId", text("video_id") ?: JSONObject.NULL)
            .put("type", cursor.getString(cursor.getColumnIndexOrThrow("type")))
            .put("name", cursor.getString(cursor.getColumnIndexOrThrow("name")))
            .put("poster", text("poster") ?: JSONObject.NULL)
            .put("season", intOrNull("season") ?: JSONObject.NULL)
            .put("episode", intOrNull("episode") ?: JSONObject.NULL)
            .put("progress", progress)
            .put("timeOffsetMs", offset ?: JSONObject.NULL)
            .put("durationMs", duration ?: JSONObject.NULL)
            .put("watchedVideoId", text("watched_video_id") ?: JSONObject.NULL)
            .put("lastWatchedAt", text("last_watched_at") ?: JSONObject.NULL)
            .put("isFavorite", cursor.getInt(cursor.getColumnIndexOrThrow("is_favorite")) == 1)
            .put("isWatchLater", cursor.getInt(cursor.getColumnIndexOrThrow("is_watch_later")) == 1)
            .put("inLibrary", true)
            .put("isLocal", intOrNull("temp") == 1)
            .put("isAnime", mediaAnimation || isAnimeMetaId(metaId))
    }

    /** Item que existe apenas em `stremio_library_state` (sem conta Stremio). */
    private fun stremioLocalItemFromCursor(cursor: Cursor): JSONObject {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        val metaId = cursor.getString(cursor.getColumnIndexOrThrow("meta_id"))
        val imdbId = Regex("^tt\\d{7,10}", RegexOption.IGNORE_CASE).find(metaId)?.value
        val mediaAnimation = cursor.getColumnIndex("media_animation")
            .let { index -> index >= 0 && cursor.getInt(index) == 1 }

        return JSONObject()
            .put("metaId", metaId)
            .put("imdbId", imdbId ?: JSONObject.NULL)
            .put("videoId", JSONObject.NULL)
            .put("type", if (text("meta_type") == "series") "series" else "movie")
            .put("name", text("name") ?: metaId)
            .put("poster", text("poster") ?: JSONObject.NULL)
            .put("season", JSONObject.NULL)
            .put("episode", JSONObject.NULL)
            .put("progress", 0.0)
            .put("timeOffsetMs", JSONObject.NULL)
            .put("durationMs", JSONObject.NULL)
            .put("watchedVideoId", JSONObject.NULL)
            .put("lastWatchedAt", text("added_at") ?: text("updated_at") ?: JSONObject.NULL)
            .put("isFavorite", cursor.getInt(cursor.getColumnIndexOrThrow("is_favorite")) == 1)
            .put("isWatchLater", cursor.getInt(cursor.getColumnIndexOrThrow("is_watch_later")) == 1)
            .put("inLibrary", cursor.getInt(cursor.getColumnIndexOrThrow("in_library")) == 1)
            .put("isLocal", true)
            .put("isAnime", mediaAnimation || isAnimeMetaId(metaId))
    }

    private data class StremioLocalState(
        val favorite: Boolean,
        val watchLater: Boolean,
        val inLibrary: Boolean,
        val metaType: String?,
        val name: String?,
        val poster: String?,
        val addedAt: String?
    )

    fun setStremioLibraryState(
        metaId: String,
        favorite: Boolean?,
        watchLater: Boolean?,
        inLibrary: Boolean?,
        type: String?,
        name: String?,
        poster: String?
    ): JSONObject {
        val now = nowIso()

        val existing = db.rawQuery(
            """
            SELECT is_favorite, is_watch_later, in_library, meta_type, name, poster, added_at
            FROM stremio_library_state WHERE meta_id = ?
            """.trimIndent(),
            arrayOf(metaId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) {
                null
            } else {
                StremioLocalState(
                    favorite = cursor.getInt(0) == 1,
                    watchLater = cursor.getInt(1) == 1,
                    inLibrary = cursor.getInt(2) == 1,
                    metaType = if (cursor.isNull(3)) null else cursor.getString(3),
                    name = if (cursor.isNull(4)) null else cursor.getString(4),
                    poster = if (cursor.isNull(5)) null else cursor.getString(5),
                    addedAt = if (cursor.isNull(6)) null else cursor.getString(6)
                )
            }
        }

        val library = stremioLibraryItem(metaId)
        val nextFavorite = favorite ?: existing?.favorite ?: library?.optBoolean("isFavorite") ?: false
        val nextLater = watchLater ?: existing?.watchLater ?: library?.optBoolean("isWatchLater") ?: false
        val nextInLibrary = inLibrary ?: existing?.inLibrary ?: (library != null)

        if (!nextFavorite && !nextLater && !nextInLibrary) {
            db.execSQL("DELETE FROM stremio_library_state WHERE meta_id = ?", arrayOf(metaId))
            return JSONObject()
                .put("metaId", metaId)
                .put("isFavorite", false)
                .put("isWatchLater", false)
                .put("inLibrary", false)
        }

        val metaType = (type ?: existing?.metaType ?: library?.optText("type"))
            ?.takeIf { it == "series" } ?: "movie"
        val title = name ?: existing?.name ?: library?.optText("name") ?: metaId
        val art = poster ?: existing?.poster ?: library?.optText("poster")
        val addedAt = existing?.addedAt ?: now

        db.execSQL(
            """
            INSERT INTO stremio_library_state (
              meta_id, meta_type, name, poster, in_library, is_favorite,
              is_watch_later, added_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(meta_id) DO UPDATE SET
              meta_type = excluded.meta_type,
              name = excluded.name,
              poster = excluded.poster,
              in_library = excluded.in_library,
              is_favorite = excluded.is_favorite,
              is_watch_later = excluded.is_watch_later,
              updated_at = excluded.updated_at
            """.trimIndent(),
            arrayOf(
                metaId,
                metaType,
                title,
                art,
                if (nextInLibrary) 1 else 0,
                if (nextFavorite) 1 else 0,
                if (nextLater) 1 else 0,
                addedAt,
                now
            )
        )

        return JSONObject()
            .put("metaId", metaId)
            .put("isFavorite", nextFavorite)
            .put("isWatchLater", nextLater)
            .put("inLibrary", nextInLibrary)
    }

    // ---------------------------------------------------------------------
    // Jogos (Steam)
    // ---------------------------------------------------------------------

    fun upsertSteamGame(app: SteamApp, inWishlist: Boolean): String {
        val now = nowIso()
        val today = Dates.todayInZone(null)
        var existingId: String? = null
        var previousLow: Int? = null

        db.rawQuery("SELECT id, official_low_cents FROM games WHERE appid = ?", arrayOf(app.appid.toString())).use { cursor ->
            if (cursor.moveToFirst()) {
                existingId = cursor.getString(0)
                previousLow = if (cursor.isNull(1)) null else cursor.getInt(1)
            }
        }

        val id: String
        if (existingId != null) {
            id = existingId!!
            val low = listOfNotNull(previousLow, app.finalCents).minOrNull()
            val atLow = app.finalCents != null && low != null && app.finalCents <= low

            db.execSQL(
                """
                UPDATE games SET
                  name = ?, cover_url = ?, header_url = ?, currency = ?,
                  steam_base_cents = ?, steam_final_cents = ?, steam_discount = ?,
                  current_official_cents = ?, official_low_cents = ?, is_at_low = ?,
                  in_wishlist = CASE WHEN ? = 1 THEN 1 ELSE in_wishlist END,
                  last_price_check_at = ?, updated_at = ?
                WHERE id = ?
                """.trimIndent(),
                arrayOf(
                    app.name,
                    app.coverUrl,
                    app.headerUrl,
                    app.currency,
                    app.baseCents,
                    app.finalCents,
                    app.discount,
                    app.finalCents,
                    low,
                    if (atLow) 1 else 0,
                    if (inWishlist) 1 else 0,
                    now,
                    now,
                    id
                )
            )
        } else {
            id = java.util.UUID.randomUUID().toString()
            db.execSQL(
                """
                INSERT INTO games (
                  id, appid, name, cover_url, header_url, currency,
                  target_price_cents, steam_base_cents, steam_final_cents, steam_discount,
                  current_official_cents, official_low_cents, is_at_low, in_wishlist,
                  origin, is_demo, added_at, metadata_fetched_at, last_price_check_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf(
                    id,
                    app.appid,
                    app.name,
                    app.coverUrl,
                    app.headerUrl,
                    app.currency,
                    app.baseCents,
                    app.finalCents,
                    app.discount,
                    app.finalCents,
                    app.finalCents,
                    if (app.finalCents != null) 1 else 0,
                    if (inWishlist) 1 else 0,
                    if (inWishlist) "wishlist" else "manual",
                    now,
                    now,
                    now,
                    now,
                    now
                )
            )
        }

        if (app.finalCents != null) {
            db.execSQL("DELETE FROM price_history WHERE game_id = ? AND day = ?", arrayOf(id, today))
            db.execSQL(
                "INSERT INTO price_history (game_id, day, official_cents, keyshop_cents, currency) VALUES (?, ?, ?, NULL, ?)",
                arrayOf<Any?>(id, today, app.finalCents, app.currency)
            )
        }

        return id
    }

    fun listGames(filter: String, sort: String, query: String): JSONObject {
        val where = mutableListOf("removed_at IS NULL")
        val args = mutableListOf<String>()

        when (filter) {
            "wishlist" -> where.add("in_wishlist = 1")
            "deals" -> where.add("steam_discount > 0")
            "at_low" -> where.add("is_at_low = 1")
        }
        if (query.isNotBlank()) {
            where.add("lower(name) LIKE ?")
            args.add("%${query.trim().lowercase()}%")
        }

        val order = when (sort) {
            "price" -> "current_official_cents IS NULL, current_official_cents ASC, name ASC"
            "name" -> "name ASC"
            "added" -> "added_at DESC"
            else -> "steam_discount DESC, name ASC"
        }

        val games = JSONArray()
        db.rawQuery(
            "SELECT * FROM games WHERE ${where.joinToString(" AND ")} ORDER BY $order LIMIT 500",
            args.toTypedArray()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                games.put(gameFromCursor(cursor, includeHistory = false))
            }
        }

        var wishlist = 0
        var deals = 0
        var atLow = 0
        db.rawQuery(
            "SELECT COALESCE(SUM(in_wishlist),0), COALESCE(SUM(CASE WHEN steam_discount > 0 THEN 1 ELSE 0 END),0), COALESCE(SUM(is_at_low),0), COUNT(*) FROM games WHERE removed_at IS NULL",
            null
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                wishlist = cursor.getInt(0)
                deals = cursor.getInt(1)
                atLow = cursor.getInt(2)
            }
        }

        return JSONObject()
            .put("games", games)
            .put(
                "stats",
                JSONObject()
                    .put("total", games.length())
                    .put("wishlist", wishlist)
                    .put("deals", deals)
                    .put("atLow", atLow)
            )
    }

    fun gameDetail(id: String): JSONObject? {
        db.rawQuery("SELECT * FROM games WHERE id = ?", arrayOf(id)).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return gameFromCursor(cursor, includeHistory = true)
        }
    }

    private fun gameFromCursor(cursor: Cursor, includeHistory: Boolean): JSONObject {
        fun text(column: String): String? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getString(index)
        }

        fun intOrNull(column: String): Int? {
            val index = cursor.getColumnIndex(column)
            return if (index < 0 || cursor.isNull(index)) null else cursor.getInt(index)
        }

        val id = cursor.getString(cursor.getColumnIndexOrThrow("id"))
        val base = intOrNull("steam_base_cents")
        val official = intOrNull("current_official_cents")
        val keyshop = intOrNull("current_keyshop_cents")

        fun discount(current: Int?): Int {
            if (base == null || base <= 0 || current == null || current >= base) return 0
            return Math.round((1.0 - current.toDouble() / base) * 100).toInt()
        }

        val sparkline = priceHistory(id, limit = 30)

        return JSONObject()
            .put("id", id)
            .put("appid", cursor.getInt(cursor.getColumnIndexOrThrow("appid")))
            .put("name", cursor.getString(cursor.getColumnIndexOrThrow("name")))
            .put("coverUrl", text("cover_url") ?: JSONObject.NULL)
            .put("headerUrl", text("header_url") ?: JSONObject.NULL)
            .put("currency", text("currency") ?: "BRL")
            .put("targetPriceCents", intOrNull("target_price_cents") ?: JSONObject.NULL)
            .put("steamBaseCents", base ?: JSONObject.NULL)
            .put("steamFinalCents", intOrNull("steam_final_cents") ?: JSONObject.NULL)
            .put("steamDiscount", intOrNull("steam_discount") ?: 0)
            .put("currentOfficialCents", official ?: JSONObject.NULL)
            .put("currentKeyshopCents", keyshop ?: JSONObject.NULL)
            .put("officialDiscount", discount(official))
            .put("keyshopDiscount", discount(keyshop))
            .put("officialLowCents", intOrNull("official_low_cents") ?: JSONObject.NULL)
            .put("keyshopLowCents", intOrNull("keyshop_low_cents") ?: JSONObject.NULL)
            .put("isAtLow", intOrNull("is_at_low") == 1)
            .put("inWishlist", intOrNull("in_wishlist") == 1)
            .put("origin", text("origin") ?: "manual")
            .put("priority", intOrNull("priority") ?: JSONObject.NULL)
            .put("isDemo", intOrNull("is_demo") == 1)
            .put("ggUrl", text("gg_url") ?: JSONObject.NULL)
            .put("lastPriceCheckAt", text("last_price_check_at") ?: JSONObject.NULL)
            .put("addedAt", text("added_at") ?: "")
            .put("removedAt", text("removed_at") ?: JSONObject.NULL)
            .put("sparkline", sparkline)
            .put("history", if (includeHistory) priceHistory(id, limit = 365) else JSONArray())
    }

    private fun priceHistory(gameId: String, limit: Int): JSONArray {
        val result = JSONArray()
        db.rawQuery(
            """
            SELECT day, official_cents, keyshop_cents FROM price_history
            WHERE game_id = ?
            ORDER BY day DESC
            LIMIT ?
            """.trimIndent(),
            arrayOf(gameId, limit.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                result.put(
                    JSONObject()
                        .put("day", cursor.getString(0))
                        .put(
                            "officialCents",
                            if (cursor.isNull(1)) JSONObject.NULL else cursor.getInt(1)
                        )
                        .put(
                            "keyshopCents",
                            if (cursor.isNull(2)) JSONObject.NULL else cursor.getInt(2)
                        )
                )
            }
        }

        // Do mais antigo para o mais recente, como o gráfico espera.
        val ordered = JSONArray()
        for (index in result.length() - 1 downTo 0) ordered.put(result.get(index))
        return ordered
    }

    /**
     * Cria/atualiza um card de alerta por jogo quando o preço bate o alvo ou
     * atinge o menor valor já visto. Dedupe por appid: o mesmo card é
     * atualizado em vez de duplicar no feed.
     */
    fun upsertPriceDropItems(sourceId: String, prices: List<GgPrice>): Int {
        if (prices.isEmpty()) return 0
        val now = nowIso()
        var created = 0

        for (price in prices) {
            if (!price.found) continue
            val game = db.rawQuery(
                """
                SELECT id, appid, name, target_price_cents, current_official_cents,
                       current_keyshop_cents, is_at_low, gg_url, header_url
                FROM games WHERE appid = ?
                """.trimIndent(),
                arrayOf(price.appid.toString())
            ).use { cursor ->
                if (!cursor.moveToFirst()) null else cursor
            } ?: continue

            val id = game.getString(0)
            val name = game.getString(2)
            val target = if (game.isNull(3)) null else game.getInt(3)
            val official = if (game.isNull(4)) null else game.getInt(4)
            val keyshop = if (game.isNull(5)) null else game.getInt(5)
            val atLow = game.getInt(6) == 1
            val ggUrl = if (game.isNull(7)) null else game.getString(7)
            val header = if (game.isNull(8)) null else game.getString(8)
            game.close()

            val best = listOfNotNull(official, keyshop).minOrNull() ?: continue
            val bestKind = if (keyshop != null && keyshop == best) "keyshop" else "official"
            val belowTarget = target != null && best <= target
            if (!belowTarget && !atLow) continue

            val priceLabel = SteamGames.formatCents(best, price.currency)
            val title = if (belowTarget) "$name — $priceLabel (seu alvo)"
            else "$name — $priceLabel (menor preço)"
            val description = if (belowTarget && target != null) {
                "Bateu o preço-alvo de ${SteamGames.formatCents(target, price.currency)}."
            } else {
                "Menor preço registrado até agora."
            }
            val url = ggUrl ?: "https://store.steampowered.com/app/${price.appid}/"
            val meta = JSONObject()
                .put("gameId", id)
                .put("appid", price.appid)
                .put("priceCents", best)
                .put("priceKind", bestKind)
                .put("targetPriceCents", target ?: JSONObject.NULL)
                .put("ggUrl", ggUrl ?: JSONObject.NULL)

            db.execSQL(
                """
                INSERT INTO items (
                  id, source_id, external_id, dedupe_key, category_id, kind, title, url,
                  thumbnail_url, description, author, published_at, discovered_at,
                  is_read, is_favorite, is_watch_later, is_hidden, meta
                ) VALUES (?, ?, ?, ?, 'game', 'price_drop', ?, ?, ?, ?, NULL, ?, ?, 0, 0, 0, 0, ?)
                ON CONFLICT(dedupe_key) DO UPDATE SET
                  title = excluded.title,
                  url = excluded.url,
                  thumbnail_url = excluded.thumbnail_url,
                  description = excluded.description,
                  published_at = excluded.published_at,
                  discovered_at = excluded.discovered_at,
                  is_read = 0,
                  read_at = NULL,
                  meta = excluded.meta
                """.trimIndent(),
                arrayOf(
                    UUID.randomUUID().toString(),
                    sourceId,
                    "game:${price.appid}",
                    "price:${price.appid}",
                    title,
                    url,
                    header,
                    description,
                    now,
                    now,
                    meta.toString()
                )
            )
            created++
        }

        return created
    }

    /** Títulos dos alertas de preço mais recentes (para a notificação). */
    fun priceDropTitles(limit: Int): List<String> {
        val titles = mutableListOf<String>()
        db.rawQuery(
            "SELECT title FROM items WHERE kind = 'price_drop' AND is_hidden = 0 ORDER BY discovered_at DESC LIMIT ?",
            arrayOf(limit.coerceIn(1, 10).toString())
        ).use { cursor ->
            while (cursor.moveToNext()) titles.add(cursor.getString(0))
        }
        return titles
    }

    /** Remove capítulos offline antigos; devolve quantos saíram do cache. */
    fun pruneNovelOffline(days: Int): Int {
        val cutoff = Dates.iso(System.currentTimeMillis() - days.coerceIn(1, 365) * 86_400_000L)
        return db.delete("novel_cache", "kind = 'chapter' AND fetched_at < ?", arrayOf(cutoff))
    }

    /** Aplica os preços do gg.deals e devolve quantos jogos foram atualizados. */
    fun applyGgPrices(prices: List<GgPrice>): Int {
        if (prices.isEmpty()) return 0
        val now = nowIso()
        val today = Dates.todayInZone(null)
        var updated = 0

        db.beginTransaction()
        try {
            for (price in prices) {
                if (!price.found) continue
                val row = db.rawQuery(
                    "SELECT id, official_low_cents, keyshop_low_cents FROM games WHERE appid = ?",
                    arrayOf(price.appid.toString())
                ).use { cursor ->
                    if (!cursor.moveToFirst()) {
                        null
                    } else {
                        Triple(
                            cursor.getString(0),
                            if (cursor.isNull(1)) null else cursor.getInt(1),
                            if (cursor.isNull(2)) null else cursor.getInt(2)
                        )
                    }
                } ?: continue

                val (id, previousOfficialLow, previousKeyshopLow) = row
                val officialLow = listOfNotNull(previousOfficialLow, price.officialLowCents, price.officialCents)
                    .minOrNull()
                val keyshopLow = listOfNotNull(previousKeyshopLow, price.keyshopLowCents, price.keyshopCents)
                    .minOrNull()
                val officialAtLow = price.officialCents != null && officialLow != null &&
                    price.officialCents <= officialLow
                val keyshopAtLow = price.keyshopCents != null && keyshopLow != null &&
                    price.keyshopCents <= keyshopLow

                db.execSQL(
                    """
                    UPDATE games SET
                      currency = ?,
                      current_official_cents = COALESCE(?, current_official_cents),
                      current_keyshop_cents = COALESCE(?, current_keyshop_cents),
                      official_low_cents = ?,
                      keyshop_low_cents = ?,
                      is_at_low = ?,
                      gg_url = COALESCE(?, gg_url),
                      last_price_check_at = ?,
                      updated_at = ?
                    WHERE id = ?
                    """.trimIndent(),
                    arrayOf(
                        price.currency,
                        price.officialCents,
                        price.keyshopCents,
                        officialLow,
                        keyshopLow,
                        if (officialAtLow || keyshopAtLow) 1 else 0,
                        price.ggUrl,
                        now,
                        now,
                        id
                    )
                )

                db.execSQL("DELETE FROM price_history WHERE game_id = ? AND day = ?", arrayOf(id, today))
                db.execSQL(
                    "INSERT INTO price_history (game_id, day, official_cents, keyshop_cents, currency) VALUES (?, ?, ?, ?, ?)",
                    arrayOf<Any?>(id, today, price.officialCents, price.keyshopCents, price.currency)
                )
                updated++
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return updated
    }

    /** Appids com preço mais antigo, para atualização em segundo plano. */
    fun gamesForPriceCheck(limit: Int): List<Int> {
        val result = mutableListOf<Int>()
        db.rawQuery(
            """
            SELECT appid FROM games
            WHERE removed_at IS NULL
            ORDER BY last_price_check_at IS NOT NULL, last_price_check_at ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(limit.coerceIn(1, 100).toString())
        ).use { cursor ->
            while (cursor.moveToNext()) result.add(cursor.getInt(0))
        }
        return result
    }

    fun updateGameTarget(id: String, targetPriceCents: Int?): JSONObject? {        db.execSQL(
            "UPDATE games SET target_price_cents = ?, updated_at = ? WHERE id = ?",
            arrayOf(targetPriceCents, nowIso(), id)
        )
        return gameDetail(id)
    }

    fun deleteGame(id: String): Boolean {
        db.rawQuery("SELECT 1 FROM games WHERE id = ?", arrayOf(id)).use { cursor ->
            if (!cursor.moveToFirst()) return false
        }
        db.execSQL("DELETE FROM games WHERE id = ?", arrayOf(id))
        return true
    }

    fun countGames(): Int {
        db.rawQuery("SELECT COUNT(*) FROM games WHERE removed_at IS NULL", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    // ---------------------------------------------------------------------
    // Backup: linhas cruas e importação
    // ---------------------------------------------------------------------

    private val BACKUP_TABLES = setOf(
        "games", "price_history", "media", "release_events", "global_releases",
        "items", "stremio_playback", "stremio_library", "stremio_library_state", "novel_cache"
    )

    private val SAFE_COLUMN = Regex("^[a-z_][a-z0-9_]*$")

    fun rawRows(table: String): List<JSONObject> {
        if (table !in BACKUP_TABLES) return emptyList()
        val rows = mutableListOf<JSONObject>()
        db.rawQuery("SELECT * FROM $table", null).use { cursor ->
            while (cursor.moveToNext()) {
                val row = JSONObject()
                for (index in 0 until cursor.columnCount) {
                    val name = cursor.getColumnName(index)
                    when (cursor.getType(index)) {
                        Cursor.FIELD_TYPE_NULL -> row.put(name, JSONObject.NULL)
                        Cursor.FIELD_TYPE_INTEGER -> row.put(name, cursor.getLong(index))
                        Cursor.FIELD_TYPE_FLOAT -> row.put(name, cursor.getDouble(index))
                        else -> row.put(name, cursor.getString(index))
                    }
                }
                rows.add(row)
            }
        }
        return rows
    }

    fun importRow(table: String, row: JSONObject) {
        if (table !in BACKUP_TABLES) return
        val columns = row.keys().asSequence()
            .filter { SAFE_COLUMN.matches(it) }
            .toList()
        if (columns.isEmpty()) return

        val values = columns.map { key ->
            when (val value = row.opt(key)) {
                null, JSONObject.NULL -> null
                is Boolean -> if (value) 1 else 0
                is Number -> value
                else -> value.toString()
            }
        }.toTypedArray()

        val placeholders = columns.joinToString(", ") { "?" }
        val names = columns.joinToString(", ")
        db.execSQL("INSERT OR REPLACE INTO $table ($names) VALUES ($placeholders)", values)
    }

    fun upsertCategoryFromBackup(id: String, label: String, icon: String, color: String) {
        db.execSQL(
            """
            INSERT INTO categories (id, label, icon, color, sort_order, is_system)
            VALUES (?, ?, ?, ?, 100, 0)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label,
              icon = excluded.icon,
              color = excluded.color
            """.trimIndent(),
            arrayOf(id, label, icon, color)
        )
    }

    /** Restaura um addon do backup (URL cifrada de novo, dedupe por hash). */
    fun importAddon(
        transportUrl: String,
        manifest: org.json.JSONObject,
        name: String,
        enabled: Boolean,
        priority: Int
    ) {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(transportUrl.toByteArray(Charsets.UTF_8))
        val hash = digest.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
        val now = nowIso()

        db.execSQL("DELETE FROM stremio_addons WHERE url_hash = ?", arrayOf(hash))
        db.execSQL(
            """
            INSERT INTO stremio_addons (
              id, url_hash, transport_url_enc, addon_id, name, version, description,
              manifest_json, enabled, priority, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            arrayOf(
                java.util.UUID.randomUUID().toString(),
                hash,
                SecretCrypto.encrypt(transportUrl),
                manifest.optText("id"),
                name,
                manifest.optText("version"),
                manifest.optText("description"),
                manifest.toString(),
                if (enabled) 1 else 0,
                priority,
                now,
                now
            )
        )
    }

    fun importSource(        id: String,
        type: String,
        name: String,
        categoryId: String,
        config: JSONObject,
        enabled: Boolean,
        intervalMinutes: Int
    ) {
        if (!categoryExists(categoryId)) {
            upsertCategoryFromBackup(categoryId, categoryId, "rss", "#8b96a8")
        }
        val now = nowIso()
        db.execSQL(
            """
            INSERT INTO sources (
              id, type, name, category_id, config, state, enabled, interval_minutes,
              next_run_at, is_demo, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              type = excluded.type,
              name = excluded.name,
              category_id = excluded.category_id,
              config = excluded.config,
              enabled = excluded.enabled,
              interval_minutes = excluded.interval_minutes,
              updated_at = excluded.updated_at
            """.trimIndent(),
            arrayOf(
                id, type, name, categoryId, config.toString(),
                if (enabled) 1 else 0, intervalMinutes, now, now
            )
        )
    }

    // ---------------------------------------------------------------------
    // Cache/offline de novels
    // ---------------------------------------------------------------------

    fun cacheNovelChapter(
        url: String,
        title: String,
        text: String,
        bookTitle: String,
        chapterIndex: Int?,
        expiresAt: String
    ) {
        val data = org.json.JSONObject()
            .put("url", url)
            .put("title", title)
            .put("text", text)
            .put("bookTitle", bookTitle)
            .put("chapterIndex", chapterIndex ?: org.json.JSONObject.NULL)
        db.execSQL(
            """
            INSERT INTO novel_cache (cache_key, kind, data, fetched_at, expires_at)
            VALUES (?, 'chapter', ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              data = excluded.data,
              fetched_at = excluded.fetched_at,
              expires_at = excluded.expires_at
            """.trimIndent(),
            arrayOf(url, data.toString(), nowIso(), expiresAt)
        )
    }

    fun cachedNovelChapter(url: String): org.json.JSONObject? {
        db.rawQuery(
            "SELECT data FROM novel_cache WHERE cache_key = ? AND kind = 'chapter'",
            arrayOf(url)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return try {
                org.json.JSONObject(cursor.getString(0))
            } catch (error: Exception) {
                null
            }
        }
    }

    /** Agrupa os capítulos baixados por livro. */
    fun novelOfflineBooks(): org.json.JSONArray {
        val books = org.json.JSONArray()
        val grouped = LinkedHashMap<String, Pair<Int, String>>()

        db.rawQuery(
            "SELECT data, fetched_at FROM novel_cache WHERE kind = 'chapter' ORDER BY fetched_at DESC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val data = try {
                    org.json.JSONObject(cursor.getString(0))
                } catch (error: Exception) {
                    continue
                }
                val bookTitle = data.optString("bookTitle").ifEmpty { "Novel" }
                val fetchedAt = cursor.getString(1)
                val current = grouped[bookTitle]
                grouped[bookTitle] = (current?.first ?: 0) + 1 to (current?.second ?: fetchedAt)
            }
        }

        for ((title, value) in grouped) {
            books.put(
                org.json.JSONObject()
                    .put("bookId", bookIdOf(title))
                    .put("title", title)
                    .put("chapterCount", value.first)
                    .put("updatedAt", value.second)
                    .put("author", org.json.JSONObject.NULL)
                    .put("coverUrl", org.json.JSONObject.NULL)
            )
        }
        return books
    }

    fun novelOfflineBook(bookId: String): org.json.JSONObject? {
        val chapters = org.json.JSONArray()
        var title: String? = null

        db.rawQuery(
            "SELECT data FROM novel_cache WHERE kind = 'chapter' ORDER BY fetched_at ASC",
            null
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val data = try {
                    org.json.JSONObject(cursor.getString(0))
                } catch (error: Exception) {
                    continue
                }
                val bookTitle = data.optString("bookTitle").ifEmpty { "Novel" }
                if (bookIdOf(bookTitle) != bookId) continue
                title = bookTitle
                chapters.put(
                    org.json.JSONObject()
                        .put("url", data.optString("url"))
                        .put("name", data.optString("title"))
                        .put("index", if (data.has("chapterIndex")) data.opt("chapterIndex") else org.json.JSONObject.NULL)
                        .put("fetchedAt", data.optString("url"))
                )
            }
        }

        val bookTitle = title ?: return null
        return org.json.JSONObject()
            .put("bookId", bookId)
            .put("title", bookTitle)
            .put("chapters", chapters)
    }

    fun deleteNovelChapters(urls: List<String>): Int {
        if (urls.isEmpty()) return 0
        var removed = 0
        for (url in urls.distinct()) {
            db.execSQL("DELETE FROM novel_cache WHERE cache_key = ?", arrayOf(url))
            removed++
        }
        return removed
    }

    private fun bookIdOf(title: String): String = android.util.Base64.encodeToString(
        title.toByteArray(Charsets.UTF_8),
        android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING
    )

    // ---------------------------------------------------------------------
    // Saúde / estatísticas
    // ---------------------------------------------------------------------

    fun healthCounts(): JSONObject {
        var sources = 0
        var demo = 0
        db.rawQuery("SELECT COUNT(*) AS total, COALESCE(SUM(is_demo), 0) AS demo FROM sources", null).use { cursor ->
            if (cursor.moveToFirst()) {
                sources = cursor.getInt(0)
                demo = cursor.getInt(1)
            }
        }
        var items = 0
        var unread = 0
        db.rawQuery(
            "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread FROM items",
            null
        ).use { cursor ->
            if (cursor.moveToFirst()) {
                items = cursor.getInt(0)
                unread = cursor.getInt(1)
            }
        }
        var games = 0
        db.rawQuery("SELECT COUNT(*) FROM games", null).use { cursor ->
            if (cursor.moveToFirst()) games = cursor.getInt(0)
        }
        var demoGames = 0
        db.rawQuery("SELECT COALESCE(SUM(is_demo), 0) FROM games", null).use { cursor ->
            if (cursor.moveToFirst()) demoGames = cursor.getInt(0)
        }

        return JSONObject()
            .put("sources", sources)
            .put("items", items)
            .put("unread", unread)
            .put("games", games)
            .put("demo", demo > 0 || demoGames > 0)
    }

    fun close() {
        db.close()
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private fun encodeCursor(publishedAt: String, id: String): String {
        val raw = "$publishedAt|$id".toByteArray(Charsets.UTF_8)
        return Base64.encodeToString(raw, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun decodeCursor(token: String?): Pair<String, String>? {
        if (token.isNullOrEmpty()) return null
        return try {
            val padded = token + "=".repeat((4 - token.length % 4) % 4)
            val decoded = String(Base64.decode(padded, Base64.URL_SAFE), Charsets.UTF_8)
            val separator = decoded.indexOf('|')
            if (separator <= 0) null else decoded.substring(0, separator) to decoded.substring(separator + 1)
        } catch (error: Exception) {
            null
        }
    }

    private fun feedCutoffIso(hours: Int): String {
        val safeHours = hours.coerceIn(1, 168)
        return ISO.format(Instant.now().minusSeconds(safeHours * 3600L))
    }

    private fun jsonObjectOrEmpty(text: String?): JSONObject =
        jsonObjectOrNull(text) ?: JSONObject()

    private fun jsonObjectOrNull(text: String?): JSONObject? {
        if (text.isNullOrBlank()) return null
        return try {
            val value = JSONTokener(text).nextValue()
            value as? JSONObject
        } catch (error: Exception) {
            null
        }
    }

    private fun parseJsonValue(text: String?): Any? {
        if (text == null) return null
        return try {
            JSONTokener(text).nextValue()
        } catch (error: Exception) {
            null
        }
    }

    private fun boolean(value: Any?, fallback: Boolean): Boolean = value as? Boolean ?: fallback

    /** Serializa um valor escalar de configuração como JSON. */
    private fun encodeSettingValue(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is String -> JSONObject.quote(value)
        is Boolean, is Number -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun string(value: Any?, fallback: String): String = value as? String ?: fallback

    private fun number(value: Any?): Double? = when (value) {
        is Number -> value.toDouble()
        else -> null
    }

    private fun clamp(value: Any?, fallback: Int, min: Int, max: Int): Int {
        val parsed = number(value) ?: return fallback
        return Math.round(parsed).toInt().coerceIn(min, max)
    }

    private fun clampDecimal(value: Any?, fallback: Double, min: Double, max: Double): Double {
        val parsed = number(value) ?: return fallback
        val bounded = parsed.coerceIn(min, max)
        return Math.round(bounded * 100.0) / 100.0
    }

    private fun color(value: Any?, fallback: String): String {
        val text = value as? String ?: return fallback
        return if (COLOR_PATTERN.matches(text.trim())) text.trim().lowercase() else fallback
    }

    private fun language(value: Any?): String {
        val text = value as? String ?: return DEFAULTS.subtitleLanguage
        return if (SUBTITLE_LANGUAGE_PATTERN.matches(text.trim())) text.trim().lowercase()
        else DEFAULTS.subtitleLanguage
    }

    private fun parseTheme(value: Any?): String =
        if (value == "light" || value == "system" || value == "dark") value as String else DEFAULTS.theme

    private fun parseAppLanguage(value: Any?): String =
        if (value == "en" || value == "es" || value == "pt") value as String else DEFAULTS.language

    private fun slugify(value: String): String {
        val normalized = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{Mn}+"), "")
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
        return normalized.take(40)
    }

    private object DEFAULTS {
        const val theme = "dark"
        const val language = "pt"
        const val introEnabled = true
        const val introAudio = true
        const val defaultIntervalMinutes = 30
        const val feedRefreshSeconds = 300
        const val hoverPreviewSeconds = 3
        const val feedWindowHours = 48
        const val novelCacheRetentionHours = 168
        const val novelCacheCleanupHours = 6
        const val novelChaptersOffline = true
        const val novelOfflineRetentionDays = 7
        const val timezone = "America/Sao_Paulo"
        const val region = "BR"
        const val currency = "BRL"
        const val streamCacheTtlHours = 24
        const val torrentCacheRetentionDays = 7
        const val autoMaintenanceEnabled = true
        const val playerSkipSeconds = 10
        const val subtitleLanguage = "por"
        const val subtitleFontSize = 22
        const val subtitleColor = "#ffffff"
        const val subtitleBackgroundColor = "#000000"
        const val subtitleBackgroundOpacity = 65
        const val subtitleLineHeight = 1.32
        const val subtitlePosition = 85
    }

    companion object {
        const val FAVORITES_TAB_ID = "__favorites"
        const val WATCH_LATER_TAB_ID = "__watch_later"

        private const val DB_NAME = "hub.db"
        private const val MIGRATIONS_DIR = "db/migrations"
        private const val VISIBLE_ITEM_FILTER =
            "i.is_hidden = 0 AND (s.type <> 'youtube' OR i.published_at >= ?)"

        private val ISO: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
        private val COLOR_PATTERN = Regex("^#[0-9a-f]{6}$", RegexOption.IGNORE_CASE)
        private val SUBTITLE_LANGUAGE_PATTERN = Regex("^([a-z0-9-]{2,12}|off)$", RegexOption.IGNORE_CASE)

        /**
         * Lista em `SystemCategories.kt`; o CI compara com `@hub/shared`.
         */
        private val SETTINGS_KEYS = listOf(
            "theme", "language", "introEnabled", "introAudio", "defaultIntervalMinutes",
            "feedRefreshSeconds", "hoverPreviewSeconds", "feedWindowHours",
            "novelCacheRetentionHours", "novelCacheCleanupHours", "novelChaptersOffline",
            "novelOfflineRetentionDays", "timezone", "region", "currency",
            "streamCacheTtlHours", "torrentCacheRetentionDays", "autoMaintenanceEnabled",
            "playerSkipSeconds", "subtitleLanguage", "subtitleFontSize", "subtitleColor",
            "subtitleBackgroundColor", "subtitleBackgroundOpacity", "subtitleLineHeight",
            "subtitlePosition"
        )

        private fun nowIso(): String = ISO.format(Instant.now())
    }
}
