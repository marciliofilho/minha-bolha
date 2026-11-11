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
- Connectors **YouTube** (public Atom feed + channel page fallback) and
  **RSS/Atom/RDF**, with the same SSRF guard and HTTP policy as the desktop.
- **TMDB** (movies/series) and **AniList** (anime) connectors, including
  IMDB resolution, release events and feed items for releases/episodes.
- **Global calendar** (TMDB discover + AniList airing schedule), with the
  automatic `global-releases` source created on first boot.
- **Stremio addons**: install by manifest URL, catalog groups, catalog browsing
  and title metadata (the addon URL is encrypted and never exposed).
- API keys (TMDB/Steam/gg.deals) encrypted with the Android Keystore
  (AES-GCM); the UI only ever sees a masked status.
- Scheduler in-process: 30s tick, 2 concurrent jobs, jitter, exponential
  backoff and per-type minimum interval.
- WorkManager refreshes the sources every ~6 hours when the app is closed.
- SSE (`/api/events`) with real `source:status`, `items:new`,
  `refresh:state`, `calendar:changed` and `secrets:changed` events.
- API implemented in Kotlin:
  - `GET /api/health`, `GET /api/status`, `GET /api/events`
  - `GET|PATCH /api/settings`
  - `GET|POST /api/categories`
  - `GET /api/secrets`, `PUT|DELETE /api/secrets/:id`
  - `GET /api/media/search`
  - `GET /api/stremio/status`, `GET|POST /api/stremio/addons`,
    `DELETE /api/stremio/addons/:id`, `GET /api/stremio/catalogs`,
    `GET /api/stremio/catalog`, `GET /api/stremio/search`,
    `GET /api/stremio/title/:type/:id`, `GET /api/stremio/library`
  - `GET /api/calendar`, `GET /api/calendar/search`, `POST /api/calendar/refresh`
  - `GET|POST /api/sources`, `POST /api/sources/resolve`,
    `POST /api/sources/bulk-delete`, `PATCH|DELETE /api/sources/:id`,
    `POST /api/sources/:id/refresh`, `GET /api/sources/:id/runs`
  - `POST /api/refresh`
  - `GET /api/feed`, `/api/feed/counts`, `POST /api/feed/mark-all-read`
  - `GET|PATCH /api/items/:id`
- SPA fallback: React Router routes are served from `index.html`.
- Debug APK built by GitHub Actions.
- Emulator smoke test that creates a real RSS source, waits for the scheduler,
  checks the feed, checks the run history and deletes the source.

## Not ported yet

- Stremio account login, library sync and continue-watching.
- Stremio streams, player, subtitles, HLS proxy and torrent engine.
- FFmpeg/transcoding, background downloads and notifications.
- Steam wishlist and gg.deals connectors, games screen.
- Embedded browser (WebView-based, no CDP/Puppeteer equivalent).
- Backup import/export, library mutations and novel connectors.

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
- `HubDatabase.kt` — schema, settings, categories, sources, runs, feed and item flags.
- `HubScheduler.kt` — tick, queue, backoff and synchronization bookkeeping.
- `connectors/` — HTTP client, SSRF guard, XML parsing, RSS and YouTube connectors.
- `EventStream.kt` — SSE hub and stream for `/api/events`.
- `SqlScript.kt` — splits the shared `.sql` migrations into statements.
- `MainActivity.kt` — WebView bootstrap, fixed local port and readiness check.

The server listens only on `127.0.0.1` and is not reachable from other devices.

### SSE and gzip

NanoHTTPD compresses any `text/*` response when the client sends
`Accept-Encoding: gzip`. `GZIPOutputStream` only flushes when the stream ends,
so the EventSource connection opened but no event ever reached the WebView.
`curl` does not send gzip, which made the bug invisible in manual tests.
`HubServer.useGzipWhenAccepted` disables gzip for `text/event-stream`.

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
9. no uncaught JavaScript error was logged;
10. a real RSS source is resolved, created, synced by the scheduler, appears in
    `/api/feed`, records a successful run and is deleted again.
    If the external feed is unreachable, step 10 prints a warning instead of
    failing the build.

### Emulator requirements in CI

The runner needs `/dev/kvm`; the workflow adds a udev rule (`99-kvm4all.rules`)
before starting the emulator. Without KVM the emulator cannot boot in time.
The smoke test uses API 34 (`google_apis`, `x86_64`) to get a modern WebView.

## Known differences from the desktop

- WebView instead of Electron Chromium: no CDP, no Puppeteer, no hidden windows.
- `minSdk` is 30 because the shared migrations use JSON1 and window functions.
- No background scheduler yet, so the feed is only reloaded when the UI asks.
- Play Store/AAB packaging and signing are not configured.
