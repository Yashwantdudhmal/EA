import neo4j from 'neo4j-driver';

let driver = null;
let connectionState = {
  connected: false,
  uri: 'neo4j://127.0.0.1:7687',
  user: 'neo4j',
  lastError: null
};

function getConfig() {
  const uri = process.env.NEO4J_URI ?? 'neo4j://127.0.0.1:7687';
  const user = process.env.NEO4J_USER ?? 'neo4j';
  const password = process.env.NEO4J_PASSWORD;

  if (!password) {
    const err = new Error(
      'Neo4j password not set. Set env var NEO4J_PASSWORD (and optionally NEO4J_URI, NEO4J_USER).'
    );
    err.code = 'NEO4J_PASSWORD_MISSING';
    throw err;
  }

  return { uri, user, password };
}

export async function connect() {
  if (driver) return connectionState;

  try {
    const { uri, user, password } = getConfig();

    console.log(`[neo4j] connecting to ${uri}...`);

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      encrypted: 'ENCRYPTION_OFF'
    });
    await driver.verifyConnectivity();

    connectionState = {
      connected: true,
      uri,
      user,
      lastError: null
    };

    return connectionState;
  } catch (error) {
    connectionState = {
      connected: false,
      uri: connectionState.uri,
      user: connectionState.user,
      lastError: {
        message: error?.message ?? String(error),
        code: error?.code
      }
    };

    if (driver) {
      try {
        await driver.close();
      } catch {
        // ignore
      }
      driver = null;
    }

    throw error;
  }
}

export async function disconnect() {
  if (!driver) return;

  await driver.close();
  driver = null;
  connectionState = {
    ...connectionState,
    connected: false
  };
}

export async function query(cypher, params = {}) {
  if (!driver) {
    await connect();
  }

  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result;
  } finally {
    await session.close();
  }
}

export function getStatus() {
  return connectionState;
}
