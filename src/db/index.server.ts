// Server-only Postgres connection pool + per-request transaction helper.
// Files ending in *.server.ts are blocked from the client bundle.
import { Pool, type PoolClient, type QueryResult } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("[db] DATABASE_URL is not set");
}

const ssl = process.env.DATABASE_SSL === "true"
  ? { rejectUnauthorized: false }
  : undefined;

declare global {
  // eslint-disable-next-line no-var
  var __chromaPgPool: Pool | undefined;
}

export const pool: Pool =
  globalThis.__chromaPgPool ??
  (globalThis.__chromaPgPool = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  }));

export type Db = {
  query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>;
  many: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  maybe: <T = any>(sql: string, params?: any[]) => Promise<T | null>;
  one: <T = any>(sql: string, params?: any[]) => Promise<T>;
};

function wrap(c: PoolClient): Db {
  return {
    query: (sql, params) => c.query(sql, params),
    many: async (sql, params) => (await c.query(sql, params)).rows,
    maybe: async (sql, params) => (await c.query(sql, params)).rows[0] ?? null,
    one: async (sql, params) => {
      const r = await c.query(sql, params);
      if (r.rows.length === 0) throw new Error("Expected exactly one row");
      return r.rows[0];
    },
  };
}

export type AuthCtx = {
  userId?: string | null;
  isAdmin?: boolean;
};

/**
 * Open a single transaction, set the per-request GUCs that RLS reads from,
 * and run `fn(db)` against that client. Commits on success, rolls back on
 * throw. Always release the client.
 */
export async function withDb<T>(
  ctx: AuthCtx,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (ctx.userId) {
      await c.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    }
    if (ctx.isAdmin) {
      await c.query("SELECT set_config('app.is_admin', 'true', true)");
    }
    const out = await fn(wrap(c));
    await c.query("COMMIT");
    return out;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    c.release();
  }
}

/** Convenience: act as the signed-in user (RLS applies). */
export const withUser = <T>(userId: string, fn: (db: Db) => Promise<T>) =>
  withDb({ userId }, fn);

/** Convenience: trusted server code that bypasses RLS via is_admin flag. */
export const withAdmin = <T>(fn: (db: Db) => Promise<T>) =>
  withDb({ isAdmin: true }, fn);
