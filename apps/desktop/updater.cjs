/**
 * Atualizações via GitHub Releases.
 *
 * - Instalado (NSIS): electron-updater baixa e instala o novo instalador.
 * - Portátil: baixa o ZIP portátil, substitui os arquivos da pasta e reinicia,
 *   preservando a pasta `data` do usuário.
 *
 * O popup e o botão de Config usam IPC (`update:check`, `update:download`) e
 * recebem progresso pelo evento `update:event`.
 */
const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const semver = require('semver');
const updateConfig = require('./update-config.cjs');

const CHECK_DELAY_MS = 7000;
const USER_AGENT = 'Minha-Bolha-Updater';
const GITHUB_API = 'https://api.github.com';

function createUpdater({ getWindow, isPortable }) {
  let started = false;
  let checkPromise = null;
  let downloadInFlight = false;
  let pendingInstalled = null;
  let pendingPortable = null;

  const configured = updateConfig.configured;
  const currentVersion = () => app.getVersion();
  const releasePage = (version) =>
    `https://github.com/${updateConfig.owner}/${updateConfig.repo}/releases/tag/v${version}`;

  function send(payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update:event', payload);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  async function checkInstalled() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || !semver.gt(version, currentVersion())) {
      return { status: 'none', version: currentVersion() };
    }

    pendingInstalled = { version };
    return {
      status: 'available',
      mode: 'installed',
      version,
      currentVersion: currentVersion(),
      releaseUrl: releasePage(version)
    };
  }

  async function checkPortable() {
    const response = await fetch(
      `${GITHUB_API}/repos/${updateConfig.owner}/${updateConfig.repo}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': USER_AGENT
        }
      }
    );

    if (response.status === 404) {
      return {
        status: 'error',
        message: 'Nenhuma release encontrada no repositório configurado.'
      };
    }
    if (response.status === 403) {
      throw new Error('O GitHub limitou as requisições. Tente novamente mais tarde.');
    }
    if (!response.ok) {
      throw new Error(`O GitHub respondeu HTTP ${response.status}.`);
    }

    const release = await response.json();
    const version = String(release.tag_name ?? '').replace(/^v/i, '');
    if (!semver.valid(version)) {
      throw new Error('A release mais recente não tem uma versão válida.');
    }
    if (!semver.gt(version, currentVersion())) {
      return { status: 'none', version: currentVersion() };
    }

    const asset = (release.assets ?? []).find((item) =>
      /^Minha-Bolha-Portable-.*\.zip$/i.test(item.name ?? '')
    );

    pendingPortable = {
      version,
      assetUrl: asset?.browser_download_url ?? null,
      digest: asset?.digest ?? null,
      releaseUrl: release.html_url ?? releasePage(version)
    };

    return {
      status: 'available',
      mode: 'portable',
      version,
      currentVersion: currentVersion(),
      releaseUrl: pendingPortable.releaseUrl,
      assetUrl: pendingPortable.assetUrl,
      size: asset?.size ?? null
    };
  }

  function check() {
    if (!app.isPackaged) return Promise.resolve({ status: 'dev' });
    if (!configured) return Promise.resolve({ status: 'not-configured' });
    if (checkPromise) return checkPromise;

    checkPromise = (async () => {
      try {
        return isPortable ? await checkPortable() : await checkInstalled();
      } catch (error) {
        return { status: 'error', message: errorMessage(error) };
      } finally {
        checkPromise = null;
      }
    })();

    return checkPromise;
  }

  function downloadFile(url, destination, onProgress, digest, redirects = 0) {
    return new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          headers: {
            Accept: 'application/octet-stream',
            'User-Agent': USER_AGENT
          }
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.resume();
            if (redirects > 5) {
              reject(new Error('Muitos redirecionamentos ao baixar a atualização.'));
              return;
            }
            const next = new URL(response.headers.location, url).toString();
            resolve(downloadFile(next, destination, onProgress, digest, redirects + 1));
            return;
          }
          if (status !== 200) {
            response.resume();
            reject(new Error(`Falha ao baixar a atualização (HTTP ${status}).`));
            return;
          }

          const total = Number(response.headers['content-length'] ?? 0);
          const hash = crypto.createHash('sha256');
          const output = fs.createWriteStream(destination);
          let received = 0;
          let lastSent = 0;

          response.on('data', (chunk) => {
            received += chunk.length;
            hash.update(chunk);
            const now = Date.now();
            if (now - lastSent > 250) {
              lastSent = now;
              onProgress({
                percent: total > 0 ? Math.min(100, (received / total) * 100) : 0,
                transferred: received,
                total
              });
            }
          });
          response.on('error', (error) => {
            output.destroy();
            reject(error);
          });
          output.on('error', (error) => reject(error));
          output.on('finish', () => {
            output.close(() => {
              const actual = hash.digest('hex');
              if (digest?.startsWith('sha256:') && actual !== digest.slice(7)) {
                fs.rmSync(destination, { force: true });
                reject(new Error('O checksum da atualização não confere.'));
                return;
              }
              onProgress({ percent: 100, transferred: received, total: total || received });
              resolve();
            });
          });
          response.pipe(output);
        }
      );
      request.on('error', reject);
      request.setTimeout(60_000, () => {
        request.destroy(new Error('Tempo esgotado ao baixar a atualização.'));
      });
    });
  }

  function powershellQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  function portableTaskName(version) {
    const safe = String(version).replace(/[^0-9A-Za-z._-]/g, '');
    return `MinhaBolhaUpdate-${safe}-${Date.now()}`;
  }

  /**
   * Script que espera o app fechar, extrai o ZIP portátil por cima da pasta
   * atual e abre o novo executável. `data/` não vem no ZIP, então é preservada.
   *
   * É iniciado por uma tarefa agendada porque o Electron encerra processos
   * filhos (job object) ao sair — um PowerShell com `spawn` era morto antes
   * de concluir a atualização.
   */
  function writePortableUpdater(zipPath, version, taskName) {
    const exeDir = path.dirname(process.execPath);
    const exePath = process.execPath;
    const scriptPath = path.join(os.tmpdir(), `minha-bolha-update-${version}.ps1`);
    const script = `
$ErrorActionPreference = 'Stop'
$parentPid = ${process.pid}
$zip = ${powershellQuote(zipPath)}
$destination = ${powershellQuote(exeDir)}
$exePath = ${powershellQuote(exePath)}
$taskName = ${powershellQuote(taskName)}
$log = Join-Path $env:TEMP ${powershellQuote(`minha-bolha-update-${version}.log`)}

function Write-Log([string]$message) {
  try { Add-Content -Path $log -Value ((Get-Date -Format o) + ' ' + $message) } catch { }
}

Write-Log "updater started (parent=$parentPid, version=${version})"

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Process -Id $parentPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
  Start-Sleep -Milliseconds 500
}

# Espera API/navegador auxiliar liberarem os arquivos da pasta.
$waitUntil = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $waitUntil) {
  $busy = 0
  foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
    try {
      if ($proc.Path -and $proc.Path.StartsWith($destination, [System.StringComparison]::OrdinalIgnoreCase)) {
        $busy++
      }
    } catch { }
  }
  if ($busy -eq 0) { break }
  Start-Sleep -Milliseconds 500
}

$temp = Join-Path $env:TEMP ('minha-bolha-update-' + [guid]::NewGuid().ToString('N'))
$copied = $false
try {
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  Expand-Archive -Path $zip -DestinationPath $temp -Force

  $source = Join-Path $temp 'Minha Bolha'
  if (-not (Test-Path $source)) {
    $source = Get-ChildItem -Path $temp -Directory | Select-Object -First 1 -ExpandProperty FullName
  }

  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force -ErrorAction Stop
      $copied = $true
      Write-Log "files copied (attempt $attempt)"
      break
    } catch {
      Write-Log "copy failed (attempt $attempt): $($_.Exception.Message)"
      Start-Sleep -Seconds 2
    }
  }

  if ($copied) {
    $installed = (Get-Item -LiteralPath $exePath).VersionInfo.ProductVersion
    Write-Log "installed version: $installed (expected ${version})"
  } else {
    Write-Log 'ERROR: could not replace the app files; zip kept for manual update'
  }
} catch {
  Write-Log ('ERROR: ' + $_.Exception.Message)
} finally {
  Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
}

try {
  Start-Process -FilePath $exePath -WorkingDirectory $destination
  Write-Log 'app started'
} catch {
  Write-Log ('ERROR starting app: ' + $_.Exception.Message)
}

if ($copied) {
  Remove-Item -Path $zip -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue
}

schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
`;

    fs.writeFileSync(scriptPath, script, 'utf8');
    return scriptPath;
  }

  /** Agenda o script para rodar fora do job object do Electron. */
  function schedulePortableUpdater(scriptPath, taskName) {
    const command =
      `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden ` +
      `-ExecutionPolicy Bypass -File "${scriptPath}"`;
    const create = spawnSync(
      'schtasks',
      ['/Create', '/TN', taskName, '/SC', 'ONCE', '/ST', '23:59', '/F', '/IT', '/TR', command],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 }
    );
    if (create.status !== 0) {
      throw new Error(
        (create.stderr || create.stdout || 'Falha ao agendar a atualização.').trim()
      );
    }

    const run = spawnSync('schtasks', ['/Run', '/TN', taskName], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000
    });
    if (run.status !== 0) {
      spawnSync('schtasks', ['/Delete', '/TN', taskName, '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      throw new Error((run.stderr || run.stdout || 'Falha ao iniciar a atualização.').trim());
    }
  }

  async function downloadPortable() {
    if (!pendingPortable) {
      const result = await check();
      if (result.status !== 'available' || result.mode !== 'portable') return result;
    }
    if (!pendingPortable?.assetUrl) {
      return {
        status: 'manual',
        releaseUrl: pendingPortable?.releaseUrl ?? null,
        version: pendingPortable?.version ?? null
      };
    }
    if (downloadInFlight) return { status: 'downloading' };

    downloadInFlight = true;
    try {
      const destination = path.join(
        os.tmpdir(),
        `minha-bolha-portable-${pendingPortable.version}.zip`
      );
      await downloadFile(
        pendingPortable.assetUrl,
        destination,
        (progress) => send({ type: 'progress', ...progress }),
        pendingPortable.digest
      );

      send({ type: 'installing', version: pendingPortable.version });
      const taskName = portableTaskName(pendingPortable.version);
      const scriptPath = writePortableUpdater(
        destination,
        pendingPortable.version,
        taskName
      );
      schedulePortableUpdater(scriptPath, taskName);
      setTimeout(() => app.quit(), 800);
      return { status: 'installing', version: pendingPortable.version };
    } catch (error) {
      send({ type: 'error', message: errorMessage(error) });
      return { status: 'error', message: errorMessage(error) };
    } finally {
      downloadInFlight = false;
    }
  }

  async function downloadInstalled() {
    if (!pendingInstalled) {
      const result = await check();
      if (result.status !== 'available' || result.mode !== 'installed') return result;
    }
    if (downloadInFlight) return { status: 'downloading' };

    downloadInFlight = true;
    try {
      await autoUpdater.downloadUpdate();
      return { status: 'downloaded', version: pendingInstalled?.version ?? null };
    } catch (error) {
      send({ type: 'error', message: errorMessage(error) });
      return { status: 'error', message: errorMessage(error) };
    } finally {
      downloadInFlight = false;
    }
  }

  function setup() {
    if (started) return;
    started = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('download-progress', (progress) => {
      send({
        type: 'progress',
        percent: Math.max(0, Math.min(100, progress.percent ?? 0)),
        transferred: progress.transferred ?? 0,
        total: progress.total ?? 0
      });
    });

    autoUpdater.on('update-downloaded', () => {
      send({ type: 'downloaded', version: pendingInstalled?.version ?? null });
      send({ type: 'installing', version: pendingInstalled?.version ?? null });
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(true, true);
        } catch (error) {
          send({ type: 'error', message: errorMessage(error) });
        }
      }, 1200);
    });

    autoUpdater.on('error', (error) => {
      if (downloadInFlight) send({ type: 'error', message: errorMessage(error) });
    });

    ipcMain.handle('update:check', () => check());
    ipcMain.handle('update:download', () =>
      isPortable ? downloadPortable() : downloadInstalled()
    );

    // Verificação automática ao abrir, mas só depois que a interface carregar.
    if (app.isPackaged && configured) {
      const win = getWindow();
      const schedule = () => {
        setTimeout(async () => {
          const result = await check();
          if (result.status === 'available') {
            send({ type: 'available', ...result });
          }
        }, CHECK_DELAY_MS);
      };
      if (win && win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', schedule);
      } else if (win) {
        schedule();
      }
    }
  }

  return { setup, check };
}

module.exports = { createUpdater };
