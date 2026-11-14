package com.minhabolha.android

import com.minhabolha.android.connectors.ConnectorError
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException

/** Códigos curtos usados pela interface para explicar falhas de addon. */
object AddonDiagnostics {

    fun hostOf(url: String?): String? = try {
        if (url.isNullOrBlank()) null else URI(url).host
    } catch (error: Exception) {
        null
    }

    fun codeOf(error: Throwable): String = when (error) {
        is UnknownHostException -> "dns"
        is SocketTimeoutException -> "timeout"
        is ConnectorError -> error.diagnostic ?: when (error.code) {
            "dns" -> "dns"
            "timeout" -> "timeout"
            "auth" -> "auth"
            "blocked" -> "blocked"
            "not_found" -> "not_found"
            "rate_limited" -> "rate_limited"
            "config" -> "invalid"
            "layout_changed" -> "invalid"
            else -> "network"
        }
        else -> "unknown"
    }
}
