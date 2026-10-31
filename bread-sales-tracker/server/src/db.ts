import pg from 'pg';
import type { Config } from './config.js';

// Money is stored as whole paise (₹1 = 100 paise) in BIGINT columns, and sums come back
// as NUMERIC. Both always fit safely in a JS number for this business, so parse them as
// numbers instead of strings. DATE columns stay as 'YYYY-MM-DD' strings so that no time
// zone conversion can ever shift a sale to the wrong day.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/** Anything we can run a query on: the pool or a client inside a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow = any>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export function createPool(config: Pick<Config, 'databaseUrl' | 'databaseSsl'>): pg.Pool {
  const ssl =
    config.databaseSsl === 'no-verify'
      ? { rejectUnauthorized: false }
      : config.databaseSsl === 'verify'
        ? true
        : undefined;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl });
  pool.on('error', (err) => {
    console.error('Unexpected database pool error', err);
  });
  return pool;
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function many<R extends pg.QueryResultRow = any>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<R[]> {
  const result = await db.query<R>(text, values);
  return result.rows;
}

export async function one<R extends pg.QueryResultRow = any>(
  db: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<R | undefined> {
  const result = await db.query<R>(text, values);
  return result.rows[0];
}

/** Postgres error code for unique_violation */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}
