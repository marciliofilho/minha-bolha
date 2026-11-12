# Minha Bolha Android

Android version of the **Minha Bolha / My Bubble** app. It reuses the desktop
React interface inside a WebView and replaces the Electron/Node backend with a
Kotlin service running in the same process.

This is an **alpha** on the way to functional parity. It is not feature complete.

## What works today

- Kotlin app with an embedded HTTP server (`NanoHTTPD`) bound to `127.0.0.1`.
- The Android app serves the same React build used by the desktop; no separate UI.
- SQLite database created from the **same migrations** as the desktop
  (`apps/api/src/db/migrations`), with `_migrations` tracking. The app bundles
  SQLite 3.49 (`sqlite-android`), so JSON1 and window functions work even on
  system images that lack them (BlueStacks and some Android 11 devices).
- System categories seeded on first boot, mirroring `@hub/shared`.
- Connectors **YouTube** (public Atom feed + channel page fallback) and
  **RSS/Atom/RDF**, with the same SSRF guard and HTTP policy as the desktop.
- **TMDB** (movies/series) and **AniList** (anime) connectors, including
  IMDB resolution, release events and feed items for releases/episodes.
- **Global calendar** (TMDB discover + AniList airing schedule), with the
  automatic `global-releases` source created on first boot.
- **Stremio addons**: install by manifest URL, catalog groups, catalog browsing
  and title metadata (the addon URL is encrypted and never exposed).
- **Stremio streams**: aggregation across enabled addons (direct, HLS, external
  and torrent entries) and local playback progress with "continue watching".
  Direct/HLS streams play in the existing web player (hls.js inside the WebView).
- **Stremio subtitles**: tracks from the enabled addons, downloaded through a
  same-origin proxy that detects UTF-8/Windows-1252, converts SRT/ASS to WebVTT
  and is attached to both the web and the native player.
- **Steam games**: add by appid, search the store, import the public wishlist
  (no API key), track prices/history, target price and "at lowest" flag.
- **gg.deals**: with an API key, official/keyshop prices and historical lows are
  merged into the games library by a scheduled ggdeals source (and on demand).
- **Backup**: export/preview/import in the desktop hub-backup v2 format
  (settings, categories, sources, addons, games, calendar, feed, playback,
  Stremio library, local library and novel cache), so data can move between the
  PC and the phone.
- **Embedded browser**: a native WebView screen with address bar, back/forward,
  reload and cookies. External links and the feed's "Browser" button open it
  (the desktop's CDP/Puppeteer live view is not portable).
- **Novels/articles extraction**: a hidden WebView (attached to the window)
  loads the page, runs the site's JavaScript and extracts the reader text for
  `/api/articles/content` and `/api/novels/chapter` — the Android replacement
  for the desktop's Puppeteer pipeline.
- **Webnovel sources**: add a novel by its index URL; the feed shows the latest
  chapter and the reader pulls the text through the same extractor.
- **Stremio account**: login with e-mail/password or an auth key (the session
  key is encrypted with the Android Keystore), hourly library sync through a
  `stremio-library` source, local favourites/watch‑later and shared
  continue‑watching progress.
- **Torrents**: libtorrent4j engine with sequential download, file selection and
  an HTTP Range endpoint, so MP4/WebM torrents play while they download.
  MKV/HEVC torrents are handed to a **native Media3/ExoPlayer** screen through
  the `HubNative` bridge, with progress shared with the web player.
- **Foreground service** (`mediaPlayback|dataSync`) keeps playback and torrents
  alive when the app is in the background, with an ongoing notification and a
  "Parar" action. Playback runs in a **MediaSessionService**, so the lockscreen,
  headphones and system controls work too.
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
    `GET /api/stremio/title/:type/:id`, `GET /api/stremio/streams`,
    `GET /api/stremio/subtitles`, `GET /api/stremio/server`,
    `GET /api/stremio/library`
  - `GET /api/playback/progress`, `GET /api/playback/continue`,
    `PUT|POST|DELETE /api/playback/progress`
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

- Notifications for price alerts (the `price_drop` cards already appear in the feed).
- Backup of credentials (apiKeys/stremioAccount) is intentionally omitted.
- Torrent audio transcoding (AC3/EAC3 fallback) and subtitle burn-in.
- Browser features that depend on CDP: Cloudflare handling and the live
  screenshot view used by some desktop novel/paywall flows.
- Novels: sites that require login/anti-bot and automatic cleanup of old downloads.

Screens whose endpoints are still missing show the app's normal error state.

## Requirements

Android 11 (API 30) or newer. On BlueStacks, use an **Android 11/13** instance
(`BlueStacks App Player 9` in the default setup); the Android 9 (Pie64) instance
cannot install the APK because of `minSdk`.

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
- `minSdk` is 30 (Android 11). The bundled SQLite already provides JSON1 and
  window functions; the floor comes from the rest of the platform APIs.
- MediaSession exposes only the current item (no queue/next/previous).
- Play Store/AAB packaging and signing are not configured.
