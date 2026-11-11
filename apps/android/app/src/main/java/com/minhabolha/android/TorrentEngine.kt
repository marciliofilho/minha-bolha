package com.minhabolha.android

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.libtorrent4j.Priority
import org.libtorrent4j.SessionManager
import org.libtorrent4j.Sha1Hash
import org.libtorrent4j.TorrentHandle
import org.libtorrent4j.TorrentInfo
import org.libtorrent4j.swig.torrent_flags_t
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Motor de torrents do app Android.
 *
 * Usa libtorrent4j (mesma base do LibreTorrent) com download **sequencial** e
 * serve o arquivo escolhido por HTTP com Range. As leituras acontecem direto
 * do arquivo no disco: esperamos o pedaço ficar disponível (`havePiece`) antes
 * de ler, o que evita acessar buffers nativos.
 *
 * Se a biblioteca nativa não carregar (ABI ausente), [available] vira false e
 * as rotas respondem 503 — o resto do app segue funcionando.
 */
object TorrentEngine {

    private const val TAG = "MinhaBolha"
    private const val METADATA_TIMEOUT_MS = 45_000L
    private const val PIECE_TIMEOUT_MS = 90_000L
    private const val POLL_MS = 250L

    data class Session(
        val id: String,
        val infoHash: String,
        val handle: TorrentHandle,
        val saveDir: File,
        val fileIndex: Int,
        val fileName: String,
        val fileLength: Long,
        val fileOffset: Long,
        val filePath: File
    )

    private var manager: SessionManager? = null

    @Volatile
    var available: Boolean = true
        private set

    @Volatile
    var lastError: String? = null
        private set

    private val sessions = ConcurrentHashMap<String, Session>()

    // ---------------------------------------------------------------------
    // Ciclo de vida
    // ---------------------------------------------------------------------

    @Synchronized
    private fun manager(context: Context): SessionManager? {
        manager?.let { return it }
        if (!available) return null
        return try {
            val created = SessionManager()
            created.start()
            manager = created
            created
        } catch (error: Throwable) {
            available = false
            lastError = error.message ?: error.javaClass.simpleName
            Log.e(TAG, "libtorrent indisponível: $lastError")
            null
        }
    }

    /** Garante que a sessão nativa está pronta; usado pelo diagnóstico/CI. */
    fun ensure(context: Context): Boolean {
        manager(context)
        return available
    }

    fun stop() {
        sessions.clear()
        try {
            manager?.stop()
        } catch (error: Throwable) {
            Log.w(TAG, "falha ao parar o libtorrent", error)
        }
        manager = null
    }

    // ---------------------------------------------------------------------
    // Preparação
    // ---------------------------------------------------------------------

    fun prepare(
        context: Context,
        infoHash: String,
        fileIdx: Int?,
        sources: List<String>
    ): JSONObject {
        val hash = infoHash.trim().lowercase()
        if (!HASH_PATTERN.matches(hash)) {
            throw HubException(400, "validation", "Info hash inválido.")
        }
        val sessionManager = manager(context)
            ?: throw HubException(503, "not_supported", "Motor de torrents indisponível neste aparelho.")

        val existing = sessions.values.firstOrNull { it.infoHash == hash }
        if (existing != null) {
            return dto(existing)
        }

        val magnet = buildMagnet(hash, sources)
        val saveDir = File(context.filesDir, "torrents").apply { mkdirs() }

        try {
            sessionManager.download(magnet, saveDir, torrent_flags_t())
        } catch (error: Throwable) {
            throw HubException(502, "torrent", "Não foi possível iniciar o torrent: ${error.message}")
        }

        val sha1 = try {
            Sha1Hash.parseHex(hash)
        } catch (error: Throwable) {
            throw HubException(400, "validation", "Info hash inválido.")
        }

        val handle = waitForHandle(sessionManager, sha1)
            ?: throw HubException(502, "torrent", "O torrent não foi aceito pelo motor.")

        val deadline = System.currentTimeMillis() + METADATA_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (handle.status().hasMetadata()) break
            Thread.sleep(POLL_MS)
        }
        if (!handle.status().hasMetadata()) {
            throw HubException(
                504,
                "torrent",
                "Os metadados do torrent não chegaram. Verifique a conexão e tente novamente."
            )
        }

        val info: TorrentInfo = try {
            handle.torrentFile()
        } catch (error: Throwable) {
            throw HubException(502, "torrent", "Não foi possível ler o torrent: ${error.message}")
        }

        val files = info.files()
        val count = files.numFiles()
        if (count <= 0) throw HubException(502, "torrent", "O torrent não tem arquivos.")

        val chosen = fileIdx?.takeIf { it in 0 until count } ?: largestVideoFile(files, count)
        val fileName = File(files.filePath(chosen)).name

        // Só o arquivo escolhido interessa para o player.
        val priorities = Array(count) { index ->
            if (index == chosen) Priority.DEFAULT else Priority.IGNORE
        }
        handle.prioritizeFiles(priorities)

        val fileOffset = files.fileOffset(chosen)
        val fileLength = files.fileSize(chosen)
        val pieceLength = info.pieceLength().coerceAtLeast(1)
        val firstPiece = (fileOffset / pieceLength).toInt()
        handle.setSequentialRange(firstPiece)

        val relative = files.filePath(chosen)
        val filePath = File(saveDir, relative)
        filePath.parentFile?.mkdirs()

        val session = Session(
            id = UUID.randomUUID().toString(),
            infoHash = hash,
            handle = handle,
            saveDir = saveDir,
            fileIndex = chosen,
            fileName = fileName,
            fileLength = fileLength,
            fileOffset = fileOffset,
            filePath = filePath
        )

        sessions[session.id] = session
        Log.i(TAG, "torrent pronto: $fileName (${fileLength / 1024 / 1024} MB)")
        return dto(session)
    }

    private fun waitForHandle(sessionManager: SessionManager, sha1: Sha1Hash): TorrentHandle? {
        val deadline = System.currentTimeMillis() + 15_000
        while (System.currentTimeMillis() < deadline) {
            val handle = try {
                sessionManager.find(sha1)
            } catch (error: Throwable) {
                null
            }
            if (handle != null && handle.isValid) return handle
            Thread.sleep(POLL_MS)
        }
        return null
    }

    private fun buildMagnet(infoHash: String, sources: List<String>): String {
        val builder = StringBuilder("magnet:?xt=urn:btih:").append(infoHash)
        val trackers = sources
            .mapNotNull { source ->
                when {
                    source.startsWith("tracker:") -> source.removePrefix("tracker:")
                    source.startsWith("udp://") || source.startsWith("http://") ||
                        source.startsWith("https://") -> source
                    else -> null
                }
            }
            .distinct()

        for (tracker in trackers) {
            builder.append("&tr=").append(java.net.URLEncoder.encode(tracker, "UTF-8"))
        }
        builder.append("&tr=").append(
            java.net.URLEncoder.encode("udp://tracker.opentrackr.org:1337/announce", "UTF-8")
        )
        builder.append("&tr=").append(
            java.net.URLEncoder.encode("udp://open.demonii.com:1337/announce", "UTF-8")
        )
        return builder.toString()
    }

    private fun largestVideoFile(files: org.libtorrent4j.FileStorage, count: Int): Int {
        var best = 0
        var bestSize = -1L
        for (index in 0 until count) {
            val path = files.filePath(index).lowercase()
            val isVideo = VIDEO_EXTENSIONS.any { path.endsWith(it) }
            val size = files.fileSize(index)
            if (isVideo && size > bestSize) {
                best = index
                bestSize = size
            }
        }
        if (bestSize >= 0) return best

        for (index in 0 until count) {
            val size = files.fileSize(index)
            if (size > bestSize) {
                best = index
                bestSize = size
            }
        }
        return best
    }

    private fun dto(session: Session): JSONObject {
        val container = session.fileName.substringAfterLast('.', "").lowercase()
        val directPlayable = container in setOf("mp4", "m4v", "webm")

        return JSONObject()
            .put("sessionId", session.id)
            .put("infoHash", session.infoHash)
            .put("fileIdx", session.fileIndex)
            .put("fileName", session.fileName)
            .put("fileLength", session.fileLength)
            .put("durationSec", JSONObject.NULL)
            .put("container", container.ifEmpty { null } ?: JSONObject.NULL)
            .put("videoCodec", JSONObject.NULL)
            .put("audioTracks", JSONArray())
            .put("directUrl", "/api/stremio/torrent/${session.id}/raw")
            .put("directPlayable", directPlayable)
            .put("hlsUrl", JSONObject.NULL)
            .put("audioHlsUrls", JSONArray())
            .put("error", JSONObject.NULL)
    }

    fun session(id: String): Session? = sessions[id]

    fun status(sessionId: String): JSONObject? {
        val session = sessions[sessionId] ?: return null
        return try {
            val status = session.handle.status()
            JSONObject()
                .put("sessionId", session.id)
                .put("infoHash", session.infoHash)
                .put("fileName", session.fileName)
                .put("fileLength", session.fileLength)
                .put("progress", status.progress())
                .put("downloadRate", status.downloadRate())
                .put("peers", status.numPeers())
                .put("done", status.totalDone())
                .put("seeding", status.isSeeding())
        } catch (error: Throwable) {
            null
        }
    }

    // ---------------------------------------------------------------------
    // Leitura com Range
    // ---------------------------------------------------------------------

    /**
     * Lê [length] bytes do arquivo a partir de [offset], esperando os pedaços
     * necessários ficarem disponíveis. Devolve menos bytes só no fim do arquivo.
     */
    fun read(session: Session, offset: Long, length: Int): ByteArray {
        if (offset >= session.fileLength) return ByteArray(0)

        val end = minOf(offset + length, session.fileLength)
        val info = session.handle.torrentFile()
        val pieceLength = info.pieceLength().coerceAtLeast(1)
        val absoluteStart = session.fileOffset + offset
        val absoluteEnd = session.fileOffset + end - 1

        val firstPiece = (absoluteStart / pieceLength).toInt()
        val lastPiece = (absoluteEnd / pieceLength).toInt()
        val deadline = System.currentTimeMillis() + PIECE_TIMEOUT_MS

        for (piece in firstPiece..lastPiece) {
            while (!session.handle.havePiece(piece)) {
                if (System.currentTimeMillis() > deadline) {
                    throw java.io.IOException("Peça $piece ainda não baixada.")
                }
                Thread.sleep(POLL_MS)
            }
        }

        RandomAccessFile(session.filePath, "r").use { file ->
            file.seek(absoluteStart)
            val buffer = ByteArray((end - offset).toInt())
            file.readFully(buffer)
            return buffer
        }
    }

    fun remove(sessionId: String) {
        val session = sessions.remove(sessionId) ?: return
        try {
            manager?.remove(session.handle)
        } catch (error: Throwable) {
            Log.w(TAG, "falha ao remover torrent", error)
        }
        try {
            session.filePath.delete()
        } catch (error: Throwable) {
            Log.w(TAG, "falha ao apagar arquivo do torrent", error)
        }
    }
    private val HASH_PATTERN = Regex("^[a-f0-9]{40}$|^[a-z2-7]{32}$")

    private val VIDEO_EXTENSIONS = listOf(
        ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".ts", ".m2ts"
    )
}
