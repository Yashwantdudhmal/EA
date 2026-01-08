import { query } from './neo4j.js';

const CRITICALITY_PRIORITY = ['critical', 'high', 'medium', 'low'];
const RETIRING_STATUSES = new Set(['retiring', 'sunsetting', 'planned-retirement', 'decommissioning']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function criticalityScore(value) {
  const idx = CRITICALITY_PRIORITY.indexOf(normalizeLower(value));
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

function isRetiringStatus(value) {
  return RETIRING_STATUSES.has(normalizeLower(value));
}

function formatDependencyLabel(relProps = {}) {
  const type = normalizeString(relProps.dependency_type);
  const strength = normalizeString(relProps.dependency_strength);
  const mode = normalizeString(relProps.dependency_mode);

  const qualifiers = [strength, mode].filter(Boolean).join(' / ');
  if (type && qualifiers) return `${type} (${qualifiers})`;
  if (type) return type;
  if (qualifiers) return `(${qualifiers})`;
  return '';
}

function nodeToApplication(node) {
  const props = node?.properties ?? {};
  return {
    id: props.id ?? null,
    name: props.name ?? null,
    owner: props.owner ?? null,
    criticality: props.criticality ?? null,
    status: props.status ?? null
  };
}

export async function getAllApplications() {
  const records = await query(`
    MATCH (a:Application)
    RETURN a
    ORDER BY toLower(coalesce(a.name, a.id))
  `);

  return records
    .map((r) => nodeToApplication(r.get('a')))
    .filter((a) => a?.id);
}

export async function searchApplications({ text, criticality, status } = {}) {
  const records = await query(
    `
    MATCH (a:Application)
    WHERE (
      $text IS NULL OR $text = '' OR toLower(coalesce(a.name, '')) CONTAINS toLower($text)
    )
    AND (
      $criticality IS NULL OR $criticality = '' OR a.criticality = $criticality
    )
    AND (
      $status IS NULL OR $status = '' OR a.status = $status
    )
    RETURN a
    ORDER BY toLower(coalesce(a.name, a.id))
    `,
    {
      text: text ?? null,
      criticality: criticality ?? null,
      status: status ?? null
    }
  );

  return records
    .map((r) => nodeToApplication(r.get('a')))
    .filter((a) => a?.id);
}

export async function getDependencyGraph() {
  const records = await query(`
    MATCH (a:Application)
    OPTIONAL MATCH (a)-[r:DEPENDS_ON]->(b:Application)
    RETURN a, r, b
  `);

  const nodes = new Map();
  const edges = [];

  for (const record of records) {
    const a = record.get('a');
    const b = record.get('b');
    const r = record.get('r');

    if (a && a.properties?.id && !nodes.has(a.properties.id)) {
      nodes.set(a.properties.id, {
        data: {
          id: a.properties.id,
          label: a.properties.name ?? a.properties.id
        }
      });
    }

    if (b && b.properties?.id && !nodes.has(b.properties.id)) {
      nodes.set(b.properties.id, {
        data: {
          id: b.properties.id,
          label: b.properties.name ?? b.properties.id
        }
      });
    }

    if (r && a && b && a.properties?.id && b.properties?.id) {
      const props = r.properties ?? {};
      edges.push({
        data: {
          source: a.properties.id,
          target: b.properties.id,
          label: formatDependencyLabel(props),
          dependency_type: props.dependency_type ?? null,
          dependency_strength: props.dependency_strength ?? null,
          dependency_mode: props.dependency_mode ?? null,
          signature: props.signature ?? null
        }
      });
    }
  }

  return [...nodes.values(), ...edges];
}

export async function getStudioEaSnapshot() {
  const applications = await getAllApplications();

  const dependencyRecords = await query(`
    MATCH (a:Application)-[r:DEPENDS_ON]->(b:Application)
    RETURN
      a.id AS sourceId,
      b.id AS targetId,
      r.signature AS signature,
      r.dependency_type AS dependency_type,
      r.dependency_strength AS dependency_strength,
      r.dependency_mode AS dependency_mode
    ORDER BY toLower(coalesce(a.name, a.id)), toLower(coalesce(b.name, b.id)), coalesce(r.signature, '')
  `);

  const dependencies = dependencyRecords
    .map((record) => ({
      sourceId: record.get('sourceId') ?? null,
      targetId: record.get('targetId') ?? null,
      signature: record.get('signature') ?? null,
      dependency_type: record.get('dependency_type') ?? null,
      dependency_strength: record.get('dependency_strength') ?? null,
      dependency_mode: record.get('dependency_mode') ?? null
    }))
    .filter((d) => typeof d.sourceId === 'string' && typeof d.targetId === 'string' && d.sourceId && d.targetId);

  return {
    applications,
    dependencies
  };
}

export async function getImpactAnalysis(input) {
  const appId = typeof input === 'string' ? input : input?.appId;
  if (!appId) {
    return {
      appId: null,
      depthUsed: 0,
      direct: [],
      indirect: [],
      summary: { totalImpacted: 0, highestCriticality: null, retiringCount: 0 }
    };
  }

  const requestedDepth =
    typeof input === 'object' && input !== null && Number.isInteger(input.depth)
      ? input.depth
      : null;
  const positiveDepth = requestedDepth && requestedDepth > 0 ? requestedDepth : null;
  const depthCap = 10;
  const usableDepth = positiveDepth ? Math.min(positiveDepth, depthCap) : depthCap;
  const depthPattern = `1..${usableDepth}`;

  const records = await query(
    `
    MATCH (start:Application {id: $appId})
    CALL {
      WITH start
      MATCH path = (start)-[:DEPENDS_ON*${depthPattern}]->(impacted:Application)
      RETURN impacted, length(path) AS depth
    }
    RETURN impacted, min(depth) AS depth
    `,
    { appId }
  );

  const direct = [];
  const indirect = [];
  let highestCriticality = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let retiringCount = 0;

  for (const record of records) {
    const node = record.get('impacted');
    const depth = record.get('depth');
    if (!node || !node.properties?.id || typeof depth !== 'number') continue;

    const application = nodeToApplication(node);
    if (!application.id) continue;
    const entry = { ...application, depth };

    if (depth === 1) {
      direct.push(entry);
    } else if (depth > 1) {
      indirect.push(entry);
    }

    const score = criticalityScore(application.criticality);
    if (score < bestScore) {
      bestScore = score;
      highestCriticality = application.criticality ?? null;
    }

    if (isRetiringStatus(application.status)) {
      retiringCount += 1;
    }
  }

  const summary = {
    totalImpacted: direct.length + indirect.length,
    highestCriticality,
    retiringCount
  };

  const directIds = new Set(direct.map((entry) => entry.id));
  const indirectIds = new Set(indirect.map((entry) => entry.id));
  const overlap = [...directIds].filter((id) => indirectIds.has(id));
  void overlap;

  const maxObservedDepth = Math.max(0, ...direct.map(() => 1), ...indirect.map((entry) => entry.depth ?? 0));
  void maxObservedDepth;

  try {
    const directValidation = await query(
      `MATCH (start:Application {id: $appId})-[:DEPENDS_ON]->(direct:Application)
       RETURN DISTINCT direct.id AS id`,
      { appId }
    );
    const expectedDirect = new Set(
      directValidation
        .map((record) => record.get('id'))
        .filter((id) => typeof id === 'string' && id.length > 0)
    );
    const reportedDirect = new Set(direct.map((entry) => entry.id));

    void expectedDirect;
    void reportedDirect;

    if (usableDepth >= 2) {
      const indirectValidation = await query(
        `MATCH (start:Application {id: $appId})-[:DEPENDS_ON*2..${usableDepth}]->(indirect:Application)
         RETURN DISTINCT indirect.id AS id`,
        { appId }
      );
      const expectedIndirect = new Set(
        indirectValidation
          .map((record) => record.get('id'))
          .filter((id) => typeof id === 'string' && id.length > 0)
      );
      const reportedIndirect = new Set(indirect.map((entry) => entry.id));
      void expectedIndirect;
      void reportedIndirect;
    }
  } catch (validationError) {
    void validationError;
  }

  return {
    appId,
    depthUsed: usableDepth,
    direct: direct.sort((a, b) => (a.name ?? a.id ?? '').localeCompare(b.name ?? b.id ?? '')),
    indirect: indirect.sort(
      (a, b) => (a.depth - b.depth) || (a.name ?? a.id ?? '').localeCompare(b.name ?? b.id ?? '')
    ),
    summary
  };
}

export async function getRiskIndicators() {
  const fanRecords = await query(
    `
    MATCH (a:Application)
    OPTIONAL MATCH (:Application)-[incoming:DEPENDS_ON]->(a)
    OPTIONAL MATCH (a)-[outgoing:DEPENDS_ON]->(:Application)
    RETURN a, count(DISTINCT incoming) AS fanIn, count(DISTINCT outgoing) AS fanOut
    `
  );

  const fanMetrics = fanRecords
    .map((record) => {
      const node = record.get('a');
      return {
        application: nodeToApplication(node),
        fanIn: record.get('fanIn') ?? 0,
        fanOut: record.get('fanOut') ?? 0
      };
    })
    .filter((entry) => entry.application?.id);

  const fanInValues = fanMetrics.map((m) => m.fanIn).filter((n) => Number.isFinite(n));
  const fanOutValues = fanMetrics.map((m) => m.fanOut).filter((n) => Number.isFinite(n));

  const computeThreshold = (values, fallback) => {
    if (!values.length) return fallback;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
    return Math.max(fallback, sorted[idx]);
  };

  const fanInThreshold = computeThreshold(fanInValues, 3);
  const fanOutThreshold = computeThreshold(fanOutValues, 4);

  const singlePointsOfFailure = fanMetrics
    .filter((m) => m.fanIn >= fanInThreshold && m.fanIn > 0)
    .map((m) => ({ ...m.application, fanIn: m.fanIn }));

  const overloadedProviders = fanMetrics
    .filter((m) => m.fanOut >= fanOutThreshold && m.fanOut > 0)
    .map((m) => ({ ...m.application, fanOut: m.fanOut }));

  const criticalDependencyRecords = await query(
    `
    MATCH (consumer:Application)-[rel:DEPENDS_ON]->(provider:Application)
    WHERE toLower(coalesce(consumer.criticality, '')) IN ['critical', 'high']
      AND toLower(coalesce(provider.status, '')) IN ['retiring', 'sunsetting', 'planned-retirement', 'decommissioning']
    RETURN consumer, provider, rel
    `
  );

  const criticalRetiringRisks = criticalDependencyRecords.map((record) => {
    const consumer = nodeToApplication(record.get('consumer'));
    const provider = nodeToApplication(record.get('provider'));
    const relProps = record.get('rel')?.properties ?? {};
    return {
      consumer,
      provider,
      dependency: {
        dependency_type: relProps.dependency_type ?? null,
        dependency_strength: relProps.dependency_strength ?? null,
        dependency_mode: relProps.dependency_mode ?? null,
        label: formatDependencyLabel(relProps)
      }
    };
  });

  const cycleRecords = await query(
    `
    MATCH path = (a:Application)-[:DEPENDS_ON*2..6]->(a)
    RETURN nodes(path) AS nodePath
    `
  );

  const seenCycles = new Set();
  const circularDependencies = [];

  for (const record of cycleRecords) {
    const nodePath = record.get('nodePath');
    if (!Array.isArray(nodePath) || nodePath.length < 2) continue;
    const ids = nodePath
      .map((node) => node?.properties?.id)
      .filter(Boolean);
    if (ids.length < 2) continue;
    ids.pop(); // remove duplicate closing node
    if (!ids.length) continue;

    const rotations = ids.map((_, idx) => ids.slice(idx).concat(ids.slice(0, idx)));
    const reversed = [...ids].reverse();
    const reversedRotations = reversed.map((_, idx) => reversed.slice(idx).concat(reversed.slice(0, idx)));
    const candidates = rotations.concat(reversedRotations).map((cycle) => cycle.join('>'));
    const canonical = candidates.sort()[0];
    if (!canonical || seenCycles.has(canonical)) continue;
    seenCycles.add(canonical);
    circularDependencies.push({ nodes: canonical.split('>'), size: ids.length });
  }

  return {
    thresholds: {
      fanIn: fanInThreshold,
      fanOut: fanOutThreshold
    },
    singlePointsOfFailure,
    overloadedProviders,
    criticalRetiringRisks,
    circularDependencies
  };
}
