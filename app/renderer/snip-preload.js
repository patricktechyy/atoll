const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snip', {
  onImage: (cb) => ipcRenderer.on('snip:image', (_e, b64) => cb(b64)),
  ready: () => ipcRenderer.send('snip:ready'),
  done: (rect) => ipcRenderer.send('snip:done', rect)
});
