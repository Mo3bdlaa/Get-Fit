/**
 * Boots the app for the end-to-end run against a real Postgres wire connection.
 *
 * `next start` serves server actions and page renders from separate module
 * instances, so an in-process database gets opened twice — writes land in one
 * copy and reads come from the other. PGlite is therefore run here as a *server*
 * over the Postgres wire protocol, on a port, with the app connecting through
 * the same `pg` driver it uses against Neon. One database, one driver, no
 * service to install.
 *
 * Set `E2E_DATABASE_URL` to point the run at a real Postgres instead.
 */
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 3100);
const dbPort = Number(process.env.E2E_DB_PORT ?? 55432);

async function startEmbeddedPostgres(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

  const db = await PGlite.create();
  const server = new PGLiteSocketServer({
    db,
    port: dbPort,
    host: "127.0.0.1",
    // Defaults to 1. Next serves page renders and server actions from separate
    // module instances, so the app opens more than one pool.
    maxConnections: 20,
  });
  await server.start();

  return {
    url: `postgres://postgres@127.0.0.1:${dbPort}/postgres`,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}

const embedded = process.env.E2E_DATABASE_URL ? null : await startEmbeddedPostgres();
const databaseUrl = process.env.E2E_DATABASE_URL ?? embedded!.url;

// Migrate before the app takes traffic, the same way a deploy does.
process.env.DATABASE_URL = databaseUrl;
const { migrate, closeDb } = await import("@/lib/db");
const { seedCatalogue } = await import("@/lib/repo/exercises");
await migrate();
await seedCatalogue();
await closeDb();

const next = spawn("npx", ["next", "start", "--port", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-secret",
  },
});

async function shutdown(code: number): Promise<void> {
  next.kill("SIGTERM");
  await embedded?.stop();
  process.exit(code);
}

next.on("exit", (code) => void shutdown(code ?? 0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
