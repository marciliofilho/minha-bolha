package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import org.json.JSONObject

/**
 * Conta do Stremio: login, status, sincronização da biblioteca e a fonte
 * automática que mantém a lista atualizada pelo scheduler.
 *
 * A senha nunca é gravada; o authKey fica cifrado com o Android Keystore.
 */
object StremioAccount {

    private const val SOURCE_TYPE = "stremio-library"

    fun status(database: HubDatabase): JSONObject {
        val row = database.stremioAccountRow()
        val authKey = database.stremioAuthKey()
        val expired = row?.optBoolean("expired") == true || (row != null && authKey == null)
        return JSONObject()
            .put("connected", row != null && authKey != null && !expired)
            .put("email", row?.optString("email")?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
            .put("expired", expired)
            .put("lastSyncAt", row?.optString("last_sync_at")?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
            .put("libraryCount", database.countStremioLibrary())
            .put("appSecretConfigured", true)
    }

    fun login(database: HubDatabase, email: String, password: String): JSONObject {
        if (email.isBlank() || password.isEmpty()) {
            throw HubException(400, "validation", "Informe e-mail e senha.")
        }
        val (authKey, resolvedEmail) = try {
            StremioApi.login(email.trim(), password)
        } catch (error: ConnectorError) {
            throw HubException(if (error.code == "auth") 401 else 502, error.code, error.message ?: "Falha no login.")
        }

        database.saveStremioAccount(resolvedEmail, authKey)
        syncLibrary(database)
        ensureSource(database)
        return status(database)
    }

    fun saveAuthKey(database: HubDatabase, authKey: String, email: String?): JSONObject {
        val trimmed = authKey.trim()
        if (trimmed.isEmpty()) throw HubException(400, "validation", "Informe a chave de sessão.")

        // Valida a chave lendo a biblioteca uma vez antes de gravar.
        val items = try {
            StremioApi.fetchLibrary(trimmed)
        } catch (error: ConnectorError) {
            throw HubException(if (error.code == "auth") 401 else 502, error.code, error.message ?: "Chave inválida.")
        }

        database.saveStremioAccount(email?.takeIf { it.isNotBlank() }, trimmed)
        database.syncStremioLibrary(items)
        ensureSource(database)
        return status(database)
    }

    fun disconnect(database: HubDatabase): JSONObject {
        database.disconnectStremio()
        database.sourceByType(SOURCE_TYPE)?.let { database.updateSource(it.getString("id"), enabled = false) }
        return status(database)
    }

    fun syncLibrary(database: HubDatabase): Int {
        val authKey = database.stremioAuthKey()
            ?: throw HubException(401, "auth", "Conta do Stremio não conectada.")

        val items = try {
            StremioApi.fetchLibrary(authKey)
        } catch (error: ConnectorError) {
            if (error.code == "auth") database.markStremioExpired()
            throw HubException(if (error.code == "auth") 401 else 502, error.code, error.message ?: "Falha ao sincronizar.")
        }

        return database.syncStremioLibrary(items)
    }

    /** Cria/ativa a fonte da biblioteca quando conectado; desativa ao sair. */
    fun ensureSource(database: HubDatabase): JSONObject? {
        val status = status(database)
        val connected = status.optBoolean("connected")
        val existing = database.sourceByType(SOURCE_TYPE)

        if (!connected) {
            if (existing != null && existing.optBoolean("enabled")) {
                database.updateSource(existing.getString("id"), enabled = false)
            }
            return existing
        }

        if (existing != null) {
            if (!existing.optBoolean("enabled")) {
                database.updateSource(existing.getString("id"), enabled = true)
            }
            return database.source(existing.getString("id")) ?: existing
        }

        return database.createSource(
            type = SOURCE_TYPE,
            name = "Biblioteca Stremio",
            categoryId = "other",
            config = JSONObject().put("provider", "stremio"),
            intervalMinutes = 60
        )
    }
}
