import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { addEdge, applyEdgeChanges, applyNodeChanges } from 'reactflow';

const SNAP_GRID = [16, 16];

function nowIso() {
  return new Date().toISOString();
}

const initialState = {
  diagramId: null,
  metadata: {
    name: 'Untitled Diagram',
    description: '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  nodes: [],
  edges: [],
  selection: {
    nodes: [],
    edges: []
  },
  snapGrid: SNAP_GRID,
  dirty: false
};

export const useStudioStore = create(
  immer((set, get) => ({
    ...initialState,
    reset: () =>
      set(() => ({
        ...initialState,
        metadata: {
          ...initialState.metadata,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      })),
    loadDiagram: (diagram) =>
      set(() => {
        if (!diagram) {
          return { ...initialState };
        }
        return {
          diagramId: diagram.id ?? null,
          metadata: {
            name: diagram.name ?? 'Untitled Diagram',
            description: diagram.metadata?.description ?? '',
            createdAt: diagram.createdAt ?? nowIso(),
            updatedAt: diagram.updatedAt ?? nowIso()
          },
          nodes: Array.isArray(diagram.nodes) ? diagram.nodes : [],
          edges: Array.isArray(diagram.edges) ? diagram.edges : [],
          selection: { nodes: [], edges: [] },
          snapGrid: SNAP_GRID,
          dirty: false
        };
      }),
    serialize: () => {
      const state = get();
      return {
        id: state.diagramId,
        name: state.metadata.name,
        nodes: state.nodes,
        edges: state.edges,
        metadata: {
          description: state.metadata.description,
          createdAt: state.metadata.createdAt,
          updatedAt: state.metadata.updatedAt
        }
      };
    },
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
      }),
    setMetadata: (updates) =>
      set((draft) => {
        draft.metadata = {
          ...draft.metadata,
          ...updates,
          updatedAt: nowIso()
        };
        draft.dirty = true;
      }),
    onNodesChange: (changes) =>
      set((draft) => {
        draft.nodes = applyNodeChanges(changes, draft.nodes);
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      }),
    onEdgesChange: (changes) =>
      set((draft) => {
        draft.edges = applyEdgeChanges(changes, draft.edges);
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      }),
    onConnect: (connection) =>
      set((draft) => {
        draft.edges = addEdge(
          {
            ...connection,
            type: connection.type ?? 'default',
            label: connection.label ?? ''
          },
          draft.edges
        );
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      }),
    setSelection: (selection) =>
      set((draft) => {
        draft.selection = selection ?? { nodes: [], edges: [] };
      }),
    updateNodes: (updater) =>
      set((draft) => {
        draft.nodes = typeof updater === 'function' ? updater(draft.nodes) : updater;
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      }),
    updateEdges: (updater) =>
      set((draft) => {
        draft.edges = typeof updater === 'function' ? updater(draft.edges) : updater;
        draft.dirty = true;
        draft.metadata.updatedAt = nowIso();
      })
  }))
);

export function getInitialNode(position = { x: 0, y: 0 }) {
  return {
    id: `node-${crypto.randomUUID()}`,
    type: 'generic',
    position,
    data: {
      label: 'New Node'
    },
    width: 180,
    height: 120
  };
}
