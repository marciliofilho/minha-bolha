/**
 * Shell desktop do Hub.
 *
 * A janela principal carrega o frontend servido pela API local e habilita o
 * <webview>, que é o navegador real embutido no card do Feed. O webview usa
 * uma sessão/partição própria, então não interfere no navegador do usuário.
 */
const { app, BrowserWindow, Menu, shell, webContents } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { createSplash } = require('./splash/splash-window.cjs');
const { createLanguageWindow } = require('./language/language-window.cjs');
const { createUpdater } = require('./updater.cjs');

const repoRoot = path.resolve(__dirname, '../..');

// O mesmo executável também roda como navegador auxiliar (Chromium embutido).
// Nesse modo não há splash, API nem janela principal visível.
const hostArg = process.argv.find((argument) => argument.startsWith('--browser-host='));
const isBrowserHost = process.env.HUB_BROWSER_HOST === '1' || Boolean(hostArg);
const hostPort = hostArg ? Number(hostArg.split('=')[1]) : 0;

// Mantém janelas fora da tela ativas: desafios do site (Cloudflare) dependem
// de timers/renderização e não podem ser "congelados" por oclusão.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

if (isBrowserHost) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  if (hostPort > 0) {
    app.commandLine.appendSwitch('remote-debugging-port', String(hostPort));
  }
  app.commandLine.appendSwitch('remote-allow-origins', '*');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

const DEFAULT_API_PORT = 4000;
// Cada instância escolhe uma porta livre no modo empacotado, permitindo que
// instalado e portátil rodem ao mesmo tempo sem compartilhar a mesma API.
let apiPort = DEFAULT_API_PORT;
const appUrl = () => process.env.HUB_DESKTOP_URL || `http://127.0.0.1:${apiPort}/`;
const healthUrl = () => `http://127.0.0.1:${apiPort}/api/health`;

const isPackaged = app.isPackaged;
const exeDir = path.dirname(process.execPath);
// O ZIP portátil inclui "portable.txt" ao lado do .exe; o instalador não.
const isPortable = isPackaged && fs.existsSync(path.join(exeDir, 'portable.txt'));
// Instalado: %APPDATA%\Minha Bolha. Portátil: data\ ao lado do executável.
const dataDir = isPackaged
  ? isPortable
    ? path.join(exeDir, 'data')
    : path.join(app.getPath('appData'), 'Minha Bolha')
  : path.join(repoRoot, 'data');
const hubDbPath = isPackaged
  ? path.join(dataDir, 'hub.db')
  : process.env.HUB_DB_PATH?.trim()
    ? path.resolve(repoRoot, process.env.HUB_DB_PATH.trim())
    : path.join(dataDir, 'hub.db');

// O host usa o perfil real do navegador (cookies/login). O app usa data/desktop.
const userData = isBrowserHost
  ? process.env.HUB_BROWSER_PROFILE?.trim() || path.join(dataDir, 'browser-profile')
  : path.join(dataDir, 'desktop');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', userData);
app.setName(isBrowserHost ? 'Hub browser host' : 'Minha Bolha');
if (process.platform === 'win32') {
  app.setAppUserModelId(
    isBrowserHost ? 'com.updatehub.desktop.browser' : 'com.updatehub.desktop'
  );
}

let mainWindow = null;
let splashHandle = null;
let apiProcess = null;
let apiLogStream = null;
let updater = null;
let startingUp = true;
let quitting = false;
/** Mantém as janelas do navegador auxiliar vivas (sem referência o Electron as fecha). */
let hostWindows = [];
let hostScrapeWindow = null;

/** Lê as preferências da intro direto do SQLite antes de a API subir. */
function readSplashPreferences() {
  const preferences = { introEnabled: true, introAudio: true, language: null };
  try {
    if (!fs.existsSync(hubDbPath)) return preferences;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(hubDbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT key, value FROM settings WHERE key IN ('introEnabled', 'introAudio', 'language')"
        )
        .all();
      for (const row of rows) {
        try {
          const value = JSON.parse(row.value);
          if (row.key === 'language' && typeof value === 'string') {
            preferences.language = value;
            continue;
          }
          if (typeof value !== 'boolean') continue;
          if (row.key === 'introEnabled') preferences.introEnabled = value;
          if (row.key === 'introAudio') preferences.introAudio = value;
        } catch {
          // valor inválido: mantém o padrão
        }
      }
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('[splash] não foi possível ler as preferências:', error);
  }
  return preferences;
}

/** Idioma efetivo: o do app ou, se ainda não houver, o do sistema. */
function effectiveLanguage(language) {
  const appLanguage = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (appLanguage) return appLanguage.startsWith('pt') ? 'pt-BR' : 'global';
  const system = String(app.getLocale() || '').trim().toLowerCase().replace('_', '-');
  return system === 'pt-br' || system === 'pt' ? 'pt-BR' : 'global';
}

/** Escolhe a intro pelo idioma do app; se não houver, usa o idioma do sistema. */
function splashVideoFor(language) {
  return effectiveLanguage(language) === 'pt-BR' ? 'pt-BR/intro.webm' : 'global/intro.webm';
}

/** Nome do app conforme o idioma. */
function appNameFor(language) {
  return effectiveLanguage(language) === 'pt-BR' ? 'Minha Bolha' : 'My Bubble';
}

/** Ícone da janela/taskbar conforme o idioma. */
function appIconFor(language) {
  const file = effectiveLanguage(language) === 'pt-BR' ? 'icon-pt-BR.png' : 'icon-global.png';
  return path.join(__dirname, 'assets', file);
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get(healthUrl(), (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(900, () => {
      request.destroy();
      resolve(false);
    });
  });
}

/** Porta livre em 127.0.0.1 para a API da instância atual. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('Sem porta livre.'))));
    });
  });
}

async function waitForApi(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealth()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Idioma do sistema reduzido aos três suportados. */
function systemLanguage() {
  const locale = String(app.getLocale() || '').trim().toLowerCase();
  if (locale.startsWith('pt')) return 'pt';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

/** Abre o seletor de idioma do primeiro boot, antes da intro. */
async function pickLanguage() {
  try {
    const picker = createLanguageWindow();
    try {
      return await picker.done;
    } finally {
      picker.close();
    }
  } catch (error) {
    console.error('[language] não foi possível abrir o seletor:', error);
    return { type: 'error' };
  }
}

/** Grava o idioma escolhido na API (banco) antes de carregar a interface. */
async function setApiLanguage(language) {
  if (process.env.HUB_DESKTOP_URL) return true;
  const body = JSON.stringify({ language });
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (response.ok) return true;
    } catch {
      // A API pode estar terminando de subir.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error('[language] não foi possível salvar o idioma inicial na API.');
  return false;
}

// Mantém no máximo um log antigo de 5 MB. O api.log atual é reiniciado a cada
// execução; a cópia anterior fica em api.log.old para diagnóstico.
const API_LOG_MAX_BYTES = 5 * 1024 * 1024;

function rotateApiLog(logPath) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < API_LOG_MAX_BYTES) return;
    fs.rmSync(`${logPath}.old`, { force: true });
    fs.renameSync(logPath, `${logPath}.old`);
  } catch {
    // ainda não existe log
  }
}

async function startApi(initialLanguage = null) {
  if (process.env.HUB_DESKTOP_URL) return true;
  if (!isPackaged && (await checkHealth())) return true;

  if (isPackaged) {
    apiPort = await freePort();
  } else {
    apiPort = DEFAULT_API_PORT;
  }

  if (isPackaged) {
    const resources = process.resourcesPath;
    const apiEntry = path.join(resources, 'api', 'index.mjs');
    const bin = (name) =>
      path.join(resources, 'bin', process.platform === 'win32' ? `${name}.exe` : name);

    apiProcess = spawn(process.execPath, [apiEntry], {
      cwd: path.dirname(apiEntry),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(apiPort),
        HUB_INITIAL_LANGUAGE: initialLanguage ?? '',
        HUB_PACKAGED: '1',
        HUB_ELECTRON_PATH: process.execPath,
        HUB_BROWSER_UA: desktopUserAgent(),
        HUB_EXTRACT_PORT: extractPort ? String(extractPort) : '',
        HUB_APP_DIR: exeDir,
        HUB_DATA_DIR: dataDir,
        HUB_DB_PATH: path.join(dataDir, 'hub.db'),
        HUB_WEB_DIST: path.join(resources, 'web'),
        HUB_MIGRATIONS: path.join(resources, 'api', 'migrations'),
        HUB_BROWSER_PROFILE: path.join(dataDir, 'browser-profile'),
        NODE_PATH: path.join(resources, 'api', 'vendor'),
        HUB_NODE_DATACHANNEL: path.join(
          resources,
          'api',
          'vendor',
          'node-datachannel',
          'dist',
          'cjs',
          'lib',
          'index.cjs'
        ),
        FFMPEG_PATH: bin('ffmpeg'),
        FFPROBE_PATH: bin('ffprobe'),
        HUB_SEED_DEMO: process.env.HUB_SEED_DEMO ?? 'false'
      }
    });
  } else {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm run start -w @hub/api']
        : ['run', 'start', '-w', '@hub/api'];

    apiProcess = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(apiPort),
        HUB_INITIAL_LANGUAGE: initialLanguage ?? '',
        // Usados pelo navegador auxiliar (Chromium do próprio Electron).
        HUB_ELECTRON_PATH: process.execPath,
        HUB_BROWSER_UA: desktopUserAgent(),
        HUB_EXTRACT_PORT: extractPort ? String(extractPort) : '',
        HUB_APP_ROOT: repoRoot
      }
    });
  }

  const apiLogPath = path.join(dataDir, 'api.log');
  rotateApiLog(apiLogPath);
  apiLogStream = fs.createWriteStream(apiLogPath, { flags: 'w' });
  apiProcess.stdout?.pipe(apiLogStream);
  apiProcess.stderr?.pipe(apiLogStream);

  apiProcess.once('exit', () => {
    apiLogStream?.end();
    apiLogStream = null;
    apiProcess = null;
  });

  return waitForApi(60_000);
}

function stopApi() {
  const child = apiProcess;
  apiProcess = null;
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      // já encerrado
    }
  }
}

function createWindow(title = 'Minha Bolha', icon = null) {  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 960,
    minHeight: 600,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#07090e',
    title,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  // A janela só aparece depois que o splash terminar e a URL carregar.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // O webview é conteúdo não confiável: sem preload/Node no guest.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });

  // No Windows, a primeira pintura pode ficar presa até um evento de layout.
  // Um resize forçado faz o Feed aparecer imediatamente ao abrir o app.
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(nudgeWindowLayout, 250);
  });
  mainWindow.once('show', () => {
    setTimeout(nudgeWindowLayout, 150);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function nudgeWindowLayout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void mainWindow.webContents
    .executeJavaScript('window.dispatchEvent(new Event("resize"))', true)
    .catch(() => undefined);
}

/** User-agent idêntico ao do navegador do Feed (sem marcas do Electron). */
function desktopUserAgent() {
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) Chrome/${process.versions.chrome || '140.0.0.0'} Safari/537.36`
  );
}

// ---------------------------------------------------------------------------
// Extração usando a sessão do navegador do Feed
// ---------------------------------------------------------------------------

let extractPort = 0;
let extractWindow = null;
let extractQueue = Promise.resolve();

function ensureExtractWindow() {
  if (extractWindow && !extractWindow.isDestroyed()) return extractWindow;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    x: -32000,
    y: -32000,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#07090e',
    webPreferences: {
      partition: 'persist:hub-browser',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.webContents.setUserAgent(desktopUserAgent());
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Fora da tela: não bloqueia cliques nem aparece para o usuário.
  win.setPosition(-32000, -32000);
  win.setSkipTaskbar(true);
  win.showInactive();
  win.on('closed', () => {
    if (extractWindow === win) extractWindow = null;
  });
  extractWindow = win;
  return win;
}

function enqueueExtract(task) {
  const next = extractQueue.then(task, task);
  extractQueue = next.catch(() => undefined);
  return next;
}

function parkExtractWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(true);
    win.setPosition(-32000, -32000);
    win.showInactive();
  } catch {
    // janela indisponível
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EXTRACT_CHALLENGE_RE =
  /executando verifica|verificação de segurança|cf-browser-verification|just a moment\.\.\.|attention required!?\s*\|\s*cloudflare|checking your browser before accessing|enable javascript and cookies|ray id:/i;

function sameExtractUrl(a, b) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.host === right.host && left.pathname === right.pathname;
  } catch {
    return false;
  }
}

function findFeedWebview(url) {
  try {
    return (
      webContents
        .getAllWebContents()
        .find(
          (contents) =>
            contents.getType() === 'webview' &&
            !contents.isDestroyed() &&
            sameExtractUrl(contents.getURL(), url)
        ) ?? null
    );
  } catch {
    return null;
  }
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function findLongText(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') return value.length > 400 ? value : '';
  if (Array.isArray(value)) {
    let best = '';
    for (const item of value) {
      const found = findLongText(item, depth + 1);
      if (found.length > best.length) best = found;
    }
    return best;
  }
  if (typeof value === 'object') {
    let best = '';
    for (const [key, item] of Object.entries(value)) {
      if (!/content|text|body|chapter/i.test(key)) continue;
      const found = findLongText(item, depth + 1);
      if (found.length > best.length) best = found;
    }
    return best;
  }
  return '';
}

/** Fallback por HTML: pega a página com os cookies da sessão e extrai o texto. */
async function extractChapterFromHtml(contents, url) {
  const html = await contents.executeJavaScript(
    `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then((response) => response.text())`,
    true
  );
  if (typeof html !== 'string' || html.length < 500) return null;
  if (EXTRACT_CHALLENGE_RE.test(html.slice(0, 5000))) return null;

  const title = decodeEntities(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
  );
  const match =
    /<(div|article)[^>]*class="[^"]*(?:cha-words|cha-content|chapter-content|chapterContent|entry-content|post-content|read-content|reading-content)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i.exec(
      html
    ) ?? /<div[^>]*id="chapterContent"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const inner = match ? match[2] ?? match[1] ?? '' : '';
  let content = inner;
  if (!content) {
    const nextData =
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html) ??
      /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (nextData?.[1]) {
      try {
        content = findLongText(JSON.parse(nextData[1]));
      } catch {
        content = '';
      }
    }
  }
  if (!content) return null;
  const text = decodeEntities(
    content
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h\d|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < 80) return null;
  return { title, text };
}

async function runExtraction(
  contents,
  url,
  readyExpression,
  expression,
  timeout,
  onStuck,
  allowHtmlFallback = false
) {
  const targetPath = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  })();
  const pathGuard = targetPath
    ? `if (location.pathname !== ${JSON.stringify(targetPath)}) return false;`
    : '';
  const readyScript = readyExpression
    ? `(() => { try { ${pathGuard} return Boolean(${readyExpression}); } catch { return false; } })()`
    : pathGuard
      ? `(() => { try { ${pathGuard} return true; } catch { return false; } })()`
      : 'true';
  const challengeScript =
    `/executando verifica|verificação de segurança|cf-browser-verification|just a moment\\.\\.\\.|attention required!?\\s*\\|\\s*cloudflare|checking your browser before accessing|enable javascript and cookies|ray id:/i.test((document.title || '') + ' ' + (document.body ? document.body.innerText : '').slice(0, 1500))`;
  const deadline = Date.now() + timeout;
  const startedAt = Date.now();
  let ready = false;
  let revealed = false;
  let htmlTried = false;

  while (Date.now() < deadline) {
    try {
      ready = (await contents.executeJavaScript(readyScript, true)) === true;
    } catch {
      ready = false;
    }
    if (ready) break;
    // Não espera o timeout inteiro: tenta o HTML cedo (com os cookies da sessão).
    if (allowHtmlFallback && !htmlTried && Date.now() - startedAt > 6_000) {
      htmlTried = true;
      const early = await extractChapterFromHtml(contents, url).catch(() => null);
      if (early) {
        return {
          data: { title: early.title, text: early.text },
          title: early.title,
          finalUrl: url,
          source: 'html'
        };
      }
    }
    // Depois de alguns segundos bloqueado, mostra a janela para o desafio
    // poder ser resolvido (janela fora da tela não passa pelo desafio).
    if (!revealed && onStuck && Date.now() - startedAt > 3_500) {
      try {
        const challenged = await contents.executeJavaScript(challengeScript, true);
        if (challenged || Date.now() - startedAt > 8_000) {
          revealed = true;
          onStuck();
        }
      } catch {
        if (Date.now() - startedAt > 8_000) {
          revealed = true;
          onStuck();
        }
      }
    }
    await wait(450);
  }
  if (!ready) {
    if (allowHtmlFallback) {
      const fallback = await extractChapterFromHtml(contents, url).catch(() => null);
      if (fallback) {
        return {
          data: { title: fallback.title, text: fallback.text },
          title: fallback.title,
          finalUrl: url,
          source: 'html'
        };
      }
    }
    let detail = '';
    try {
      const info = await contents.executeJavaScript(
        `JSON.stringify({ title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 160) })`,
        true
      );
      detail = info ? ` (${info})` : '';
    } catch {
      // sem detalhes
    }
    throw new Error(
      `A página não liberou o conteúdo dentro do tempo esperado.${detail}`
    );
  }

  await wait(250);

  // A página de desafio pode "parecer pronta"; espera ela se resolver antes de
  // devolver o conteúdo.
  while (Date.now() < deadline) {
    const raw = await contents.executeJavaScript(
      `JSON.stringify(${expression})`,
      true
    );
    const meta = await contents.executeJavaScript(
      `JSON.stringify({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 600) : '' })`,
      true
    );
    const metaValue = meta ? JSON.parse(meta) : {};
    const title = String(metaValue.title ?? '');
    const bodyText = String(metaValue.text ?? '');
    if (!EXTRACT_CHALLENGE_RE.test(`${title} ${bodyText}`)) {
      return {
        data: raw ? JSON.parse(raw) : null,
        title,
        finalUrl: metaValue.url ?? url
      };
    }
    await wait(800);
  }

  throw new Error('O site pediu verificação de segurança.');
}

function findAnyFeedWebview() {
  try {
    return (
      webContents
        .getAllWebContents()
        .find(
          (contents) =>
            contents.getType() === 'webview' &&
            !contents.isDestroyed() &&
            /^https?:/i.test(contents.getURL())
        ) ?? null
    );
  } catch {
    return null;
  }
}

async function extractWithFeedSession(payload) {
  const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida.');
  const timeout = Math.max(
    5_000,
    Math.min(Number(payload?.timeoutMs) || 30_000, 90_000)
  );
  const readyExpression =
    typeof payload?.readyExpression === 'string' && payload.readyExpression.trim()
      ? payload.readyExpression
      : null;
  const expression =
    typeof payload?.expression === 'string' && payload.expression.trim()
      ? payload.expression
      : null;
  if (!expression) throw new Error('Expressão de extração ausente.');
  const htmlFallback = payload?.fallback === true;

  return enqueueExtract(async () => {
    // Melhor contexto: a própria webview do Feed, que já abre a página.
    const feedView = findFeedWebview(url);
    if (feedView) {
      const result = await runExtraction(
        feedView,
        url,
        readyExpression,
        expression,
        timeout,
        null,
        htmlFallback
      );
      return { ...result, source: 'feed-view' };
    }

    // Webview do navegador do Feed (mesmo que esteja em outra página): é o
    // contexto que sabidamente funciona. Navegamos e restauramos depois.
    const anyView = findAnyFeedWebview();
    if (anyView) {
      const previous = anyView.getURL();
      try {
        await anyView.loadURL(url);
        const result = await runExtraction(
          anyView,
          url,
          readyExpression,
          expression,
          Math.min(timeout, 25_000),
          null,
          htmlFallback
        );
        return { ...result, source: 'feed-any' };
      } catch {
        // segue para a janela de extração
      } finally {
        if (previous && previous !== 'about:blank') {
          anyView.loadURL(previous).catch(() => undefined);
        }
      }
    }

    // Repetição do mesmo capítulo não recarrega a página: usa a que já está
    // carregada na janela de extração.
    const reuseExtract =
      extractWindow &&
      !extractWindow.isDestroyed() &&
      sameExtractUrl(extractWindow.webContents.getURL(), url);
    const win = reuseExtract ? extractWindow : ensureExtractWindow();
    const contents = win.webContents;

    if (!reuseExtract) {
      let loadTimer = null;
      await Promise.race([
        contents.loadURL(url).catch(() => undefined),
        new Promise((resolve) => {
          loadTimer = setTimeout(resolve, timeout);
        })
      ]);
      if (loadTimer) clearTimeout(loadTimer);
    }

    let result;
    try {
      result = await runExtraction(
        contents,
        url,
        readyExpression,
        expression,
        timeout,
        null,
        htmlFallback
      );
      if (win === extractWindow) parkExtractWindow(win);
      return { ...result, source: 'window' };
    } catch (error) {
      if (win === extractWindow) parkExtractWindow(win);
      // Último recurso: usa a webview do navegador do Feed (mesmo que esteja em
      // outra página), restaurando a página original depois.
      const fallbackView = findAnyFeedWebview();
      if (!fallbackView) throw error;
      const previous = fallbackView.getURL();
      try {
        await fallbackView.loadURL(url);
        const fallback = await runExtraction(
          fallbackView,
          url,
          readyExpression,
          expression,
          Math.min(timeout, 12_000),
          null,
          htmlFallback
        );
        return { ...fallback, source: 'feed-fallback' };
      } finally {
        if (previous && previous !== 'about:blank') {
          fallbackView.loadURL(previous).catch(() => undefined);
        }
      }
    }
  });
}

function startExtractServer() {
  return freePort().then(
    (port) =>
      new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          if (req.method !== 'POST' || req.url !== '/extract') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Rota não encontrada.' }));
            return;
          }
          let body = '';
          let tooLarge = false;
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 512 * 1024) {
              tooLarge = true;
              req.destroy();
            }
          });
          req.on('end', () => {
            if (tooLarge) return;
            let payload = null;
            try {
              payload = JSON.parse(body || '{}');
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'JSON inválido.' }));
              return;
            }
            extractWithFeedSession(payload)
              .then((result) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
              })
              .catch((error) => {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: error instanceof Error ? error.message : String(error)
                  })
                );
              });
          });
        });
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
          extractPort = port;
          try {
            fs.writeFileSync(
              path.join(dataDir, 'desktop-extract.json'),
              JSON.stringify({ port, updatedAt: new Date().toISOString() })
            );
          } catch {
            // a API ainda pode usar a variável de ambiente
          }
          server.unref?.();
          resolve();
        });
      })
  );
}

async function bootstrap() {
  Menu.setApplicationMenu(null);
  await startExtractServer().catch((error) => {
    console.error('[desktop] extração pelo navegador do Feed indisponível:', error);
  });

  // Popups de sites no webview continuam na mesma aba do card.
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      void contents.loadURL(url).catch(() => undefined);
      return { action: 'deny' };
    });
  });

  let splash = null;
  const splashPreferences = readSplashPreferences();
  let language = splashPreferences.language;
  let initialLanguage = null;

  // Primeiro boot: pergunta o idioma antes da intro e da API.
  if (!language) {
    const picked = await pickLanguage();
    if (picked?.type === 'closed') {
      app.quit();
      return;
    }
    language = picked?.type === 'language' ? picked.language : systemLanguage();
    initialLanguage = language;
  }

  const brandName = appNameFor(language);
  const brandIcon = appIconFor(language);
  const isPortuguese = effectiveLanguage(language) === 'pt-BR';
  app.setName(brandName);

  const splashEnabled =
    process.env.HUB_SPLASH === '0'
      ? false
      : process.env.HUB_SPLASH === '1'
        ? true
        : splashPreferences.introEnabled;
  const splashMuted =
    process.env.HUB_SPLASH_MUTED === '1' ? true : !splashPreferences.introAudio;

  if (splashEnabled) {
    const video = splashVideoFor(language);
    const videoFile = path.join(__dirname, 'splash', 'assets', video);
    if (!fs.existsSync(videoFile)) {
      console.warn(`[splash] vídeo ausente: ${videoFile}; abrindo sem intro.`);
    } else {
      try {
        splash = createSplash({ muted: splashMuted, video, title: brandName });
        splashHandle = splash;
      } catch (error) {
        console.error('[splash] não foi possível abrir a intro:', error);
      }
    }
  }

  // A janela principal começa a carregar escondida enquanto a intro toca.
  const window = createWindow(brandName, brandIcon);
  startingUp = false;

  updater = createUpdater({ getWindow: () => mainWindow, isPortable });
  updater.setup();
  let ok = false;
  try {
    ok = await startApi(initialLanguage);
  } catch (error) {
    console.error('[desktop] falha ao iniciar a API:', error);
  }

  if (initialLanguage && ok) {
    await setApiLanguage(initialLanguage);
  }

  const errorPage =
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      '<body style="margin:0;background:#07090e;color:#e5e7eb;font-family:system-ui;display:grid;place-items:center;height:100vh;text-align:center">' +
        `<div><h1 style="font-size:18px">${
          isPortuguese ? 'Não foi possível iniciar a API local' : 'Could not start the local API'
        }</h1>` +
        `<p style="font-size:13px;opacity:.7">${
          isPortuguese ? 'Rode' : 'Run'
        } <code>npm run start -w @hub/api</code> ${
          isPortuguese ? 'e abra o app novamente.' : 'and open the app again.'
        }</p></div></body>`
    );

  const loadPromise = (ok ? window.loadURL(appUrl()) : window.loadURL(errorPage)).catch(
    async (error) => {
      console.error('[desktop] falha ao carregar a interface:', error);
      try {
        await window.loadURL(errorPage);
      } catch {
        // Sem interface: a janela ainda será exibida abaixo.
      }
    }
  );

  // Mesmo que a página demore (ou trave), a janela aparece depois deste limite.
  const showTimeoutMs = Number(process.env.HUB_STARTUP_TIMEOUT_MS) || 15_000;
  const showDeadline = new Promise((resolve) => setTimeout(resolve, showTimeoutMs));

  try {
    await Promise.allSettled([
      splash ? splash.done : Promise.resolve(),
      // Não bloqueia a abertura indefinidamente se o carregamento travar.
      Promise.race([loadPromise, showDeadline])
    ]);
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
      mainWindow.focus();
    }

    if (splash) {
      try {
        await splash.close();
      } catch (error) {
        console.error('[splash] falha ao fechar:', error);
        splash.destroy?.();
      }
      splashHandle = null;
    }
  }
}

async function startBrowserHost() {
  Menu.setApplicationMenu(null);

  const windowOptions = () => ({
    width: 1280,
    height: 720,
    x: -32000,
    y: -32000,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    backgroundColor: '#000000',
    webPreferences: {
      partition: 'persist:hub-live',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  // Qualquer janela criada depois (inclusive por CDP) fica fora da barra.
  app.on('browser-window-created', (_event, win) => {
    try {
      win.setSkipTaskbar(true);
      win.setPosition(-32000, -32000);
      win.setMenuBarVisibility(false);
      if (process.env.HUB_BROWSER_DEBUG === '1') console.error('[browser-host] janela criada');
      if (!hostWindows.includes(win)) {
        hostWindows.push(win);
        win.once('closed', () => {
          if (process.env.HUB_BROWSER_DEBUG === '1') console.error('[browser-host] janela removida');
          hostWindows = hostWindows.filter((item) => item !== win);
        });
      }
    } catch {
      // janela já fechada
    }
  });

  const live = new BrowserWindow(windowOptions());
  const scrape = new BrowserWindow(windowOptions());
  hostScrapeWindow = scrape;

  live.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void live.loadURL(url).catch(() => undefined);
    return { action: 'deny' };
  });
  scrape.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  await Promise.all([
    live.loadURL('about:blank#hub-live'),
    scrape.loadURL('about:blank#hub-scrape')
  ]);

  // "Visível" para anti-bot, mas fora da tela e sem botão na barra de tarefas.
  live.showInactive();
  scrape.showInactive();
  // No Windows, mostrar a janela pode recriar o botão; reaplicamos depois.
  live.setSkipTaskbar(true);
  scrape.setSkipTaskbar(true);
  setTimeout(() => {
    for (const win of [live, scrape]) {
      if (!win.isDestroyed()) win.setSkipTaskbar(true);
    }
  }, 800);

  // Se a API morrer (inclusive de forma abrupta), o host encerra sozinho.
  const parentPid = Number(process.env.HUB_PARENT_PID);
  if (parentPid) {
    const watchdog = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        app.quit();
      }
    }, 5000);
    watchdog.unref?.();
  }
}

if (isBrowserHost) {
  app.whenReady().then(startBrowserHost).catch((error) => {
    console.error('[browser-host]', error);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });

    app.whenReady().then(bootstrap).catch((error) => {
      console.error('[desktop]', error);
      app.quit();
    });

    app.on('window-all-closed', () => {
      // A janela de idioma pode fechar antes da intro ser criada.
      if (startingUp) return;
      app.quit();
    });

    app.on('before-quit', () => {
      if (quitting) return;
      quitting = true;
      splashHandle?.destroy();
      splashHandle = null;
      stopApi();
    });
  }
}
