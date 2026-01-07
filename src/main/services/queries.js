import { query } from './neo4j.js';

export async function getDependencyGraph() {
  const result = await query(`
    MATCH (a:Application)
    OPTIONAL MATCH (a)-[r:DEPENDS_ON]->(b:Application)
    RETURN a, r, b
  `);

  const nodes = new Map();
  const edges = [];

  for (const record of result.records) {
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
      edges.push({
        data: {
          source: a.properties.id,
          target: b.properties.id,
          label: r.properties?.dependency_type ?? ''
        }
      });
    }
  }

  return [...nodes.values(), ...edges];
}

export async function getImpactAnalysis(appId) {
  const result = await query(
    `
    MATCH (start:Application {id: $appId})-[:DEPENDS_ON*]->(downstream)
    RETURN DISTINCT downstream
    `,
    { appId }
  );

  return result.records
    .map((r) => r.get('downstream')?.properties?.id)
    .filter(Boolean);
}
