import Database from "better-sqlite3";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * SQLite is the R0 storage choice: it runs with no service to provision, which
 * is what makes the walking skeleton end-to-end today. Every query in the app
 * goes through `src/lib/repo/*`, so moving to Postgres in R1 is a change to
 * this file and those repositories — not to route handlers or components.
 */

const MIGRATIONS_DIR = join(process.cwd(), "src", "lib", "db", "migrations");

let db: Database.Database | null = null;

function databasePath(): string {
  return process.env.GETFIT_DB_PATH ?? join(process.cwd(), "data", "get-fit.db");
}

function applyMigrations(connection: Database.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    connection
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => !applied.has(name));

  const record = connection.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    connection.transaction(() => {
      connection.exec(sql);
      record.run(name, new Date().toISOString());
    })();
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  const path = databasePath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const connection = new Database(path);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  applyMigrations(connection);

  db = connection;
  return db;
}

/** Test helper: drops the cached handle so the next getDb() starts clean. */
export function resetDbForTests(): void {
  db?.close();
  db = null;
}
