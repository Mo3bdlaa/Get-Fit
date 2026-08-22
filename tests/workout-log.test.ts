import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { findExerciseBySlug } from "@/lib/repo/exercises";
import {
  UnknownExerciseError,
  listSets,
  logSet,
  softDeleteSet,
  volumeByDay,
} from "@/lib/repo/workoutLogs";
import type { Actor } from "@/lib/authz";
import { freshDatabase, makeUser } from "./helpers";

let sam: Actor;
let squatId: string;

beforeEach(async () => {
  freshDatabase();
  sam = await makeUser("sam@example.com");
  squatId = findExerciseBySlug("barbell-back-squat")!.id;
});

describe("one row per set (BRD §9)", () => {
  it("writes a separate row per set and numbers them within the day", () => {
    for (let i = 0; i < 3; i += 1) {
      logSet(sam, {
        exerciseId: squatId,
        weightKg: 100,
        reps: 5,
        performedAt: "2026-08-20T09:00:00.000Z",
      });
    }

    const rows = getDb()
      .prepare(
        "SELECT set_index FROM workout_logs WHERE owner_id = ? ORDER BY set_index",
      )
      .all(sam.id) as { set_index: number }[];

    expect(rows.map((row) => row.set_index)).toEqual([1, 2, 3]);
  });

  it("restarts set numbering on a new day", () => {
    logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: "2026-08-20T09:00:00.000Z" });
    const nextDay = logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-21T09:00:00.000Z",
    });

    expect(nextDay.setIndex).toBe(1);
  });

  it("stores RPE and notes when given, and null when not", () => {
    const withDetail = logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      rpe: 8.5,
      notes: "Felt fast",
    });
    const without = logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5 });

    expect(withDetail.rpe).toBe(8.5);
    expect(withDetail.notes).toBe("Felt fast");
    expect(without.rpe).toBeNull();
    expect(without.notes).toBeNull();
  });
});

describe("validation", () => {
  it("rejects zero reps and a negative weight", () => {
    expect(() => logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 0 })).toThrow();
    expect(() => logSet(sam, { exerciseId: squatId, weightKg: -1, reps: 5 })).toThrow();
  });

  it("rejects an RPE outside 1–10", () => {
    expect(() =>
      logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, rpe: 11 }),
    ).toThrow();
  });

  it("rejects an exercise that is not in the catalogue", () => {
    expect(() => logSet(sam, { exerciseId: "no-such-id", weightKg: 100, reps: 5 })).toThrow(
      UnknownExerciseError,
    );
  });
});

describe("daily volume series", () => {
  it("totals weight × reps per day, oldest first", () => {
    logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: "2026-08-20T09:00:00.000Z" });
    logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 3, performedAt: "2026-08-20T09:10:00.000Z" });
    logSet(sam, { exerciseId: squatId, weightKg: 60, reps: 10, performedAt: "2026-08-21T09:00:00.000Z" });

    expect(volumeByDay(sam, sam.id)).toEqual([
      { day: "2026-08-20", volumeKg: 800, sets: 2 },
      { day: "2026-08-21", volumeKg: 600, sets: 1 },
    ]);
  });

  it("is empty for a user who has logged nothing", () => {
    expect(volumeByDay(sam, sam.id)).toEqual([]);
  });
});

describe("soft delete (BRD §9)", () => {
  it("stamps deleted_at and drops the set from lists and totals", () => {
    const set = logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-20T09:00:00.000Z",
    });

    expect(softDeleteSet(sam, set.id)).toBe(true);
    expect(listSets(sam, sam.id)).toHaveLength(0);
    expect(volumeByDay(sam, sam.id)).toEqual([]);

    const row = getDb()
      .prepare("SELECT deleted_at FROM workout_logs WHERE id = ?")
      .get(set.id) as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull(); // the row survives; only the erasure job removes it
  });
});
