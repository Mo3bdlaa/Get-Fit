import "server-only";
import { ensureMigrated } from "@/lib/db";
import { seedCatalogue } from "@/lib/repo/exercises";

let ready: Promise<void> | null = null;

/**
 * Migrations + catalogue seed, once per process and idempotent. Every server
 * entry point awaits it.
 *
 * Migrations run behind a Postgres advisory lock (see `src/lib/db/index.ts`), so
 * several serverless instances booting at once queue rather than race. Deploys
 * can still run `npm run db:migrate` ahead of traffic; this is the safety net,
 * not the plan.
 */
export function bootstrap(): Promise<void> {
  ready ??= (async () => {
    await ensureMigrated();
    await seedCatalogue();
  })();
  return ready;
}
