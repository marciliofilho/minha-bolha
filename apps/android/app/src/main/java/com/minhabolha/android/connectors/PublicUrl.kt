package com.minhabolha.android.connectors

import java.net.InetAddress
import java.net.URL

/**
 * Guarda contra SSRF para URLs fornecidas pelo usuário.
 *
 * Espelha `apps/api/src/lib/ssrf.ts`: bloqueia loopback, rede local, link-local
 * e CGNAT, inclusive quando o DNS resolve para um desses endereços. O app é
 * local, mas uma fonte maliciosa não deve poder sondar a rede doméstica.
 */
object PublicUrl {

    fun assert(raw: String): URL {
        val url = try {
            URL(raw.trim())
        } catch (error: Exception) {
            throw ConnectorError("config", "URL inválida. Inclua http:// ou https://.")
        }

        if (url.protocol != "http" && url.protocol != "https") {
            throw ConnectorError("config", "Apenas URLs http ou https são aceitas.")
        }

        val host = url.host.lowercase()
        if (host.isEmpty()) throw ConnectorError("config", "URL sem domínio.")
        if (isPrivateHost(host)) {
            throw ConnectorError("config", "Endereços da rede local não são permitidos.")
        }

        try {
            val addresses = InetAddress.getAllByName(host)
            if (addresses.any { isPrivateHost(it.hostAddress.orEmpty()) }) {
                throw ConnectorError("config", "O endereço aponta para a rede local.")
            }
        } catch (error: ConnectorError) {
            throw error
        } catch (error: Exception) {
            // Falha de DNS: o fetch reporta o erro de rede real.
        }

        return url
    }

    private fun isPrivateHost(host: String): Boolean {
        val value = host.lowercase().trim('[', ']')
        if (value == "localhost" || value.endsWith(".localhost")) return true
        if (value.endsWith(".local") || value.endsWith(".internal") || value.endsWith(".home.arpa")) {
            return true
        }
        if (value.contains(':')) return isPrivateIpv6(value)
        return isPrivateIpv4(value)
    }

    private fun isPrivateIpv4(value: String): Boolean {
        val parts = value.split('.')
        if (parts.size != 4) return false
        val octets = parts.map { it.toIntOrNull() ?: return false }
        if (octets.any { it < 0 || it > 255 }) return false
        val (a, b) = octets[0] to octets[1]
        if (a == 10 || a == 127 || a == 0) return true
        if (a == 169 && b == 254) return true
        if (a == 192 && b == 168) return true
        if (a == 172 && b in 16..31) return true
        if (a == 100 && b in 64..127) return true // CGNAT
        return false
    }

    private fun isPrivateIpv6(value: String): Boolean {
        if (value == "::1" || value == "::") return true
        if (value.startsWith("fc") || value.startsWith("fd")) return true
        if (value.startsWith("fe8") || value.startsWith("fe9") ||
            value.startsWith("fea") || value.startsWith("feb")
        ) {
            return true
        }
        val mapped = Regex("^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$").find(value)
        if (mapped != null) return isPrivateIpv4(mapped.groupValues[1])
        return false
    }
}
