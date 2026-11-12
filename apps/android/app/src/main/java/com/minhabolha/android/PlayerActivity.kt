package com.minhabolha.android

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
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
    private var originalOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

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
        originalOrientation = requestedOrientation
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

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

        val errorText = TextView(this).apply {
            setTextColor(Color.parseColor("#F8FAFC"))
            textSize = 15f
            gravity = Gravity.CENTER
        }
        val backButton = Button(this).apply {
            text = "Voltar"
            setTextColor(Color.parseColor("#080A0F"))
            setBackgroundColor(Color.parseColor("#7C9CFF"))
            setPadding(64, 24, 64, 24)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = 32
            }
            setOnClickListener { finish() }
        }
        val errorBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F2080A0F"))
            setPadding(64, 64, 64, 64)
            visibility = View.GONE
            addView(errorText)
            addView(backButton)
        }

        val subtitleButton = Button(this).apply {
            text = "Legendas"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#D9080A0F"))
            setPadding(32, 8, 32, 8)
            visibility = View.GONE
            setOnClickListener { showSubtitlePicker() }
        }

        val root = FrameLayout(this)
        root.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        root.addView(
            subtitleButton,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                topMargin = 32
                rightMargin = 32
            }
        )
        root.addView(
            errorBox,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

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
                            if (state == Player.STATE_READY) errorBox.visibility = View.GONE
                            if (state == Player.STATE_ENDED) persistProgress(completed = true)
                        }

                        override fun onPlayerError(error: PlaybackException) {
                            Log.e(TAG, "player nativo: erro", error)
                            val detail = error.cause?.message?.takeIf { it.isNotBlank() }
                                ?: error.message
                                ?: error.errorCodeName
                            errorText.text = buildString {
                                appendLine("Não foi possível reproduzir este stream.")
                                appendLine()
                                appendLine(detail)
                                appendLine()
                                append("Volte e escolha outro stream.")
                            }
                            errorBox.visibility = View.VISIBLE
                        }

                        override fun onVideoSizeChanged(videoSize: VideoSize) {
                            if (videoSize.width > videoSize.height) {
                                requestedOrientation =
                                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            }
                        }

                        override fun onTracksChanged(tracks: Tracks) {
                            val hasText = tracks.groups.any {
                                it.type == C.TRACK_TYPE_TEXT && it.isSupported
                            }
                            subtitleButton.visibility = if (hasText) View.VISIBLE else View.GONE
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
                val seen = mutableSetOf<String>()
                for (index in 0 until subtitles.length()) {
                    // Alguns addons devolvem 100+ faixas, muitas repetidas
                    // (mesmo idioma/rótulo vindo de addons diferentes).
                    if (configurations.size >= 30) break
                    val item = subtitles.optJSONObject(index) ?: continue
                    val proxyUrl = item.optString("proxyUrl")
                    if (proxyUrl.isEmpty()) continue
                    val language = item.optString("lang").ifEmpty { "und" }
                    val label = item.optString("language").ifEmpty { "Legenda" }
                    if (!seen.add("${language.lowercase()}|${label.lowercase()}")) continue
                    configurations.add(
                        MediaItem.SubtitleConfiguration.Builder(Uri.parse(baseUrl + proxyUrl))
                            .setMimeType(MimeTypes.TEXT_VTT)
                            .setLanguage(language)
                            .setLabel(label)
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

    private fun showSubtitlePicker() {
        val mediaController = controller ?: return
        val textGroups = mediaController.currentTracks.groups.filter {
            it.type == C.TRACK_TYPE_TEXT && it.isSupported
        }
        if (textGroups.isEmpty()) {
            Toast.makeText(this, "Este stream não tem legendas.", Toast.LENGTH_SHORT).show()
            return
        }

        val labels = mutableListOf("Desligada")
        val groups = mutableListOf<TrackGroup?>(null)
        val seen = mutableSetOf<String>()
        for (group in textGroups) {
            val format = group.mediaTrackGroup.getFormat(0)
            val label = format.label?.toString()?.takeIf { it.isNotBlank() }
                ?: format.language?.takeIf { it.isNotBlank() }
                ?: "Legenda ${labels.size}"
            val language = format.language?.toString().orEmpty()
            if (!seen.add("${language.lowercase()}|${label.lowercase()}")) continue
            labels.add(label)
            groups.add(group.mediaTrackGroup)
        }

        AlertDialog.Builder(this)
            .setTitle("Legendas")
            .setItems(labels.toTypedArray()) { _, which ->
                val builder = mediaController.trackSelectionParameters.buildUpon()
                    .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                val group = groups[which]
                if (group == null) {
                    builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                } else {
                    builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                    builder.setOverrideForType(TrackSelectionOverride(group, 0))
                }
                mediaController.trackSelectionParameters = builder.build()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    override fun finish() {
        // Volta à orientação que o app usava antes do player em tela cheia.
        requestedOrientation = originalOrientation
        super.finish()
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        finish()
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
        // Fechar a tela do player (X/Voltar) encerra o áudio; apertar Home
        // continua em segundo plano pela MediaSession.
        if (isFinishing) {
            controller?.let { media ->
                runCatching { media.stop() }
                runCatching { media.clearMediaItems() }
            }
            runCatching {
                startService(
                    Intent(this, PlaybackService::class.java)
                        .setAction(PlaybackService.ACTION_STOP)
                )
            }
        }
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
        // Não cria "Continuar assistindo" para um stream que nunca começou.
        if (position <= 0 && !completed) return
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
