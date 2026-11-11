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
- Runtime smoke test on an Android emulator in CI.

## Validation status

The CI workflow builds the APK and runs a real emulator test before publishing the artifact:

1. installs the APK;
2. launches `com.minhabolha.android/.MainActivity`;
3. checks the process is alive and that there is no `FATAL EXCEPTION`;
4. forwards `127.0.0.1:47821` and validates `/api/health`
   (expected: `{"ok":true,...,"database":"sqlite-ok"}`);
5. validates the HTML served by the app;
6. uploads `android-spike.png` (screenshot) and `android-logcat.txt`.

The screenshot artifact shows the diagnostic page reporting **Android spike OK**,
port `47821` and SQLite `sqlite-ok`.

### Emulator requirements in CI

The runner needs `/dev/kvm`. The workflow adds a udev rule (`99-kvm4all.rules`)
before starting the emulator; without it the emulator cannot boot in time.
The smoke test uses API 30 with `target: default` and `arch: x86_64` because
it boots in ~25 s with KVM, while newer images are much slower.

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
