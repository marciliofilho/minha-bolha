package com.minhabolha.android

import android.app.Activity
import android.app.Dialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale

/**
 * Tela de reprodução nativa.
 *
 * Conecta-se ao [PlaybackService] por `MediaController`: o player (e a sessão
 * de mídia) ficam no serviço, então a reprodução continua em segundo plano e
 * aparece na tela de bloqueio. Esta Activity é só a interface.
 */
class PlayerActivity : Activity() {

    private companion object {
        const val TAG = "MinhaBolha"
        const val SAVE_INTERVAL_MS = 10_000L
    }

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var view: PlayerView? = null
    private val handler = Handler(Looper.getMainLooper())
    private var originalOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    private data class AddonSubtitleOption(
        val id: String,
        val label: String,
        val language: String,
        val source: String,
        val detail: String,
        val media3Label: String
    )

    private data class SubtitleChoice(
        val label: String,
        val detail: String,
        val group: TrackGroup?,
        val id: String?
    )

    private var baseUrl: String = ""
    private var playbackUrl: String = ""
    private var title: String = ""
    private var metaId: String = ""
    private var metaType: String = "movie"
    private var videoId: String = ""
    private var season: Int? = null
    private var episode: Int? = null
    private var poster: String? = null
    private var preferredSubtitleLanguage: String = "por"
    private var userSelectedSubtitle: Boolean = false
    private var autoSubtitleApplied: Boolean = false
    private val addonSubtitleOptions = mutableListOf<AddonSubtitleOption>()

    private val saveProgress = object : Runnable {
        override fun run() {
            persistProgress()
            handler.postDelayed(this, SAVE_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Tela cheia imersiva: esconde status e barra de navegação. Um vídeo
        // horizontal também gira para paisagem para ocupar a tela toda.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        originalOrientation = requestedOrientation
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

        val payload = intent.getStringExtra("payload") ?: run {
            finish()
            return
        }
        baseUrl = intent.getStringExtra("baseUrl").orEmpty()

        val json = try {
            JSONObject(payload)
        } catch (error: Exception) {
            Log.e(TAG, "payload inválido do player", error)
            finish()
            return
        }

        val relativeUrl = json.optString("url")
        if (relativeUrl.isEmpty()) {
            finish()
            return
        }
        playbackUrl = if (relativeUrl.startsWith("http")) relativeUrl else baseUrl + relativeUrl
        title = json.optString("title").ifEmpty { "Reprodução" }

        val tracking = json.optJSONObject("tracking")
        metaId = tracking?.optString("metaId").orEmpty()
        metaType = if (tracking?.optString("type") == "series") "series" else "movie"
        videoId = tracking?.optString("videoId").orEmpty()
        season = tracking?.optInt("season")?.takeIf { tracking.has("season") && !tracking.isNull("season") }
        episode = tracking?.optInt("episode")?.takeIf { tracking.has("episode") && !tracking.isNull("episode") }
        poster = tracking?.optString("poster")?.takeIf { it.isNotEmpty() }
        preferredSubtitleLanguage = json.optString("subtitleLanguage")
            .trim()
            .lowercase()
            .ifEmpty {
                if (Locale.getDefault().language == "pt") "por" else "off"
            }

        view = PlayerView(this).apply {
            setShowNextButton(false)
            setShowPreviousButton(false)
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }

        val errorText = TextView(this).apply {
            setTextColor(Color.parseColor("#F8FAFC"))
            textSize = 15f
            gravity = Gravity.CENTER
        }
        val backButton = Button(this).apply {
            text = "Voltar"
            setTextColor(Color.parseColor("#080A0F"))
            setBackgroundColor(Color.parseColor("#7C9CFF"))
            setPadding(64, 24, 64, 24)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = 32
            }
            setOnClickListener { finish() }
        }
        val errorBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#F2080A0F"))
            setPadding(64, 64, 64, 64)
            visibility = View.GONE
        }
        val retryButton = Button(this).apply {
            text = "Tentar novamente"
            setTextColor(Color.parseColor("#7C9CFF"))
            setBackgroundColor(Color.parseColor("#1B2433"))
            setPadding(48, 20, 48, 20)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                topMargin = 24
            }
            setOnClickListener {
                errorBox.visibility = View.GONE
                controller?.let { media ->
                    runCatching { media.prepare() }
                    media.playWhenReady = true
                }
            }
        }
        errorBox.addView(errorText)
        errorBox.addView(retryButton)
        errorBox.addView(backButton)

        val subtitleButton = Button(this).apply {
            text = "Legendas"
            textSize = 12f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#D9080A0F"))
            setPadding(32, 8, 32, 8)
            visibility = View.GONE
            setOnClickListener { showSubtitlePicker() }
        }

        val root = FrameLayout(this)
        root.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        root.addView(
            subtitleButton,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                topMargin = 32
                rightMargin = 32
            }
        )
        root.addView(
            errorBox,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener(
            {
                try {
                    val mediaController = future.get()
                    controller = mediaController
                    view?.player = mediaController

                    mediaController.addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            if (state == Player.STATE_READY) errorBox.visibility = View.GONE
                            if (state == Player.STATE_ENDED) persistProgress(completed = true)
                        }

                        override fun onPlayerError(error: PlaybackException) {
                            Log.e(TAG, "player nativo: erro", error)
                            val detail = error.cause?.message?.takeIf { it.isNotBlank() }
                                ?: error.message
                                ?: error.errorCodeName
                            errorText.text = buildString {
                                appendLine("Não foi possível reproduzir este stream.")
                                appendLine()
                                appendLine(detail)
                                appendLine()
                                append("Volte e escolha outro stream.")
                            }
                            errorBox.visibility = View.VISIBLE
                        }

                        override fun onVideoSizeChanged(videoSize: VideoSize) {
                            if (videoSize.width > videoSize.height) {
                                requestedOrientation =
                                    ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            }
                        }

                        override fun onTracksChanged(tracks: Tracks) {
                            val hasText = tracks.groups.any {
                                it.type == C.TRACK_TYPE_TEXT && it.isSupported
                            }
                            subtitleButton.visibility = if (hasText) View.VISIBLE else View.GONE
                            maybeAutoSelectSubtitle(tracks)
                        }
                    })

                    // Busca as legendas antes de iniciar o MediaItem. Antes
                    // o player começava sem legendas e era reconfigurado no
                    // meio do carregamento, causando piscadas/reinícios.
                    Thread {
                        val subtitleData = fetchSubtitleData()
                        runOnUiThread {
                            if (isFinishing || isDestroyed) return@runOnUiThread
                            addonSubtitleOptions.clear()
                            addonSubtitleOptions.addAll(subtitleData.second)
                            autoSubtitleApplied = false
                            mediaController.setMediaItem(
                                buildItem(subtitleData.first)
                            )
                            mediaController.prepare()
                            mediaController.playWhenReady = true
                            handler.postDelayed(saveProgress, SAVE_INTERVAL_MS)
                        }
                    }.start()
                    Log.i(TAG, "player nativo iniciado: $title")
                } catch (error: Exception) {
                    Log.e(TAG, "falha ao conectar no serviço de mídia", error)
                    errorText.text = buildString {
                        appendLine("Não foi possível conectar ao player.")
                        appendLine()
                        appendLine(error.message ?: error.javaClass.simpleName)
                        appendLine()
                        append("Volte e tente abrir o vídeo novamente.")
                    }
                    errorBox.visibility = View.VISIBLE
                }
            },
            ContextCompat.getMainExecutor(this)
        )
    }

    private fun buildItem(subtitles: List<MediaItem.SubtitleConfiguration>): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtworkUri(poster?.let { Uri.parse(it) })
            .build()

        return MediaItem.Builder()
            .setUri(playbackUrl)
            .setMediaMetadata(metadata)
            .setSubtitleConfigurations(subtitles)
            .build()
    }

    /**
     * Busca as legendas antes de iniciar o MediaItem. Retorna as configurações
     * e os metadados usados no popup.
     */
    private fun fetchSubtitleData(): Pair<
        List<MediaItem.SubtitleConfiguration>,
        List<AddonSubtitleOption>
        > {
        val configurations = mutableListOf<MediaItem.SubtitleConfiguration>()
        val options = mutableListOf<AddonSubtitleOption>()
        if (metaId.isEmpty() || baseUrl.isEmpty()) return configurations to options

        try {
            val query = buildString {
                append(baseUrl).append("/api/stremio/subtitles")
                append("?type=").append(URLEncoder.encode(metaType, "UTF-8"))
                append("&id=").append(URLEncoder.encode(metaId, "UTF-8"))
                if (videoId.isNotEmpty()) {
                    append("&videoId=").append(URLEncoder.encode(videoId, "UTF-8"))
                }
            }
            val connection = URL(query).openConnection() as HttpURLConnection
            connection.connectTimeout = 2000
            connection.readTimeout = 3000
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()

            val subtitles = JSONObject(text).optJSONArray("subtitles") ?: JSONArray()
            for (index in 0 until subtitles.length()) {
                // Mantém todas as faixas, inclusive as repetidas: duas
                // legendas em PT-BR podem ter sincronias diferentes.
                if (configurations.size >= 80) break
                val item = subtitles.optJSONObject(index) ?: continue
                val proxyUrl = item.optString("proxyUrl")
                if (proxyUrl.isEmpty()) continue
                val language = item.optString("lang").ifEmpty { "und" }
                val label = subtitleLabel(language, item.optString("language"))
                val source = item.optString("addonName").ifEmpty { "Addon" }
                val fileName = item.optString("url")
                    .substringAfterLast('/')
                    .substringBefore('?')
                    .take(72)
                val detail = listOf(source, fileName)
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                // Media3 não expõe um id no SubtitleConfiguration; o label
                // único serve para reencontrar a faixa no TrackGroup.
                val media3Label = "$label · $source · ${index + 1}"
                configurations.add(
                    MediaItem.SubtitleConfiguration.Builder(Uri.parse(baseUrl + proxyUrl))
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLanguage(language)
                        .setLabel(media3Label)
                        .build()
                )
                options.add(
                    AddonSubtitleOption(
                        id = "sub-$index",
                        label = label,
                        language = language,
                        source = source,
                        detail = detail,
                        media3Label = media3Label
                    )
                )
            }
        } catch (error: Exception) {
            Log.w(TAG, "falha ao carregar legendas", error)
        }
        Log.i(TAG, "player nativo: ${configurations.size} faixa(s) de legenda")
        return configurations to options
    }

    private fun subtitleLabel(language: String, rawLabel: String?): String {
        val code = language.trim().lowercase()
        val label = rawLabel?.trim().orEmpty()
        if (label.isNotEmpty() && !label.equals(code, ignoreCase = true)) return label
        if (code.isEmpty() || code == "und" || code == "unknown") return "Legenda"
        val display = Locale.forLanguageTag(code)
            .getDisplayLanguage(Locale("pt", "BR"))
            .replaceFirstChar { it.uppercase() }
        return display.ifEmpty { code }
    }

    private fun preferredAliases(): Set<String> {
        return when (preferredSubtitleLanguage) {
            "por", "pob", "pt", "pt-br", "pt-pt" ->
                setOf("por", "pob", "pt", "pt-br", "pt-pt")
            "eng", "en" -> setOf("eng", "en")
            "spa", "es" -> setOf("spa", "es")
            "fra", "fre", "fr" -> setOf("fra", "fre", "fr")
            "deu", "ger", "de" -> setOf("deu", "ger", "de")
            "ita", "it" -> setOf("ita", "it")
            "jpn", "ja" -> setOf("jpn", "ja")
            "kor", "ko" -> setOf("kor", "ko")
            "zho", "chi", "zh" -> setOf("zho", "chi", "zh", "zh-cn", "zh-tw")
            else -> setOf(preferredSubtitleLanguage)
        }
    }

    private fun isPreferredSubtitle(language: String?, label: String?): Boolean {
        if (preferredSubtitleLanguage == "off") return false
        val code = language?.trim()?.lowercase().orEmpty()
        if (code.isNotEmpty() && code in preferredAliases()) return true
        return preferredAliases().any { it.startsWith("por") } &&
            label?.contains("portugu", ignoreCase = true) == true
    }

    private fun isAddonTrack(group: TrackGroup): Boolean {
        val label = group.getFormat(0).label?.toString()
        return addonSubtitleOptions.any { it.media3Label == label }
    }

    private fun selectTextGroup(group: TrackGroup) {
        val mediaController = controller ?: return
        val builder = mediaController.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(TrackSelectionOverride(group, 0))
        mediaController.trackSelectionParameters = builder.build()
    }

    private fun disableText() {
        val mediaController = controller ?: return
        val builder = mediaController.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        mediaController.trackSelectionParameters = builder.build()
    }

    private fun maybeAutoSelectSubtitle(tracks: Tracks) {
        if (userSelectedSubtitle || preferredSubtitleLanguage == "off") return
        val textGroups = tracks.groups.filter {
            it.type == C.TRACK_TYPE_TEXT && it.isSupported
        }
        if (textGroups.isEmpty()) return

        val preferredGroups = textGroups.filter {
            val format = it.mediaTrackGroup.getFormat(0)
            isPreferredSubtitle(
                format.language?.toString(),
                format.label?.toString()
            )
        }
        if (preferredGroups.isEmpty()) return
        // Prefere uma legenda externa PT-BR (OpenSubtitles) em vez da faixa
        // embutida, que muitas vezes é só crédito do encoder.
        val preferred = preferredGroups.firstOrNull {
            isAddonTrack(it.mediaTrackGroup)
        } ?: preferredGroups.first()
        val selected = textGroups.firstOrNull { it.isSelected }

        if (selected == null) {
            selectTextGroup(preferred.mediaTrackGroup)
            autoSubtitleApplied = true
            return
        }
        // Se a faixa embutida já foi escolhida, troca uma única vez para uma
        // legenda PT-BR dos addons (normalmente melhor sincronizada).
        if (!autoSubtitleApplied &&
            !isAddonTrack(selected.mediaTrackGroup) &&
            isAddonTrack(preferred.mediaTrackGroup)
        ) {
            selectTextGroup(preferred.mediaTrackGroup)
            autoSubtitleApplied = true
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun showSubtitlePicker() {
        val mediaController = controller ?: return
        val textGroups = mediaController.currentTracks.groups.filter {
            it.type == C.TRACK_TYPE_TEXT && it.isSupported
        }
        if (textGroups.isEmpty()) {
            Toast.makeText(this, "Este stream não tem legendas.", Toast.LENGTH_SHORT).show()
            return
        }

        val choices = mutableListOf(
            SubtitleChoice("Desligada", "Nenhuma legenda", null, null)
        )
        val groupsByLabel = textGroups.mapNotNull { group ->
            val label = group.mediaTrackGroup.getFormat(0).label?.toString()
                ?: return@mapNotNull null
            label to group.mediaTrackGroup
        }.toMap()
        val usedLabels = mutableSetOf<String>()

        for (option in addonSubtitleOptions) {
            val group = groupsByLabel[option.media3Label] ?: continue
            choices.add(
                SubtitleChoice(
                    label = option.label,
                    detail = option.detail.ifEmpty { option.source },
                    group = group,
                    id = option.id
                )
            )
            usedLabels.add(option.media3Label)
        }

        var embeddedIndex = 0
        for (group in textGroups) {
            val format = group.mediaTrackGroup.getFormat(0)
            val label = format.label?.toString()
            if (label != null && label in usedLabels) continue
            val language = format.language?.toString().orEmpty()
            embeddedIndex++
            choices.add(
                SubtitleChoice(
                    label = subtitleLabel(language, label),
                    detail = "Embutida no vídeo · faixa $embeddedIndex",
                    group = group.mediaTrackGroup,
                    id = format.id
                )
            )
        }

        // PT-BR primeiro, mas mantendo todas as alternativas.
        val ordered = listOf(choices.first()) + choices.drop(1).sortedWith(
            compareByDescending<SubtitleChoice> {
                isPreferredSubtitle(
                    it.group?.getFormat(0)?.language?.toString(),
                    it.group?.getFormat(0)?.label?.toString()
                )
            }.thenBy { it.label.lowercase() }
        )

        val activeGroup = textGroups.firstOrNull { it.isSelected }?.mediaTrackGroup
        val selectedIndex = ordered.indexOfFirst { choice ->
            if (choice.group == null) activeGroup == null
            else choice.group == activeGroup
        }.let { if (it >= 0) it else 0 }

        val dialog = Dialog(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(20).toFloat()
                setColor(Color.parseColor("#121722"))
                setStroke(dp(1), Color.parseColor("#2A3346"))
            }
        }

        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(
            TextView(this).apply {
                text = "Legendas"
                setTextColor(Color.parseColor("#F8FAFC"))
                textSize = 18f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        titleRow.addView(
            TextView(this).apply {
                text = "${ordered.size - 1} faixas"
                setTextColor(Color.parseColor("#8B93A7"))
                textSize = 11f
            }
        )
        root.addView(titleRow)

        root.addView(
            TextView(this).apply {
                text = "Escolha outra faixa se a legenda estiver fora de sincronia."
                setTextColor(Color.parseColor("#8B93A7"))
                textSize = 11f
                setPadding(0, dp(4), 0, dp(8))
            }
        )

        val list = ListView(this).apply {
            divider = ColorDrawable(Color.TRANSPARENT)
            dividerHeight = dp(2)
            adapter = SubtitleAdapter(ordered, selectedIndex)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                minOf((resources.displayMetrics.heightPixels * 0.62).toInt(), dp(520))
            )
            setOnItemClickListener { _, _, position, _ ->
                val choice = ordered[position]
                userSelectedSubtitle = true
                if (choice.group == null) disableText() else selectTextGroup(choice.group)
                dialog.dismiss()
            }
        }
        root.addView(list)

        root.addView(
            TextView(this).apply {
                text = "Fechar"
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#7C9CFF"))
                textSize = 13f
                setPadding(0, dp(10), 0, dp(6))
                setOnClickListener { dialog.dismiss() }
            }
        )

        dialog.setContentView(root)
        dialog.setCanceledOnTouchOutside(true)
        dialog.setOnShowListener {
            dialog.window?.apply {
                setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                setLayout(
                    minOf((resources.displayMetrics.widthPixels * 0.92).toInt(), dp(640)),
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
                setDimAmount(0.65f)
                addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            }
        }
        dialog.show()
    }

    private inner class SubtitleAdapter(
        private val choices: List<SubtitleChoice>,
        private val selectedIndex: Int
    ) : BaseAdapter() {
        override fun getCount(): Int = choices.size
        override fun getItem(position: Int): SubtitleChoice = choices[position]
        override fun getItemId(position: Int): Long = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val choice = choices[position]
            val selected = position == selectedIndex
            val row = LinearLayout(this@PlayerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(10), dp(10), dp(10))
                background = GradientDrawable().apply {
                    cornerRadius = dp(10).toFloat()
                    setColor(
                        if (selected) Color.parseColor("#1B2433") else Color.TRANSPARENT
                    )
                }
            }

            val textColumn = LinearLayout(this@PlayerActivity).apply {
                orientation = LinearLayout.VERTICAL
            }
            textColumn.addView(
                TextView(this@PlayerActivity).apply {
                    text = choice.label
                    setTextColor(
                        if (selected) Color.parseColor("#7C9CFF")
                        else Color.parseColor("#F8FAFC")
                    )
                    textSize = 14f
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                }
            )
            textColumn.addView(
                TextView(this@PlayerActivity).apply {
                    text = choice.detail
                    setTextColor(Color.parseColor("#8B93A7"))
                    textSize = 11f
                    maxLines = 2
                    ellipsize = TextUtils.TruncateAt.END
                }
            )
            row.addView(
                textColumn,
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            )
            row.addView(
                TextView(this@PlayerActivity).apply {
                    text = if (selected) "✓" else ""
                    setTextColor(Color.parseColor("#7C9CFF"))
                    textSize = 16f
                    gravity = Gravity.CENTER
                    width = dp(28)
                }
            )
            return row
        }
    }

    override fun finish() {
        // Volta à orientação que o app usava antes do player em tela cheia.
        requestedOrientation = originalOrientation
        super.finish()
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        finish()
    }

    override fun onStop() {
        persistProgress()
        super.onStop()
    }

    /**
     * Ao sair, apenas soltamos o controlador: o player continua no serviço e a
     * notificação de mídia permite pausar/parar.
     */
    override fun onDestroy() {
        // Fechar a tela do player (X/Voltar) encerra o áudio; apertar Home
        // continua em segundo plano pela MediaSession.
        if (isFinishing) {
            controller?.let { media ->
                runCatching { media.stop() }
                runCatching { media.clearMediaItems() }
            }
            runCatching {
                startService(
                    Intent(this, PlaybackService::class.java)
                        .setAction(PlaybackService.ACTION_STOP)
                )
            }
        }
        handler.removeCallbacksAndMessages(null)
        view?.player = null
        view = null
        controllerFuture?.let { future ->
            if (future.isDone) {
                try {
                    MediaController.releaseFuture(future)
                } catch (error: Exception) {
                    Log.w(TAG, "falha ao liberar o controlador", error)
                }
            }
        }
        controllerFuture = null
        controller = null
        super.onDestroy()
    }

    private fun persistProgress(completed: Boolean = false) {
        val mediaController = controller ?: return
        if (metaId.isEmpty() || videoId.isEmpty() || baseUrl.isEmpty()) return

        val position = mediaController.currentPosition.coerceAtLeast(0)
        // Não cria "Continuar assistindo" para um stream que nunca começou.
        if (position <= 0 && !completed) return
        val duration = mediaController.duration.takeIf { it > 0 }

        val body = JSONObject()
            .put("metaId", metaId)
            .put("type", metaType)
            .put("videoId", videoId)
            .put("season", season ?: JSONObject.NULL)
            .put("episode", episode ?: JSONObject.NULL)
            .put("positionMs", position)
            .put("durationMs", duration ?: JSONObject.NULL)
            .put("name", title)
            .put("poster", poster ?: JSONObject.NULL)
            .put("completed", completed)
            .toString()

        Thread {
            try {
                val connection = URL("$baseUrl/api/playback/progress").openConnection() as HttpURLConnection
                connection.requestMethod = "PUT"
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                connection.responseCode
                connection.disconnect()
            } catch (error: Exception) {
                Log.w(TAG, "falha ao salvar progresso do player nativo", error)
            }
        }.start()
    }
}
