package com.minhabolha.android

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response

/**
 * Servidor HTTP local do spike.
 *
 * Na versão final ele será o backend Kotlin que serve a UI React e implementa
 * os endpoints /api. Neste spike existem apenas o health check e a página de
 * diagnóstico.
 */
class SpikeServer(
    private val context: Context,
    private val port: Int,
    private val database: SpikeDatabase
) : NanoHTTPD("127.0.0.1", port) {

    override fun serve(session: IHTTPSession): Response {
        return when (session.uri) {
            "/", "/index.html" -> serveAsset("web/index.html", "text/html; charset=utf-8")
            "/api/health" -> {
                val body = """
                    {"ok":true,"platform":"android","version":"0.1.0-spike","port":$port,"database":"${escape(database.health())}"}
                """.trimIndent()
                newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", body)
            }
            "/favicon.ico" -> newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
            else -> newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                "text/plain; charset=utf-8",
                "Rota não encontrada: ${session.uri}"
            )
        }
    }

    private fun serveAsset(path: String, mime: String): Response {
        return try {
            val body = context.assets.open(path).bufferedReader().use { it.readText() }
            newFixedLengthResponse(Response.Status.OK, mime, body)
        } catch (error: Exception) {
            newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                "text/plain; charset=utf-8",
                "Asset ausente: $path"
            )
        }
    }

    private fun escape(value: String): String {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
    }
}
