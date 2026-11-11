/** Ponte da janela de escolha de idioma. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('languagePicker', {
  choose: (language) => ipcRenderer.send('hub:language', language),
  minimize: () => ipcRenderer.send('hub:language:minimize'),
  close: () => ipcRenderer.send('hub:language:close')
});
