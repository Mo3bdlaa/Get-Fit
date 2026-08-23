/**
 * Applies migrations and seeds the catalogue against whatever `DATABASE_URL`
 * points at. Run it before a deployment takes traffic:
 *
 *   DATABASE_URL='postgres://…' npm run db:migrate
 *
 * The app also migrates on first request behind an advisory lock, so this is
 * the orderly path rather than the only one.
 */
import { closeDb, migrate } from "@/lib/db";
import { seedCatalogue } from "@/lib/repo/exercises";

const target = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).host
  : `${process.env.GETFIT_DB_DRIVER ?? "pglite"} (no DATABASE_URL)`;

console.log(`Migrating ${target}…`);
await migrate();
await seedCatalogue();
console.log("Migrations applied, catalogue seeded.");
await closeDb();
