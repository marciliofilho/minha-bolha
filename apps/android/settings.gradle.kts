import org.gradle.api.initialization.resolve.RepositoriesMode

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // sqlite-android (SQLite atual com JSON1) é distribuído pelo JitPack.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "MinhaBolhaAndroid"
include(":app")
