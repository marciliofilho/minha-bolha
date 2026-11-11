package com.minhabolha.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Serviço em primeiro plano que mantém a reprodução e os torrents vivos com o
 * app em segundo plano (ou a tela apagada).
 *
 * Android 14+ exige declarar o tipo do serviço; usamos `mediaPlayback` quando
 * há player ativo e `dataSync` quando há torrent baixando (ou os dois).
 */
class HubForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "minha-bolha-foreground"
        const val NOTIFICATION_ID = 42
        const val ACTION_START = "com.minhabolha.android.START_FOREGROUND"
        const val ACTION_STOP = "com.minhabolha.android.STOP_FOREGROUND"
        const val EXTRA_TEXT = "text"
        const val EXTRA_PLAYBACK = "playback"
        const val EXTRA_TORRENT = "torrent"
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Minha Bolha"
        val playback = intent?.getBooleanExtra(EXTRA_PLAYBACK, false) ?: false
        val torrent = intent?.getBooleanExtra(EXTRA_TORRENT, false) ?: false

        var types = 0
        if (playback) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (torrent) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        if (types == 0) types = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC

        startForeground(NOTIFICATION_ID, buildNotification(text), types)
        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Reprodução e downloads",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Mantém o player e os torrents ativos em segundo plano."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, HubForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Minha Bolha")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopIntent)
            .build()
    }
}

/**
 * Contador simples de atividades que exigem primeiro plano.
 *
 * A reprodução e os torrents podem coexistir; o serviço só para quando os dois
 * terminam.
 */
object ForegroundGuard {

    private var appContext: Context? = null
    private var playback = false
    private var playbackTitle: String = "Reprodução"
    private var torrents = 0

    @Synchronized
    fun bind(context: Context) {
        appContext = context.applicationContext
    }

    @Synchronized
    fun setPlayback(active: Boolean, title: String? = null) {
        playback = active
        if (!title.isNullOrBlank()) playbackTitle = title
        update()
    }

    @Synchronized
    fun torrentStarted() {
        torrents += 1
        update()
    }

    @Synchronized
    fun torrentStopped() {
        torrents = (torrents - 1).coerceAtLeast(0)
        update()
    }

    @Synchronized
    fun resetTorrents() {
        torrents = 0
        update()
    }

    private fun update() {
        val context = appContext ?: return
        val needPlayback = playback
        val needTorrent = torrents > 0

        if (!needPlayback && !needTorrent) {
            context.startService(
                Intent(context, HubForegroundService::class.java)
                    .setAction(HubForegroundService.ACTION_STOP)
            )
            return
        }

        val text = when {
            needPlayback && needTorrent -> "$playbackTitle · $torrents torrent(s)"
            needPlayback -> playbackTitle
            else -> "Baixando ${torrents} torrent(s)"
        }

        context.startForegroundService(
            Intent(context, HubForegroundService::class.java)
                .setAction(HubForegroundService.ACTION_START)
                .putExtra(HubForegroundService.EXTRA_TEXT, text)
                .putExtra(HubForegroundService.EXTRA_PLAYBACK, needPlayback)
                .putExtra(HubForegroundService.EXTRA_TORRENT, needTorrent)
        )
    }
}
