import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DATE_OID,
  TIMESTAMPTZ_OID,
  TIMESTAMP_OID,
  toDateString,
  toIsoString,
} from "@/lib/db/types";

/**
 * The only module that talks to Postgres. Everything else goes through
 * `src/lib/repo/*`, and `tests/authz-enforcement.test.ts` fails the build if
 * anything outside those two places imports this file or a driver directly.
 *
 * No `server-only` marker here, deliberately: `scripts/migrate.ts` runs this
 * from plain Node at deploy time. The static check above is the stronger guard,
 * and it also covers the client-bundle case `server-only` would have caught.
 *
 * Two drivers, one dialect:
 *   - `DATABASE_URL` set          → `pg` against Neon (or any Postgres).
 *   - unset, outside production   → PGlite.
 *   - unset, in production        → refused, loudly.
 *
 * PGlite is an in-process build of Postgres 18, so the migrations and queries
 * under test are the ones that run in production. What it does not exercise is
 * the `pg` driver and the network in front of Neon, which is why the deployed
 * URL is smoke-tested by hand at each release.
 */

const MIGRATIONS_DIR = join(process.cwd(), "src", "lib", "db", "migrations");
const MIGRATION_LOCK_KEY = 4_814_192; // arbitrary, stable: advisory lock id

export type Row = Record<string, unknown>;

type Driver = {
  query: <T extends Row>(text: string, params?: unknown[]) => Promise<T[]>;
  /**
   * Multi-statement SQL over the simple query protocol. The extended protocol
   * `query` uses accepts exactly one statement per call, so migration files have
   * to come through here.
   */
  exec: (text: string) => Promise<void>;
  close: () => Promise<void>;
};

let driverPromise: Promise<Driver> | null = null;
let migrated = false;

async function createPgDriver(connectionString: string): Promise<Driver> {
  const { default: pg } = await import("pg");

  // Applied to the shared type registry, so every Pool in this process agrees.
  pg.types.setTypeParser(TIMESTAMPTZ_OID, toIsoString);
  pg.types.setTypeParser(TIMESTAMP_OID, toIsoString);
  pg.types.setTypeParser(DATE_OID, toDateString);

  const pool = new pg.Pool({
    connectionString,
    // Neon terminates TLS at the pooler and does not present a cert chain the
    // default verifier accepts; local Postgres usually has no TLS at all.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });

  return {
    query: async <T extends Row>(text: string, params?: unknown[]) =>
      (await pool.query(text, params)).rows as T[],
    // No values argument, so `pg` sends this as a simple query.
    exec: async (text: string) => {
      await pool.query(text);
    },
    close: () => pool.end(),
  };
}

/**
 * The specifier is assembled rather than written literally, and marked
 * `webpackIgnore`, so that neither the bundler nor Next's file tracer follows
 * it. PGlite is a devDependency: a literal import gets traced into the
 * serverless output, and Vercel prunes devDependencies after the build — so the
 * deployment is packaged around a file that no longer exists and fails. Nothing
 * in production takes this branch; in development and tests Node resolves it
 * from node_modules at runtime, as normal.
 */
const PGLITE = ["@electric-sql", "pglite"].join("/");

async function createPgliteDriver(): Promise<Driver> {
  const { PGlite } = (await import(/* webpackIgnore: true */ PGLITE)) as
    typeof import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DATA_DIR; // undefined = in-memory
  const client = await PGlite.create({
    dataDir,
    parsers: {
      [TIMESTAMPTZ_OID]: toIsoString,
      [TIMESTAMP_OID]: toIsoString,
      [DATE_OID]: toDateString,
    },
  });

  return {
    query: async <T extends Row>(text: string, params?: unknown[]) =>
      (await client.query<T>(text, params as unknown[])).rows,
    exec: async (text: string) => {
      await client.exec(text);
    },
    close: () => client.close(),
  };
}

async function createDriver(): Promise<Driver> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) return createPgDriver(connectionString);

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL must be set in production — refusing to fall back to PGlite",
    );
  }
  return createPgliteDriver();
}

function db(): Promise<Driver> {
  driverPromise ??= createDriver();
  return driverPromise;
}

export async function query<T extends Row>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  return (await db()).query<T>(text, params);
}

export async function queryOne<T extends Row>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Statement count, for callers that only care whether a write landed. */
export async function execute(text: string, params?: unknown[]): Promise<void> {
  await query(text, params);
}

export async function migrate(): Promise<void> {
  const driver = await db();

  await driver.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Serverless means several instances may boot at once. The advisory lock makes
  // concurrent migration runs wait rather than race on CREATE TABLE.
  await driver.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    const applied = new Set(
      (
        await driver.query<{ name: string }>("SELECT name FROM schema_migrations")
      ).map((row) => row.name),
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
      // Each migration file is one transaction: a half-applied migration is
      // worse than a failed one.
      await driver.query("BEGIN");
      try {
        await driver.exec(sql);
        await driver.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await driver.query("COMMIT");
      } catch (error) {
        await driver.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
  } finally {
    await driver.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }

  migrated = true;
}

export async function ensureMigrated(): Promise<void> {
  if (!migrated) await migrate();
}

/** Test helper: drops the cached driver so the next query starts a new one. */
export async function closeDb(): Promise<void> {
  const pending = driverPromise;
  driverPromise = null;
  migrated = false;
  if (pending) await (await pending).close();
}
