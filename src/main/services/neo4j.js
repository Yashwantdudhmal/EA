import neo4j from 'neo4j-driver';

// GLOBAL IN-MEMORY SINGLETON (PROCESS ONLY)
if (!globalThis.__EA_NEO4J__) {
  globalThis.__EA_NEO4J__ = {
    driver: null,
    connected: false
  };
}

const state = globalThis.__EA_NEO4J__;

export async function connect() {
  if (state.connected && state.driver) {
    return;
  }

  // HARD-CODED DEV CONFIG (TEMPORARY)
  const uri = 'bolt://127.0.0.1:7687';
  const user = 'neo4j';
  const password = 'Aniruddh@123';

  state.driver = neo4j.driver(
    uri,
    neo4j.auth.basic(user, password),
    {
      encrypted: 'ENCRYPTION_OFF',
      disableLosslessIntegers: true
    }
  );

  // Do NOT verifyConnectivity
  state.connected = true;
}

export async function query(cypher, params = {}) {
  if (!state.connected || !state.driver) {
    throw new Error('Neo4j not connected');
  }

  const session = state.driver.session({
    defaultAccessMode: neo4j.session.WRITE
  });

  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export async function disconnect() {
  if (state.driver) {
    await state.driver.close();
    state.driver = null;
    state.connected = false;
  }
}
