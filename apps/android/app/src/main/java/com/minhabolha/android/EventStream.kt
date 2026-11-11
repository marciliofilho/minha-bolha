package com.minhabolha.android

import org.json.JSONObject
import java.io.InputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import android.util.Log

/**
 * Hub SSE: mantém os clientes de `/api/events` e entrega os eventos do
 * scheduler, como o `sse.ts` do desktop.
 */
class EventHub {

    private val streams = CopyOnWriteArrayList<EventStream>()

    fun createStream(): EventStream = EventStream(this)

    internal fun register(stream: EventStream) {
        streams.add(stream)
        if (BuildConfig.DEBUG) Log.i("MinhaBolha", "sse: cliente conectado (${streams.size})")
    }

    internal fun unregister(stream: EventStream) {
        streams.remove(stream)
        if (BuildConfig.DEBUG) Log.i("MinhaBolha", "sse: cliente desconectado (${streams.size})")
    }

    fun broadcast(type: String, payload: JSONObject = JSONObject()) {
        if (streams.isEmpty()) {
            if (BuildConfig.DEBUG) Log.i("MinhaBolha", "sse: evento $type sem clientes")
            return
        }
        if (BuildConfig.DEBUG) Log.i("MinhaBolha", "sse: evento $type para ${streams.size} cliente(s)")

        val message = JSONObject().put("type", type)
        val keys = payload.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            message.put(key, payload.get(key))
        }

        val frame = "data: $message\n\n"
        for (stream in streams) {
            stream.send(frame)
        }
    }

    fun closeAll() {
        for (stream in streams.toList()) stream.close()
        streams.clear()
    }
}

/**
 * Stream SSE com fila: heartbeats quando não há eventos e entrega imediata
 * quando o scheduler publica algo.
 */
class EventStream(
    private val hub: EventHub,
    private val heartbeatMs: Long = 15_000
) : InputStream() {

    private val queue = LinkedBlockingQueue<ByteArray>()
    private var pending = "retry: 3000\n\n".toByteArray()
    private var offset = 0

    @Volatile
    private var closed = false

    init {
        hub.register(this)
    }

    internal fun send(frame: String) {
        if (closed) return
        queue.offer(frame.toByteArray(Charsets.UTF_8))
    }

    override fun read(): Int {
        val single = ByteArray(1)
        val count = read(single, 0, 1)
        return if (count == -1) -1 else single[0].toInt() and 0xFF
    }

    override fun read(target: ByteArray, targetOffset: Int, length: Int): Int {
        if (closed) return -1
        if (offset >= pending.size) {
            val next = try {
                queue.poll(heartbeatMs, TimeUnit.MILLISECONDS)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                return -1
            }
            pending = next ?: ": keep-alive\n\n".toByteArray()
            offset = 0
        }
        val count = minOf(length, pending.size - offset)
        System.arraycopy(pending, offset, target, targetOffset, count)
        offset += count
        return count
    }

    override fun close() {
        closed = true
        hub.unregister(this)
    }
}
