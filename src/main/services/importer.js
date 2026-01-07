import fs from 'node:fs';
import Papa from 'papaparse';
import { query } from './neo4j.js';

function parseCsv(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, errors } = Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (errors?.length) {
    const details = errors.map((e) => e.message ?? String(e)).join('; ');
    const err = new Error(`CSV parsing failed: ${details}`);
    err.code = 'CSV_PARSE_FAILED';
    throw err;
  }

  return data;
}

/**
 * Import applications from CSV file
 * CSV format: id,name,owner,criticality,status
 */
export async function importApplications(filePath) {
  try {
    console.log('[import] reading applications from:', filePath);

    const data = parseCsv(filePath);
    console.log(`[import] parsed ${data.length} applications`);

    let imported = 0;
    for (const row of data) {
      const id = row.id?.trim();
      if (!id) continue;

      await query(
        `MERGE (a:Application {id: $id})
         SET a.name = $name,
             a.owner = $owner,
             a.criticality = $criticality,
             a.status = $status`,
        {
          id,
          name: row.name?.trim() ?? null,
          owner: row.owner?.trim() ?? null,
          criticality: row.criticality?.trim() ?? null,
          status: row.status?.trim() ?? null
        }
      );
      imported++;
    }

    console.log(`[import] ✓ imported ${imported} applications`);
    return { success: true, count: imported };
  } catch (error) {
    console.error('[import] failed:', error?.message ?? error);
    return { success: false, error: error?.message ?? String(error) };
  }
}

/**
 * Import dependencies from CSV file
 * CSV format: source_id,target_id,dependency_type
 */
export async function importDependencies(filePath) {
  try {
    console.log('[import] reading dependencies from:', filePath);

    const data = parseCsv(filePath);
    console.log(`[import] parsed ${data.length} dependencies`);

    let imported = 0;
    for (const row of data) {
      const sourceId = row.source_id?.trim();
      const targetId = row.target_id?.trim();
      const dependencyType = row.dependency_type?.trim() ?? null;

      if (!sourceId || !targetId) continue;

      const result = await query(
        `MATCH (source:Application {id: $source_id})
         MATCH (target:Application {id: $target_id})
         MERGE (source)-[r:DEPENDS_ON]->(target)
         SET r.dependency_type = $dependency_type
         RETURN source, target`,
        {
          source_id: sourceId,
          target_id: targetId,
          dependency_type: dependencyType
        }
      );

      if (result.records?.length) {
        imported++;
      } else {
        console.warn(`[import] skipped: ${sourceId} -> ${targetId} (apps not found)`);
      }
    }

    console.log(`[import] ✓ imported ${imported} dependencies`);
    return { success: true, count: imported };
  } catch (error) {
    console.error('[import] failed:', error?.message ?? error);
    return { success: false, error: error?.message ?? String(error) };
  }
}
