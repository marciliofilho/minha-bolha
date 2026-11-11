package com.minhabolha.android

import android.content.Context

/**
 * Banco único do processo.
 *
 * O servidor, o scheduler, a WebView e o WorkManager compartilham a mesma
 * conexão SQLite (WAL). Fechar o banco enquanto outro componente ainda o usa
 * era o caminho para erros do tipo "database closed", então o ciclo de vida
 * acompanha o processo, não a Activity.
 */
object HubDb {

    @Volatile
    private var instance: HubDatabase? = null

    @Synchronized
    fun get(context: Context): HubDatabase =
        instance ?: HubDatabase(context.applicationContext).also { instance = it }
}
