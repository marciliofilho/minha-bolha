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

class MainActivity : Activity() {

    private companion object {
        const val TAG = "MinhaBolha"
    }

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val port = HubRuntime.start(this)

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
