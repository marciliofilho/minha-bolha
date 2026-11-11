package com.minhabolha.android

import android.content.Context
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import java.net.ServerSocket

/**
 * Ciclo de vida único do backend local.
 *
 * O servidor, o banco e o scheduler pertencem ao processo — não à Activity.
 * Assim uma rotação de tela (ou qualquer recriação da Activity) não abre uma
 * segunda porta nem cria um segundo scheduler.
 */
object HubRuntime {

    private const val TAG = "MinhaBolha"
    private const val PREFERRED_PORT = 47821

    private var database: HubDatabase? = null
    private var scheduler: HubScheduler? = null
    private var events: EventHub? = null
    private var server: HubServer? = null
    private var port: Int = 0

    /** Sobe o backend se ainda não estiver ativo e devolve a porta local. */
    @Synchronized
    fun start(context: Context): Int {
        server?.let { return port }

        val appContext = context.applicationContext
        val hubDatabase = HubDatabase(appContext)
        val hubEvents = EventHub()

        // Liga os conectores ao banco: chaves cifradas e mídia já salva.
        com.minhabolha.android.connectors.Registry.configure(
            secrets = object : com.minhabolha.android.connectors.SecretAccess {
                override fun value(key: String): String? = hubDatabase.secretValue(key)
            },
            mediaLookup = { sourceId -> hubDatabase.mediaBySource(sourceId) }
        )

        // O calendário global é criado no primeiro boot (AniList não exige chave).
        GlobalReleasesSource.ensure(hubDatabase)

        val hubScheduler = HubScheduler(hubDatabase, hubEvents)

        for (candidate in listOf(PREFERRED_PORT, 0)) {
            val candidatePort = if (candidate == 0) {
                ServerSocket(0).use { it.localPort }
            } else {
                candidate
            }
            val started = try {
                HubServer(
                    context = appContext,
                    port = candidatePort,
                    database = hubDatabase,
                    scheduler = hubScheduler,
                    events = hubEvents,
                    version = BuildConfig.VERSION_NAME
                ).also {
                    it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                }
            } catch (error: Exception) {
                Log.e(TAG, "falha ao iniciar o servidor local na porta $candidatePort", error)
                null
            }

            if (started != null) {
                server = started
                database = hubDatabase
                events = hubEvents
                scheduler = hubScheduler
                port = candidatePort
                hubScheduler.start()

                // O calendário global é atualizado assim que o app abre.
                GlobalReleasesSource.find(hubDatabase)?.let {
                    hubScheduler.enqueueSource(it.getString("id"), false)
                }

                Log.i(TAG, "backend local ativo em 127.0.0.1:$candidatePort")
                return candidatePort
            }
        }

        hubDatabase.close()
        return 0
    }

    @Synchronized
    fun stop() {
        scheduler?.stop()
        scheduler = null
        server?.stop()
        server = null
        events?.closeAll()
        events = null
        database?.close()
        database = null
        port = 0
        Log.i(TAG, "backend local encerrado")
    }
}
