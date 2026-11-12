import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** UI React do desktop, compilada por `npm run build` na raiz do repositório. */
val webDist = rootProject.file("../web/dist")

/** Migrations compartilhadas com a API do desktop. */
val migrationsDir = rootProject.file("../api/src/db/migrations")

/**
 * Assinatura de release.
 *
 * O keystore e a senha ficam fora do repositório (`apps/android/keystore.properties`,
 * ignorado pelo git). No CI eles são gravados a partir dos segredos
 * `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
 * e `ANDROID_KEY_PASSWORD`.
 */
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}
val hasReleaseSigning = keystoreProperties.getProperty("storeFile")?.isNotBlank() == true

/** `-PabiSplits=true` gera APKs por ABI; o AAB já é dividido pela loja. */
val abiSplits = providers.gradleProperty("abiSplits").orNull == "true"

/**
 * Assets gerados: a UI compilada e as migrations.
 *
 * Se `apps/web/dist` não existir (build local sem `npm run build`), o app usa a
 * página de diagnóstico em `src/main/assets-fallback/web`.
 */
val generatedAssetsDir = layout.buildDirectory.dir("generated/assets")

val syncWebAssets by tasks.registering {
    val target = generatedAssetsDir.map { it.dir("web") }

    doLast {
        val targetDir = target.get().asFile
        targetDir.deleteRecursively()
        targetDir.mkdirs()

        val source = if (webDist.exists()) webDist else file("src/main/assets-fallback/web")
        logger.lifecycle("Android UI: ${source.absolutePath}")
        copy {
            from(source)
            into(targetDir)
        }
    }
}

val syncMigrations by tasks.registering {
    val target = generatedAssetsDir.map { it.dir("db/migrations") }

    doLast {
        val targetDir = target.get().asFile
        targetDir.deleteRecursively()
        targetDir.mkdirs()

        if (!migrationsDir.exists()) {
            throw GradleException("Migrations não encontradas em ${migrationsDir.absolutePath}")
        }
        copy {
            from(migrationsDir)
            include("*.sql")
            into(targetDir)
        }
    }
}

android {
    namespace = "com.minhabolha.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.minhabolha.android"
        // SQLite do Android 11+ já suporta JSON1 e window functions usados
        // pelas migrations compartilhadas com o desktop.
        minSdk = 30
        targetSdk = 35
        versionCode = 15
        versionName = "0.5.0-alpha15"

        // libtorrent4j traz bibliotecas nativas: só as ABIs suportadas.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedAssetsDir)
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    splits {
        abi {
            isEnable = abiSplits
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild") {
    dependsOn(syncWebAssets, syncMigrations)
}

dependencies {
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.core:core-ktx:1.13.1")

    // Motor de torrents (mesma base do LibreTorrent). Uma artifact por ABI.
    implementation("org.libtorrent4j:libtorrent4j:2.1.0-39")
    implementation("org.libtorrent4j:libtorrent4j-android-arm64:2.1.0-39")
    implementation("org.libtorrent4j:libtorrent4j-android-x86_64:2.1.0-39")

    // SQLite empacotado: o SQLite do sistema (inclusive no Android 11) pode vir
    // sem JSON1, que as migrations compartilhadas com o desktop usam. Esta
    // biblioteca garante a mesma versão (3.49) em qualquer aparelho.
    implementation("com.github.requery:sqlite-android:3.49.0")

    // Player nativo para MKV/HEVC (o WebView não abre esses containers).
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
}
