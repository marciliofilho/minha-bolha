/** Ponte segura entre o Electron e o frontend do Hub. */
const { contextBridge, ipcRenderer } = require('electron');

let updateHandler = null;

ipcRenderer.on('update:event', (_event, payload) => {
  if (typeof updateHandler === 'function') updateHandler(payload);
});

contextBridge.exposeInMainWorld('hubDesktop', {
  isDesktop: true,
  platform: process.platform,
  chromeVersion: process.versions.chrome || '140.0.0.0',
  electronVersion: process.versions.electron || '',
  userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${
    process.versions.chrome || '140.0.0.0'
  } Safari/537.36`,
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateEvent: (callback) => {
    updateHandler = callback;
  }
});
