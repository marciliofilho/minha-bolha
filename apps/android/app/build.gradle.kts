plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** UI React do desktop, compilada por `npm run build` na raiz do repositório. */
val webDist = rootProject.file("../web/dist")

/** Migrations compartilhadas com a API do desktop. */
val migrationsDir = rootProject.file("../api/src/db/migrations")

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
        versionCode = 1
        versionName = "0.5.0-alpha1"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedAssetsDir)
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
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
}
