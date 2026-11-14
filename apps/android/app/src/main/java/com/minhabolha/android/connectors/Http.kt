package com.minhabolha.android.connectors

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Resultado de uma requisição de texto. */
data class HttpResult(
    val text: String,
    val status: Int,
    val contentType: String,
    val finalUrl: String
)

/**
 * Cliente HTTP único dos conectores (espelho de `connectors/http.ts`):
 * timeout, retry, limite de tamanho e tradução de erros para [ConnectorError].
 */
object Http {

    private const val DEFAULT_TIMEOUT_MS = 20_000L
    private const val MAX_BYTES = 8 * 1024 * 1024

    private const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/126.0 Mobile Safari/537.36 MinhaBolha/0.5 (+local personal reader)"

    const val DEFAULT_ACCEPT =
        "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8"

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .readTimeout(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    fun fetchText(
        url: String,
        accept: String = DEFAULT_ACCEPT,
        headers: Map<String, String> = emptyMap(),
        retries: Int = 2,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): HttpResult = request(url, null, accept, headers, retries, timeoutMs)

    /** POST JSON (GraphQL do AniList). */
    fun postJson(
        url: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
        retries: Int = 2,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS
    ): HttpResult = request(url, body, "application/json", headers, retries, timeoutMs)

    private fun request(
        url: String,
        body: String?,
        accept: String,
        extraHeaders: Map<String, String>,
        retries: Int,
        timeoutMs: Long
    ): HttpResult {
        var lastError: Throwable? = null

        for (attempt in 0..retries) {
            try {
                val requestBody = body?.toRequestBody("application/json".toMediaTypeOrNull())
                val request = Request.Builder()
                    .url(url)
                    .header("user-agent", USER_AGENT)
                    .header("accept", accept)
                    .header("accept-language", "pt-BR,pt;q=0.9,en;q=0.7")
                    .apply { extraHeaders.forEach { (key, value) -> header(key, value) } }
                    .apply {
                        if (requestBody != null) post(requestBody) else get()
                    }
                    .build()

                val callClient = client.newBuilder()
                    .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .build()

                callClient.newCall(request).execute().use { response ->
                    val code = response.code
                    if (!response.isSuccessful) {
                        val retriable = code == 429 || code >= 500
                        if (retriable && attempt < retries) {
                            Thread.sleep(700L * (attempt + 1))
                            return@use
                        }
                        throw statusError(code, url)
                    }

                    val declared = response.header("content-length")?.toLongOrNull() ?: 0L
                    if (declared > MAX_BYTES) {
                        throw ConnectorError(
                            "network",
                            "Resposta grande demais (${declared / 1024} KB)."
                        )
                    }

                    val body = response.body?.string().orEmpty()
                    if (body.length > MAX_BYTES) {
                        throw ConnectorError("network", "Resposta excedeu o limite de tamanho.")
                    }

                    return HttpResult(
                        text = body,
                        status = code,
                        contentType = response.header("content-type").orEmpty(),
                        finalUrl = response.request.url.toString()
                    )
                }
            } catch (error: ConnectorError) {
                throw error
            } catch (error: IOException) {
                lastError = error
                if (attempt < retries) {
                    try {
                        Thread.sleep(700L * (attempt + 1))
                    } catch (interrupted: InterruptedException) {
                        Thread.currentThread().interrupt()
                        throw ConnectorError("network", "Requisição interrompida.")
                    }
                }
            }
        }

        val host = try {
            java.net.URI(url).host
        } catch (error: Exception) {
            null
        }
        val diagnostic = when {
            lastError is java.net.UnknownHostException -> "dns"
            lastError is java.net.SocketTimeoutException -> "timeout"
            else -> "network"
        }
        val message = when {
            lastError is java.net.UnknownHostException ->
                "Domínio do addon não encontrado (DNS): ${host ?: url}."
            lastError is java.net.SocketTimeoutException ->
                "O addon demorou demais para responder."
            lastError != null -> lastError.message ?: "Falha de rede."
            else -> "Falha de rede."
        }
        throw ConnectorError("network", message, diagnostic)
    }

    private fun statusError(status: Int, url: String): ConnectorError {
        val safe = sanitizeUrl(url)
        return when (status) {
            401 -> ConnectorError(
                "auth",
                "Autenticação recusada (HTTP 401) em $safe. Confira a chave da API.",
                "auth"
            )

            403 -> ConnectorError("blocked", "Acesso negado (HTTP 403) em $safe.", "blocked")
            404, 410 -> ConnectorError(
                "not_found",
                "Endereço não encontrado (HTTP $status).",
                "not_found"
            )
            429 -> ConnectorError(
                "rate_limited",
                "O site limitou as requisições (HTTP 429).",
                "rate_limited"
            )
            else -> ConnectorError(
                "network",
                "Resposta inesperada do servidor (HTTP $status).",
                "http"
            )
        }
    }

    private fun sanitizeUrl(url: String): String = try {
        val parsed = java.net.URL(url)
        "${parsed.protocol}://${parsed.host}${parsed.path}"
    } catch (error: Exception) {
        "servidor remoto"
    }
}
