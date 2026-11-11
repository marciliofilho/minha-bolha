package com.minhabolha.android

import java.io.InputStream

/**
 * Stream SSE mínimo para `/api/events`.
 *
 * O app ainda não tem um scheduler emitindo eventos, então o endpoint apenas
 * mantém a conexão aberta com heartbeats. Isso evita que o `EventSource` do
 * React entre em um ciclo de reconexões. Quando os conectores forem portados,
 * este stream passa a receber os eventos reais.
 */
class EventStream(
    private val intervalMs: Long = 15_000,
    private val maxEvents: Int = 240
) : InputStream() {

    private var buffer = "retry: 3000\n\n".toByteArray()
    private var offset = 0
    private var sent = 0

    @Volatile
    private var closed = false

    override fun read(): Int {
        val single = ByteArray(1)
        val count = read(single, 0, 1)
        return if (count == -1) -1 else single[0].toInt() and 0xFF
    }

    override fun read(target: ByteArray, targetOffset: Int, length: Int): Int {
        if (closed) return -1
        if (offset >= buffer.size) {
            if (sent >= maxEvents) return -1
            try {
                Thread.sleep(intervalMs)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                return -1
            }
            sent++
            buffer = ": keep-alive\n\n".toByteArray()
            offset = 0
        }
        val count = minOf(length, buffer.size - offset)
        System.arraycopy(buffer, offset, target, targetOffset, count)
        offset += count
        return count
    }

    override fun close() {
        closed = true
    }
}
