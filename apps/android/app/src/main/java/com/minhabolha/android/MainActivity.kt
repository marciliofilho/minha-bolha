package com.minhabolha.android

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import fi.iki.elonen.NanoHTTPD
import java.net.ServerSocket

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var server: SpikeServer? = null
    private var database: SpikeDatabase? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val db = SpikeDatabase(this)
        database = db

        val port = ServerSocket(0).use { it.localPort }
        val localServer = try {
            SpikeServer(this, port, db).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        } catch (error: Exception) {
            null
        }
        server = localServer

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        setContentView(webView)

        if (localServer != null) {
            webView.loadUrl("http://127.0.0.1:$port/")
        } else {
            webView.loadDataWithBaseURL(
                null,
                """
                <!doctype html><html><body style="background:#07090e;color:#fff;font-family:sans-serif;padding:24px">
                <h1>Minha Bolha Android</h1>
                <p>Não foi possível iniciar o servidor local na porta $port.</p>
                </body></html>
                """.trimIndent(),
                "text/html",
                "utf-8",
                null
            )
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
            return
        }
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    override fun onDestroy() {
        server?.stop()
        server = null
        if (this::webView.isInitialized) {
            webView.destroy()
        }
        database?.close()
        database = null
        super.onDestroy()
    }
}
