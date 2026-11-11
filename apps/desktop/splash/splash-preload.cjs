const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashAPI', {
  done: () => ipcRenderer.send('minha-bolha:splash:done')
});
