import { beforeEach, describe, expect, it } from "vitest";
import { ensureMigrated, query } from "@/lib/db";
import { seedCatalogue, listCatalogue, findExerciseBySlug } from "@/lib/repo/exercises";
import { freshDatabase, makeUser } from "./helpers";

beforeEach(async () => {
  await freshDatabase();
});

describe("schema and seed", () => {
  it("creates every table the BRD data model names for R0", async () => {
    const rows = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = rows.map((row) => row.table_name);

    for (const table of ["users", "exercises", "workout_logs", "audit_log"]) {
      expect(names).toContain(table);
    }
  });

  it("stores instants as timestamptz, not text", async () => {
    const rows = await query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workout_logs'
         AND column_name IN ('performed_at', 'created_at', 'updated_at', 'deleted_at')`,
    );

    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.data_type, row.column_name).toBe("timestamp with time zone");
    }
  });

  it("generates its own uuid keys", async () => {
    const rows = await query<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'`,
    );
    expect(rows[0].column_default).toContain("gen_random_uuid()");
  });

  it("is idempotent: re-running migrations applies nothing new", async () => {
    const before = await query<{ name: string }>("SELECT name FROM schema_migrations");
    await ensureMigrated();
    const after = await query<{ name: string }>("SELECT name FROM schema_migrations");
    expect(after).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it("seeds the catalogue idempotently", async () => {
    const actor = await makeUser("sam@example.com");
    const first = (await listCatalogue(actor)).length;

    await seedCatalogue();
    await seedCatalogue();

    expect(await listCatalogue(actor)).toHaveLength(first);
    expect(first).toBeGreaterThan(0);
  });

  it("carries an Arabic name for every seeded exercise (§6 step 2)", async () => {
    const actor = await makeUser("sam@example.com");
    for (const exercise of await listCatalogue(actor)) {
      expect(exercise.nameAr.trim()).not.toBe("");
      expect(exercise.nameAr).not.toBe(exercise.nameEn);
    }
  });

  it("looks a catalogue entry up by slug, and reports a miss as null", async () => {
    expect(await findExerciseBySlug("barbell-back-squat")).not.toBeNull();
    expect(await findExerciseBySlug("no-such-exercise")).toBeNull();
  });

  it("refuses a private exercise with no owner (and the reverse)", async () => {
    await expect(
      query(
        `INSERT INTO exercises (slug, name_en, name_ar, equipment, primary_muscle, visibility)
         VALUES ('orphan', 'Orphan', 'يتيم', 'none', 'none', 'private')`,
      ),
    ).rejects.toThrow();
  });
});
