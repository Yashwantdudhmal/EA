import { query } from './neo4j.js';

export async function initializeSchema() {
  try {
    console.log('[schema] initializing constraints and indexes...');

    await query(
      'CREATE CONSTRAINT app_id_unique IF NOT EXISTS FOR (a:Application) REQUIRE a.id IS UNIQUE'
    );
    console.log('[schema] ✓ unique constraint on Application.id');

    await query('CREATE INDEX app_name_index IF NOT EXISTS FOR (a:Application) ON (a.name)');
    console.log('[schema] ✓ index on Application.name');

    console.log('[schema] initialization complete');
    return true;
  } catch (error) {
    console.error('[schema] initialization failed:', error?.message ?? error);
    throw error;
  }
}
