import pg from "pg";

let pool = null;

export function hasDatabase(env = process.env) {
  return Boolean(env.DATABASE_URL && env.DATABASE_URL.trim());
}

export function getPool() {
  if (!hasDatabase()) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_SIZE || 1),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 1000),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5000)
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const db = getPool();
  if (!db) return null;
  return db.query(text, params);
}

export async function closePool() {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}
