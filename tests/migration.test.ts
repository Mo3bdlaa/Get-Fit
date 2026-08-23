import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

/**
 * The 002 backfill only runs against a database that already holds day-attributed
 * sets — which the ordinary suite, starting from empty, never produces. This
 * builds that database on purpose and upgrades it.
 */

const MIGRATIONS = join(process.cwd(), "src", "lib", "db", "migrations");

async function sql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS, name), "utf8");
}

async function legacyDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(await sql("001_init.sql"));

  await db.exec(`
    INSERT INTO users (id, email, password_hash, display_name)
    VALUES ('11111111-1111-4111-8111-111111111111', 'sam@example.com', 'x', 'Sam'),
           ('22222222-2222-4222-8222-222222222222', 'alex@example.com', 'x', 'Alex');

    INSERT INTO exercises (id, slug, name_en, name_ar, equipment, primary_muscle)
    VALUES ('33333333-3333-4333-8333-333333333333', 'squat', 'Squat', 'سكوات', 'barbell', 'quadriceps');
  `);

  // Sam: two sets on the 20th, one on the 21st. Alex: one on the 20th.
  await db.exec(`
    INSERT INTO workout_logs (owner_id, exercise_id, performed_at, set_index, weight_kg, reps)
    VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '2026-08-20T09:00:00Z', 1, 100, 5),
           ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '2026-08-20T09:10:00Z', 2, 100, 5),
           ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '2026-08-21T09:00:00Z', 1, 100, 5),
           ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '2026-08-20T09:00:00Z', 1, 60, 8);
  `);

  return db;
}

describe("002 upgrades a database that already has sets", () => {
  // Booting PGlite costs seconds, so the upgrade happens once and the
  // assertions below read the result. Only the last one writes, and it fails.
  let db: PGlite;

  beforeAll(async () => {
    db = await legacyDatabase();
    await db.exec(await sql("002_workout_sessions.sql"));
  });

  afterAll(async () => {
  });

  it("gives every existing set a session, one per owner per day", async () => {
    const orphans = await db.query<{ n: number }>(
      "SELECT COUNT(*)::integer AS n FROM workout_logs WHERE session_id IS NULL",
    );
    expect(orphans.rows[0].n).toBe(0);

    const sessions = await db.query<{ n: number }>(
      "SELECT COUNT(*)::integer AS n FROM workout_sessions",
    );
    expect(sessions.rows[0].n).toBe(3); // Sam ×2 days, Alex ×1

  });

  it("does not move a set into another user's or another day's session", async () => {
    const mismatched = await db.query<{ n: number }>(
      `SELECT COUNT(*)::integer AS n
       FROM workout_logs w JOIN workout_sessions s ON s.id = w.session_id
       WHERE s.owner_id <> w.owner_id
          OR (s.started_at AT TIME ZONE 'UTC')::date <> (w.performed_at AT TIME ZONE 'UTC')::date`,
    );
    expect(mismatched.rows[0].n).toBe(0);

  });

  it("leaves every set_index exactly as it was", async () => {
    const rows = await db.query<{ set_index: number }>(
      `SELECT set_index FROM workout_logs
       WHERE owner_id = '11111111-1111-4111-8111-111111111111'
       ORDER BY performed_at`,
    );
    expect(rows.rows.map((row) => row.set_index)).toEqual([1, 2, 1]);

  });

  it("spans each backfilled session across the sets it contains, and closes it", async () => {
    const rows = await db.query<{ started_at: string; ended_at: string | null }>(
      `SELECT s.started_at, s.ended_at FROM workout_sessions s
       WHERE s.owner_id = '11111111-1111-4111-8111-111111111111'
         AND (s.started_at AT TIME ZONE 'UTC')::date = DATE '2026-08-20'`,
    );

    expect(rows.rows).toHaveLength(1);
    const [session] = rows.rows;
    expect(new Date(session.started_at).toISOString()).toBe("2026-08-20T09:00:00.000Z");
    expect(new Date(session.ended_at!).toISOString()).toBe("2026-08-20T09:10:00.000Z");

  });

  it("rejects a second set with the same index in one session and exercise", async () => {
    const session = await db.query<{ id: string }>(
      "SELECT id FROM workout_sessions LIMIT 1",
    );

    await expect(
      db.query(
        `INSERT INTO workout_logs (owner_id, session_id, exercise_id, performed_at, set_index, weight_kg, reps)
         SELECT owner_id, $1, exercise_id, performed_at, set_index, weight_kg, reps
         FROM workout_logs WHERE session_id = $1 LIMIT 1`,
        [session.rows[0].id],
      ),
    ).rejects.toThrow();

  });
});
