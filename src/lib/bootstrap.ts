import "server-only";
import { getDb } from "@/lib/db";
import { seedCatalogue } from "@/lib/repo/exercises";

let ready = false;

/** Migrations + catalogue seed. Idempotent; every server entry point calls it. */
export function bootstrap(): void {
  if (ready) return;
  getDb();
  seedCatalogue();
  ready = true;
}
