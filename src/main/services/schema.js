import { query } from './neo4j.js';

export const EA_CORE_SCHEMA_VERSION = 1;

export async function initializeSchema() {
  try {
    const constraintRecords = await query('SHOW CONSTRAINTS');
    const indexRecords = await query('SHOW INDEXES');

    const constraints = constraintRecords.map((record) => record.toObject?.() ?? {});
    const indexes = indexRecords.map((record) => record.toObject?.() ?? {});

    await query(
      'CREATE CONSTRAINT app_id_unique IF NOT EXISTS FOR (a:Application) REQUIRE a.id IS UNIQUE'
    );

    await query('CREATE INDEX app_name_index IF NOT EXISTS FOR (a:Application) ON (a.name)');

    await query(`
      MATCH (source:Application)-[rel:DEPENDS_ON]->(target:Application)
      WHERE rel.signature IS NULL
      SET rel.signature = source.id + '|' + target.id + '|' + coalesce(rel.dependency_type, '') + '|' + coalesce(rel.dependency_strength, '') + '|' + coalesce(rel.dependency_mode, '')
    `);

    const signatureGaps = await query(
      'MATCH ()-[rel:DEPENDS_ON]->() WHERE rel.signature IS NULL RETURN count(rel) AS missing'
    );
    const missingSignatures = signatureGaps[0]?.get('missing') ?? 0;
    void missingSignatures;

    const semanticsCoverage = await query(
      `MATCH ()-[rel:DEPENDS_ON]->()
       RETURN
         count(rel) AS total,
         sum(CASE WHEN rel.dependency_strength IS NULL OR rel.dependency_strength = '' THEN 1 ELSE 0 END) AS missingStrength,
         sum(CASE WHEN rel.dependency_mode IS NULL OR rel.dependency_mode = '' THEN 1 ELSE 0 END) AS missingMode`
    );
    void semanticsCoverage;

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

    await query('SHOW CONSTRAINTS');
    await query('SHOW INDEXES');
    return true;
  } catch (error) {
    throw error;
  }
}
