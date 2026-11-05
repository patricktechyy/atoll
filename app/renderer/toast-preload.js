const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('toastApi', {
  onShow: (cb) => ipcRenderer.on('toast', (_e, n) => cb(n)),
  onPlace: (cb) => ipcRenderer.on('toast-place', (_e, n) => cb(n)),
  event: (ev) => ipcRenderer.send('toast:event', ev),
  interactive: (on) => ipcRenderer.send('toast:interactive', on),
  ready: () => ipcRenderer.send('toast:ready')
});
