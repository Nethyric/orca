'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orcaDesktop', {
  platform: process.platform,
  win: (a) => ipcRenderer.invoke('win', a),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  saveFile: (name, content) => ipcRenderer.invoke('save-file', { name, content }),
  onWinState: (cb) => ipcRenderer.on('win-state', (_e, s) => cb(s)),
});
