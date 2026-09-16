'use strict';
// Electron main: starts the local server on a loopback port and opens the window.
const { app, BrowserWindow, ipcMain, shell, dialog, nativeTheme, Menu } = require('electron');
const path = require('path');
const config = require('./core/config');
const { listen } = require('./server');

app.setName('ORCA Agent');
if (process.platform === 'win32') app.setAppUserModelId('ai.orca.agent');

let win = null;
let port = 0;

const SPLASH = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#080a12;color:#a9b2c6;font:14px Segoe UI,system-ui"><div style="text-align:center"><div style="font-weight:800;letter-spacing:.3em;font-size:22px;background:linear-gradient(120deg,#5b8cff,#a55cff);-webkit-background-clip:text;color:transparent">ORCA</div><div style="margin-top:14px;width:120px;height:3px;background:#1b2140;border-radius:3px;overflow:hidden;margin-inline:auto"><div style="width:40%;height:100%;background:linear-gradient(90deg,#5b8cff,#a55cff);animation:m 1s infinite"></div></div></div><style>@keyframes m{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}</style></body></html>`);

function createWindow() {
  win = new BrowserWindow({
    width: 1380, height: 880, minWidth: 900, minHeight: 600, show: true,
    backgroundColor: '#080a12', title: 'ORCA Agent', frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  win.loadURL(SPLASH);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('maximize', () => win.webContents.send('win-state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win-state', { maximized: false }));
  win.on('closed', () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  config.setDataDir(path.join(app.getPath('userData'), 'data'));
  createWindow(); // window appears instantly with a splash; server boots in parallel
  try { ({ port } = await listen(0, '127.0.0.1')); }
  catch (e) { dialog.showErrorBox('ORCA', 'Failed to start local server: ' + e.message); app.quit(); return; }
  if (win) win.loadURL(`http://127.0.0.1:${port}/`);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); win.loadURL(`http://127.0.0.1:${port}/`); } });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('win', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') { win.isMaximized() ? win.unmaximize() : win.maximize(); }
  else if (action === 'close') win.close();
  return win.isMaximized();
});
ipcMain.handle('open-path', (_e, p) => shell.openPath(p || config.workspaceDir()));
ipcMain.handle('open-external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('save-file', async (_e, { name, content }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name });
  if (r.canceled) return false;
  require('fs').writeFileSync(r.filePath, content, 'utf8');
  return r.filePath;
});
