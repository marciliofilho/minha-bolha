/**
 * Janela de primeiro boot: escolhe o idioma antes da intro e da API.
 * Pode ser minimizada para depois ou fechada para encerrar a abertura.
 */
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const CHANNEL = 'hub:language';
const MINIMIZE_CHANNEL = 'hub:language:minimize';
const CLOSE_CHANNEL = 'hub:language:close';

function createLanguageWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 460,
    center: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    closable: true,
    show: false,
    title: 'Minha Bolha',
    icon: path.join(__dirname, '..', 'assets', 'icon-pt-BR.png'),
    webPreferences: {
      preload: path.join(__dirname, 'language-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.setMenuBarVisibility(false);

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  let finished = false;

  const finish = (result) => {
    if (finished) return;
    finished = true;
    resolveDone(result);
  };

  const onChoose = (event, language) => {
    if (event.sender !== win.webContents) return;
    if (language !== 'pt' && language !== 'en' && language !== 'es') return;
    finish({ type: 'language', language });
  };

  const onMinimize = (event) => {
    if (event.sender !== win.webContents) return;
    win.minimize();
  };

  const onClose = (event) => {
    if (event.sender !== win.webContents) return;
    win.close();
  };

  ipcMain.on(CHANNEL, onChoose);
  ipcMain.on(MINIMIZE_CHANNEL, onMinimize);
  ipcMain.on(CLOSE_CHANNEL, onClose);

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  win.on('closed', () => {
    ipcMain.removeListener(CHANNEL, onChoose);
    ipcMain.removeListener(MINIMIZE_CHANNEL, onMinimize);
    ipcMain.removeListener(CLOSE_CHANNEL, onClose);
    finish({ type: 'closed' });
  });

  win.loadFile(path.join(__dirname, 'language.html')).catch((error) => {
    console.error('[language] falha ao carregar html:', error);
    finish({ type: 'error' });
  });

  return {
    window: win,
    done,
    close() {
      if (!win.isDestroyed()) win.destroy();
    }
  };
}

module.exports = { createLanguageWindow };
