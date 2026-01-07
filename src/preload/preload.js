import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ea', {
  version: '0.1.0'
});

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  importApplications: (filePath) => ipcRenderer.invoke('import-applications', filePath),
  importDependencies: (filePath) => ipcRenderer.invoke('import-dependencies', filePath),
  getGraph: () => ipcRenderer.invoke('get-graph'),
  getImpact: (appId) => ipcRenderer.invoke('get-impact', appId)
});
