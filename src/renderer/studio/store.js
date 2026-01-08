import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { addEdge, applyEdgeChanges, applyNodeChanges } from 'reactflow';
import { createComponentNode, createGroupNode, createRelationshipEdge, normalizeDiagram, normalizeEdge, normalizeNode, computeComponentTitle } from './modeling/model.js';
import { validateDiagram } from './modeling/validate.js';
import { computeAllowedTargetIds, resolveGuidedConnection } from './modeling/diagramTypes.js';

enableMapSet();

const SNAP_GRID = [16, 16];

const EA_CORE_SOURCE = 'EA_CORE';

function nowIso() {
  return new Date().toISOString();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return Math.max(min, Math.min(max, i));
}

function safeId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  return value.replace(/[^a-zA-Z0-9._:-]/g, '_');
}

function isEaBackedElement(item) {
  return item?.data?.metadata?.source === EA_CORE_SOURCE;
}

function isEaBackedNode(node) {
  return Boolean(node && isEaBackedElement(node) && node?.type !== 'group' && node?.data?.kind !== 'group');
}

function isEaBackedEdge(edge) {
  return Boolean(edge && isEaBackedElement(edge));
}

function eaBackedMutationBlockedMessage() {
  return 'EA Core elements are read-only in Studio.';
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const VIEW_STATE_STORAGE_PREFIX = 'ea.studio.viewState.';

function loadViewState(diagramId) {
  if (!diagramId) return null;
  try {
    const raw = window?.localStorage?.getItem(`${VIEW_STATE_STORAGE_PREFIX}${diagramId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveViewState(diagramId, view) {
  if (!diagramId) return;
  try {
    window?.localStorage?.setItem(`${VIEW_STATE_STORAGE_PREFIX}${diagramId}`, JSON.stringify(view ?? {}));
  } catch {
    // Best-effort only.
  }
}

function normalizeView(view) {
  const v = view ?? {};
  return {
    activeLayerIds: Array.isArray(v.activeLayerIds) ? v.activeLayerIds.filter(Boolean).slice().sort() : [],
    collapsedContainerIds: Array.isArray(v.collapsedContainerIds) ? v.collapsedContainerIds.filter(Boolean).slice().sort() : []
  };
}

function sanitizeNodeForSave(node) {
  if (!node) return node;
  const { selected, dragging, positionAbsolute, ...rest } = node;

  // Phase D: disallow persistence of manual styling fields.
  const data = { ...(node.data ?? {}) };
  delete data.visual;
  delete data.style;
  if (data.metadata?.template?.overrides?.visual) {
    data.metadata = {
      ...(data.metadata ?? {}),
      template: {
        ...(data.metadata?.template ?? {}),
        overrides: {
          ...(data.metadata?.template?.overrides ?? {})
        }
      }
    };
    delete data.metadata.template.overrides.visual;
  }

  return {
    ...rest,
    data
  };
}

function sanitizeEdgeForSave(edge) {
  if (!edge) return edge;
  const { selected, ...rest } = edge;

  // Phase D: disallow persistence of manual styling fields.
  const data = { ...(edge.data ?? {}) };
  delete data.style;
  if (data.metadata?.template?.overrides?.style) {
    data.metadata = {
      ...(data.metadata ?? {}),
      template: {
        ...(data.metadata?.template ?? {}),
        overrides: {
          ...(data.metadata?.template?.overrides ?? {})
        }
      }
    };
    delete data.metadata.template.overrides.style;
  }

  return {
    ...rest,
    label: '',
    data
  };
}

function computeAllowedEdgeTypeIds(registry, sourceType, targetType) {
  if (!registry || !sourceType || !targetType) return [];
  const sourceAllowed = Array.isArray(sourceType.allowedEdgeTypes) ? sourceType.allowedEdgeTypes : [];
  const targetAllowed = Array.isArray(targetType.allowedEdgeTypes) ? targetType.allowedEdgeTypes : [];
  return sourceAllowed
    .filter((id) => targetAllowed.includes(id))
    .filter((id) => Boolean(registry.edgeTypesById?.has(id)))
    .slice()
    .sort();
}

function resolveEdgeTypeVersion(registry, edgeTypeId) {
  const edgeType = registry?.edgeTypesById?.get(edgeTypeId) ?? null;
  return edgeType?.version;
}

function computeGuidedEdgeLabel(edgeTypeId) {
  switch (edgeTypeId) {
    case 'rel.processToApp':
      return 'Process → Application';
    case 'rel.programmeToCapability':
      return 'Programme → Capability';
    case 'rel.programmeToApplication':
      return 'Programme → Application';
    case 'rel.appToTechnology':
      return 'Application → Technology';
    default:
      return '';
  }
}

function snapshot(state) {
  return {
    nodes: clone(state.nodes ?? []),
    edges: clone(state.edges ?? []),
    metadata: clone(state.metadata ?? {})
  };
}

function applySelectionFlags(draft, selection) {
  const nodeIds = new Set(selection?.nodes ?? []);
  const edgeIds = new Set(selection?.edges ?? []);
  draft.nodes = (draft.nodes ?? []).map((node) => ({ ...node, selected: nodeIds.has(node.id) }));
  draft.edges = (draft.edges ?? []).map((edge) => ({ ...edge, selected: edgeIds.has(edge.id) }));
}

function hasMeaningfulNodeChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return false;
  return changes.some((change) => {
    if (!change || change.type === 'select') return false;
    if (change.type === 'position') {
      return change.dragging === false || change.dragging === undefined;
    }
    return true;
  });
}

function hasMeaningfulEdgeChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return false;
  return changes.some((change) => change && change.type !== 'select');
}

const initialState = {
  diagramId: null,
  diagramViews: {
    activeViewId: 'view-main',
    views: [
      {
        id: 'view-main',
        name: 'Main',
        nodeIds: [],
        edgeIds: [],
        nodeLayoutById: {},
        ui: {
          activeLayerIds: [],
          collapsedContainerIds: []
        }
      }
    ]
  },
  metadata: {
    name: 'Untitled Diagram',
    description: '',
    diagramTypeId: null,
    eaSnapshot: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  // Back-compat: this mirrors the *active* view ui state. Authoritative state is in diagramViews.views[].ui.
  view: {
    activeLayerIds: [],
    collapsedContainerIds: []
  },
  registry: { status: 'loading' },
  registryError: null,
  validationErrors: [],
  lastModelingError: null,
  nodes: [],
  edges: [],
  selection: {
    nodes: [],
    edges: []
  },
  snapGrid: SNAP_GRID,
  showGrid: true,
  dirty: false,
  history: {
    past: [],
    future: []
  },
  armedHistory: null,
  clipboard: null,
  connectMode: {
    active: false,
    sourceNodeId: null,
    allowedTargetIds: []
  }
};

function extractNodeLayout(node) {
  if (!node?.id) return null;
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    width: node.width ?? node.measured?.width ?? null,
    height: node.height ?? node.measured?.height ?? null,
    parentNode: node.parentNode ?? null,
    extent: node.extent ?? null
  };
}

function applyNodeLayout(node, layout) {
  if (!node || !layout) return node;
  const next = {
    ...node,
    position: {
      x: typeof layout.x === 'number' ? layout.x : node.position?.x ?? 0,
      y: typeof layout.y === 'number' ? layout.y : node.position?.y ?? 0
    }
  };

  if (layout.width) next.width = layout.width;
  if (layout.height) next.height = layout.height;

  if (layout.parentNode) {
    next.parentNode = layout.parentNode;
    if (layout.extent) next.extent = layout.extent;
  } else {
    delete next.parentNode;
    delete next.extent;
  }

  return next;
}

function normalizeDiagramViewsFromDiagram(diagram, fallbackUi, nodes, edges) {
  const uiFallback = normalizeView(fallbackUi);
  const nodeIds = (Array.isArray(nodes) ? nodes : []).map((n) => n?.id).filter(Boolean).slice().sort();
  const edgeIds = (Array.isArray(edges) ? edges : []).map((e) => e?.id).filter(Boolean).slice().sort();

  const incomingViews = Array.isArray(diagram?.views) ? diagram.views : null;
  if (!incomingViews || incomingViews.length === 0) {
    const nodeLayoutById = {};
    for (const n of Array.isArray(nodes) ? nodes : []) {
      const layout = extractNodeLayout(n);
      if (layout) nodeLayoutById[n.id] = layout;
    }
    return {
      activeViewId: 'view-main',
      views: [
        {
          id: 'view-main',
          name: 'Main',
          nodeIds,
          edgeIds,
          nodeLayoutById,
          ui: uiFallback
        }
      ]
    };
  }

  const normalizedViews = incomingViews
    .filter((v) => v && typeof v === 'object')
    .map((v, idx) => {
      const id = String(v.id ?? `view-${idx + 1}`).trim() || `view-${idx + 1}`;
      const name = String(v.name ?? 'View').trim() || 'View';
      const vNodeIds = Array.isArray(v.nodeIds) ? v.nodeIds.filter(Boolean).slice().sort() : nodeIds;
      const vEdgeIds = Array.isArray(v.edgeIds) ? v.edgeIds.filter(Boolean).slice().sort() : edgeIds;
      const nodeLayoutById = v.nodeLayoutById && typeof v.nodeLayoutById === 'object' ? v.nodeLayoutById : {};
      const ui = normalizeView(v.ui ?? uiFallback);
      return { id, name, nodeIds: vNodeIds, edgeIds: vEdgeIds, nodeLayoutById, ui };
    });

  const activeViewId = String(diagram?.activeViewId ?? normalizedViews[0]?.id ?? 'view-main');
  const activeOk = normalizedViews.some((v) => v.id === activeViewId);
  return {
    activeViewId: activeOk ? activeViewId : normalizedViews[0]?.id,
    views: normalizedViews
  };
}

function getActiveView(draft) {
  const activeId = draft?.diagramViews?.activeViewId;
  const views = Array.isArray(draft?.diagramViews?.views) ? draft.diagramViews.views : [];
  return views.find((v) => v.id === activeId) ?? views[0] ?? null;
}

function upsertActiveViewUi(draft, nextUi) {
  const activeId = draft?.diagramViews?.activeViewId;
  draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) => {
    if (v.id !== activeId) return v;
    return { ...v, ui: normalizeView(nextUi) };
  });
  draft.view = normalizeView(nextUi);
}

function recordActiveViewLayouts(draft, changedNodeIds) {
  const active = getActiveView(draft);
  if (!active) return;
  const setIds = new Set(Array.isArray(changedNodeIds) ? changedNodeIds.filter(Boolean) : []);
  if (setIds.size === 0) return;

  const nodeLayoutById = { ...(active.nodeLayoutById ?? {}) };
  for (const n of draft.nodes ?? []) {
    if (!setIds.has(n.id)) continue;
    const layout = extractNodeLayout(n);
    if (layout) nodeLayoutById[n.id] = layout;
  }

  draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) => {
    if (v.id !== active.id) return v;
    return { ...v, nodeLayoutById };
  });
}

export const useStudioStore = create(
  immer((set, get) => ({
    ...initialState,
    clearLastModelingError: () =>
      set((draft) => {
        draft.lastModelingError = null;
      }),
    setRegistry: (registryState) => {
      set((draft) => {
        const next = registryState ?? { status: 'loading' };
        draft.registry = next;
        draft.registryError = next?.status === 'error' ? String(next?.message ?? 'Registry load failed.') : null;

        // Normalize existing diagram content once registry becomes available.
        if (draft.registry?.status === 'ready') {
          draft.nodes = (draft.nodes ?? []).map((node) => normalizeNode(draft.registry, node));
          draft.edges = (draft.edges ?? []).map((edge) => normalizeEdge(edge));
        }

        draft.validationErrors = validateDiagram({
          registry: draft.registry,
          nodes: draft.nodes,
          edges: draft.edges
        });
      });
    },
    revalidate: () =>
      set((draft) => {
        draft.validationErrors = validateDiagram({
          registry: draft.registry,
          nodes: draft.nodes,
          edges: draft.edges
        });
      }),
    _pushHistory: () => {
      const state = get();
      const snap = snapshot(state);
      set((draft) => {
        draft.history.past.push(snap);
        draft.history.future = [];
      });
    },
    armHistory: () => {
      const state = get();
      if (state.armedHistory) return;
      set((draft) => {
        draft.armedHistory = snapshot(state);
      });
    },
    _commitArmedHistory: () => {
      const armed = get().armedHistory;
      if (!armed) return;
      set((draft) => {
        draft.history.past.push(armed);
        draft.history.future = [];
        draft.armedHistory = null;
      });
    },
    clearArmedHistory: () =>
      set((draft) => {
        draft.armedHistory = null;
      }),
    undo: () => {
      const state = get();
      const previous = state.history.past[state.history.past.length - 1];
      if (!previous) return;
      const current = snapshot(state);
      set((draft) => {
        draft.history.past.pop();
        draft.history.future.unshift(current);
        draft.nodes = clone(previous.nodes ?? []);
        draft.edges = clone(previous.edges ?? []);
        draft.metadata = {
          ...draft.metadata,
          ...(previous.metadata ?? {})
        };
        draft.selection = { nodes: [], edges: [] };
        draft.dirty = true;
      });
    },
    redo: () => {
      const state = get();
      const next = state.history.future[0];
      if (!next) return;
      const current = snapshot(state);
      set((draft) => {
        draft.history.future.shift();
        draft.history.past.push(current);
        draft.nodes = clone(next.nodes ?? []);
        draft.edges = clone(next.edges ?? []);
        draft.metadata = {
          ...draft.metadata,
          ...(next.metadata ?? {})
        };
        draft.selection = { nodes: [], edges: [] };
        draft.dirty = true;
      });
    },
    setShowGrid: (show) =>
      set((draft) => {
        draft.showGrid = Boolean(show);
      }),
    reset: () =>
      set(() => ({
        ...initialState,
        metadata: {
          ...initialState.metadata,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      })),

    // Dev-only helper for G9 validation (large graph performance).
    // Not persisted automatically; caller can save if desired.
    loadStressGraph: ({ nodeCount = 1000, edgesPerNode = 2 } = {}) => {
      const registry = get().registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Registry not loaded. Cannot generate stress graph.';
        });
        return;
      }

      const nCount = clampInt(nodeCount, 10, 20000, 1000);
      const ePer = clampInt(edgesPerNode, 0, 8, 2);

      const componentTypeId = registry.componentTypesById?.has('app.application')
        ? 'app.application'
        : registry.componentTypesById?.has('app.service')
          ? 'app.service'
          : registry.componentTypesById?.has('legacy.unknown')
            ? 'legacy.unknown'
            : (registry.componentTypes?.[0]?.typeId ?? 'legacy.unknown');

      const edgeTypeId = registry.edgeTypesById?.has('rel.dependsOn')
        ? 'rel.dependsOn'
        : (registry.edgeTypes?.[0]?.edgeTypeId ?? null);

      if (!edgeTypeId || !registry.edgeTypesById?.has(edgeTypeId)) {
        set((draft) => {
          draft.lastModelingError = 'No edge types available in registry. Cannot generate stress graph.';
        });
        return;
      }

      const edgeTypeVersion = registry.edgeTypesById.get(edgeTypeId)?.version ?? 1;
      const createdAt = nowIso();

      const gridCols = Math.ceil(Math.sqrt(nCount));
      const spacingX = 220;
      const spacingY = 150;

      const nodes = [];
      for (let i = 0; i < nCount; i += 1) {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);
        const position = { x: col * spacingX, y: row * spacingY };
        const node = createComponentNode({ registry, componentTypeId, position });

        // Make titles deterministic + immediately valid.
        const name = `Synthetic ${i + 1}`;
        const ct = registry.componentTypesById.get(componentTypeId);
        const attributes = { ...(node.data?.attributes ?? {}) };
        attributes.name = name;
        const title = computeComponentTitle(ct, attributes);

        nodes.push(
          normalizeNode(registry, {
            ...node,
            data: {
              ...(node.data ?? {}),
              title,
              attributes,
              metadata: {
                ...(node.data?.metadata ?? {}),
                createdAt,
                updatedAt: createdAt,
                source: 'DEV_STRESS'
              }
            }
          })
        );
      }

      const edges = [];
      const nodeIds = nodes.map((n) => n.id);
      for (let i = 0; i < nCount; i += 1) {
        const source = nodeIds[i];
        if (!source) continue;
        for (let k = 1; k <= ePer; k += 1) {
          const target = nodeIds[(i + k) % nCount];
          if (!target || target === source) continue;
          edges.push(
            normalizeEdge(
              createRelationshipEdge({
                edgeTypeId,
                edgeTypeVersion,
                source,
                target
              })
            )
          );
        }
      }

      const nodeLayoutById = {};
      for (const n of nodes) {
        const layout = extractNodeLayout(n);
        if (layout) nodeLayoutById[n.id] = layout;
      }

      const viewId = 'view-main';
      const views = [
        {
          id: viewId,
          name: `Main (${nCount} nodes)`,
          nodeIds: nodeIds.slice().sort(),
          edgeIds: edges.map((e) => e.id).filter(Boolean).slice().sort(),
          nodeLayoutById,
          ui: normalizeView(get().view)
        }
      ];

      set(() => ({
        diagramId: null,
        diagramViews: { activeViewId: viewId, views },
        metadata: {
          name: `DEV Stress (${nCount} nodes, ${edges.length} edges)`,
          description: 'Synthetic diagram generated for performance validation.',
          eaSnapshot: null,
          createdAt,
          updatedAt: createdAt
        },
        view: normalizeView(get().view),
        registry,
        registryError: get().registryError,
        validationErrors: validateDiagram({ registry, nodes, edges }),
        lastModelingError: null,
        nodes,
        edges,
        selection: { nodes: [], edges: [] },
        snapGrid: SNAP_GRID,
        showGrid: true,
        dirty: true,
        history: { past: [], future: [] },
        armedHistory: null,
        clipboard: null
      }));
    },

    loadDiagram: (diagram) =>
      set(() => {
        if (!diagram) {
          return { ...initialState };
        }

        const registry = get().registry;
        const normalized = registry ? normalizeDiagram(registry, diagram) : diagram;
        const storedView = loadViewState(diagram.id ?? null);

        const diagramViews = normalizeDiagramViewsFromDiagram(
          diagram,
          storedView,
          Array.isArray(normalized.nodes) ? normalized.nodes : [],
          Array.isArray(normalized.edges) ? normalized.edges : []
        );

        const active = diagramViews.views.find((v) => v.id === diagramViews.activeViewId) ?? diagramViews.views[0];
        const activeUi = normalizeView(active?.ui ?? storedView);
        const activeNodeLayoutById = active?.nodeLayoutById ?? {};

        const positionedNodes = (Array.isArray(normalized.nodes) ? normalized.nodes : []).map((n) =>
          applyNodeLayout(n, activeNodeLayoutById?.[n.id])
        );
        return {
          diagramId: diagram.id ?? null,
          diagramViews,
          metadata: {
            name: diagram.name ?? 'Untitled Diagram',
            description: diagram.metadata?.description ?? '',
            eaSnapshot: diagram.metadata?.eaSnapshot ?? null,
            createdAt: diagram.createdAt ?? nowIso(),
            updatedAt: diagram.updatedAt ?? nowIso()
          },
          // Phase D compat: mirror active view ui into state.view for existing selectors.
          view: activeUi,
          registry,
          registryError: get().registryError,
          validationErrors: validateDiagram({
            registry,
            nodes: positionedNodes,
            edges: Array.isArray(normalized.edges) ? normalized.edges : []
          }),
          lastModelingError: null,
          nodes: positionedNodes,
          edges: Array.isArray(normalized.edges) ? normalized.edges : [],
          selection: { nodes: [], edges: [] },
          snapGrid: SNAP_GRID,
          showGrid: true,
          dirty: false,
          history: { past: [], future: [] },
          armedHistory: null,
          clipboard: null
        };
      }),
    serialize: () => {
      const state = get();
      return {
        id: state.diagramId,
        name: state.metadata.name,
        nodes: (state.nodes ?? []).map(sanitizeNodeForSave),
        edges: (state.edges ?? []).map(sanitizeEdgeForSave),
        // Phase G: one logical model, many diagram views.
        activeViewId: state.diagramViews?.activeViewId ?? 'view-main',
        views: (state.diagramViews?.views ?? []).map((v) => ({
          id: v.id,
          name: v.name,
          nodeIds: Array.isArray(v.nodeIds) ? v.nodeIds : [],
          edgeIds: Array.isArray(v.edgeIds) ? v.edgeIds : [],
          nodeLayoutById: v.nodeLayoutById ?? {},
          ui: normalizeView(v.ui)
        })),
        metadata: {
          description: state.metadata.description,
          eaSnapshot: state.metadata.eaSnapshot ?? null,
          createdAt: state.metadata.createdAt,
          updatedAt: state.metadata.updatedAt
        }
      };
    },

    setActiveDiagramView: (viewId) => {
      const nextId = String(viewId ?? '').trim();
      if (!nextId) return;

      const state = get();
      const view = (state.diagramViews?.views ?? []).find((v) => v.id === nextId);
      if (!view) return;

      set((draft) => {
        draft.diagramViews.activeViewId = nextId;
        draft.view = normalizeView(view.ui);

        const layoutById = view.nodeLayoutById ?? {};
        draft.nodes = (draft.nodes ?? []).map((n) => applyNodeLayout(n, layoutById?.[n.id]));

        draft.selection = { nodes: [], edges: [] };
      });
    },

    createDiagramView: ({ name }) => {
      const baseName = String(name ?? '').trim() || 'New View';
      const id = `view-${crypto.randomUUID()}`;
      const state = get();
      const active = (state.diagramViews?.views ?? []).find((v) => v.id === state.diagramViews?.activeViewId) ?? (state.diagramViews?.views ?? [])[0];
      const nodeIds = Array.isArray(active?.nodeIds) ? active.nodeIds.slice() : (state.nodes ?? []).map((n) => n.id).filter(Boolean).slice().sort();
      const edgeIds = Array.isArray(active?.edgeIds) ? active.edgeIds.slice() : (state.edges ?? []).map((e) => e.id).filter(Boolean).slice().sort();
      const nodeLayoutById = clone(active?.nodeLayoutById ?? {});
      const ui = normalizeView(active?.ui ?? state.view);

      set((draft) => {
        draft.diagramViews.views = [...(draft.diagramViews.views ?? []), { id, name: baseName, nodeIds, edgeIds, nodeLayoutById, ui }];
        draft.diagramViews.activeViewId = id;
        draft.view = ui;
        // Apply layout snapshot into active node positions.
        draft.nodes = (draft.nodes ?? []).map((n) => applyNodeLayout(n, nodeLayoutById?.[n.id]));
      });
    },

    renameDiagramView: ({ viewId, name }) => {
      const id = String(viewId ?? '').trim();
      const nextName = String(name ?? '').trim();
      if (!id || !nextName) return;
      set((draft) => {
        draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) => (v.id === id ? { ...v, name: nextName } : v));
      });
    },

    deleteDiagramView: ({ viewId }) => {
      const id = String(viewId ?? '').trim();
      if (!id) return;
      const state = get();
      const views = state.diagramViews?.views ?? [];
      if (views.length <= 1) return;
      if (!views.some((v) => v.id === id)) return;

      const nextViews = views.filter((v) => v.id !== id);
      const nextActiveId = state.diagramViews?.activeViewId === id ? nextViews[0]?.id : state.diagramViews?.activeViewId;

      set((draft) => {
        draft.diagramViews.views = nextViews;
        draft.diagramViews.activeViewId = nextActiveId;
        const active = nextViews.find((v) => v.id === nextActiveId) ?? nextViews[0];
        draft.view = normalizeView(active?.ui);
        const layoutById = active?.nodeLayoutById ?? {};
        draft.nodes = (draft.nodes ?? []).map((n) => applyNodeLayout(n, layoutById?.[n.id]));
        draft.selection = { nodes: [], edges: [] };
      });
    },

    removeSelectionFromActiveView: () => {
      const state = get();
      const activeId = state.diagramViews?.activeViewId;
      const selectedNodeIds = new Set(state.selection?.nodes ?? []);
      const selectedEdgeIds = new Set(state.selection?.edges ?? []);
      if (!activeId || (!selectedNodeIds.size && !selectedEdgeIds.size)) return;

      set((draft) => {
        draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) => {
          if (v.id !== activeId) return v;
          const nodeIds = (v.nodeIds ?? []).filter((id) => !selectedNodeIds.has(id));
          const edgeIds = (v.edgeIds ?? []).filter((id) => !selectedEdgeIds.has(id));
          const nodeLayoutById = { ...(v.nodeLayoutById ?? {}) };
          for (const id of selectedNodeIds) delete nodeLayoutById[id];
          return { ...v, nodeIds, edgeIds, nodeLayoutById };
        });
        draft.selection = { nodes: [], edges: [] };
        applySelectionFlags(draft, draft.selection);
      });
    },

    importEaSnapshot: ({ snapshot, applications, dependencies, mode = 'replace' }) => {
      const registry = get().registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Component Type Registry is not loaded. Cannot import EA snapshot.';
        });
        return false;
      }

      const snapId = snapshot?.snapshotId ?? snapshot?.importId ?? null;
      const importedAt = snapshot?.importedAt ?? nowIso();
      if (!snapId) {
        set((draft) => {
          draft.lastModelingError = 'Invalid EA snapshot (missing snapshotId).';
        });
        return false;
      }

      if (!registry.componentTypesById?.has('app.application')) {
        set((draft) => {
          draft.lastModelingError = 'Missing Studio Application component type (app.application).';
        });
        return false;
      }

      const existingNodes = get().nodes ?? [];
      const existingEdges = get().edges ?? [];
      const existingEaNodesBySourceId = new Map(
        existingNodes
          .filter((n) => isEaBackedNode(n) && typeof n?.data?.metadata?.eaSourceId === 'string')
          .map((n) => [n.data.metadata.eaSourceId, n])
      );

      const nextEaNodes = (applications ?? [])
        .filter((app) => typeof app?.id === 'string' && app.id)
        .map((app, idx) => {
          const position = { x: 32 + (idx % 8) * 220, y: 32 + Math.floor(idx / 8) * 140 };
          const node = createComponentNode({ registry, componentTypeId: 'app.application', position });
          const stable = `ea.app.${safeId(app.id)}`;
          node.id = stable;
          node.data.attributes = {
            name: app.name ?? app.id,
            owner: app.owner ?? '',
            criticality: app.criticality ?? '',
            status: app.status ?? ''
          };
          const componentType = registry.componentTypesById.get(node.data.componentTypeId);
          node.data.title = computeComponentTitle(componentType, node.data.attributes);
          node.data.metadata = {
            ...(node.data.metadata ?? {}),
            createdAt: importedAt,
            updatedAt: importedAt,
            version: 1,
            source: EA_CORE_SOURCE,
            eaSourceId: app.id,
            eaSourceType: 'Application',
            eaSnapshotId: snapId,
            eaImportedAt: importedAt
          };

          const previous = existingEaNodesBySourceId.get(app.id);
          if (mode === 'replace' && previous) {
            node.position = previous.position ?? node.position;
            if (previous.width) node.width = previous.width;
            if (previous.height) node.height = previous.height;
            if (previous.parentNode) {
              node.parentNode = previous.parentNode;
              node.extent = previous.extent;
            }
          }

          return normalizeNode(registry, node);
        });

      const newNodeIdByAppId = new Map(
        nextEaNodes
          .filter((n) => typeof n?.data?.metadata?.eaSourceId === 'string')
          .map((n) => [n.data.metadata.eaSourceId, n.id])
      );

      const nextEaEdges = (dependencies ?? [])
        .filter((d) => typeof d?.sourceId === 'string' && typeof d?.targetId === 'string' && d.sourceId && d.targetId)
        .map((d) => {
          const source = newNodeIdByAppId.get(d.sourceId);
          const target = newNodeIdByAppId.get(d.targetId);
          if (!source || !target) return null;
          const signature = typeof d.signature === 'string' && d.signature ? d.signature : `${d.sourceId}|${d.targetId}|${d.dependency_type ?? ''}|${d.dependency_strength ?? ''}|${d.dependency_mode ?? ''}`;
          const edgeTypeId = 'rel.dependsOn';
          const edgeTypeVersion = resolveEdgeTypeVersion(registry, edgeTypeId);
          const edge = createRelationshipEdge({ edgeTypeId, edgeTypeVersion, source, target });
          edge.id = `ea.dep.${safeId(signature)}`;
          edge.data = {
            ...(edge.data ?? {}),
            dependency_type: d.dependency_type ?? null,
            dependency_strength: d.dependency_strength ?? null,
            dependency_mode: d.dependency_mode ?? null,
            signature
          };
          edge.data.metadata = {
            ...(edge.data.metadata ?? {}),
            createdAt: importedAt,
            updatedAt: importedAt,
            version: 1,
            source: EA_CORE_SOURCE,
            eaSourceId: signature,
            eaSourceType: 'Dependency',
            eaSnapshotId: snapId,
            eaImportedAt: importedAt
          };
          return normalizeEdge(edge);
        })
        .filter(Boolean);

      get()._pushHistory();
      set((draft) => {
        const keepNodes = (draft.nodes ?? []).filter((n) => !isEaBackedNode(n));
        const keepEdges = (draft.edges ?? []).filter((e) => !isEaBackedEdge(e));

        draft.nodes = [...keepNodes, ...nextEaNodes];
        draft.edges = [...keepEdges, ...nextEaEdges];

        draft.metadata.eaSnapshot = {
          eaCoreVersion: snapshot?.eaCoreVersion ?? null,
          eaCoreTimestamp: snapshot?.eaCoreTimestamp ?? null,
          importId: snapshot?.importId ?? snapId,
          snapshotId: snapId,
          importedAt
        };

        draft.selection = { nodes: [], edges: [] };
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });

      return true;
    },
    toggleViewLayer: (layerId) => {
      if (!layerId) return;
      set((draft) => {
        const currentUi = getActiveView(draft)?.ui ?? draft.view;
        const active = new Set(currentUi?.activeLayerIds ?? []);
        if (active.has(layerId)) active.delete(layerId);
        else active.add(layerId);
        upsertActiveViewUi(draft, {
          ...(currentUi ?? {}),
          activeLayerIds: Array.from(active).sort()
        });
      });
    },
    clearViewLayers: () =>
      set((draft) => {
        const currentUi = getActiveView(draft)?.ui ?? draft.view;
        upsertActiveViewUi(draft, {
          ...(currentUi ?? {}),
          activeLayerIds: []
        });
      }),
    toggleCollapsedContainer: (containerId) => {
      if (!containerId) return;
      set((draft) => {
        const currentUi = getActiveView(draft)?.ui ?? draft.view;
        const current = new Set(currentUi?.collapsedContainerIds ?? []);
        if (current.has(containerId)) current.delete(containerId);
        else current.add(containerId);
        upsertActiveViewUi(draft, {
          ...(currentUi ?? {}),
          collapsedContainerIds: Array.from(current).sort()
        });
      });
    },
    clearCollapsedContainers: () =>
      set((draft) => {
        const currentUi = getActiveView(draft)?.ui ?? draft.view;
        upsertActiveViewUi(draft, {
          ...(currentUi ?? {}),
          collapsedContainerIds: []
        });
      }),
    markClean: (diagramId, timestamps) =>
      set((draft) => {
        draft.diagramId = diagramId ?? draft.diagramId;
        if (timestamps?.createdAt) {
          draft.metadata.createdAt = timestamps.createdAt;
        }
        if (timestamps?.updatedAt) {
          draft.metadata.updatedAt = timestamps.updatedAt;
        } else {
          draft.metadata.updatedAt = nowIso();
        }
        draft.dirty = false;
        draft.history = { past: [], future: [] };
        draft.armedHistory = null;

        // Persist current view state under the (possibly new) diagram id.
        saveViewState(draft.diagramId, normalizeView(draft.view));
      }),
    setMetadata: (updates) =>
      set((draft) => {
        draft.metadata = {
          ...draft.metadata,
          ...updates,
          updatedAt: nowIso()
        };
        draft.dirty = true;

        // Phase H: diagram type drives validation and modeling enablement.
        if (updates && Object.prototype.hasOwnProperty.call(updates, 'diagramTypeId')) {
          draft.validationErrors = validateDiagram({
            registry: draft.registry,
            nodes: draft.nodes,
            edges: draft.edges,
            diagramTypeId: draft.metadata?.diagramTypeId
          });
        }
      }),
    onNodesChange: (changes) =>
      set((draft) => {
        const meaningful = hasMeaningfulNodeChanges(changes);
        if (meaningful) {
          draft.history.past.push(snapshot(get()));
          draft.history.future = [];
        }
        const registry = draft.registry;
        const currentNodes = draft.nodes;

        // Enforce template locks for movement/resizing.
        const lockedNodeIds = new Set(
          (currentNodes ?? [])
            .filter((n) => Boolean(n?.data?.metadata?.template?.locked) && !Boolean(n?.data?.metadata?.template?.overridesEnabled))
            .map((n) => n.id)
        );

        const eaLockedNodeIds = new Set((currentNodes ?? []).filter((n) => isEaBackedNode(n)).map((n) => n.id));

        const filteredChanges = Array.isArray(changes)
          ? changes.filter((change) => {
              if (!change?.id) return true;

              if (eaLockedNodeIds.has(change.id)) {
                if (change.type === 'remove') {
                  draft.lastModelingError = eaBackedMutationBlockedMessage();
                  return false;
                }
              }

              if (!lockedNodeIds.has(change.id)) return true;
              if (change.type === 'position' || change.type === 'dimensions') {
                draft.lastModelingError = 'Template instances are locked. Enable overrides to move/resize.';
                return false;
              }
              return true;
            })
          : changes;

        draft.nodes = applyNodeChanges(filteredChanges, draft.nodes);

        // Phase G: capture diagram-local layout updates into the active diagram view.
        if (Array.isArray(filteredChanges)) {
          const ids = filteredChanges
            .filter((c) => c && c.id && (c.type === 'position' || c.type === 'dimensions'))
            .map((c) => c.id);
          recordActiveViewLayouts(draft, ids);
        }

        if (registry) {
          draft.nodes = (draft.nodes ?? []).map((node) => normalizeNode(registry, node));
        }
        if (meaningful) {
          draft.dirty = true;
          draft.metadata.updatedAt = nowIso();
        }
        if (meaningful) {
          draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
        }
      }),
    onEdgesChange: (changes) =>
      set((draft) => {
        const meaningful = hasMeaningfulEdgeChanges(changes);
        if (meaningful) {
          draft.history.past.push(snapshot(get()));
          draft.history.future = [];
        }
        const currentEdges = draft.edges;
        const eaLockedEdgeIds = new Set((currentEdges ?? []).filter((e) => isEaBackedEdge(e)).map((e) => e.id));

        const filteredChanges = Array.isArray(changes)
          ? changes.filter((change) => {
              if (!change?.id) return true;
              if (eaLockedEdgeIds.has(change.id) && change.type === 'remove') {
                draft.lastModelingError = eaBackedMutationBlockedMessage();
                return false;
              }
              return true;
            })
          : changes;

        draft.edges = applyEdgeChanges(filteredChanges, draft.edges);
        draft.edges = (draft.edges ?? []).map((edge) => normalizeEdge(edge));
        if (meaningful) {
          draft.dirty = true;
          draft.metadata.updatedAt = nowIso();
          draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
        }
      }),
    beginConnect: ({ sourceNodeId }) => {
      const state = get();
      const diagramTypeId = state.metadata?.diagramTypeId;
      const allowed = computeAllowedTargetIds({ diagramTypeId, nodes: state.nodes, sourceId: sourceNodeId });
      set((draft) => {
        draft.connectMode = {
          active: true,
          sourceNodeId,
          allowedTargetIds: Array.from(allowed)
        };
      });
    },
    endConnect: () => {
      set((draft) => {
        draft.connectMode = { active: false, sourceNodeId: null, allowedTargetIds: [] };
      });
    },
    onConnect: (connection) => {
      const state = get();
      const registry = state.registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Component Type Registry is not loaded. Cannot create edges.';
        });
        return;
      }

      const diagramTypeId = state.metadata?.diagramTypeId;
      if (!diagramTypeId) {
        set((draft) => {
          draft.lastModelingError = 'Diagram type is not set. Select a diagram type to enable modeling.';
        });
        return;
      }

      const guided = resolveGuidedConnection({ diagramTypeId, nodes: state.nodes, sourceId: connection?.source, targetId: connection?.target });
      if (!guided) {
        set((draft) => {
          draft.lastModelingError = 'Invalid connection for this diagram type. Select a source node to highlight valid targets.';
        });
        return;
      }

      const edgeTypeId = guided.edgeTypeId;
      const edgeTypeVersion = resolveEdgeTypeVersion(registry, edgeTypeId);

      set((draft) => {
        draft.history.past.push(snapshot(get()));
        draft.history.future = [];
        const edge = createRelationshipEdge({ edgeTypeId, edgeTypeVersion, source: connection.source, target: connection.target });
        edge.label = computeGuidedEdgeLabel(edgeTypeId);
        draft.edges = addEdge(edge, draft.edges);

        // Add to active view membership.
        const active = getActiveView(draft);
        if (active) {
          const edgeIds = new Set(active.edgeIds ?? []);
          edgeIds.add(edge.id);
          const nodeIds = new Set(active.nodeIds ?? []);
          if (edge.source) nodeIds.add(edge.source);
          if (edge.target) nodeIds.add(edge.target);
          draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) =>
            v.id === active.id
              ? {
                  ...v,
                  edgeIds: Array.from(edgeIds).sort(),
                  nodeIds: Array.from(nodeIds).sort()
                }
              : v
          );
        }

        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },
    setSelection: (selection) =>
      set((draft) => {
        draft.selection = selection ?? { nodes: [], edges: [] };
      }),
    setSelectionEphemeral: (selection) =>
      set((draft) => {
        const normalized = selection ?? { nodes: [], edges: [] };
        draft.selection = normalized;
        applySelectionFlags(draft, normalized);
      }),
    updateNodes: (updater, options = {}) => {
      const mode = options.history ?? 'push';
      if (mode === 'push') {
        get()._pushHistory();
      }
      if (mode === 'armed') {
        get()._commitArmedHistory();
      }
      set((draft) => {
        draft.nodes = typeof updater === 'function' ? updater(draft.nodes) : updater;

        // Phase G: capture any layout changes written through updateNodes.
        const active = getActiveView(draft);
        if (active) {
          const nodeLayoutById = { ...(active.nodeLayoutById ?? {}) };
          for (const n of draft.nodes ?? []) {
            if (!n?.id) continue;
            if (!(active.nodeIds ?? []).includes(n.id)) continue;
            const layout = extractNodeLayout(n);
            if (layout) nodeLayoutById[n.id] = layout;
          }
          draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) => (v.id === active.id ? { ...v, nodeLayoutById } : v));
        }

        if (draft.registry) {
          draft.nodes = (draft.nodes ?? []).map((node) => normalizeNode(draft.registry, node));
        }
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },
    updateEdges: (updater, options = {}) => {
      const mode = options.history ?? 'push';
      if (mode === 'push') {
        get()._pushHistory();
      }
      if (mode === 'armed') {
        get()._commitArmedHistory();
      }
      set((draft) => {
        draft.edges = typeof updater === 'function' ? updater(draft.edges) : updater;
        draft.edges = (draft.edges ?? []).map((edge) => normalizeEdge(edge));
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },
    addComponentNode: ({ componentTypeId, position }) => {
      const registry = get().registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Component Type Registry is not loaded. Cannot create components.';
        });
        return;
      }

      if (!get().metadata?.diagramTypeId) {
        set((draft) => {
          draft.lastModelingError = 'Diagram type is not set. Select a diagram type to enable modeling.';
        });
        return;
      }
      try {
        const node = createComponentNode({ registry, componentTypeId, position });
        set((draft) => {
          draft.history.past.push(snapshot(get()));
          draft.history.future = [];
          draft.nodes = [...(draft.nodes ?? []), node];

          const active = getActiveView(draft);
          if (active) {
            const nodeIds = new Set(active.nodeIds ?? []);
            nodeIds.add(node.id);
            const nodeLayoutById = { ...(active.nodeLayoutById ?? {}) };
            nodeLayoutById[node.id] = extractNodeLayout(node);
            draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) =>
              v.id === active.id ? { ...v, nodeIds: Array.from(nodeIds).sort(), nodeLayoutById } : v
            );
          }

          draft.selection = { nodes: [node.id], edges: [] };
          draft.dirty = true;
          draft.metadata.updatedAt = nowIso();
          draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
        });
      } catch (error) {
        set((draft) => {
          draft.lastModelingError = String(error?.message ?? error);
        });
      }
    },
    addGroupNode: ({ groupTypeId, position }) => {
      const registry = get().registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Group Type Registry is not loaded. Cannot create groups.';
        });
        return;
      }

      if (!get().metadata?.diagramTypeId) {
        set((draft) => {
          draft.lastModelingError = 'Diagram type is not set. Select a diagram type to enable modeling.';
        });
        return;
      }
      try {
        const node = createGroupNode({ registry, groupTypeId, position });
        // Groups should not be connectable.
        node.connectable = false;
        set((draft) => {
          draft.history.past.push(snapshot(get()));
          draft.history.future = [];
          draft.nodes = [...(draft.nodes ?? []), node];

          const active = getActiveView(draft);
          if (active) {
            const nodeIds = new Set(active.nodeIds ?? []);
            nodeIds.add(node.id);
            const nodeLayoutById = { ...(active.nodeLayoutById ?? {}) };
            nodeLayoutById[node.id] = extractNodeLayout(node);
            draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) =>
              v.id === active.id ? { ...v, nodeIds: Array.from(nodeIds).sort(), nodeLayoutById } : v
            );
          }

          draft.selection = { nodes: [node.id], edges: [] };
          draft.dirty = true;
          draft.metadata.updatedAt = nowIso();
          draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
        });
      } catch (error) {
        set((draft) => {
          draft.lastModelingError = String(error?.message ?? error);
        });
      }
    },
    instantiateTemplate: ({ templateId, position }) => {
      const registry = get().registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Component Type Registry is not loaded. Cannot instantiate templates.';
        });
        return;
      }
      const template = registry.templatesById.get(templateId);
      if (!template) {
        set((draft) => {
          draft.lastModelingError = `Unknown template: ${templateId}`;
        });
        return;
      }

      const anchor = position ?? { x: 0, y: 0 };
      const idMap = new Map();
      const instanceId = crypto.randomUUID();

      const newNodes = (template.nodes ?? []).map((tNode) => {
        const node = createComponentNode({ registry, componentTypeId: tNode.componentTypeId, position: { x: anchor.x + (tNode.position?.x ?? 0), y: anchor.y + (tNode.position?.y ?? 0) } });
        node.data.attributes = { ...(node.data.attributes ?? {}), ...(tNode.attributes ?? {}) };
        const componentType = registry.componentTypesById.get(node.data.componentTypeId);
        node.data.title = computeComponentTitle(componentType, node.data.attributes);
        node.data.metadata.template = {
          templateId,
          templateVersion: template.version,
          instanceId,
          localId: tNode.localId,
          locked: true,
          overridesEnabled: false,
          overrides: {}
        };
        idMap.set(tNode.localId, node.id);
        return node;
      });

      const newEdges = (template.edges ?? []).map((tEdge) => {
        const source = idMap.get(tEdge.sourceLocalId);
        const target = idMap.get(tEdge.targetLocalId);
        const edgeTypeId = tEdge.edgeTypeId ?? 'rel.dependsOn';
        const edgeTypeVersion = resolveEdgeTypeVersion(registry, edgeTypeId);
        const edge = createRelationshipEdge({ edgeTypeId, edgeTypeVersion, source, target });
        edge.data.metadata.template = {
          templateId,
          templateVersion: template.version,
          instanceId,
          localId: tEdge.localId,
          locked: true,
          overridesEnabled: false,
          overrides: {}
        };
        return edge;
      });

      set((draft) => {
        draft.history.past.push(snapshot(get()));
        draft.history.future = [];
        draft.nodes = [...(draft.nodes ?? []), ...newNodes];
        draft.edges = [...(draft.edges ?? []), ...newEdges];

        const active = getActiveView(draft);
        if (active) {
          const nodeIds = new Set(active.nodeIds ?? []);
          const edgeIds = new Set(active.edgeIds ?? []);
          const nodeLayoutById = { ...(active.nodeLayoutById ?? {}) };
          for (const n of newNodes) {
            nodeIds.add(n.id);
            nodeLayoutById[n.id] = extractNodeLayout(n);
          }
          for (const e of newEdges) edgeIds.add(e.id);
          draft.diagramViews.views = (draft.diagramViews.views ?? []).map((v) =>
            v.id === active.id
              ? { ...v, nodeIds: Array.from(nodeIds).sort(), edgeIds: Array.from(edgeIds).sort(), nodeLayoutById }
              : v
          );
        }

        draft.selection = { nodes: newNodes.map((n) => n.id), edges: newEdges.map((e) => e.id) };
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },
    setEdgeType: ({ edgeId, edgeTypeId }) => {
      const state = get();
      const registry = state.registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Component Type Registry is not loaded. Cannot change edge type.';
        });
        return;
      }

      const edge = (state.edges ?? []).find((e) => e.id === edgeId);
      if (!edge) return;
      if (isEaBackedEdge(edge)) {
        set((draft) => {
          draft.lastModelingError = eaBackedMutationBlockedMessage();
        });
        return;
      }
      if (edge.data?.metadata?.template?.locked && !edge.data?.metadata?.template?.overridesEnabled) {
        set((draft) => {
          draft.lastModelingError = 'Template instances are locked. Enable overrides to edit edges.';
        });
        return;
      }

      if (!registry.edgeTypesById?.has(edgeTypeId)) {
        set((draft) => {
          draft.lastModelingError = `Unknown edge type (not in registry): ${edgeTypeId}`;
        });
        return;
      }

      const sourceNode = (state.nodes ?? []).find((n) => n.id === edge.source);
      const targetNode = (state.nodes ?? []).find((n) => n.id === edge.target);
      const sourceType = registry.componentTypesById.get(sourceNode?.data?.componentTypeId);
      const targetType = registry.componentTypesById.get(targetNode?.data?.componentTypeId);
      if (!sourceType || !targetType) {
        set((draft) => {
          draft.lastModelingError = 'Edges can only connect typed components.';
        });
        return;
      }

      // Directional compatibility, when declared.
      if ((sourceType.allowedChildTypes ?? []).length || (targetType.allowedParentTypes ?? []).length) {
        const ok = (sourceType.allowedChildTypes ?? []).includes(targetType.typeId) && (targetType.allowedParentTypes ?? []).includes(sourceType.typeId);
        if (!ok) {
          set((draft) => {
            draft.lastModelingError = `Invalid relationship: ${sourceType.displayName} cannot connect to ${targetType.displayName}.`;
          });
          return;
        }
      }

      const allowed = computeAllowedEdgeTypeIds(registry, sourceType, targetType);
      if (!allowed.includes(edgeTypeId)) {
        set((draft) => {
          draft.lastModelingError = `Edge type ${edgeTypeId} is not allowed between ${sourceType.displayName} and ${targetType.displayName}.`;
        });
        return;
      }

      const edgeTypeVersion = resolveEdgeTypeVersion(registry, edgeTypeId);
      get().updateEdges(
        (draft) =>
          (draft ?? []).map((e) => {
            if (e.id !== edgeId) return e;
            return {
              ...e,
              label: '',
              data: {
                ...(e.data ?? {}),
                edgeTypeId,
                edgeTypeVersion,
                metadata: {
                  ...(e.data?.metadata ?? {}),
                  updatedAt: nowIso()
                }
              }
            };
          }),
        { history: 'armed' }
      );
    },

    setEdgeDescription: ({ edgeId, description }) => {
      const edge = (get().edges ?? []).find((e) => e.id === edgeId);
      if (!edge) return;

      if (isEaBackedEdge(edge)) {
        set((draft) => {
          draft.lastModelingError = eaBackedMutationBlockedMessage();
        });
        return;
      }

      if (edge.data?.metadata?.template?.locked && !edge.data?.metadata?.template?.overridesEnabled) {
        set((draft) => {
          draft.lastModelingError = 'Template instances are locked. Enable overrides to edit edges.';
        });
        return;
      }

      get().updateEdges(
        (draft) =>
          (draft ?? []).map((e) => {
            if (e.id !== edgeId) return e;
            return {
              ...e,
              data: {
                ...(e.data ?? {}),
                description: description ?? ''
              }
            };
          }),
        { history: 'armed' }
      );
    },
    setNodeAttribute: ({ nodeId, key, value }) => {
      const registry = get().registry;
      const node = (get().nodes ?? []).find((n) => n.id === nodeId);
      if (!node) return;

      if (isEaBackedNode(node)) {
        set((draft) => {
          draft.lastModelingError = eaBackedMutationBlockedMessage();
        });
        return;
      }

      if (node.data?.metadata?.template?.locked && !node.data?.metadata?.template?.overridesEnabled) {
        set((draft) => {
          draft.lastModelingError = 'Template instances are locked. Enable overrides to edit attributes.';
        });
        return;
      }
      get().updateNodes(
        (draft) =>
          (draft ?? []).map((n) => {
            if (n.id !== nodeId) return n;
            const attributes = { ...(n.data?.attributes ?? {}), [key]: value };
            const template = n.data?.metadata?.template;
            const templateMeta = template
              ? {
                  ...template,
                  overrides: {
                    ...(template.overrides ?? {}),
                    attributes: {
                      ...((template.overrides ?? {}).attributes ?? {}),
                      [key]: value
                    }
                  }
                }
              : undefined;

            if (n.type === 'group' || n.data?.kind === 'group') {
              return {
                ...n,
                data: {
                  ...n.data,
                  attributes,
                  metadata: {
                    ...(n.data?.metadata ?? {}),
                    updatedAt: nowIso(),
                    template: templateMeta
                  }
                }
              };
            }

            const componentType = registry?.componentTypesById?.get(n.data?.componentTypeId);
            return {
              ...n,
              data: {
                ...n.data,
                attributes,
                title: computeComponentTitle(componentType, attributes),
                metadata: {
                  ...(n.data?.metadata ?? {}),
                  updatedAt: nowIso(),
                  template: templateMeta
                }
              }
            };
          }),
        { history: 'armed' }
      );
    },
    enableTemplateOverridesForSelection: () => {
      const state = get();
      const nodeIds = new Set(state.selection?.nodes ?? []);
      const edgeIds = new Set(state.selection?.edges ?? []);
      if (nodeIds.size === 0 && edgeIds.size === 0) return;
      get()._pushHistory();
      set((draft) => {
        draft.nodes = (draft.nodes ?? []).map((n) => {
          if (!nodeIds.has(n.id)) return n;
          if (!n.data?.metadata?.template?.locked) return n;
          return {
            ...n,
            data: {
              ...n.data,
              metadata: {
                ...n.data.metadata,
                template: {
                  ...n.data.metadata.template,
                  overridesEnabled: true
                }
              }
            }
          };
        });
        draft.edges = (draft.edges ?? []).map((e) => {
          if (!edgeIds.has(e.id)) return e;
          if (!e.data?.metadata?.template?.locked) return e;
          return {
            ...e,
            data: {
              ...e.data,
              metadata: {
                ...e.data.metadata,
                template: {
                  ...e.data.metadata.template,
                  overridesEnabled: true
                }
              }
            }
          };
        });
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },
    setParentGroup: ({ nodeId, parentGroupId, nextPosition }) => {
      const state = get();
      const registry = state.registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Registry not loaded. Cannot change grouping.';
        });
        return false;
      }

      const node = (state.nodes ?? []).find((n) => n.id === nodeId);
      if (!node) return false;

      const parent = parentGroupId ? (state.nodes ?? []).find((n) => n.id === parentGroupId) : null;
      if (parentGroupId && (!parent || parent.type !== 'group' || parent.data?.kind !== 'group')) {
        set((draft) => {
          draft.lastModelingError = 'Invalid parent. Only groups can contain elements.';
        });
        return false;
      }

      if (parent) {
        const parentGroupType = registry.groupTypesById.get(parent.data.groupTypeId);
        if (!parentGroupType) {
          set((draft) => {
            draft.lastModelingError = 'Parent group has unknown groupTypeId.';
          });
          return false;
        }

        if (node.type === 'group' || node.data?.kind === 'group') {
          const childGroupTypeId = node.data?.groupTypeId;
          const childGroupType = registry.groupTypesById.get(childGroupTypeId);
          const allowedByParent = (parentGroupType.allowedChildGroupTypes ?? []).includes(childGroupTypeId);
          const allowedByChild = childGroupType ? (childGroupType.allowedParentGroupTypes ?? []).includes(parent.data.groupTypeId) : false;
          if (!allowedByParent || !allowedByChild) {
            set((draft) => {
              draft.lastModelingError = `Invalid nesting: ${parentGroupType.displayName} cannot contain ${childGroupType?.displayName ?? childGroupTypeId}.`;
            });
            return false;
          }
        } else {
          const componentTypeId = node.data?.componentTypeId;
          const allowed = (parentGroupType.allowedChildComponentTypes ?? []).includes(componentTypeId);
          if (!allowed) {
            set((draft) => {
              draft.lastModelingError = `Invalid nesting: ${parentGroupType.displayName} cannot contain component type ${componentTypeId}.`;
            });
            return false;
          }
        }
      }

      get()._pushHistory();
      set((draft) => {
        draft.nodes = (draft.nodes ?? []).map((n) => {
          if (n.id !== nodeId) return n;
          if (!parentGroupId) {
            const { parentNode, extent, ...rest } = n;
            return {
              ...rest,
              position: nextPosition && typeof nextPosition.x === 'number' && typeof nextPosition.y === 'number' ? nextPosition : rest.position
            };
          }
          return {
            ...n,
            parentNode: parentGroupId,
            extent: 'parent',
            position: nextPosition && typeof nextPosition.x === 'number' && typeof nextPosition.y === 'number' ? nextPosition : n.position
          };
        });
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
      return true;
    },
    deleteSelection: () => {
      const state = get();
      const nodeIds = new Set(state.selection?.nodes ?? []);
      const edgeIds = new Set(state.selection?.edges ?? []);
      if (nodeIds.size === 0 && edgeIds.size === 0) return;

      const eaNodes = (state.nodes ?? []).filter((n) => nodeIds.has(n.id) && isEaBackedNode(n));
      const eaEdges = (state.edges ?? []).filter((e) => edgeIds.has(e.id) && isEaBackedEdge(e));
      if (eaNodes.length || eaEdges.length) {
        set((draft) => {
          draft.lastModelingError = eaBackedMutationBlockedMessage();
        });
        return;
      }

      const lockedNodes = (state.nodes ?? []).filter(
        (n) => nodeIds.has(n.id) && Boolean(n?.data?.metadata?.template?.locked) && !Boolean(n?.data?.metadata?.template?.overridesEnabled)
      );
      const lockedEdges = (state.edges ?? []).filter(
        (e) => edgeIds.has(e.id) && Boolean(e?.data?.metadata?.template?.locked) && !Boolean(e?.data?.metadata?.template?.overridesEnabled)
      );
      if (lockedNodes.length || lockedEdges.length) {
        set((draft) => {
          draft.lastModelingError = 'Template instances are locked. Enable overrides to delete template elements.';
        });
        return;
      }

      get()._pushHistory();
      set((draft) => {
        draft.nodes = (draft.nodes ?? []).filter((node) => !nodeIds.has(node.id));
        draft.edges = (draft.edges ?? []).filter((edge) => {
          if (edgeIds.has(edge.id)) return false;
          if (nodeIds.has(edge.source) || nodeIds.has(edge.target)) return false;
          return true;
        });
        draft.selection = { nodes: [], edges: [] };
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },

    deleteSelectionFromModel: () => {
      // Explicit destructive delete (model-level). Use removeSelectionFromActiveView for diagram-only removal.
      get().deleteSelection();
    },

    nudgeSelection: ({ dx, dy }) => {
      const state = get();
      const nodeIds = new Set(state.selection?.nodes ?? []);
      if (nodeIds.size === 0) return;
      const deltaX = Number(dx ?? 0);
      const deltaY = Number(dy ?? 0);
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
      if (deltaX === 0 && deltaY === 0) return;

      const locked = (state.nodes ?? []).some(
        (n) =>
          nodeIds.has(n.id) &&
          (isEaBackedNode(n) || (Boolean(n?.data?.metadata?.template?.locked) && !Boolean(n?.data?.metadata?.template?.overridesEnabled)))
      );
      if (locked) {
        set((draft) => {
          draft.lastModelingError = 'Selection contains locked elements; cannot nudge.';
        });
        return;
      }

      // Deterministic undo: one history entry per nudge burst.
      get()._pushHistory();
      set((draft) => {
        draft.nodes = (draft.nodes ?? []).map((n) => {
          if (!nodeIds.has(n.id)) return n;
          return {
            ...n,
            position: {
              x: (n.position?.x ?? 0) + deltaX,
              y: (n.position?.y ?? 0) + deltaY
            }
          };
        });
        recordActiveViewLayouts(draft, Array.from(nodeIds));
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      });
    },

    alignSelection: ({ mode }) => {
      const state = get();
      const nodeIds = new Set(state.selection?.nodes ?? []);
      if (nodeIds.size < 2) return;

      const nodes = (state.nodes ?? []).filter((n) => nodeIds.has(n.id));
      const locked = nodes.some(
        (n) => isEaBackedNode(n) || (Boolean(n?.data?.metadata?.template?.locked) && !Boolean(n?.data?.metadata?.template?.overridesEnabled))
      );
      if (locked) {
        set((draft) => {
          draft.lastModelingError = 'Selection contains locked elements; cannot align.';
        });
        return;
      }

      const boxes = nodes.map((n) => {
        const w = Number(n.width ?? n.measured?.width ?? 160);
        const h = Number(n.height ?? n.measured?.height ?? 92);
        const x = Number(n.position?.x ?? 0);
        const y = Number(n.position?.y ?? 0);
        return { id: n.id, x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
      });

      const minX = Math.min(...boxes.map((b) => b.x));
      const maxR = Math.max(...boxes.map((b) => b.r));
      const minY = Math.min(...boxes.map((b) => b.y));
      const maxB = Math.max(...boxes.map((b) => b.b));
      const midX = (Math.min(...boxes.map((b) => b.cx)) + Math.max(...boxes.map((b) => b.cx))) / 2;
      const midY = (Math.min(...boxes.map((b) => b.cy)) + Math.max(...boxes.map((b) => b.cy))) / 2;

      const compute = (b) => {
        if (mode === 'left') return { x: minX, y: b.y };
        if (mode === 'right') return { x: maxR - b.w, y: b.y };
        if (mode === 'top') return { x: b.x, y: minY };
        if (mode === 'bottom') return { x: b.x, y: maxB - b.h };
        if (mode === 'hcenter') return { x: midX - b.w / 2, y: b.y };
        if (mode === 'vcenter') return { x: b.x, y: midY - b.h / 2 };
        return null;
      };

      get()._pushHistory();
      set((draft) => {
        const byId = new Map(boxes.map((b) => [b.id, b]));
        draft.nodes = (draft.nodes ?? []).map((n) => {
          const b = byId.get(n.id);
          if (!b) return n;
          const next = compute(b);
          if (!next) return n;
          return { ...n, position: { x: next.x, y: next.y } };
        });
        recordActiveViewLayouts(draft, Array.from(nodeIds));
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      });
    },

    distributeSelection: ({ mode }) => {
      const state = get();
      const nodeIds = new Set(state.selection?.nodes ?? []);
      if (nodeIds.size < 3) return;

      const nodes = (state.nodes ?? []).filter((n) => nodeIds.has(n.id));
      const locked = nodes.some(
        (n) => isEaBackedNode(n) || (Boolean(n?.data?.metadata?.template?.locked) && !Boolean(n?.data?.metadata?.template?.overridesEnabled))
      );
      if (locked) {
        set((draft) => {
          draft.lastModelingError = 'Selection contains locked elements; cannot distribute.';
        });
        return;
      }

      const boxes = nodes
        .map((n) => {
          const w = Number(n.width ?? n.measured?.width ?? 160);
          const h = Number(n.height ?? n.measured?.height ?? 92);
          const x = Number(n.position?.x ?? 0);
          const y = Number(n.position?.y ?? 0);
          return { id: n.id, x, y, w, h, r: x + w, b: y + h };
        })
        .sort((a, b) => (mode === 'horizontal' ? a.x - b.x : a.y - b.y));

      if (mode === 'horizontal') {
        const left = boxes[0];
        const right = boxes[boxes.length - 1];
        const span = (right.x - left.x);
        const step = span / (boxes.length - 1);
        get()._pushHistory();
        set((draft) => {
          const targets = new Map();
          boxes.forEach((b, idx) => targets.set(b.id, { x: left.x + step * idx, y: b.y }));
          draft.nodes = (draft.nodes ?? []).map((n) => {
            const t = targets.get(n.id);
            if (!t) return n;
            return { ...n, position: { x: t.x, y: t.y } };
          });
          recordActiveViewLayouts(draft, Array.from(nodeIds));
          draft.dirty = true;
          draft.metadata.updatedAt = nowIso();
        });
        return;
      }

      if (mode === 'vertical') {
        const top = boxes[0];
        const bottom = boxes[boxes.length - 1];
        const span = (bottom.y - top.y);
        const step = span / (boxes.length - 1);
        get()._pushHistory();
        set((draft) => {
          const targets = new Map();
          boxes.forEach((b, idx) => targets.set(b.id, { x: b.x, y: top.y + step * idx }));
          draft.nodes = (draft.nodes ?? []).map((n) => {
            const t = targets.get(n.id);
            if (!t) return n;
            return { ...n, position: { x: t.x, y: t.y } };
          });
          recordActiveViewLayouts(draft, Array.from(nodeIds));
          draft.dirty = true;
          draft.metadata.updatedAt = nowIso();
        });
      }
    },
    copySelection: () => {
      const state = get();
      const selectedNodeIds = new Set(state.selection?.nodes ?? []);
      const selectedEdgeIds = new Set(state.selection?.edges ?? []);
      if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

      const eaNodes = (state.nodes ?? []).filter((n) => selectedNodeIds.has(n.id) && isEaBackedNode(n));
      const eaEdges = (state.edges ?? []).filter((e) => selectedEdgeIds.has(e.id) && isEaBackedEdge(e));
      if (eaNodes.length || eaEdges.length) {
        set((draft) => {
          draft.lastModelingError = 'EA Core elements cannot be copied. Import a snapshot instead.';
        });
        return;
      }

      const nodes = (state.nodes ?? []).filter((node) => selectedNodeIds.has(node.id));
      const edgesBetweenSelectedNodes = (state.edges ?? []).filter(
        (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
      );
      const edges = (state.edges ?? []).filter((edge) => selectedEdgeIds.has(edge.id));

      const mergedEdges = [...edgesBetweenSelectedNodes, ...edges].reduce((acc, edge) => {
        if (!acc.some((item) => item.id === edge.id)) acc.push(edge);
        return acc;
      }, []);

      set((draft) => {
        draft.clipboard = {
          nodes: clone(nodes),
          edges: clone(mergedEdges)
        };
      });
    },
    pasteClipboard: (anchorPosition) => {
      const state = get();
      const clipboard = state.clipboard;
      if (!clipboard?.nodes?.length && !clipboard?.edges?.length) return;

      const registry = state.registry;
      if (!registry || registry.status !== 'ready') {
        set((draft) => {
          draft.lastModelingError = 'Component Type Registry is not loaded. Cannot paste.';
        });
        return;
      }

      const baseOffset = { x: 40, y: 40 };
      const anchor = anchorPosition && typeof anchorPosition.x === 'number' && typeof anchorPosition.y === 'number' ? anchorPosition : null;

      const sourceNodes = clipboard.nodes ?? [];
      const sourceEdges = clipboard.edges ?? [];

      const minX = sourceNodes.length ? Math.min(...sourceNodes.map((node) => node.position?.x ?? 0)) : 0;
      const minY = sourceNodes.length ? Math.min(...sourceNodes.map((node) => node.position?.y ?? 0)) : 0;
      const offset = anchor
        ? { x: anchor.x - minX + 12, y: anchor.y - minY + 12 }
        : baseOffset;

      const idMap = new Map();
      const newNodes = sourceNodes.map((node) => {
        const newId = `node-${crypto.randomUUID()}`;
        idMap.set(node.id, newId);
        const cloned = {
          ...clone(node),
          id: newId,
          position: {
            x: (node.position?.x ?? 0) + offset.x,
            y: (node.position?.y ?? 0) + offset.y
          },
          selected: true
        };
        // Drop parent relationships during paste (explicit grouping is enforced separately).
        delete cloned.parentNode;
        delete cloned.extent;
        return normalizeNode(registry, cloned);
      });

      // Hard fail: do not allow paste to introduce version-missing typed elements.
      for (const node of newNodes) {
        const kind = node?.data?.kind;
        if (kind === 'component') {
          if (node.data?.componentTypeVersion === undefined || node.data?.componentTypeVersion === null) {
            set((draft) => {
              draft.lastModelingError = 'Cannot paste component missing componentTypeVersion.';
            });
            return;
          }
        }
        if (kind === 'group') {
          if (node.data?.groupTypeVersion === undefined || node.data?.groupTypeVersion === null) {
            set((draft) => {
              draft.lastModelingError = 'Cannot paste group missing groupTypeVersion.';
            });
            return;
          }
        }
      }

      const newEdges = sourceEdges
        .map((edge) => {
          const source = idMap.get(edge.source) ?? edge.source;
          const target = idMap.get(edge.target) ?? edge.target;
          if (!idMap.has(edge.source) || !idMap.has(edge.target)) {
            return null;
          }
          return normalizeEdge({
            ...clone(edge),
            id: `edge-${crypto.randomUUID()}`,
            source,
            target,
            selected: true
          });
        })
        .filter(Boolean);

      // Hard fail: do not allow paste to introduce invalid or unknown edge types.
      const newNodeById = new Map(newNodes.map((n) => [n.id, n]));
      for (const edge of newEdges) {
        const edgeTypeId = edge?.data?.edgeTypeId;
        if (!edgeTypeId || !registry.edgeTypesById?.has(edgeTypeId)) {
          set((draft) => {
            draft.lastModelingError = `Cannot paste edge with unknown edgeTypeId: ${edgeTypeId ?? '(missing)'}.`;
          });
          return;
        }
        if (edge?.data?.edgeTypeVersion === undefined || edge?.data?.edgeTypeVersion === null) {
          set((draft) => {
            draft.lastModelingError = `Cannot paste edge missing edgeTypeVersion for ${edgeTypeId}.`;
          });
          return;
        }

        const sourceNode = newNodeById.get(edge.source);
        const targetNode = newNodeById.get(edge.target);
        const sourceType = registry.componentTypesById.get(sourceNode?.data?.componentTypeId);
        const targetType = registry.componentTypesById.get(targetNode?.data?.componentTypeId);
        if (!sourceType || !targetType) {
          set((draft) => {
            draft.lastModelingError = 'Cannot paste edge: endpoints must be typed components.';
          });
          return;
        }

        if ((sourceType.allowedChildTypes ?? []).length || (targetType.allowedParentTypes ?? []).length) {
          const ok = (sourceType.allowedChildTypes ?? []).includes(targetType.typeId) && (targetType.allowedParentTypes ?? []).includes(sourceType.typeId);
          if (!ok) {
            set((draft) => {
              draft.lastModelingError = `Cannot paste edge: ${sourceType.displayName} cannot connect to ${targetType.displayName}.`;
            });
            return;
          }
        }

        const allowed = computeAllowedEdgeTypeIds(registry, sourceType, targetType);
        if (!allowed.includes(edgeTypeId)) {
          set((draft) => {
            draft.lastModelingError = `Cannot paste edge: edge type ${edgeTypeId} is not allowed between ${sourceType.displayName} and ${targetType.displayName}.`;
          });
          return;
        }
      }

      get()._pushHistory();
      set((draft) => {
        draft.nodes = [...(draft.nodes ?? []), ...newNodes];
        draft.edges = [...(draft.edges ?? []), ...newEdges];
        draft.selection = { nodes: newNodes.map((n) => n.id), edges: newEdges.map((e) => e.id) };
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
        draft.validationErrors = validateDiagram({ registry: draft.registry, nodes: draft.nodes, edges: draft.edges, diagramTypeId: draft.metadata?.diagramTypeId });
      });
    },
    selectAll: () => {
      const state = get();
      const selection = {
        nodes: (state.nodes ?? []).map((node) => node.id),
        edges: (state.edges ?? []).map((edge) => edge.id)
      };
      set((draft) => {
        draft.selection = selection;
        applySelectionFlags(draft, selection);
      });
    }
  }))
);

export function getInitialNode(position = { x: 0, y: 0 }) {
  throw new Error('getInitialNode has been removed. Components must be created from the Component Type Registry.');
}
