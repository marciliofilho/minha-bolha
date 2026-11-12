package com.minhabolha.android

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    private companion object {
        const val TAG = "MinhaBolha"
    }

    private lateinit var webView: WebView
    private var backendPort: Int = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val port = HubRuntime.start(this)
        backendPort = port

        ForegroundGuard.bind(this)
        requestNotificationPermission()

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

        // Ponte para o player nativo: o WebView não abre MKV/HEVC.
        webView.addJavascriptInterface(HubBridge(), "HubNative")

        // O extrator de novels precisa de uma janela real para carregar páginas.
        val container = android.widget.FrameLayout(this)
        container.addView(webView)
        setContentView(container)
        HubRuntime.attachExtractor(container)

        // Diagnóstico usado pelo smoke test do CI: confirma que o React montou
        // a interface dentro do WebView, não só que o HTML foi servido.
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                view.postDelayed({ reportRootChildren() }, 6000)
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse
            ) {
                Log.w(TAG, "http ${errorResponse.statusCode} ${request.url}")
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                Log.w(TAG, "net ${error.errorCode} ${error.description} ${request.url}")
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                val host = url.host.orEmpty()
                // Só o servidor local fica dentro do WebView do app; links
                // externos abrem no navegador embutido.
                if (host == "127.0.0.1" || host == "localhost") return false
                return try {
                    startActivity(
                        Intent(this@MainActivity, BrowserActivity::class.java)
                            .putExtra("url", url.toString())
                    )
                    true
                } catch (error: Exception) {
                    Log.w(TAG, "falha ao abrir o navegador embutido", error)
                    true
                }
            }
        }

        if (port > 0) {
            webView.loadUrl("http://127.0.0.1:$port/")
        } else {
            showServerFailure(port)
        }
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
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
    }

    private fun reportRootChildren() {
        if (!this::webView.isInitialized) return
        val script =
            "(function(){var r=document.getElementById('root');" +
                "return 'rootChildren=' + (r ? r.childElementCount : -1) +" +
                " ' native=' + (window.HubNative ? 1 : 0);})()"
        webView.evaluateJavascript(script) { value ->
            Log.i(TAG, "webviewReady: $value")
        }
    }

    /**
     * Bridge exposta ao React como `window.HubNative`.
     *
     * O player web chama `playTorrent(payload)` quando o arquivo do torrent não
     * toca no WebView (MKV/HEVC) e a Activity nativa assume.
     */
    inner class HubBridge {
        @JavascriptInterface
        fun playTorrent(payload: String) {
            runOnUiThread {
                try {
                    startActivity(
                        Intent(this@MainActivity, PlayerActivity::class.java)
                            .putExtra("payload", payload)
                            .putExtra("baseUrl", "http://127.0.0.1:$backendPort")
                    )
                } catch (error: Exception) {
                    Log.e(TAG, "falha ao abrir o player nativo", error)
                }
            }
        }

        @JavascriptInterface
        fun isAvailable(): Boolean = true

        @JavascriptInterface
        fun openBrowser(url: String?) {
            runOnUiThread {
                try {
                    startActivity(
                        Intent(this@MainActivity, BrowserActivity::class.java)
                            .putExtra("url", url.orEmpty())
                    )
                } catch (error: Exception) {
                    Log.e(TAG, "falha ao abrir o navegador", error)
                }
            }
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
        if (isFinishing) {
            HubRuntime.stop()
        }
        if (this::webView.isInitialized) {
            webView.loadUrl("about:blank")
            webView.visibility = View.GONE
            webView.destroy()
        }
        super.onDestroy()
    }
}
