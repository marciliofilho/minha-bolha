package com.minhabolha.android

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
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
        const val FAILURE_VIEW_ID = 0x00fa1101
    }

    private lateinit var webView: WebView
    private var backendPort: Int = 0

    private var fullscreenOverlay: FrameLayout? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var previousOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installCrashLogger()

        val container = android.widget.FrameLayout(this)
        setContentView(container)

        val loading = android.widget.TextView(this).apply {
            setBackgroundColor(Color.parseColor("#080a0f"))
            setTextColor(Color.parseColor("#f8fafc"))
            textSize = 15f
            gravity = android.view.Gravity.CENTER
            text = "Iniciando Minha Bolha…"
        }
        container.addView(
            loading,
            android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        // Banco e migrations podem levar alguns segundos em emuladores; rodar
        // fora da thread principal evita ANR e mantém a tela de carregamento.
        Thread {
            val result = runCatching { HubRuntime.start(this) }
            runOnUiThread {
                result.fold(
                    onSuccess = { port -> startUi(container, loading, port) },
                    onFailure = { error -> showStartupFailure(container, loading, error) }
                )
            }
        }.start()
    }

    private fun startUi(
        container: android.widget.FrameLayout,
        loading: android.widget.TextView,
        port: Int
    ) {
        backendPort = port
        ForegroundGuard.bind(this)
        requestNotificationPermission()

        if (port <= 0) {
            showServerFailure(container, loading, port)
            return
        }

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

                /**
                 * Tela cheia do player web.
                 *
                 * O React chama `requestFullscreen()` no vídeo; sem este callback
                 * o WebView ignora e o botão de maximizar não faz nada.
                 */
                override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
                    if (fullscreenOverlay != null) {
                        callback.onCustomViewHidden()
                        return
                    }
                    val root = webView.parent as? ViewGroup
                    if (root == null) {
                        callback.onCustomViewHidden()
                        return
                    }

                    val overlay = FrameLayout(this@MainActivity).apply {
                        setBackgroundColor(Color.BLACK)
                        addView(
                            view,
                            FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                        )
                    }
                    root.addView(
                        overlay,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                    webView.visibility = View.INVISIBLE
                    fullscreenOverlay = overlay
                    fullscreenCallback = callback
                    previousOrientation = requestedOrientation
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    hideSystemBars()
                    Log.i(TAG, "player web em tela cheia")
                }

                override fun onHideCustomView() {
                    val overlay = fullscreenOverlay ?: return
                    (overlay.parent as? ViewGroup)?.removeView(overlay)
                    fullscreenOverlay = null
                    webView.visibility = View.VISIBLE
                    requestedOrientation = previousOrientation
                    showSystemBars()
                    fullscreenCallback?.onCustomViewHidden()
                    fullscreenCallback = null
                    Log.i(TAG, "player web saiu da tela cheia")
                }
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        // Ponte para o player nativo: o WebView não abre MKV/HEVC.
        webView.addJavascriptInterface(HubBridge(), "HubNative")

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

        container.removeView(loading)
        container.addView(
            webView,
            android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        // O extrator de novels precisa de uma janela real para carregar páginas.
        HubRuntime.attachExtractor(container)

        webView.loadUrl("http://127.0.0.1:$port/")
    }

    private fun showServerFailure(
        container: android.widget.FrameLayout,
        loading: android.widget.TextView,
        port: Int
    ) {
        loading.text = """
            Não foi possível iniciar o servidor local (porta $port).

            Feche o app e abra novamente. Se continuar, outro processo pode
            estar usando a porta.
        """.trimIndent()
    }

    /**
     * Mostra o erro de inicialização na tela (em vez de fechar sem aviso) e
     * grava o stack trace em `filesDir/startup-crash.txt`.
     */
    private fun showStartupFailure(
        container: android.widget.FrameLayout,
        loading: android.widget.TextView,
        error: Throwable
    ) {
        Log.e(TAG, "falha ao iniciar o app", error)
        runCatching { HubRuntime.stop() }
        runCatching {
            java.io.File(filesDir, "startup-crash.txt").writeText(error.stackTraceToString())
        }

        val details = buildString {
            appendLine("Não foi possível iniciar o Minha Bolha.")
            appendLine()
            appendLine(error.toString())
            appendLine()
            error.stackTrace.take(12).forEach { appendLine("  at $it") }
            appendLine()
            appendLine("Detalhes completos: logcat (MinhaBolha) ou")
            appendLine("files/startup-crash.txt no armazenamento do app.")
        }

        val message = android.widget.TextView(this).apply {
            setBackgroundColor(Color.parseColor("#080a0f"))
            setTextColor(Color.parseColor("#f8fafc"))
            textSize = 12f
            setPadding(48, 96, 48, 48)
            typeface = android.graphics.Typeface.MONOSPACE
            text = details
        }
        val scroll = android.widget.ScrollView(this).apply { addView(message) }

        container.removeView(loading)
        container.addView(
            scroll,
            android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
    }

    /** Guarda o último crash para diagnóstico sem precisar de adb. */
    private fun installCrashLogger() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                java.io.File(filesDir, "last-crash.txt").writeText(
                    "thread=${thread.name}\n\n" + error.stackTraceToString()
                )
            }
            previous?.uncaughtException(thread, error)
        }
    }

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
            if (value != null && value.contains("rootChildren=0")) {
                showWebViewFailure()
            }
        }
    }

    /**
     * Diagnóstico visível quando o React não monta (WebView antigo, por
     * exemplo). Sem isso a tela fica preta e não há como saber o motivo.
     */
    private fun showWebViewFailure() {
        val container = (webView.parent as? android.view.ViewGroup) ?: return
        if (container.findViewById<android.widget.TextView>(FAILURE_VIEW_ID) != null) return

        val userAgent = try {
            WebSettings.getDefaultUserAgent(this)
        } catch (error: Exception) {
            "desconhecido"
        }
        val chrome = Regex("Chrome/([0-9.]+)").find(userAgent)?.value ?: "desconhecido"

        val message = android.widget.TextView(this).apply {
            id = FAILURE_VIEW_ID
            setBackgroundColor(Color.parseColor("#080a0f"))
            setTextColor(Color.parseColor("#f8fafc"))
            textSize = 14f
            setPadding(48, 96, 48, 48)
            text = """
                Não foi possível carregar a interface.

                O WebView deste Android pode ser antigo demais.
                Versão detectada: $chrome

                Atualize o "Android System WebView" / Chrome, ou use um
                dispositivo/emulador com Android 11+ e WebView atualizado.

                Detalhes técnicos no logcat: adb logcat -s MinhaBolha
            """.trimIndent()
        }

        container.addView(
            message,
            android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
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

    private fun hideSystemBars() {
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller =
            androidx.core.view.WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun showSystemBars() {
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, true)
        androidx.core.view.WindowInsetsControllerCompat(window, window.decorView)
            .show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (fullscreenOverlay != null) {
            webView.webChromeClient?.onHideCustomView()
            return
        }
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
        if (fullscreenOverlay != null) {
            (fullscreenOverlay?.parent as? ViewGroup)?.removeView(fullscreenOverlay)
            fullscreenOverlay = null
            fullscreenCallback = null
            showSystemBars()
        }
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
