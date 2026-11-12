package com.minhabolha.android

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.minhabolha.android.connectors.Registry
import java.util.concurrent.TimeUnit

/**
 * Sincronização em segundo plano.
 *
 * Com o app fechado o scheduler em memória não roda, então o WorkManager
 * acorda o processo a cada ~6 horas e atualiza as fontes vencidas. É o mesmo
 * pipeline do app (conectores + SQLite + calendário), só que sem a WebView.
 */
class RefreshWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {

    override fun doWork(): Result {
        val context = applicationContext
        val database = HubDb.get(context)
        return try {
            Registry.configure(
                secrets = object : com.minhabolha.android.connectors.SecretAccess {
                    override fun value(key: String): String? = database.secretValue(key)
                },
                mediaLookup = { sourceId -> database.mediaBySource(sourceId) },
                stremioAuthKey = { database.stremioAuthKey() },
                novelExtractor = { null },
                gamesProvider = { database.gamesForPriceCheck(20) }
            )
            GlobalReleasesSource.ensure(database)

            val scheduler = HubScheduler(context, database, EventHub())
            val refreshed = scheduler.runDueNow(limit = 8)

            // Limpeza automática dos capítulos offline antigos.
            val retention = database.settings().optInt("novelOfflineRetentionDays", 7)
            val pruned = database.pruneNovelOffline(retention)
            if (pruned > 0) android.util.Log.i("MinhaBolha", "novels offline limpos: $pruned capítulo(s)")
            Result.success(workDataOf("refreshed" to refreshed))
        } catch (error: Exception) {
            android.util.Log.e("MinhaBolha", "falha na sincronização em segundo plano", error)
            Result.retry()
        }
    }
}

/** Agenda a sincronização periódica em segundo plano. */
object BackgroundSync {

    private const val WORK_NAME = "minha-bolha-refresh"
    private const val INTERVAL_HOURS = 6L

    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()

        val request = PeriodicWorkRequestBuilder<RefreshWorker>(
            INTERVAL_HOURS,
            TimeUnit.HOURS,
            30,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}
