package com.minhabolha.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar

/**
 * Navegador embutido do app Android.
 *
 * O desktop usa um Chromium controlado por CDP; no Android o equivalente viável
 * é um WebView com barra de endereço, voltar/avançar e recarregar. Abre os
 * links externos do feed e dos títulos dentro do app.
 */
class BrowserActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var urlField: EditText
    private lateinit var progress: ProgressBar
    private lateinit var backButton: Button
    private lateinit var forwardButton: Button

    private companion object {
        const val HOME_HTML = """
            <!doctype html>
            <html lang="pt-BR">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                html, body { height: 100%; margin: 0; }
                body { background: #080a0f; color: #e5e7eb; font-family: system-ui, sans-serif;
                       display: flex; align-items: center; justify-content: center; }
                main { width: min(680px, 92vw); }
                h1 { font-size: 20px; margin: 0 0 18px; }
                form { display: flex; gap: 8px; }
                input { flex: 1; height: 48px; border-radius: 12px; border: 1px solid #263042;
                        background: #111827; color: #fff; padding: 0 14px; font-size: 16px; }
                button { height: 48px; border-radius: 12px; border: 0; background: #4f7cff;
                         color: #fff; font-weight: 600; padding: 0 18px; font-size: 15px; }
                p { color: #8b93a7; font-size: 12px; margin-top: 14px; }
              </style>
            </head>
            <body>
              <main>
                <h1>Minha Bolha</h1>
                <form onsubmit="HubBrowser.search(this.q.value); return false;">
                  <input name="q" type="search" placeholder="Pesquisar no DuckDuckGo" autofocus>
                  <button type="submit"
                          onclick="HubBrowser.search(this.form.q.value); return false;">Pesquisar</button>
                </form>
                <p>Resultados pela versão HTML leve do DuckDuckGo.</p>
              </main>
            </body>
            </html>
        """

        const val DUCKDUCKGO_FORM_JS = """
            (function() {
              if (window.__mbDuckDuckGoHooked) return;
              window.__mbDuckDuckGoHooked = true;
              var submit = function(form) {
                if (!form) return true;
                var input = form.querySelector('input[name="q"]');
                var q = input ? String(input.value || '').trim() : '';
                if (!q) return true;
                if (window.HubBrowser && HubBrowser.search) HubBrowser.search(q);
                return false;
              };
              document.addEventListener('submit', function(event) {
                var form = event.target;
                if (form && form.querySelector && form.querySelector('input[name="q"]')) {
                  event.preventDefault();
                  submit(form);
                }
              }, true);
              document.addEventListener('click', function(event) {
                var el = event.target;
                if (!el || !el.matches) return;
                if (!el.matches('input[type="submit"], button[type="submit"]')) return;
                var form = el.form || (el.closest ? el.closest('form') : null);
                if (form && form.querySelector('input[name="q"]')) {
                  event.preventDefault();
                  submit(form);
                }
              }, true);
            })();
        """
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val initialUrl = intent.getStringExtra("url")?.trim().orEmpty()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#080a0f"))
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(16, 16, 16, 16)
        }

        fun barButton(label: String, onClick: () -> Unit): Button =
            Button(this).apply {
                text = label
                textSize = 13f
                setOnClickListener { onClick() }
                bar.addView(this)
            }

        backButton = barButton("‹") { if (webView.canGoBack()) webView.goBack() }
        forwardButton = barButton("›") { if (webView.canGoForward()) webView.goForward() }

        urlField = EditText(this).apply {
            setSingleLine(true)
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            hint = "https://"
            setSelectAllOnFocus(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnEditorActionListener { _, _, _ ->
                loadUrl(text.toString())
                true
            }
        }
        bar.addView(urlField)

        barButton("⟳") { webView.reload() }
        barButton("✕") { finish() }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            visibility = ProgressBar.GONE
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#080a0f"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.userAgentString =
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
            settings.setSupportMultipleWindows(true)
            settings.javaScriptCanOpenWindowsAutomatically = true
            settings.setSupportZoom(true)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            addJavascriptInterface(
                object {
                    @android.webkit.JavascriptInterface
                    fun search(query: String) {
                        if (query.isBlank()) return
                        post { this@BrowserActivity.loadUrl(query) }
                    }
                },
                "HubBrowser"
            )

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    val scheme = uri.scheme.orEmpty()
                    if (scheme == "http" || scheme == "https") {
                        val rewritten = duckDuckGoHtml(uri.toString())
                        if (rewritten != uri.toString()) {
                            view.loadUrl(rewritten)
                            return true
                        }
                        return false
                    }
                    return openExternally(uri)
                }

                override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                    // Mantém a barra sincronizada durante redirecionamentos,
                    // antes de a página terminar de carregar.
                    if (!urlField.hasFocus()) urlField.setText(url)
                    refreshNav()
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (!urlField.hasFocus()) urlField.setText(url)
                    refreshNav()
                    if (url.contains("duckduckgo.com")) {
                        // O formulário HTML do DuckDuckGo usa POST, que alguns
                        // WebViews ignoram. Reescreve para GET na própria página.
                        view.evaluateJavascript(DUCKDUCKGO_FORM_JS, null)
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(
                    view: WebView,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: Message
                ): Boolean {
                    // target=_blank (resultados de busca/news) abre na mesma
                    // WebView em vez de ficar sem ação.
                    val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                    transport.webView = webView
                    resultMsg.sendToTarget()
                    return true
                }

                override fun onProgressChanged(view: WebView, newProgress: Int) {
                    this@BrowserActivity.progress.progress = newProgress
                    this@BrowserActivity.progress.visibility =
                        if (newProgress in 1..99) ProgressBar.VISIBLE else ProgressBar.GONE
                }

                override fun onReceivedTitle(view: WebView, title: String?) {
                    // Mantém o foco na barra de endereço.
                }
            }
        }

        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 6))
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        if (initialUrl.isEmpty()) loadHome() else loadUrl(initialUrl)
    }

    private fun loadHome() {
        webView.loadDataWithBaseURL(
            "https://html.duckduckgo.com/",
            HOME_HTML,
            "text/html",
            "utf-8",
            null
        )
        urlField.setText("https://html.duckduckgo.com/html/")
    }

    /**
     * O DuckDuckGo normal usa uma SPA que não renderiza em WebViews antigos.
     * A versão HTML entrega os resultados prontos e funciona no Android.
     */
    private fun duckDuckGoHtml(value: String): String {
        val uri = Uri.parse(value)
        val host = uri.host.orEmpty()
        if (host != "duckduckgo.com" && host != "www.duckduckgo.com") return value
        if (uri.path != "/" && uri.path != "/search") return value
        val query = uri.getQueryParameter("q").orEmpty()
        if (query.isEmpty()) return value
        return "https://html.duckduckgo.com/html/?q=" +
            java.net.URLEncoder.encode(query, "UTF-8")
    }

    private fun loadUrl(value: String) {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return
        val url = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            duckDuckGoHtml(trimmed)
        } else if (trimmed.contains('.') && !trimmed.contains(' ')) {
            "https://$trimmed"
        } else {
            "https://html.duckduckgo.com/html/?q=" +
                java.net.URLEncoder.encode(trimmed, "UTF-8")
        }
        urlField.setText(url)
        urlField.clearFocus()
        webView.requestFocus()
        webView.loadUrl(url)
    }

    private fun refreshNav() {
        backButton.isEnabled = webView.canGoBack()
        forwardButton.isEnabled = webView.canGoForward()
    }

    private fun openExternally(uri: Uri): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (error: ActivityNotFoundException) {
            false
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
        if (this::webView.isInitialized) {
            webView.loadUrl("about:blank")
            webView.destroy()
        }
        super.onDestroy()
    }
}
