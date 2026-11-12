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

    data class ChapterLink(val title: String, val url: String)

    data class ChapterList(
        val title: String,
        val links: List<ChapterLink>,
        val cover: String? = null
    )

    private companion object {
        const val TAG = "MinhaBolha"
        const val RENDER_DELAY_MS = 4_000L
        const val DEFAULT_TIMEOUT_MS = 30_000L

        const val EXTRACT_JS = """            (function() {
              try {
                var junk = document.querySelectorAll('script, style, noscript, iframe, nav, header, footer, aside, form');
                for (var i = 0; i < junk.length; i++) { junk[i].parentNode && junk[i].parentNode.removeChild(junk[i]); }

                // Webnovel: o corpo real fica em .cha-words; o container
                // mobile inclui cabeçalho/menus e seria escolhido por tamanho.
                var words = document.querySelector('.cha-words');
                if (words) {
                  var innerJunk = words.querySelectorAll(
                    '.para-comment, .chapter-comment, .comment-item, script, style'
                  );
                  for (var w = 0; w < innerJunk.length; w++) {
                    innerJunk[w].parentNode && innerJunk[w].parentNode.removeChild(innerJunk[w]);
                  }
                  var wordsTitle = document.querySelector('.cha-tit, h1');
                  return JSON.stringify({
                    title: wordsTitle ? (wordsTitle.textContent || '').trim() : (document.title || '').trim(),
                    text: (words.textContent || '').trim()
                  });
                }

                var selectors = [
                  '#chapter-content', '.cha-words', '.chapter-content', '.chapter-body',
                  '.reading-content', '.entry-content', '.post-content', '.content',
                  'article', 'main', 'body'
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

        const val CHAPTERS_JS = """
            (function() {
              try {
                var titleNode = document.querySelector('h1, .book-title, .novel-title, .entry-title');
                var ogTitle = document.querySelector('meta[property="og:title"], meta[name="og:title"]');
                var title = (titleNode ? titleNode.textContent : '') ||
                  (ogTitle ? ogTitle.getAttribute('content') : '') ||
                  document.title || '';

                // Capas específicas primeiro: em páginas de catálogo o
                // og:image costuma apontar para banner/anúncio, não a capa.
                var cover = '';
                var coverImg = document.querySelector(
                  'img[src*="book-pic.webnovel.com/bookcover"], .g_thumb > img,' +
                  ' .book-cover img, .novel-cover img, .cover img, .book-img img,' +
                  ' .series-cover img, .thumbnail img'
                );
                if (coverImg) cover = coverImg.currentSrc || coverImg.src || '';
                if (!cover) {
                  var coverNode = document.querySelector(
                    'meta[property="og:image"], meta[name="og:image"], link[rel="image_src"]'
                  );
                  cover = coverNode
                    ? (coverNode.getAttribute('content') || coverNode.getAttribute('href') || '')
                    : '';
                }

                var cleanTitle = function(a) {
                  var own = (a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
                  if (own) return own;
                  return (a.textContent || '')
                    .replace(/\s+/g, ' ')
                    .replace(/\s+\d+\s+(years?|months?|days?|hours?|minutes?)\s+ago\s*$/i, '')
                    .trim();
                };

                // Webnovel (e afins): lista de capítulos em .volume-item.
                var volumeAnchors = document.querySelectorAll(
                  '.j_catalog_list .volume-item li a[href], .volume-item ol > li a[href]'
                );
                if (volumeAnchors.length > 2) {
                  var structured = [];
                  var seenStructured = {};
                  for (var v = 0; v < volumeAnchors.length; v++) {
                    var va = volumeAnchors[v];
                    if (va.querySelector('svg._icon')) continue;
                    var vhref = va.href || '';
                    if (!/^https?:/i.test(vhref) || seenStructured[vhref]) continue;
                    var vname = cleanTitle(va);
                    if (!vname) continue;
                    seenStructured[vhref] = true;
                    structured.push({ title: vname, url: vhref });
                  }
                  if (structured.length > 2) {
                    return JSON.stringify({ title: title.trim(), cover: cover, links: structured });
                  }
                }

                var containers = document.querySelectorAll(
                  '#chapters, #chapterlist, #chapter-list, .chapters, .chapter-list, .list-chapter,' +
                  ' .list-chapters, .chapter-list-wrap, .volume-list, .volume-item, .chapter-item-list,' +
                  ' .manga-chapter, .chp-list, .chapter-list-container, .table-of-contents, .toc,' +
                  ' table#chapters, ul.chapter-list'
                );
                var anchors = [];
                var inList = {};
                if (containers.length > 0) {
                  for (var c = 0; c < containers.length; c++) {
                    var list = containers[c].querySelectorAll('a[href]');
                    for (var j = 0; j < list.length; j++) {
                      anchors.push(list[j]);
                      inList[list[j].href] = true;
                    }
                  }
                }
                if (anchors.length === 0) anchors = document.querySelectorAll('a[href]');

                var links = [];
                var seen = {};
                var nav = /^(prev|previous|next|read now|start reading|home|index|table of contents|login|register|search|menu|novel|voltar|pr[oó]ximo|anterior|continue reading|buy)$/i;
                for (var i = 0; i < anchors.length && links.length < 3000; i++) {
                  var a = anchors[i];
                  var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
                  if (text.length < 1 || text.length > 200) continue;
                  var href = a.href || '';
                  if (!/^https?:/i.test(href)) continue;
                  if (nav.test(text)) continue;
                  if (/^(19|20)\d{2}$/.test(text)) continue;
                  var listed = !!inList[href];
                  var looksChapter = /(cap[ií]tulo|chapter|epis[oó]dio|episode|volume|vol\.|prologue|pr[oó]logo|ep[ií]logo|interlude)/i.test(text) ||
                    /^\s*\d{1,5}([.,]\d+)?\s*([:.\-–—]\s*\S.*)?$/.test(text) ||
                    /(cap[ií]tulo|chapter|epis[oó]dio|episode|\/ch\/|\/cap\/|chapter-)/i.test(href);
                  if (!looksChapter && !listed) continue;
                  if (seen[href]) continue;
                  seen[href] = true;
                  links.push({ title: listed ? cleanTitle(a) : text, url: href });
                }
                return JSON.stringify({ title: title.trim(), cover: cover, links: links });
              } catch (error) {
                return JSON.stringify({ title: '', cover: '', links: [], error: String(error) });
              }
            })();
        """
    }

    /**
     * Webnovel só mostra a lista completa em `/catalog`. O usuário costuma
     * cadastrar a página do livro, então normalizamos antes de extrair.
     */
    private fun catalogUrl(url: String): String {
        val clean = url.substringBefore('?').substringBefore('#')
        val match = Regex(
            "^(https?://(?:www\\.|m\\.)?webnovel\\.com(?:/[a-z]{2})?/book/\\d+)/?$",
            RegexOption.IGNORE_CASE
        ).find(clean) ?: return url
        return match.groupValues[1] + "/catalog"
    }

    private val appContext: Context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var webView: WebView? = null
    private var host: android.view.ViewGroup? = null

    /** Precisa de uma janela real: WebViews soltos não carregam de forma confiável. */
    fun attach(root: android.view.ViewGroup) {
        host = root
    }

    /** Lista os capítulos (links) da página da novel. */
    fun chapters(rawUrl: String, timeoutMs: Long = DEFAULT_TIMEOUT_MS): ChapterList? {
        val url = try {
            catalogUrl(com.minhabolha.android.connectors.PublicUrl.assert(rawUrl).toString())
        } catch (error: Exception) {
            throw HubException(400, "validation", "URL inválida para a novel.")
        }

        synchronized(lock) {
            val latch = CountDownLatch(1)
            var result: ChapterList? = null

            // O catálogo do Webnovel hidrata em etapas; espera a lista
            // crescer antes de aceitar uma extração parcial.
            val minLinks =
                if (Regex("webnovel\\.com", RegexOption.IGNORE_CASE).containsMatchIn(url)) 5 else 0
            main.post { loadScript(url, CHAPTERS_JS, minLinks) { raw ->
                result = parseChapters(raw)
                latch.countDown()
            } }

            if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return null
            return result
        }
    }

    private fun parseChapters(raw: String?): ChapterList? {
        if (raw.isNullOrBlank() || raw == "null") return null
        val json = try {
            JSONObject(org.json.JSONTokener(raw).nextValue().toString())
        } catch (error: Exception) {
            return null
        }

        val title = json.optString("title").trim()
        val cover = json.optText("cover")
        val array = json.optJSONArray("links") ?: return null
        val links = mutableListOf<ChapterLink>()
        val seen = mutableSetOf<String>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val url = item.optString("url")
            val name = item.optString("title").trim()
            if (url.isEmpty() || name.isEmpty() || !seen.add(url)) continue
            links.add(ChapterLink(name, url))
        }
        if (links.isEmpty()) return null

        // Muitos índices vêm do mais novo para o mais antigo. Ordena pelo
        // número do capítulo para as setas anterior/próximo fazerem sentido.
        val numbered = links.map { link ->
            val number = Regex("(?i)(?:chapter|cap[ií]tulo|ch)\\.?\\s*(\\d{1,5})")
                .find(link.title)?.groupValues?.getOrNull(1)?.toIntOrNull()
                ?: Regex("^\\s*(\\d{1,5})\\b").find(link.title)?.groupValues?.getOrNull(1)?.toIntOrNull()
            link to number
        }
        val ordered = if (numbered.count { it.second != null } >= numbered.size / 2) {
            numbered.sortedBy { it.second ?: Int.MAX_VALUE }.map { it.first }
        } else {
            links
        }

        return ChapterList(title.ifEmpty { "Novel" }, ordered, cover)
    }

    /** Executa um script arbitrário na página carregada. */
    private fun loadScript(
        url: String,
        script: String,
        minLinks: Int = 0,
        callback: (String?) -> Unit
    ) {
        loadInternal(url, script, minLinks) { raw, _ -> callback(raw) }
    }

    fun extract(rawUrl: String, timeoutMs: Long = DEFAULT_TIMEOUT_MS): Extracted? {
        val url = try {
            com.minhabolha.android.connectors.PublicUrl.assert(rawUrl).toString()
        } catch (error: Exception) {
            throw HubException(400, "validation", "URL inválida para leitura.")
        }

        synchronized(lock) {
            val latch = CountDownLatch(1)
            var result: Extracted? = null
            Log.i(TAG, "extraindo: $url")
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
        loadInternal(url, EXTRACT_JS) { raw, error -> callback(parse(raw), error) }
    }

    private fun loadInternal(
        url: String,
        script: String,
        minLinks: Int = 0,
        callback: (String?, String?) -> Unit
    ) {
        val view = webView ?: createWebView().also { webView = it }

        var completed = false
        fun finish(raw: String?, error: String?) {
            if (completed) return
            completed = true
            callback(raw, error)
        }

        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Deixa o WebView seguir redirecionamentos (http→https,
                // barra final, domínio canônico). Bloquear o redirect deixava
                // a página em branco e a lista de capítulos vazia.
                val scheme = request.url.scheme.orEmpty()
                return scheme != "http" && scheme != "https"
            }

            override fun onPageFinished(view: WebView, finishedUrl: String) {
                var attempt = 0
                fun evaluate() {
                    view.evaluateJavascript(script) { value ->
                        if (completed) return@evaluateJavascript
                        if (minLinks > 0 && linkCount(value) < minLinks && attempt < 6) {
                            attempt++
                            view.postDelayed({ evaluate() }, 2_000L)
                        } else {
                            finish(value, null)
                        }
                    }
                }
                view.postDelayed({ evaluate() }, RENDER_DELAY_MS)
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

    private fun linkCount(raw: String?): Int {
        if (raw.isNullOrBlank() || raw == "null") return 0
        return try {
            val json = JSONObject(org.json.JSONTokener(raw).nextValue().toString())
            json.optJSONArray("links")?.length() ?: 0
        } catch (error: Exception) {
            0
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

            val parent = host
            if (parent != null) {
                alpha = 0f
                isFocusable = false
                isClickable = false
                parent.addView(this, android.widget.FrameLayout.LayoutParams(1, 1))
            } else {
                Log.w(TAG, "extractor sem janela anexada; usando WebView solto")
            }
        }
    }

    fun dispose() {
        main.post {
            webView?.destroy()
            webView = null
        }
    }
}
