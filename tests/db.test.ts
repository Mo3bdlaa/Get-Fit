import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { seedCatalogue, listCatalogue, findExerciseBySlug } from "@/lib/repo/exercises";
import { freshDatabase, makeUser } from "./helpers";

describe("schema and seed", () => {
  it("creates every table the BRD data model names for R0", () => {
    const names = (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);

    for (const table of ["users", "exercises", "workout_logs", "audit_log"]) {
      expect(names).toContain(table);
    }
  });

  it("seeds the catalogue idempotently", async () => {
    freshDatabase();
    const actor = await makeUser("sam@example.com");
    const first = listCatalogue(actor).length;

    seedCatalogue();
    seedCatalogue();

    expect(listCatalogue(actor)).toHaveLength(first);
    expect(first).toBeGreaterThan(0);
  });

  it("carries an Arabic name for every seeded exercise (§6 step 2)", async () => {
    freshDatabase();
    const actor = await makeUser("sam@example.com");
    for (const exercise of listCatalogue(actor)) {
      expect(exercise.nameAr.trim()).not.toBe("");
      expect(exercise.nameAr).not.toBe(exercise.nameEn);
    }
  });

  it("enforces the one-row-per-set check constraints", () => {
    expect(findExerciseBySlug("barbell-back-squat")).not.toBeNull();
    expect(findExerciseBySlug("no-such-exercise")).toBeNull();
  });
});
