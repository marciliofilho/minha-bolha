package com.minhabolha.android

import java.io.InputStream

/**
 * Stream de leitura do arquivo do torrent.
 *
 * Cada `read` espera os pedaços necessários ficarem disponíveis e lê direto do
 * disco, então o player consegue começar antes do download terminar e buscar
 * (seek) em qualquer ponto.
 */
class TorrentRangeStream(
    private val session: TorrentEngine.Session,
    offset: Long,
    private val length: Long
) : InputStream() {

    private var position = offset
    private var read = 0L

    override fun read(): Int {
        val single = ByteArray(1)
        val count = read(single, 0, 1)
        return if (count == -1) -1 else single[0].toInt() and 0xFF
    }

    override fun read(target: ByteArray, targetOffset: Int, targetLength: Int): Int {
        if (read >= length) return -1
        if (targetLength == 0) return 0

        val remaining = length - read
        val chunk = minOf(targetLength.toLong(), remaining, MAX_CHUNK).toInt()

        val buffer = try {
            TorrentEngine.read(session, position, chunk)
        } catch (error: Exception) {
            throw java.io.IOException(error.message ?: "falha ao ler o torrent", error)
        }
        if (buffer.isEmpty()) return -1

        System.arraycopy(buffer, 0, target, targetOffset, buffer.size)
        position += buffer.size
        read += buffer.size
        return buffer.size
    }

    override fun close() {
        // A sessão do torrent continua viva para o player poder buscar.
    }

    private companion object {
        const val MAX_CHUNK = 512L * 1024
    }
}
