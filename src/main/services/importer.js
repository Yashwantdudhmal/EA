import fs from 'node:fs';
import Papa from 'papaparse';
import { query } from './neo4j.js';

const VALID_STRENGTH = new Set(['hard', 'soft']);
const VALID_MODE = new Set(['runtime', 'batch', 'async']);

function normalizeStrength(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return VALID_STRENGTH.has(clean) ? clean : null;
}

function normalizeMode(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return VALID_MODE.has(clean) ? clean : null;
}

function buildSignature({ sourceId, targetId, dependencyType, dependencyStrength, dependencyMode }) {
  const parts = [sourceId, targetId, dependencyType ?? '', dependencyStrength ?? '', dependencyMode ?? ''];
  return parts.join('|');
}

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
 * CSV format: source_id,target_id,dependency_type,dependency_strength?,dependency_mode?
 */
export async function importDependencies(filePath) {
  try {
    console.log('[import] reading dependencies from:', filePath);

    const data = parseCsv(filePath);
    console.log(`[import] parsed ${data.length} dependencies`);

    const sampleRow = data[0] ?? {};
    const hasStrengthColumn = Object.prototype.hasOwnProperty.call(sampleRow, 'dependency_strength');
    const hasModeColumn = Object.prototype.hasOwnProperty.call(sampleRow, 'dependency_mode');
    console.log(
      `[import] dependency semantics columns — strength:${hasStrengthColumn ? 'present' : 'absent'}, mode:${
        hasModeColumn ? 'present' : 'absent'
      }`
    );

    let imported = 0;
    for (const row of data) {
      const sourceId = row.source_id?.trim();
      const targetId = row.target_id?.trim();
      const dependencyType = row.dependency_type?.trim() ?? null;
      const dependencyStrength = normalizeStrength(row.dependency_strength);
      const dependencyMode = normalizeMode(row.dependency_mode);

      if (!sourceId || !targetId) continue;

      if (row.dependency_strength && !dependencyStrength) {
        console.warn(
          `[import] invalid dependency_strength for ${sourceId}->${targetId}: ${row.dependency_strength}`
        );
      }

      if (row.dependency_mode && !dependencyMode) {
        console.warn(
          `[import] invalid dependency_mode for ${sourceId}->${targetId}: ${row.dependency_mode}`
        );
      }

      const signature = buildSignature({
        sourceId,
        targetId,
        dependencyType,
        dependencyStrength,
        dependencyMode
      });

      const result = await query(
        `MATCH (source:Application {id: $source_id})
         MATCH (target:Application {id: $target_id})
         OPTIONAL MATCH (source)-[existing:DEPENDS_ON]->(target)
         WHERE coalesce(existing.dependency_type, '') = coalesce($dependency_type, '')
           AND coalesce(existing.dependency_strength, '') = coalesce($dependency_strength, '')
           AND coalesce(existing.dependency_mode, '') = coalesce($dependency_mode, '')
         CALL {
           WITH source, target, existing
           WHERE existing IS NULL
           CREATE (source)-[rel:DEPENDS_ON]->(target)
           SET rel.signature = $signature,
               rel.dependency_type = $dependency_type,
               rel.dependency_strength = $dependency_strength,
               rel.dependency_mode = $dependency_mode
           RETURN rel
           UNION
             WITH existing
             SET existing.signature = $signature,
               existing.dependency_type = $dependency_type,
               existing.dependency_strength = $dependency_strength,
               existing.dependency_mode = $dependency_mode
           RETURN existing AS rel
         }
         RETURN rel`,
        {
          source_id: sourceId,
          target_id: targetId,
          dependency_type: dependencyType,
          dependency_strength: dependencyStrength,
          dependency_mode: dependencyMode,
          signature
        }
      );

      if (result.length) {
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
