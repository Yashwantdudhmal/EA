import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { connect, disconnect } from './services/neo4j.js';
import { initializeSchema } from './services/schema.js';
import { importApplications, importDependencies } from './services/importer.js';
import { getDependencyGraph, getImpactAnalysis } from './services/queries.js';

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src', 'preload', 'preload.js')
    }
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtmlPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
    win.loadFile(indexHtmlPath);
  }
}

// IPC Handlers for CSV import
ipcMain.handle('select-file', async (_event, options) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    ...(options ?? {})
  });

  if (result.canceled) return undefined;
  return result.filePaths?.[0];
});

ipcMain.handle('import-applications', async (_event, filePath) => {
  if (!filePath) return { success: false, error: 'No file selected' };
  return importApplications(filePath);
});

ipcMain.handle('import-dependencies', async (_event, filePath) => {
  if (!filePath) return { success: false, error: 'No file selected' };
  return importDependencies(filePath);
});

ipcMain.handle('get-graph', async () => {
  return getDependencyGraph();
});

ipcMain.handle('get-impact', async (_event, appId) => {
  return getImpactAnalysis(appId);
});

app.whenReady().then(() => {
  connect()
    .then(() => {
      console.log('[neo4j] connected');

      return initializeSchema()
        .then(() => {
          console.log('[schema] initialized');
        })
        .catch((err) => {
          console.warn('[neo4j/schema] initialization failed:', err?.message ?? err);
        });
    })
    .catch((err) => {
      console.warn('[neo4j] connection failed:', err?.message ?? err);
    });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  disconnect().catch(() => {
    // ignore
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
