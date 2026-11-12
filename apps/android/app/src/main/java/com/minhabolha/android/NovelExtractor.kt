package com.minhabolha.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Extração de capítulos de novels usando um WebView oculto.
 *
 * O desktop usa Chromium + Puppeteer; no Android o equivalente é carregar a
 * página num WebView (com JavaScript) e ler o texto do DOM. É mais limitado
 * para sites com desafios anti-bot, mas resolve a maioria dos capítulos.
 */
class NovelExtractor(context: Context) {

    data class Extracted(val title: String, val text: String)

    private companion object {
        const val TAG = "MinhaBolha"
        const val RENDER_DELAY_MS = 1_500L
        const val DEFAULT_TIMEOUT_MS = 30_000L

        const val EXTRACT_JS = """
            (function() {
              try {
                var junk = document.querySelectorAll('script, style, noscript, iframe, nav, header, footer, aside, form');
                for (var i = 0; i < junk.length; i++) { junk[i].parentNode && junk[i].parentNode.removeChild(junk[i]); }

                var selectors = [
                  '#chapter-content', '.chapter-content', '.chapter-body', '.reading-content',
                  '.entry-content', '.post-content', '.content', 'article', 'main', 'body'
                ];
                var best = null, bestLen = 0;
                for (var s = 0; s < selectors.length; s++) {
                  var nodes = document.querySelectorAll(selectors[s]);
                  for (var n = 0; n < nodes.length; n++) {
                    var value = (nodes[n].textContent || '').trim();
                    if (value.length > bestLen) { bestLen = value.length; best = nodes[n]; }
                  }
                }

                var heading = document.querySelector('h1, .chapter-title, .entry-title');
                var title = heading ? (heading.textContent || '').trim() : '';
                if (!title) title = (document.title || '').trim();

                return JSON.stringify({ title: title, text: best ? (best.textContent || '') : '' });
              } catch (error) {
                return JSON.stringify({ title: '', text: '', error: String(error) });
              }
            })();
        """
    }

    private val appContext: Context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var webView: WebView? = null

    fun extract(rawUrl: String, timeoutMs: Long = DEFAULT_TIMEOUT_MS): Extracted? {
        val url = try {
            com.minhabolha.android.connectors.PublicUrl.assert(rawUrl).toString()
        } catch (error: Exception) {
            throw HubException(400, "validation", "URL inválida para leitura.")
        }

        synchronized(lock) {
            val latch = CountDownLatch(1)
            var result: Extracted? = null
            var failure: String? = null

            main.post { load(url) { extracted, error ->
                result = extracted
                failure = error
                latch.countDown()
            } }

            val finished = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            if (!finished) {
                Log.w(TAG, "extração de novel sem resposta: $url")
                return null
            }
            if (failure != null) {
                Log.w(TAG, "falha na extração de novel: $failure")
            }
            return result
        }
    }

    private fun load(url: String, callback: (Extracted?, String?) -> Unit) {
        val view = webView ?: createWebView().also { webView = it }

        var completed = false
        fun finish(extracted: Extracted?, error: String?) {
            if (completed) return
            completed = true
            callback(extracted, error)
        }

        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.toString() != url

            override fun onPageFinished(view: WebView, finishedUrl: String) {
                view.postDelayed({
                    view.evaluateJavascript(EXTRACT_JS) { value ->
                        finish(parse(value), null)
                    }
                }, RENDER_DELAY_MS)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (request.isForMainFrame) {
                    finish(null, "${error.errorCode}: ${error.description}")
                }
            }
        }

        try {
            view.loadUrl(url)
        } catch (error: Exception) {
            finish(null, error.message)
        }
    }

    private fun parse(raw: String?): Extracted? {
        if (raw.isNullOrBlank() || raw == "null") return null
        val json = try {
            JSONObject(org.json.JSONTokener(raw).nextValue().toString())
        } catch (error: Exception) {
            return null
        }

        val title = json.optString("title").trim()
        val text = normalize(json.optString("text"))
        if (text.isEmpty()) return null
        return Extracted(title = title.ifEmpty { "Capítulo" }, text = text)
    }

    /** Remove espaços repetidos e linhas vazias demais. */
    private fun normalize(value: String): String =
        value.replace("\r\n", "\n")
            .replace('\r', '\n')
            .replace(Regex("[\\t\\u00A0 ]+"), " ")
            .replace(Regex(" *\\n *"), "\n")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        return WebView(appContext).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.userAgentString =
                "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
                    "Chrome/126.0 Mobile Safari/537.36"
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.blockNetworkImage = true
        }
    }

    fun dispose() {
        main.post {
            webView?.destroy()
            webView = null
        }
    }
}
