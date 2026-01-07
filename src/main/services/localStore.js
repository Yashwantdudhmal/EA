import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const STORE_FILENAME = 'analysis_state.json';

const DEFAULT_STORE = {
  analysisViews: [],
  studioDiagrams: [],
  annotations: {
    application: {},
    view: {}
  }
};

function cloneDefault() {
  return {
    analysisViews: [...DEFAULT_STORE.analysisViews],
    studioDiagrams: [...DEFAULT_STORE.studioDiagrams],
    annotations: {
      application: { ...DEFAULT_STORE.annotations.application },
      view: { ...DEFAULT_STORE.annotations.view }
    }
  };
}

function ensureStoreShape(raw) {
  if (!raw || typeof raw !== 'object') {
    return cloneDefault();
  }

  const analysisViews = Array.isArray(raw.analysisViews) ? raw.analysisViews : [];
  const studioDiagrams = Array.isArray(raw.studioDiagrams) ? raw.studioDiagrams : [];
  const annotations = raw.annotations && typeof raw.annotations === 'object' ? raw.annotations : {};

  return {
    analysisViews,
    studioDiagrams,
    annotations: {
      application:
        annotations.application && typeof annotations.application === 'object'
          ? { ...annotations.application }
          : {},
      view: annotations.view && typeof annotations.view === 'object' ? { ...annotations.view } : {}
    }
  };
}

function getStoreFilePath() {
  const dir = app.getPath('userData');
  return path.join(dir, STORE_FILENAME);
}

async function readStore() {
  const filePath = getStoreFilePath();
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(contents);
    return ensureStoreShape(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return cloneDefault();
    }
    console.warn('[localStore] falling back to default store due to read error:', error?.message ?? error);
    return cloneDefault();
  }
}

async function writeStore(store) {
  const filePath = getStoreFilePath();
  const data = JSON.stringify(store, null, 2);
  await fs.writeFile(filePath, data, 'utf8');
}

function coerceString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function listAnalysisViews() {
  const store = await readStore();
  return [...store.analysisViews].sort((a, b) => {
    const left = b.updatedAt ?? b.createdAt ?? '';
    const right = a.updatedAt ?? a.createdAt ?? '';
    return left.localeCompare(right);
  });
}

export async function saveAnalysisView(view) {
  if (!view || typeof view !== 'object') {
    throw new Error('Invalid view payload');
  }

  const name = coerceString(view.name);
  const viewType = coerceString(view.viewType) || 'analysis';
  if (!name) {
    throw new Error('View name is required');
  }

  const traversalDepth = Number.isInteger(view.traversalDepth) && view.traversalDepth > 0 ? view.traversalDepth : 1;
  const filters = view.filters && typeof view.filters === 'object' ? { ...view.filters } : {};
  const layout = view.layout && typeof view.layout === 'object' ? { ...view.layout } : {};
  const highlightRules =
    view.highlightRules && typeof view.highlightRules === 'object' ? { ...view.highlightRules } : {};

  const now = new Date().toISOString();
  const store = await readStore();
  const id = coerceString(view.id) || randomUUID();

  const existingIndex = store.analysisViews.findIndex((item) => coerceString(item.id) === id);
  const baseRecord =
    existingIndex >= 0
      ? store.analysisViews[existingIndex]
      : { id, createdAt: now, name, viewType, traversalDepth, filters, layout, highlightRules };

  const updatedRecord = {
    ...baseRecord,
    name,
    viewType,
    traversalDepth,
    filters,
    layout,
    highlightRules,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    store.analysisViews.splice(existingIndex, 1, updatedRecord);
  } else {
    store.analysisViews.push(updatedRecord);
  }

  await writeStore(store);
  return updatedRecord;
}

export async function getAnalysisView(id) {
  const viewId = coerceString(id);
  if (!viewId) return null;
  const store = await readStore();
  return store.analysisViews.find((item) => coerceString(item.id) === viewId) ?? null;
}

export async function deleteAnalysisView(id) {
  const viewId = coerceString(id);
  if (!viewId) return false;
  const store = await readStore();
  const next = store.analysisViews.filter((item) => coerceString(item.id) !== viewId);
  if (next.length === store.analysisViews.length) return false;
  store.analysisViews = next;
  await writeStore(store);
  return true;
}

function accessAnnotationBucket(store, scope) {
  if (!store.annotations[scope]) {
    store.annotations[scope] = {};
  }
  return store.annotations[scope];
}

export async function listAnnotations({ scope, targetId }) {
  const normalizedScope = scope === 'view' ? 'view' : 'application';
  const id = coerceString(targetId);
  if (!id) return [];
  const store = await readStore();
  const bucket = accessAnnotationBucket(store, normalizedScope);
  return Array.isArray(bucket[id]) ? bucket[id] : [];
}

export async function addAnnotation({ scope, targetId, text }) {
  const normalizedScope = scope === 'view' ? 'view' : 'application';
  const id = coerceString(targetId);
  const body = coerceString(text);
  if (!id) {
    throw new Error('Target id is required for annotations');
  }
  if (!body) {
    throw new Error('Annotation text is required');
  }
  if (body.length > 2000) {
    throw new Error('Annotation text exceeds limit');
  }

  const now = new Date().toISOString();
  const store = await readStore();
  const bucket = accessAnnotationBucket(store, normalizedScope);
  const entries = Array.isArray(bucket[id]) ? [...bucket[id]] : [];
  const entry = { id: randomUUID(), text: body, createdAt: now };
  entries.push(entry);
  bucket[id] = entries;
  await writeStore(store);
  return entry;
}

export async function listStudioDiagrams() {
  const store = await readStore();
  return [...store.studioDiagrams].sort((a, b) => {
    const left = b.updatedAt ?? b.createdAt ?? '';
    const right = a.updatedAt ?? a.createdAt ?? '';
    return left.localeCompare(right);
  });
}

export async function saveStudioDiagram(diagram) {
  if (!diagram || typeof diagram !== 'object') {
    throw new Error('Invalid diagram payload');
  }

  const name = coerceString(diagram.name);
  if (!name) {
    throw new Error('Diagram name is required');
  }

  if (!Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) {
    throw new Error('Diagram nodes and edges are required arrays');
  }

  const metadata = diagram.metadata && typeof diagram.metadata === 'object' ? { ...diagram.metadata } : {};
  const now = new Date().toISOString();
  const store = await readStore();
  const id = coerceString(diagram.id) || randomUUID();

  const existingIndex = store.studioDiagrams.findIndex((item) => coerceString(item.id) === id);
  const baseRecord =
    existingIndex >= 0
      ? store.studioDiagrams[existingIndex]
      : { id, createdAt: now, name, nodes: [], edges: [], metadata: {} };

  const record = {
    ...baseRecord,
    name,
    nodes: diagram.nodes,
    edges: diagram.edges,
    metadata,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    store.studioDiagrams.splice(existingIndex, 1, record);
  } else {
    store.studioDiagrams.push(record);
  }

  await writeStore(store);
  return record;
}

export async function getStudioDiagram(id) {
  const diagramId = coerceString(id);
  if (!diagramId) return null;
  const store = await readStore();
  return store.studioDiagrams.find((item) => coerceString(item.id) === diagramId) ?? null;
}

export async function deleteStudioDiagram(id) {
  const diagramId = coerceString(id);
  if (!diagramId) return false;
  const store = await readStore();
  const next = store.studioDiagrams.filter((item) => coerceString(item.id) !== diagramId);
  if (next.length === store.studioDiagrams.length) return false;
  store.studioDiagrams = next;
  await writeStore(store);
  return true;
}
