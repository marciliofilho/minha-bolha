package com.minhabolha.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Notificações locais do app (sem servidor de push).
 *
 * Só alertamos sobre queda de preço: os cards também aparecem no feed, mas a
 * notificação avisa quando o app está em segundo plano.
 */
object HubNotifications {

    private const val CHANNEL_ID = "minha-bolha-alerts"
    private const val BASE_ID = 500

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Alertas de preço",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Avisa quando um jogo da sua lista atinge o preço-alvo."
            }
        )
    }

    fun priceDrops(context: Context, titles: List<String>) {
        if (titles.isEmpty()) return
        try {
            ensureChannel(context)
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) return

            val openApp = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            titles.take(3).forEachIndexed { index, title ->
                val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Preço baixo na sua lista")
                    .setContentText(title)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(title))
                    .setAutoCancel(true)
                    .setContentIntent(openApp)
                    .build()
                manager.notify(BASE_ID + index, notification)
            }
        } catch (error: Exception) {
            Log.w("MinhaBolha", "falha ao notificar queda de preço", error)
        }
    }
}
