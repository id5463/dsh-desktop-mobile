const { contextBridge, ipcRenderer } = require('electron')

// dshd Red 壳页面 API (contextIsolation 安全桥)
contextBridge.exposeInMainWorld('dshdShell', {
  action: (which) => ipcRenderer.send('shell-action', which),
  onStatus: (cb) => ipcRenderer.on('dsh-status', (_e, st) => cb(st)),
})
