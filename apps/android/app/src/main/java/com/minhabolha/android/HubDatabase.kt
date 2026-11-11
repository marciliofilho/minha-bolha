package com.minhabolha.android

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

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
        database.execSQL("PRAGMA journal_mode = WAL")
        database.execSQL("PRAGMA foreign_keys = ON")
        database.execSQL("PRAGMA busy_timeout = 5000")
        database.execSQL("PRAGMA synchronous = NORMAL")

        migrate(database)
        ensureSystemCategories(database)
        return database
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

    fun sources(): JSONArray {
        val cutoff = feedCutoffIso(48)
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
            ORDER BY s.is_demo ASC, s.name ASC
            """.trimIndent(),
            arrayOf(cutoff, cutoff, cutoff, cutoff)
        ).use { cursor ->
            while (cursor.moveToNext()) result.put(sourceFromCursor(cursor))
        }
        return result
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
