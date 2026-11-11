package com.minhabolha.android

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import fi.iki.elonen.NanoHTTPD
import java.net.ServerSocket

class MainActivity : Activity() {

    private companion object {
        /** Porta fixa do servidor local, usada também pelo smoke test do CI. */
        const val PREFERRED_PORT = 47821

        const val TAG = "MinhaBolha"
    }

    private lateinit var webView: WebView
    private var server: HubServer? = null
    private var database: HubDatabase? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val hubDatabase = HubDatabase(this)
        database = hubDatabase

        val port = startServer(hubDatabase)
        val localServer = server

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#080a0f"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.i(TAG, "console: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        setContentView(webView)

        // Diagnóstico usado pelo smoke test do CI: confirma que o React montou
        // a interface dentro do WebView, não só que o HTML foi servido.
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                view.postDelayed({ reportRootChildren() }, 6000)
            }
        }

        if (localServer != null) {
            webView.loadUrl("http://127.0.0.1:$port/")
        } else {
            showServerFailure(port)
        }
    }

    /**
     * Sobe o servidor local.
     *
     * A porta preferida é fixa para permitir testes automatizados via
     * `adb forward`; se estiver ocupada, cai para uma porta efêmera.
     */
    private fun startServer(database: HubDatabase): Int {
        for (candidate in listOf(PREFERRED_PORT, 0)) {
            val port = if (candidate == 0) {
                ServerSocket(0).use { it.localPort }
            } else {
                candidate
            }
            val started = try {
                HubServer(this, port, database, BuildConfig.VERSION_NAME).also {
                    it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                }
            } catch (error: Exception) {
                null
            }
            if (started != null) {
                server = started
                return port
            }
        }
        return 0
    }

    private fun showServerFailure(port: Int) {
        webView.loadDataWithBaseURL(
            null,
            """
            <!doctype html><html><body style="background:#080a0f;color:#f8fafc;font-family:sans-serif;padding:24px">
            <h1>Minha Bolha Android</h1>
            <p>Não foi possível iniciar o servidor local na porta $port.</p>
            <p style="color:#94a3b8;font-size:13px">Feche o app e abra novamente. Se o problema continuar,
            outro processo pode estar usando a porta.</p>
            </body></html>
            """.trimIndent(),
            "text/html",
            "utf-8",
            null
        )
    }

    /**
     * Registra no logcat quantos elementos o React montou dentro de `#root`.
     *
     * O smoke test do CI usa essa linha para diferenciar "HTML servido" de
     * "interface realmente renderizada".
     */
    private fun reportRootChildren() {
        if (!this::webView.isInitialized) return
        val script =
            "(function(){var r=document.getElementById('root');" +
                "return 'rootChildren=' + (r ? r.childElementCount : -1);})()"
        webView.evaluateJavascript(script) { value ->
            Log.i(TAG, "webviewReady: $value")
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (!this::webView.isInitialized) {
            super.onBackPressed()
            return
        }
        // O React Router usa history; se o WebView não puder voltar, fecha o app.
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    override fun onResume() {
        super.onResume()
        if (this::webView.isInitialized) {
            webView.onResume()
            webView.resumeTimers()
        }
    }

    override fun onPause() {
        if (this::webView.isInitialized) {
            webView.onPause()
            webView.pauseTimers()
        }
        super.onPause()
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        if (this::webView.isInitialized) {
            webView.loadUrl("about:blank")
            webView.visibility = View.GONE
            webView.destroy()
        }
        database?.close()
        database = null
        super.onDestroy()
    }
}
