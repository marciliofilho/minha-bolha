# My Bubble

> [English](README.md) · [Português (Brasil)](README.pt-BR.md)

**My Bubble** (Portuguese name: **Minha Bolha**) is a local-first desktop hub for your feeds, releases, game prices and novels. It combines YouTube channels, RSS feeds, news, a movie/series/anime calendar, a Steam wishlist, Stremio and a full Webnovel reader in a single app — with an embedded Chromium browser and offline reading.

Everything runs on your machine. There is no account, no cloud sync and no telemetry.

---

## Highlights

- **Unified feed** with Netflix-style rows, list and grid views, favorites and watch later.
- **Embedded Chromium** (no external Chrome/Edge required) for browsing, previews and protected sites.
- **Movies, series and anime** via TMDB and AniList, with a release calendar.
- **Games** via Steam wishlist and gg.deals: one card per game, lowest current price and a detail modal.
- **Stremio** read-only library sync, addons and stream playback. **Cinemeta**, **Kitsu** and **OpenSubtitles v3** are installed by default and can be disabled or removed.
- **Novels / Webnovel**: cover previews, chapter reader, persistent cache, offline chapter downloads, background jobs, per-chapter progress and a batch offline manager.
- **Robust novel extraction** with automatic fallbacks, fastest first: direct page HTML → Feed browser session → external reader (Jina) → mobile site → headless scraping. The fastest method that already worked for a site is tried first on the next chapter.
- **Three UI languages**: Português (Brasil), English and Español. The app is called *Minha Bolha* in Portuguese and *My Bubble* in other languages.
- **Automatic updates** through GitHub Releases, with separate installed and portable builds.
- **Local SQLite database**, preserved across updates, with automatic daily snapshots (the last 7 are kept in `data\backups`).

---

## Download

Get the latest release from the [Releases page](https://github.com/marciliofilho/minha-bolha/releases).

| Build | File | Notes |
| --- | --- | --- |
| Installer | `Minha-Bolha-Setup-<version>.exe` | Per-user install; data in `%APPDATA%\Minha Bolha` |
| Portable | `Minha-Bolha-Portable-<version>.zip` | Extract anywhere; data in `data\` next to the executable |
| Linux (AppImage, preview) | `Minha-Bolha-<version>-x86_64.AppImage` | x64; data in `~/.config/Minha Bolha` |

The Linux AppImage is built by the `Build Linux AppImage` workflow on Ubuntu. It uses the same local database, addons and updater model; the Windows portable ZIP remains Windows-only.

Both builds are independent and keep their own data. Choose one and stick to it to keep your library and offline chapters.

The application is **not code-signed**. Windows SmartScreen may show a warning on first launch.

---

## Requirements

**To use the app:** Windows 10/11 x64, or Linux x64 via the AppImage preview. Chromium, FFmpeg and FFprobe are bundled — nothing else to install.

**To build from source:** Node.js 20+ and npm.

---

## Development

```bash
npm install
cp .env.example .env   # optional: API keys can also be set in Settings
npm run dev            # API (port 4000) + web dev server (port 5173)
npm run desktop        # build the web app and start the Electron shell
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | API and web UI with hot reload |
| `npm run desktop` | Build the UI and launch the desktop app |
| `npm run typecheck` | Type-check API and web |
| `npm test` | Run the API regression tests |
| `npm run check:secrets` | Scan the repository for leaked secrets |
| `npm run dist` | Build the Windows installer and portable ZIP into `release/` |
| `npm run dist:linux` | Build the Linux AppImage into `release/` (run on Linux/CI) |

During development the desktop shell talks to the local API on port `4000`. The Vite dev server proxies `/api` to it.

---

## Configuration

API keys can be configured in **Settings → API Keys**, or via a local `.env` file (used as a fallback). The `.env` file is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `PORT` | Local API port (default `4000`) |
| `HUB_DB_PATH` | SQLite database path (default `data/hub.db`) |
| `TZ` | Time zone used for dates |
| `HUB_SEED_DEMO` | Create demo sources/items on first boot |
| `TMDB_API_KEY` | Movies, series and calendar metadata |
| `STEAM_API_KEY` | Optional: resolve Steam vanity profile URLs |
| `GGDEALS_API_KEY` | Game prices and price history |
| `APP_SECRET` | Session token encryption (generated automatically in the packaged app) |

Get your keys from:

- TMDB: https://www.themoviedb.org/settings/api
- Steam: https://steamcommunity.com/dev/apikey
- gg.deals: https://gg.deals/api/

Keys are stored locally in SQLite. They are never returned by the API after saving and are not encrypted at rest — the app is intended for personal, local use.

### Selective backup

**Settings → System → Backup and portability** lets you choose exactly which sections go into the JSON backup: settings, custom categories, sources, addons, local library, playback progress, games and prices, calendar, novels/offline chapters, feed items and the synced Stremio library. API keys and the Stremio account token are optional, disabled by default and marked as sensitive. Import restores only the sections present in the file and shows a preview with the count of each section.

---

## Architecture

| Path | Description |
| --- | --- |
| `apps/web` | React + Vite user interface |
| `apps/api` | Local HTTP API, connectors, scheduler, SQLite, novel cache |
| `apps/desktop` | Electron shell: splash, language picker, embedded browser host, updater |
| `packages/shared` | Shared DTOs and types |

The desktop app starts its own API process. In the packaged app, the API, web assets, Chromium and FFmpeg are all bundled.

Data locations:

- **Installed:** `%APPDATA%\Minha Bolha` (`hub.db`, browser profile, logs, backups).
- **Portable:** `data\` next to `Minha Bolha.exe`.
- **Development:** `data\hub.db`.
- **Automatic backups:** `data\backups\hub-*.db` (one per day, last 7 kept). To restore, close the app and replace `hub.db` with one of these files.
- **Logs:** `api.log`, rotated to `api.log.old` when it reaches 5 MB.

---

## Privacy and network access

- The app is local-first and has **no telemetry**.
- It only contacts the sources you configure (YouTube, RSS sites, TMDB, AniList, Steam, gg.deals, Stremio, Webnovel, etc.).
- API keys stay on your machine and are masked in the UI.
- The embedded browser shares a dedicated profile with the app; cookies obtained by the Feed browser are reused by the internal extraction session.
- **External reader disclosure:** when local extraction of a novel chapter fails, the app may use [Jina Reader](https://r.jina.ai/) as a fallback. In that case only the chapter URL is sent to that service. If you do not want external requests, avoid the novel sources that require this fallback or block `r.jina.ai` on your network.

---

## Updates

The app checks GitHub Releases at startup and can download/install updates automatically.

- Installed builds update in place and keep `%APPDATA%\Minha Bolha`.
- Portable builds are replaced in their folder and keep `data\`.
- Releases require `latest.yml`, the installer, its `.blockmap` and the portable ZIP.

Update metadata is configured in `apps/desktop/update-config.cjs`:

```js
module.exports = {
  owner: 'marciliofilho',
  repo: 'minha-bolha'
};
```

---

## Build and release

```bash
npm run dist
```

This generates:

- `release/Minha-Bolha-Setup-<version>.exe`
- `release/Minha-Bolha-Setup-<version>.exe.blockmap`
- `release/Minha-Bolha-Portable-<version>.zip`
- `release/latest.yml`

Publish those files as a GitHub Release tagged `v<version>`. The updater compares the installed version with `latest.yml`.

### Linux

```bash
npm run dist:linux
```

This must run on Linux (or the `Build Linux AppImage` GitHub Actions workflow). It generates:

- `release/Minha-Bolha-<version>-x86_64.AppImage`
- `release/latest-linux.yml`

Publish both files in the same GitHub Release. The AppImage updates itself through `electron-updater` and keeps its data in `~/.config/Minha Bolha`. There is no Linux portable mode; the AppImage itself is the portable build.

The build intentionally excludes local data, `.env`, logs, source maps and the debug builder file. The portable staging folder is removed automatically after the ZIP is created.

---

## License

**GPL-3.0-only**. Copyright © 2026 Minha Bolha (My Bubble).

See [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Because this application is distributed under the GPL, the complete corresponding source code is available in this repository.

---

## Support

If you find the project useful, you can support its development on [Ko-fi](https://ko-fi.com/mybubble).

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
