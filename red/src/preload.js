const { contextBridge, ipcRenderer } = require('electron')

// Expose dshd Red API to the renderer process
contextBridge.exposeInMainWorld('dshDesktop', {
  // Platform info
  platform: process.platform,
  version: '1.0.0',

  // Connection management
  getConnectionInfo: () => ({
    host: '127.0.0.1',
    port: 3080,
  }),

  // Native features
  isNativeApp: true,
  isDesktopApp: true,

  // File operations (can be extended)
  async selectDirectory() {
    return ipcRenderer.invoke('select-directory')
  },
})