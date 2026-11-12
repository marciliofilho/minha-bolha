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

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    val scheme = uri.scheme.orEmpty()
                    if (scheme == "http" || scheme == "https") return false
                    return openExternally(uri)
                }

                override fun onPageFinished(view: WebView, url: String) {
                    urlField.setText(url)
                    refreshNav()
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

        loadUrl(initialUrl.ifEmpty { "https://duckduckgo.com/" })
    }

    private fun loadUrl(value: String) {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return
        val url = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else if (trimmed.contains('.') && !trimmed.contains(' ')) {
            "https://$trimmed"
        } else {
            "https://duckduckgo.com/?q=" + java.net.URLEncoder.encode(trimmed, "UTF-8")
        }
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
