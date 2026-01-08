function safeSet(values) {
  return new Set(Array.isArray(values) ? values.filter(Boolean) : []);
}

function isEaDependencyEdge(edge) {
  return Boolean(
    edge &&
      edge.source &&
      edge.target &&
      edge.data?.metadata?.source === 'EA_CORE' &&
      edge.data?.metadata?.eaSourceType === 'Dependency'
  );
}

function normalizeDepth(value) {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

function normalizeDirection(value) {
  return value === 'upstream' ? 'upstream' : 'downstream';
}

/**
 * Deterministic, explainable, read-only traversal over EA-derived dependency edges.
 *
 * Semantics:
 * - `downstream`: follow the EA edge direction (source → target)
 * - `upstream`: follow the reverse direction (target → source)
 */
export function computeImpactAnalysis({ nodes, edges, selectedNodeIds, direction, maxDepth }) {
  const depthLimit = normalizeDepth(maxDepth);
  const dir = normalizeDirection(direction);
  const startIds = Array.from(safeSet(selectedNodeIds)).sort();

  const nodeIdSet = new Set((Array.isArray(nodes) ? nodes : []).map((n) => n?.id).filter(Boolean));

  const eaEdges = (Array.isArray(edges) ? edges : []).filter(isEaDependencyEdge);

  // Build adjacency in the chosen direction.
  const adjacency = new Map();
  const addAdj = (from, to) => {
    if (!from || !to) return;
    if (!nodeIdSet.has(from) || !nodeIdSet.has(to)) return;
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  };

  for (const e of eaEdges) {
    const from = dir === 'downstream' ? e.source : e.target;
    const to = dir === 'downstream' ? e.target : e.source;
    addAdj(from, to);
  }

  for (const [k, v] of adjacency.entries()) {
    v.sort();
    adjacency.set(k, v);
  }

  const depthByNodeId = new Map();
  const queue = [];

  for (const id of startIds) {
    if (!nodeIdSet.has(id)) continue;
    if (depthByNodeId.has(id)) continue;
    depthByNodeId.set(id, 0);
    queue.push(id);
  }

  // BFS with stable FIFO order; neighbors are sorted.
  for (let i = 0; i < queue.length; i += 1) {
    const currentId = queue[i];
    const d = depthByNodeId.get(currentId);
    if (typeof d !== 'number') continue;
    if (d >= depthLimit) continue;

    const neighbors = adjacency.get(currentId) ?? [];
    for (const nextId of neighbors) {
      if (!nodeIdSet.has(nextId)) continue;
      const nextDepth = d + 1;
      const existing = depthByNodeId.get(nextId);
      if (typeof existing === 'number' && existing <= nextDepth) continue;
      depthByNodeId.set(nextId, nextDepth);
      queue.push(nextId);
    }
  }

  const impactedNodeIds = new Set(depthByNodeId.keys());

  // Edges that are on a shortest-path frontier in the chosen direction.
  const impactedEdgeIds = new Set();
  for (const e of eaEdges) {
    const from = dir === 'downstream' ? e.source : e.target;
    const to = dir === 'downstream' ? e.target : e.source;
    const fromDepth = depthByNodeId.get(from);
    const toDepth = depthByNodeId.get(to);
    if (typeof fromDepth !== 'number' || typeof toDepth !== 'number') continue;
    if (toDepth === fromDepth + 1 && fromDepth < depthLimit) {
      impactedEdgeIds.add(e.id);
    }
  }

  // Risk concentration indicators (computed, not configured; no persistence).
  const inDegreeByNodeId = new Map();
  const outDegreeByNodeId = new Map();

  const inc = (map, id) => {
    map.set(id, (map.get(id) ?? 0) + 1);
  };

  for (const id of impactedNodeIds) {
    inDegreeByNodeId.set(id, 0);
    outDegreeByNodeId.set(id, 0);
  }

  for (const e of eaEdges) {
    if (!impactedNodeIds.has(e.source) || !impactedNodeIds.has(e.target)) continue;
    inc(outDegreeByNodeId, e.source);
    inc(inDegreeByNodeId, e.target);
  }

  let maxFanIn = 0;
  let maxFanOut = 0;
  for (const id of impactedNodeIds) {
    maxFanIn = Math.max(maxFanIn, inDegreeByNodeId.get(id) ?? 0);
    maxFanOut = Math.max(maxFanOut, outDegreeByNodeId.get(id) ?? 0);
  }

  const highFanInNodeIds = new Set();
  const highFanOutNodeIds = new Set();
  if (maxFanIn > 0) {
    for (const id of impactedNodeIds) {
      if ((inDegreeByNodeId.get(id) ?? 0) === maxFanIn) highFanInNodeIds.add(id);
    }
  }
  if (maxFanOut > 0) {
    for (const id of impactedNodeIds) {
      if ((outDegreeByNodeId.get(id) ?? 0) === maxFanOut) highFanOutNodeIds.add(id);
    }
  }

  const chainNodeIds = new Set();
  for (const id of impactedNodeIds) {
    const inD = inDegreeByNodeId.get(id) ?? 0;
    const outD = outDegreeByNodeId.get(id) ?? 0;
    if (inD === 1 && outD === 1) chainNodeIds.add(id);
  }

  return {
    direction: dir,
    depthLimit,
    startNodeIds: startIds,
    impactedNodeIds,
    impactedEdgeIds,
    depthByNodeId,
    indicators: {
      inDegreeByNodeId,
      outDegreeByNodeId,
      maxFanIn,
      maxFanOut,
      highFanInNodeIds,
      highFanOutNodeIds,
      chainNodeIds
    }
  };
}
