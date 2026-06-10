const { app, BrowserWindow, dialog, shell, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');

const APP_URL = `file://${path.join(__dirname, '..', 'packages', 'client', 'dist', 'index.html')}`;

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#111827',
    title: 'QuickPOS',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== APP_URL && !url.startsWith(`${APP_URL}#`)) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });

  window.loadFile(path.join(__dirname, '..', 'packages', 'client', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  if (app.isPackaged && process.platform === 'win32') {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdates().catch(() => {});

    autoUpdater.on('update-available', async (info) => {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'QuickPOS update available',
        message: `QuickPOS ${info.version} is available.`,
        detail: 'Download the verified update now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
      });
      if (result.response === 0) autoUpdater.downloadUpdate().catch(() => {});
    });

    autoUpdater.on('update-downloaded', async () => {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'QuickPOS update ready',
        message: 'The update has been downloaded.',
        detail: 'Restart QuickPOS to install it.',
        buttons: ['Restart and install', 'Later'],
        defaultId: 0,
      });
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
