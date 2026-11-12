package com.minhabolha.android

import android.app.Activity
import android.content.ComponentName
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Tela de reprodução nativa.
 *
 * Conecta-se ao [PlaybackService] por `MediaController`: o player (e a sessão
 * de mídia) ficam no serviço, então a reprodução continua em segundo plano e
 * aparece na tela de bloqueio. Esta Activity é só a interface.
 */
class PlayerActivity : Activity() {

    private companion object {
        const val TAG = "MinhaBolha"
        const val SAVE_INTERVAL_MS = 10_000L
    }

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var view: PlayerView? = null
    private val handler = Handler(Looper.getMainLooper())

    private var baseUrl: String = ""
    private var playbackUrl: String = ""
    private var title: String = ""
    private var metaId: String = ""
    private var metaType: String = "movie"
    private var videoId: String = ""
    private var season: Int? = null
    private var episode: Int? = null
    private var poster: String? = null

    private val saveProgress = object : Runnable {
        override fun run() {
            persistProgress()
            handler.postDelayed(this, SAVE_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Tela cheia imersiva: esconde status e barra de navegação. Um vídeo
        // horizontal também gira para paisagem para ocupar a tela toda.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR

        val payload = intent.getStringExtra("payload") ?: run {
            finish()
            return
        }
        baseUrl = intent.getStringExtra("baseUrl").orEmpty()

        val json = try {
            JSONObject(payload)
        } catch (error: Exception) {
            Log.e(TAG, "payload inválido do player", error)
            finish()
            return
        }

        val relativeUrl = json.optString("url")
        if (relativeUrl.isEmpty()) {
            finish()
            return
        }
        playbackUrl = if (relativeUrl.startsWith("http")) relativeUrl else baseUrl + relativeUrl
        title = json.optString("title").ifEmpty { "Reprodução" }

        val tracking = json.optJSONObject("tracking")
        metaId = tracking?.optString("metaId").orEmpty()
        metaType = if (tracking?.optString("type") == "series") "series" else "movie"
        videoId = tracking?.optString("videoId").orEmpty()
        season = tracking?.optInt("season")?.takeIf { tracking.has("season") && !tracking.isNull("season") }
        episode = tracking?.optInt("episode")?.takeIf { tracking.has("episode") && !tracking.isNull("episode") }
        poster = tracking?.optString("poster")?.takeIf { it.isNotEmpty() }

        view = PlayerView(this).apply {
            setShowNextButton(false)
            setShowPreviousButton(false)
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        setContentView(view)

        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener(
            {
                try {
                    val mediaController = future.get()
                    controller = mediaController
                    view?.player = mediaController

                    mediaController.addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            if (state == Player.STATE_ENDED) persistProgress(completed = true)
                        }

                        override fun onVideoSizeChanged(videoSize: VideoSize) {
                            if (videoSize.width > videoSize.height) {
                                requestedOrientation =
                                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            }
                        }
                    })

                    mediaController.setMediaItem(buildItem(emptyList()))
                    mediaController.prepare()
                    mediaController.playWhenReady = true

                    loadSubtitles()
                    handler.postDelayed(saveProgress, SAVE_INTERVAL_MS)
                    Log.i(TAG, "player nativo iniciado: $title")
                } catch (error: Exception) {
                    Log.e(TAG, "falha ao conectar no serviço de mídia", error)
                    finish()
                }
            },
            ContextCompat.getMainExecutor(this)
        )
    }

    private fun buildItem(subtitles: List<MediaItem.SubtitleConfiguration>): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtworkUri(poster?.let { Uri.parse(it) })
            .build()

        return MediaItem.Builder()
            .setUri(playbackUrl)
            .setMediaMetadata(metadata)
            .setSubtitleConfigurations(subtitles)
            .build()
    }

    /** Anexa as legendas dos addons sem interromper o que já está tocando. */
    private fun loadSubtitles() {
        if (metaId.isEmpty() || baseUrl.isEmpty()) return

        Thread {
            val configurations = mutableListOf<MediaItem.SubtitleConfiguration>()
            try {
                val query = buildString {
                    append(baseUrl).append("/api/stremio/subtitles")
                    append("?type=").append(URLEncoder.encode(metaType, "UTF-8"))
                    append("&id=").append(URLEncoder.encode(metaId, "UTF-8"))
                    if (videoId.isNotEmpty()) {
                        append("&videoId=").append(URLEncoder.encode(videoId, "UTF-8"))
                    }
                }
                val connection = URL(query).openConnection() as HttpURLConnection
                connection.connectTimeout = 8000
                connection.readTimeout = 20_000
                val text = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()

                val subtitles = JSONObject(text).optJSONArray("subtitles") ?: JSONArray()
                for (index in 0 until subtitles.length()) {
                    val item = subtitles.optJSONObject(index) ?: continue
                    val proxyUrl = item.optString("proxyUrl")
                    if (proxyUrl.isEmpty()) continue
                    configurations.add(
                        MediaItem.SubtitleConfiguration.Builder(Uri.parse(baseUrl + proxyUrl))
                            .setMimeType(MimeTypes.TEXT_VTT)
                            .setLanguage(item.optString("lang").ifEmpty { "und" })
                            .setLabel(item.optString("language").ifEmpty { "Legenda" })
                            .build()
                    )
                }
            } catch (error: Exception) {
                Log.w(TAG, "falha ao carregar legendas", error)
            }

            if (configurations.isEmpty()) return@Thread

            runOnUiThread {
                val mediaController = controller ?: return@runOnUiThread
                if (isFinishing || isDestroyed) return@runOnUiThread
                mediaController.setMediaItem(buildItem(configurations), false)
                mediaController.prepare()
                Log.i(TAG, "player nativo: ${configurations.size} faixa(s) de legenda")
            }
        }.start()
    }

    override fun onStop() {
        persistProgress()
        super.onStop()
    }

    /**
     * Ao sair, apenas soltamos o controlador: o player continua no serviço e a
     * notificação de mídia permite pausar/parar.
     */
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        view?.player = null
        view = null
        controllerFuture?.let { future ->
            if (future.isDone) {
                try {
                    MediaController.releaseFuture(future)
                } catch (error: Exception) {
                    Log.w(TAG, "falha ao liberar o controlador", error)
                }
            }
        }
        controllerFuture = null
        controller = null
        super.onDestroy()
    }

    private fun persistProgress(completed: Boolean = false) {
        val mediaController = controller ?: return
        if (metaId.isEmpty() || videoId.isEmpty() || baseUrl.isEmpty()) return

        val position = mediaController.currentPosition.coerceAtLeast(0)
        val duration = mediaController.duration.takeIf { it > 0 }

        val body = JSONObject()
            .put("metaId", metaId)
            .put("type", metaType)
            .put("videoId", videoId)
            .put("season", season ?: JSONObject.NULL)
            .put("episode", episode ?: JSONObject.NULL)
            .put("positionMs", position)
            .put("durationMs", duration ?: JSONObject.NULL)
            .put("name", title)
            .put("poster", poster ?: JSONObject.NULL)
            .put("completed", completed)
            .toString()

        Thread {
            try {
                val connection = URL("$baseUrl/api/playback/progress").openConnection() as HttpURLConnection
                connection.requestMethod = "PUT"
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                connection.responseCode
                connection.disconnect()
            } catch (error: Exception) {
                Log.w(TAG, "falha ao salvar progresso do player nativo", error)
            }
        }.start()
    }
}
