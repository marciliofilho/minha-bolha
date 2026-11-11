# Minha Bolha Android

Android spike for the **Minha Bolha / My Bubble** app.

This is the first step toward functional parity on Android. It is **not** a full port yet.

## What this spike proves

- Android application written in Kotlin.
- Embedded local HTTP server (`NanoHTTPD`) on `127.0.0.1`.
- React/WebView shell loading from the local server.
- Local SQLite database.
- `/api/health` returning platform, database status and port.
- Debug APK built by GitHub Actions.

## Build

The repository does not require Android Studio for the debug build; the CI workflow installs the Android SDK and Gradle.

Local build (requires JDK 17 + Android SDK + Gradle 8.9):

```bash
gradle -p apps/android :app:assembleDebug
```

The APK is generated at:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

The GitHub Actions workflow is `Build Android debug APK`.

## Architecture direction

The full Android version will keep the existing React UI but replace the
Electron/Node shell with a Kotlin backend:

- Kotlin/Ktor or NanoHTTPD local server serving `/api` and the web assets;
- Room/SQLite with the existing schema;
- WorkManager/Coroutines scheduler;
- OkHttp connectors for YouTube, RSS, TMDB, AniList, Steam, gg.deals and Stremio addons;
- Media3/ExoPlayer for direct/HLS playback;
- native torrent engine and FFmpeg for parity;
- Android WebView for the embedded browser, with different limitations from Electron Chromium.

The current spike only implements the health endpoint and the diagnostic page.

## Known limitations

- No feed, novels, Stremio or player yet.
- No torrent engine or FFmpeg yet.
- WebView is not Electron Chromium; CDP/Puppeteer-based extraction will need a new strategy.
- Android background execution, battery and storage restrictions apply.
