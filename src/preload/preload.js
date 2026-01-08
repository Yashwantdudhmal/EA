const { contextBridge, ipcRenderer } = require('electron');

function isStudioRoute() {
  try {
    const hash = globalThis?.location?.hash ?? '';
    return typeof hash === 'string' && hash.startsWith('#/studio');
  } catch {
    return false;
  }
}

function assertEAMode(apiName) {
  if (isStudioRoute()) {
    throw new Error(`Architecture Studio is isolated from Neo4j. Blocked access via ${apiName}.`);
  }
}

function assertStudioMode(apiName) {
  if (!isStudioRoute()) {
    throw new Error(`EA Snapshot import is only available in Architecture Studio. Blocked access via ${apiName}.`);
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: (options) => {
    if (!options?.userInitiated) {
      return Promise.resolve(null);
    }
    return ipcRenderer.invoke('select-file', options);
  },

  importApplications: (filePath) => {
    assertEAMode('importApplications');
    return ipcRenderer.invoke('import-applications', filePath);
  },

  importDependencies: (filePath) => {
    assertEAMode('importDependencies');
    return ipcRenderer.invoke('import-dependencies', filePath);
  },

  getGraph: () => {
    assertEAMode('getGraph');
    return ipcRenderer.invoke('get-graph');
  },

  getImpact: (input) => {
    assertEAMode('getImpact');
    if (!input)
      return Promise.resolve({
        appId: null,
        depthUsed: 0,
        direct: [],
        indirect: [],
        summary: { totalImpacted: 0, highestCriticality: null, retiringCount: 0 }
      });
    if (typeof input === 'string') {
      return ipcRenderer.invoke('impact-analysis', { appId: input });
    }
    return ipcRenderer.invoke('impact-analysis', input);
  },

  getRiskIndicators: () => {
    assertEAMode('getRiskIndicators');
    return ipcRenderer.invoke('risk-indicators');
  },

  getApplications: () => {
    assertEAMode('getApplications');
    return ipcRenderer.invoke('get-applications');
  },

  searchApplications: (filters) => {
    assertEAMode('searchApplications');
    return ipcRenderer.invoke('search-applications', filters);
  },

  listAnalysisViews: () => ipcRenderer.invoke('analysis-views:list'),

  saveAnalysisView: (view) => ipcRenderer.invoke('analysis-views:save', view),

  loadAnalysisView: (id) => ipcRenderer.invoke('analysis-views:get', id),

  deleteAnalysisView: (id) => ipcRenderer.invoke('analysis-views:delete', id),

  listAnnotations: (payload) => ipcRenderer.invoke('annotations:list', payload),

  addAnnotation: (payload) => ipcRenderer.invoke('annotations:add', payload),

  listStudioDiagrams: () => ipcRenderer.invoke('studio:diagrams:list'),

  loadStudioDiagram: (id) => ipcRenderer.invoke('studio:diagrams:get', id),

  saveStudioDiagram: (diagram) => ipcRenderer.invoke('studio:diagrams:save', diagram),

  deleteStudioDiagram: (id) => ipcRenderer.invoke('studio:diagrams:delete', id),

  exportStudioJson: (payload) => ipcRenderer.invoke('studio:export-json', payload),

  exportStudioPng: (payload) => ipcRenderer.invoke('studio:export-png', payload),

  getEaSnapshot: () => {
    assertStudioMode('getEaSnapshot');
    return ipcRenderer.invoke('studio:ea-snapshot:get');
  },

  onMenuCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      callback(payload?.command, payload?.payload);
    };
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  }
});
