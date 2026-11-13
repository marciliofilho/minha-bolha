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
    private var extractor: NovelExtractor? = null
    private var port: Int = 0

    /** Sobe o backend se ainda não estiver ativo e devolve a porta local. */
    @Synchronized
    fun start(context: Context): Int {
        server?.let { return port }

        val appContext = context.applicationContext
        val hubDatabase = HubDb.get(appContext)
        val hubEvents = EventHub()

        // Ligação dos conectores ao banco e ao extrator de novels.
        val novelExtractor = NovelExtractor(appContext)
        com.minhabolha.android.connectors.Registry.configure(
            secrets = object : com.minhabolha.android.connectors.SecretAccess {
                override fun value(key: String): String? = hubDatabase.secretValue(key)
            },
            mediaLookup = { sourceId -> hubDatabase.mediaBySource(sourceId) },
            stremioAuthKey = { hubDatabase.stremioAuthKey() },
            novelExtractor = { novelExtractor },
            gamesProvider = { hubDatabase.gamesForPriceCheck(20) }
        )

        // O calendário global é criado no primeiro boot (AniList não exige chave).
        GlobalReleasesSource.ensure(hubDatabase)

        // Reconecta a fonte da biblioteca se a conta do Stremio estiver salva.
        StremioAccount.ensureSource(hubDatabase)
        GgDealsSource.ensure(hubDatabase)

        val hubScheduler = HubScheduler(appContext, hubDatabase, hubEvents)


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
                    extractor = novelExtractor,
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
                extractor = novelExtractor
                port = candidatePort
                hubScheduler.start()

                // Primeiro boot: instala Cinemeta e OpenSubtitles v3. Roda em
                // segundo plano para não atrasar a abertura do app.
                Thread {
                    val prefs = appContext.getSharedPreferences(
                        "hub_defaults",
                        Context.MODE_PRIVATE
                    )
                    if (prefs.getBoolean("stremio_defaults_v1", false)) return@Thread
                    val ok = runCatching {
                        StremioCatalog.ensureDefaults(hubDatabase)
                    }.getOrDefault(false)
                    if (ok) {
                        prefs.edit().putBoolean("stremio_defaults_v1", true).apply()
                        hubEvents.broadcast("stremio:changed")
                    }
                }.start()

                // O calendário global é atualizado assim que o app abre.
                GlobalReleasesSource.find(hubDatabase)?.let {
                    hubScheduler.enqueueSource(it.getString("id"), false)
                }

                Log.i(TAG, "backend local ativo em 127.0.0.1:$candidatePort")

                // Sincroniza mesmo com o app fechado (a cada ~6h).
                BackgroundSync.schedule(appContext)

                return candidatePort
            }
        }
        return 0
    }

    /** Dá ao extrator uma janela real (chamado pela Activity). */
    @Synchronized
    fun attachExtractor(root: android.view.ViewGroup) {
        extractor?.attach(root)
    }

    /** Libera o WebView oculto de novels antes de abrir o player nativo. */
    @Synchronized
    fun releaseExtractorMemory() {
        extractor?.dispose()
    }

    @Synchronized
    fun stop() {
        scheduler?.stop()
        scheduler = null
        server?.stop()
        server = null
        events?.closeAll()
        events = null
        TorrentEngine.stop()
        extractor?.dispose()
        extractor = null
        database = null
        port = 0
        Log.i(TAG, "backend local encerrado")
    }
}

