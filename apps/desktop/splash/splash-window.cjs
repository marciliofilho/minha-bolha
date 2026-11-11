/**
 * Splash transparente para Electron no Windows.
 *
 * Cria uma janela sem moldura, transparente e always-on-top que toca o WebM
 * com alpha (VP9) em tela cheia sobre a área de trabalho. O vídeo tem áudio;
 * o app pode optar por silenciar.
 *
 * Uso:
 *   const { createSplash } = require('./desktop-splash/splash-window.cjs');
 *   const splash = createSplash();
 *   // ... carregue a janela principal escondida ...
 *   await splash.done;       // espera os 5 s do intro (ou fallback)
 *   mainWindow.show();
 *   await splash.close();    // fade-out + destroy
 */

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');

const CHANNEL = 'minha-bolha:splash:done';

function createSplash({
  muted = false,
  width = 720,
  height = 405,
  fullscreen = false,
  video = 'pt-BR/intro.webm',
  title = 'Minha Bolha'
} = {}) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;

  const winWidth = fullscreen ? area.width : Math.max(320, Math.min(Math.round(width), area.width));
  const winHeight = fullscreen ? area.height : Math.max(180, Math.min(Math.round(height), area.height));
  const x = fullscreen ? area.x : Math.round(area.x + (area.width - winWidth) / 2);
  const y = fullscreen ? area.y : Math.round(area.y + (area.height - winHeight) / 2);

  const win = new BrowserWindow({
    x,
    y,
    width: winWidth,
    height: winHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  });

  // Deixa cliques passarem para o desktop/app por baixo.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'floating');

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    resolveDone();
  };

  const onDone = (event) => {
    if (event.sender === win.webContents) finish();
  };

  ipcMain.on(CHANNEL, onDone);

  // Se o vídeo falhar ou o codec não estiver disponível, não bloqueia o app.
  const timer = setTimeout(finish, 8000);

  win.webContents.on('render-process-gone', finish);
  win.webContents.on('did-fail-load', finish);

  win.on('closed', () => {
    clearTimeout(timer);
    ipcMain.removeListener(CHANNEL, onDone);
    finish();
  });

  win.loadFile(path.join(__dirname, 'splash.html'), {
    query: { muted: muted ? '1' : '0', video, title }
  }).catch(() => finish());

  async function close() {
    if (win.isDestroyed()) return;
    try {
      await win.webContents.executeJavaScript("document.body.classList.add('out')");
    } catch {
      // janela já pode ter sido fechada
    }
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!win.isDestroyed()) win.destroy();
  }

  function destroy() {
    if (!win.isDestroyed()) win.destroy();
  }

  return { window: win, done, close, destroy };
}

module.exports = { createSplash };
