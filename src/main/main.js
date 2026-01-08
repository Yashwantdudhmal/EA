import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as neo4jService from './services/neo4j.js';
import { EA_CORE_SCHEMA_VERSION, initializeSchema } from './services/schema.js';
import { importApplications, importDependencies } from './services/importer.js';
import {
  getAllApplications,
  getDependencyGraph,
  getImpactAnalysis,
  getRiskIndicators,
  getStudioEaSnapshot,
  searchApplications
} from './services/queries.js';
import {
  addAnnotation,
  deleteAnalysisView,
  deleteStudioDiagram,
  getAnalysisView,
  getStudioDiagram,
  listAnalysisViews,
  listAnnotations,
  listStudioDiagrams,
  saveAnalysisView,
  saveStudioDiagram
} from './services/localStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

// Keep renderer DevTools console silent in dev.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// Keep DevTools console silent in dev mode.
// This prevents Chromium/DevTools protocol errors related to Autofill.
app.commandLine.appendSwitch('disable-features', 'Autofill');
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('log-level', '3');

let isSelectFileDialogOpen = false;
let lastSelectFileDialogClosedAt = 0;

function sendCommandToRenderer(command, payload) {
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target) return;
  target.webContents.send('menu-command', { command, payload });
}

function handleIpc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      const message = error?.message ?? String(error);
      throw error instanceof Error ? error : new Error(message);
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function buildApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Workspace', enabled: false },
        { label: 'Open Workspace…', enabled: false },
        { label: 'Close Workspace', enabled: false },
        { type: 'separator' },
        {
          label: 'Import Applications (CSV)',
          click: () => sendCommandToRenderer('workspace:import-applications')
        },
        {
          label: 'Import Dependencies (CSV)',
          click: () => sendCommandToRenderer('workspace:import-dependencies')
        },
        { label: 'Import Metadata (CSV / JSON)', enabled: false },
        { type: 'separator' },
        { label: 'Export Inventory (CSV)', enabled: false },
        { label: 'Export Dependency Model (CSV)', enabled: false },
        { label: 'Export Impact Analysis (CSV)', enabled: false },
        { label: 'Export View as Image (PNG / SVG)', enabled: false },
        { label: 'Export Workspace Snapshot', enabled: false },
        { type: 'separator' },
        { label: 'Workspace Settings', enabled: false },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Select All' },
        {
          label: 'Clear Selection',
          click: () => sendCommandToRenderer('edit:clear-selection')
        },
        { type: 'separator' },
        { label: 'Preferences', enabled: false }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Data',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => sendCommandToRenderer('view:reload-data')
        },
        {
          label: 'Refresh Graph',
          click: () => sendCommandToRenderer('view:refresh-graph')
        },
        {
          label: 'Reset Graph Layout',
          click: () => sendCommandToRenderer('view:reset-layout')
        },
        {
          label: 'Fit Graph to Screen',
          accelerator: 'CmdOrCtrl+0',
          click: () => sendCommandToRenderer('view:fit-graph')
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => sendCommandToRenderer('view:zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendCommandToRenderer('view:zoom-out')
        },
        { type: 'separator' },
        {
          label: 'Show / Hide Inventory Panel',
          type: 'checkbox',
          checked: true,
          click: (item) => sendCommandToRenderer('view:toggle-inventory', item.checked)
        },
        {
          label: 'Show / Hide Graph Panel',
          type: 'checkbox',
          checked: true,
          click: (item) => sendCommandToRenderer('view:toggle-graph', item.checked)
        },
        {
          label: 'Show / Hide Details Panel',
          type: 'checkbox',
          checked: false,
          click: (item) => sendCommandToRenderer('view:toggle-details', item.checked)
        },
        { type: 'separator' },
        {
          label: 'Toggle Dark Mode',
          click: () => sendCommandToRenderer('view:toggle-dark-mode')
        },
        {
          label: 'Toggle Labels',
          type: 'checkbox',
          checked: true,
          click: (item) => sendCommandToRenderer('view:toggle-labels', item.checked)
        },
        {
          label: 'Toggle Grid / Alignment Guides',
          type: 'checkbox',
          checked: false,
          click: (item) => sendCommandToRenderer('view:toggle-grid', item.checked)
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Fullscreen' }
      ]
    },
    {
      label: 'Architecture',
      submenu: [
        {
          label: 'Architecture Studio',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => sendCommandToRenderer('studio:open')
        },
        {
          label: 'Import EA Snapshot into Studio',
          click: () => sendCommandToRenderer('studio:import-ea-snapshot')
        },
        { type: 'separator' },
        {
          label: 'Application Inventory',
          click: () => sendCommandToRenderer('architecture:application-inventory')
        },
        {
          label: 'Dependency Model',
          click: () => sendCommandToRenderer('architecture:dependency-model')
        },
        { type: 'separator' },
        {
          label: 'Impact Analysis',
          click: () => sendCommandToRenderer('architecture:impact-analysis')
        },
        {
          label: 'Blast Radius View',
          click: () => sendCommandToRenderer('architecture:blast-radius')
        },
        {
          label: 'Upstream / Downstream Analysis',
          click: () => sendCommandToRenderer('architecture:upstream-downstream')
        },
        { type: 'separator' },
        {
          label: 'Criticality Overview',
          click: () => sendCommandToRenderer('architecture:criticality-overview')
        },
        {
          label: 'Lifecycle Overview',
          click: () => sendCommandToRenderer('architecture:lifecycle-overview')
        },
        { type: 'separator' },
        {
          label: 'Dependency Validation',
          click: () => sendCommandToRenderer('architecture:dependency-validation')
        },
        {
          label: 'Orphan Application Detection',
          click: () => sendCommandToRenderer('architecture:orphan-detection')
        }
      ]
    },
    {
      label: 'Analysis',
      submenu: [
        { label: 'What-If Analysis (stub)', enabled: false },
        {
          label: 'Application Decommission Impact',
          click: () => sendCommandToRenderer('analysis:decommission-impact')
        },
        {
          label: 'Change Impact Summary',
          click: () => sendCommandToRenderer('analysis:change-impact')
        },
        { type: 'separator' },
        { label: 'Risk Hotspots (stub)', enabled: false },
        { label: 'Single Points of Failure (stub)', enabled: false }
      ]
    },
    {
      label: 'Modeling',
      submenu: [
        {
          label: 'Create View',
          click: () => sendCommandToRenderer('modeling:create-view')
        },
        { label: 'Save View', enabled: false },
        { label: 'Duplicate View', enabled: false },
        { type: 'separator' },
        {
          label: 'Layout Presets',
          click: () => sendCommandToRenderer('modeling:layout-presets')
        },
        { type: 'separator' },
        {
          label: 'Group by Owner',
          click: () => sendCommandToRenderer('modeling:group-owner')
        },
        {
          label: 'Group by Criticality',
          click: () => sendCommandToRenderer('modeling:group-criticality')
        },
        {
          label: 'Group by Lifecycle State',
          click: () => sendCommandToRenderer('modeling:group-lifecycle')
        }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Validate Data Integrity',
          click: () => sendCommandToRenderer('tools:validate-data')
        },
        {
          label: 'Check Broken Dependencies',
          click: () => sendCommandToRenderer('tools:broken-dependencies')
        },
        { label: 'Rebuild Graph Indexes', enabled: false },
        { label: 'Recalculate Impact Cache', enabled: false },
        { type: 'separator' },
        { label: 'Clear Local Cache', enabled: false },
        { label: 'Reset Workspace State', enabled: false }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front', label: 'Bring All to Front' }
      ]
    },
    {
      label: 'Developer',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: 'Ctrl+Shift+I',
          click: () => {
            const target = BrowserWindow.getFocusedWindow();
            if (target) {
              if (target.webContents.isDevToolsOpened()) target.webContents.closeDevTools();
              else target.webContents.openDevTools({ mode: 'detach' });
            }
          }
        },
        {
          label: 'Reload Renderer',
          accelerator: 'Ctrl+Shift+H',
          click: () => {
            const target = BrowserWindow.getFocusedWindow();
            target?.webContents?.reloadIgnoringCache?.();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Redly Intelligence',
          click: () => sendCommandToRenderer('help:about')
        },
        {
          label: 'Product Overview',
          click: () => sendCommandToRenderer('help:product-overview')
        },
        {
          label: 'Documentation',
          click: () => sendCommandToRenderer('help:documentation')
        },
        {
          label: 'Architecture Concepts',
          click: () => sendCommandToRenderer('help:architecture-concepts')
        },
        { label: 'Keyboard Shortcuts', enabled: false },
        { type: 'separator' },
        {
          label: 'Open Logs Folder',
          click: () => sendCommandToRenderer('help:open-logs')
        },
        {
          label: 'Diagnostics',
          click: () => sendCommandToRenderer('help:diagnostics')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Redly Intelligence',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    const indexHtmlPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
    mainWindow.loadFile(indexHtmlPath);
  }
}

// IPC Handlers for CSV import
handleIpc('select-file', async (event, options) => {
  const senderUrl = event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? 'unknown';
  const isUserInitiated = Boolean(options?.userInitiated);
  if (!isUserInitiated) {
    return null;
  }

  if (isSelectFileDialogOpen) return null;

  const now = Date.now();
  if (now - lastSelectFileDialogClosedAt < 800) return null;

  isSelectFileDialogOpen = true;
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  } finally {
    isSelectFileDialogOpen = false;
    lastSelectFileDialogClosedAt = Date.now();
  }
});

handleIpc('import-applications', async (_event, filePath) => {
  if (!filePath) return { success: false, error: 'No file selected' };
  return await importApplications(filePath);
});

handleIpc('import-dependencies', async (_event, filePath) => {
  if (!filePath) return { success: false, error: 'No file selected' };
  return await importDependencies(filePath);
});

handleIpc('get-graph', async () => {
  return getDependencyGraph();
});

handleIpc('get-applications', async () => {
  return getAllApplications();
});

handleIpc('search-applications', async (_event, filters) => {
  return searchApplications(filters);
});

handleIpc('get-impact', async (_event, appId) => {
  return getImpactAnalysis(appId);
});

handleIpc('impact-analysis', async (_event, payload) => {
  return getImpactAnalysis(payload);
});

handleIpc('risk-indicators', async () => {
  return getRiskIndicators();
});

handleIpc('analysis-views:list', async () => {
  return listAnalysisViews();
});

handleIpc('analysis-views:save', async (_event, view) => {
  return saveAnalysisView(view);
});

handleIpc('analysis-views:get', async (_event, id) => {
  return getAnalysisView(id);
});

handleIpc('analysis-views:delete', async (_event, id) => {
  return deleteAnalysisView(id);
});

handleIpc('annotations:list', async (_event, payload) => {
  return listAnnotations(payload ?? {});
});

handleIpc('annotations:add', async (_event, payload) => {
  return addAnnotation(payload ?? {});
});

handleIpc('studio:diagrams:list', async () => {
  return listStudioDiagrams();
});

handleIpc('studio:diagrams:get', async (_event, id) => {
  return getStudioDiagram(id);
});

handleIpc('studio:diagrams:save', async (_event, diagram) => {
  return saveStudioDiagram(diagram);
});

handleIpc('studio:diagrams:delete', async (_event, id) => {
  return deleteStudioDiagram(id);
});

handleIpc('studio:ea-snapshot:get', async () => {
  const importId = crypto.randomUUID();
  const importedAt = nowIso();
  const { applications, dependencies } = await getStudioEaSnapshot();
  return {
    snapshot: {
      eaCoreVersion: `schema:${EA_CORE_SCHEMA_VERSION}`,
      eaCoreTimestamp: importedAt,
      importId,
      snapshotId: importId,
      importedAt
    },
    applications,
    dependencies
  };
});

handleIpc('studio:export-json', async (_event, payload = {}) => {
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'diagram';
  const data = payload.data ?? {};
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Diagram (JSON)',
    defaultPath: `${name}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (canceled || !filePath) {
    return { saved: false };
  }

  await fs.writeFile(filePath, json, 'utf8');
  return { saved: true, filePath };
});

handleIpc('studio:export-png', async (_event, payload = {}) => {
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'diagram';
  const dataUrl = typeof payload.dataUrl === 'string' ? payload.dataUrl : '';

  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    return { saved: false, error: 'Invalid PNG payload.' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Canvas (PNG)',
    defaultPath: `${name}.png`,
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });

  if (canceled || !filePath) {
    return { saved: false };
  }

  const base64 = dataUrl.slice(prefix.length);
  if (!base64) {
    return { saved: false, error: 'Empty canvas image.' };
  }

  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer?.length) {
      return { saved: false, error: 'Empty canvas image.' };
    }
    await fs.writeFile(filePath, buffer);
    return { saved: true, filePath };
  } catch {
    return { saved: false, error: 'Failed to write PNG file.' };
  }
});

app.whenReady().then(async () => {
  try {
    await neo4jService.connect();
  } catch (err) {
    // Best-effort: app can still render without Neo4j.
  }

  buildApplicationMenu();

  createWindow();

  try {
    await initializeSchema();
  } catch (err) {
    // Best-effort only.
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  neo4jService.disconnect().catch(() => {
    // ignore
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
