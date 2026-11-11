# Minha Bolha Android

Android version of the **Minha Bolha / My Bubble** app. It reuses the desktop
React interface inside a WebView and replaces the Electron/Node backend with a
Kotlin service running in the same process.

This is an **alpha** on the way to functional parity. It is not feature complete.

## What works today

- Kotlin app with an embedded HTTP server (`NanoHTTPD`) bound to `127.0.0.1`.
- The Android app serves the same React build used by the desktop; no separate UI.
- SQLite database created from the **same migrations** as the desktop
  (`apps/api/src/db/migrations`), with `_migrations` tracking.
- System categories seeded on first boot, mirroring `@hub/shared`.
- API implemented in Kotlin:
  - `GET /api/health`
  - `GET /api/status`
  - `GET /api/events` (SSE keep-alive)
  - `GET|PATCH /api/settings`
  - `GET|POST /api/categories`
  - `GET /api/sources`
  - `GET /api/feed`, `/api/feed/counts`, `POST /api/feed/mark-all-read`
  - `GET|PATCH /api/items/:id`
- SPA fallback: React Router routes are served from `index.html`.
- Debug APK built by GitHub Actions.
- Emulator smoke test that checks the API, the database, and that React
  actually mounted inside the WebView.

## Not ported yet

- Connectors and scheduler (YouTube, RSS, TMDB, AniList, Steam, gg.deals, novels).
- Stremio addons, catalogs, streams, player and playback progress.
- Torrent engine, FFmpeg/transcoding and background downloads.
- Embedded browser (WebView-based, no CDP/Puppeteer equivalent).
- Backup import/export, secrets, games, calendar and library mutations.

Because those endpoints do not exist yet, the corresponding screens show their
normal error state instead of data.

## Build

The repository does not require Android Studio for the debug build.

### CI

The workflow `Build Android debug APK` (`.github/workflows/build-android.yml`):

1. installs Java 17 and the preinstalled Android SDK;
2. runs `npm ci` and `npm run build` to generate `apps/web/dist`;
3. runs `node scripts/check-android-parity.mjs`;
4. builds the APK with Gradle;
5. runs `.github/scripts/android-smoke.sh` on an emulator;
6. uploads the APK, a screenshot and the logcat.

### Local build

Requires JDK 17, Android SDK and Gradle 8.9:

```bash
npm run build
gradle -p apps/android :app:assembleDebug
```

The APK is generated at
`apps/android/app/build/outputs/apk/debug/app-debug.apk`.

If `apps/web/dist` does not exist, Gradle packages the diagnostic page in
`app/src/main/assets-fallback/web` instead, which is useful only to check that
the server and WebView are alive.

## Architecture

```text
WebView (React build)
        │  http://127.0.0.1:47821
        ▼
HubServer (NanoHTTPD, Kotlin)
        │
        ▼
HubDatabase (SQLite + desktop migrations)
```

- `HubServer.kt` — routes, static assets, SPA fallback and JSON helpers.
- `HubDatabase.kt` — schema, settings, categories, sources, feed and item flags.
- `SqlScript.kt` — splits the shared `.sql` migrations into statements.
- `EventStream.kt` — minimal SSE stream for `/api/events`.
- `MainActivity.kt` — WebView bootstrap, fixed local port and readiness check.

The server listens only on `127.0.0.1` and is not reachable from other devices.

## Validation status

The CI emulator test asserts:

1. the APK installs and the activity starts;
2. the process stays alive with no `FATAL EXCEPTION`;
3. `hub.db` and its migrations exist (`run-as` on the app data dir);
4. `/api/health` returns `ok: true` and `platform: android`;
5. `/api/categories` contains the seeded system categories;
6. `/api/settings`, `/api/feed` and `/api/feed/counts` return valid JSON;
7. `/` and a React Router route (`/settings`) serve the app HTML;
8. the WebView mounted the React tree (`rootChildren > 0` in logcat);
9. no uncaught JavaScript error was logged.

### Emulator requirements in CI

The runner needs `/dev/kvm`; the workflow adds a udev rule (`99-kvm4all.rules`)
before starting the emulator. Without KVM the emulator cannot boot in time.
The smoke test uses API 34 (`google_apis`, `x86_64`) to get a modern WebView.

## Known differences from the desktop

- WebView instead of Electron Chromium: no CDP, no Puppeteer, no hidden windows.
- `minSdk` is 30 because the shared migrations use JSON1 and window functions.
- No background scheduler yet, so the feed is only reloaded when the UI asks.
- Play Store/AAB packaging and signing are not configured.
