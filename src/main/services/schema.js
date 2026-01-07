import { query } from './neo4j.js';

export async function initializeSchema() {
  try {
    console.log('[schema] initializing constraints and indexes...');

    const constraintRecords = await query('SHOW CONSTRAINTS');
    const indexRecords = await query('SHOW INDEXES');

    const constraints = constraintRecords.map((record) => record.toObject?.() ?? {});
    const indexes = indexRecords.map((record) => record.toObject?.() ?? {});

    console.log(
      '[schema] existing constraints:',
      constraints.map((c) => `${c.name ?? c.id ?? '?'} (${c.type ?? 'unknown'})`)
    );
    console.log(
      '[schema] existing indexes:',
      indexes.map((i) => `${i.name ?? i.id ?? '?'} (${i.type ?? 'unknown'})`)
    );

    await query(
      'CREATE CONSTRAINT app_id_unique IF NOT EXISTS FOR (a:Application) REQUIRE a.id IS UNIQUE'
    );
    console.log('[schema] ✓ unique constraint on Application.id');

    await query('CREATE INDEX app_name_index IF NOT EXISTS FOR (a:Application) ON (a.name)');
    console.log('[schema] ✓ index on Application.name');

    await query(`
      MATCH (source:Application)-[rel:DEPENDS_ON]->(target:Application)
      WHERE rel.signature IS NULL
      SET rel.signature = source.id + '|' + target.id + '|' + coalesce(rel.dependency_type, '') + '|' + coalesce(rel.dependency_strength, '') + '|' + coalesce(rel.dependency_mode, '')
    `);
    console.log('[schema] ✓ ensured dependency signatures');

    const signatureGaps = await query(
      'MATCH ()-[rel:DEPENDS_ON]->() WHERE rel.signature IS NULL RETURN count(rel) AS missing'
    );
    const missingSignatures = signatureGaps[0]?.get('missing') ?? 0;
    if (missingSignatures > 0) {
      console.warn('[schema] WARNING: dependencies without signature found:', missingSignatures);
    } else {
      console.log('[schema] ✓ all dependencies carry signatures');
    }

    const semanticsCoverage = await query(
      `MATCH ()-[rel:DEPENDS_ON]->()
       RETURN
         count(rel) AS total,
         sum(CASE WHEN rel.dependency_strength IS NULL OR rel.dependency_strength = '' THEN 1 ELSE 0 END) AS missingStrength,
         sum(CASE WHEN rel.dependency_mode IS NULL OR rel.dependency_mode = '' THEN 1 ELSE 0 END) AS missingMode`
    );
    if (semanticsCoverage.length) {
      const row = semanticsCoverage[0];
      console.log('[schema] dependency semantics coverage', {
        total: row.get('total') ?? 0,
        missingStrength: row.get('missingStrength') ?? 0,
        missingMode: row.get('missingMode') ?? 0
      });
    }

    const requiredConstraints = [
      'CREATE CONSTRAINT app_id_unique IF NOT EXISTS FOR (a:Application) REQUIRE a.id IS UNIQUE',
      'CREATE CONSTRAINT dep_signature_unique IF NOT EXISTS FOR ()-[r:DEPENDS_ON]-() REQUIRE r.signature IS UNIQUE'
    ];

    for (const statement of requiredConstraints) {
      await query(statement);
    }

    const requiredIndexes = [
      'CREATE INDEX app_name_index IF NOT EXISTS FOR (a:Application) ON (a.name)'
    ];

    for (const statement of requiredIndexes) {
      await query(statement);
    }

    const updatedConstraints = (await query('SHOW CONSTRAINTS')).map((record) => record.toObject?.() ?? {});
    const updatedIndexes = (await query('SHOW INDEXES')).map((record) => record.toObject?.() ?? {});

    const requiredConstraintNames = ['app_id_unique', 'dep_signature_unique'];
    requiredConstraintNames.forEach((name) => {
      const exists = updatedConstraints.some((entry) => entry.name === name);
      console.log('[schema]', exists ? '✓ constraint present:' : '• constraint missing:', name);
    });

    const requiredIndexNames = ['app_name_index'];
    requiredIndexNames.forEach((name) => {
      const exists = updatedIndexes.some((entry) => entry.name === name);
      console.log('[schema]', exists ? '✓ index present:' : '• index missing:', name);
    });

    console.log('[schema] initialization complete');
    return true;
  } catch (error) {
    console.error('[schema] initialization failed:', error?.message ?? error);
    throw error;
  }
}
