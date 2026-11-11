package com.minhabolha.android

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Banco mínimo do spike: prova que SQLite funciona no mesmo processo do
 * servidor local e da WebView.
 */
class SpikeDatabase(context: Context) :
    SQLiteOpenHelper(context, "spike.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execSQL(
            "INSERT INTO settings (key, value) VALUES ('spike', 'sqlite-ok')"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS settings")
        onCreate(db)
    }

    fun health(): String {
        return try {
            readableDatabase.rawQuery(
                "SELECT value FROM settings WHERE key = 'spike'",
                null
            ).use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else "sqlite-empty"
            }
        } catch (error: Exception) {
            "sqlite-error: ${error.message ?: error.javaClass.simpleName}"
        }
    }
}
