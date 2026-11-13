package com.minhabolha.android

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Serviço de mídia com MediaSession.
 *
 * O player vive aqui (e não na Activity), então a reprodução continua com o
 * app em segundo plano e ganha controles de tela de bloqueio, fones e
 * assistentes — o Media3 cuida da notificação de mídia e do foreground.
 */
class PlaybackService : MediaSessionService() {

    companion object {
        const val ACTION_STOP = "com.minhabolha.android.STOP_PLAYBACK"
    }

    private var mediaSession: MediaSession? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            mediaSession?.player?.let { player ->
                runCatching { player.stop() }
                runCatching { player.clearMediaItems() }
            }
            stopSelf()
            return START_NOT_STICKY
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onCreate() {
        super.onCreate()

        // Muitos addons redirecionam HTTP → HTTPS → HTTP (CDN). O Media3
        // recusa esses saltos por padrão e o player falhava com HTTP 301.
        val browserUserAgent =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"

        val httpDataSource = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(30_000)
            .setUserAgent(browserUserAgent)
            .setDefaultRequestProperties(
                mapOf(
                    "Accept" to "*/*",
                    "Accept-Language" to "pt-BR,pt;q=0.9,en;q=0.7"
                )
            )

        // Muitos addons exigem Referer/UA de navegador e recusam o UA padrão do
        // ExoPlayer com 403. O Referer é derivado do próprio host do stream.
        val resolvingDataSource = ResolvingDataSource.Factory(httpDataSource) { dataSpec ->
            val uri = dataSpec.uri
            val headers = mutableMapOf(
                "Accept" to "*/*",
                "Accept-Language" to "pt-BR,pt;q=0.9,en;q=0.7"
            )
            if (uri.scheme == "http" || uri.scheme == "https") {
                headers["Referer"] = "${uri.scheme}://${uri.host}/"
            }
            dataSpec.withRequestHeaders(headers)
        }

        // Buffer menor: suficiente para streaming e bem mais leve em aparelhos
        // com pouca RAM (o BlueStacks chegava a matar o processo do app).
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(10_000, 30_000, 1_000, 2_000)
            .setTargetBufferBytes(24 * 1024 * 1024)
            .build()

        val player = ExoPlayer.Builder(this)
            .setLoadControl(loadControl)
            .setMediaSourceFactory(DefaultMediaSourceFactory(resolvingDataSource))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                true
            )
            .setHandleAudioBecomingNoisy(true)
            .build()

        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivity)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    /** Sem mídia tocando, não faz sentido manter o serviço vivo. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = mediaSession?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        mediaSession?.run {
            player.release()
            release()
        }
        mediaSession = null
        super.onDestroy()
    }
}
