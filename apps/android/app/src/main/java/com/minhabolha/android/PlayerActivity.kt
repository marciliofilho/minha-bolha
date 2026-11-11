package com.minhabolha.android

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Player nativo para torrents.
 *
 * O WebView não abre MKV (e muitos torrents são MKV com HEVC/AC3), então o
 * player web delega para esta Activity, que usa Media3/ExoPlayer e transmite o
 * arquivo pelo endpoint HTTP com Range do motor de torrents.
 *
 * O progresso é gravado na mesma tabela do player web, então "Continuar
 * assistindo" funciona igual nas duas telas.
 */
class PlayerActivity : Activity() {

    private companion object {
        const val TAG = "MinhaBolha"
        const val SAVE_INTERVAL_MS = 10_000L
    }

    private var player: ExoPlayer? = null
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

        val exo = ExoPlayer.Builder(this).build()
        player = exo

        view = PlayerView(this).apply {
            this.player = exo
            setShowNextButton(false)
            setShowPreviousButton(false)
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        setContentView(view)

        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) persistProgress(completed = true)
            }
        })

        exo.setMediaItem(MediaItem.fromUri(playbackUrl))
        exo.prepare()
        exo.playWhenReady = true

        handler.postDelayed(saveProgress, SAVE_INTERVAL_MS)
        Log.i(TAG, "player nativo iniciado: $title")
    }

    override fun onStop() {
        persistProgress()
        super.onStop()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        view = null
        super.onDestroy()
    }

    private fun persistProgress(completed: Boolean = false) {
        val exo = player ?: return
        if (metaId.isEmpty() || videoId.isEmpty() || baseUrl.isEmpty()) return

        val position = exo.currentPosition.coerceAtLeast(0)
        val duration = exo.duration.takeIf { it > 0 }

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
