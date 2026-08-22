import { beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
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
  await freshDatabase();
  sam = await makeUser("sam@example.com");
  squatId = (await findExerciseBySlug("barbell-back-squat"))!.id;
});

describe("one row per set (BRD §9)", () => {
  it("writes a separate row per set and numbers them within the day", async () => {
    for (let i = 0; i < 3; i += 1) {
      await logSet(sam, {
        exerciseId: squatId,
        weightKg: 100,
        reps: 5,
        performedAt: "2026-08-20T09:00:00.000Z",
      });
    }

    const rows = await query<{ set_index: number }>(
      "SELECT set_index FROM workout_logs WHERE owner_id = $1 ORDER BY set_index",
      [sam.id],
    );

    expect(rows.map((row) => row.set_index)).toEqual([1, 2, 3]);
  });

  it("restarts set numbering on a new day", async () => {
    await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-20T09:00:00.000Z",
    });
    const nextDay = await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-21T09:00:00.000Z",
    });

    expect(nextDay.setIndex).toBe(1);
  });

  it("groups a day by UTC, not by the server's local zone", async () => {
    // 23:30 UTC and 00:30 UTC the next day are different days even though they
    // are 60 minutes apart. Whatever TZ the test host runs in, this must hold.
    await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-20T23:30:00.000Z",
    });
    const afterMidnight = await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-21T00:30:00.000Z",
    });

    expect(afterMidnight.setIndex).toBe(1);
    expect((await volumeByDay(sam, sam.id)).map((point) => point.day)).toEqual([
      "2026-08-20",
      "2026-08-21",
    ]);
  });

  it("stores RPE and notes when given, and null when not", async () => {
    const withDetail = await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      rpe: 8.5,
      notes: "Felt fast",
    });
    const without = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5 });

    expect(withDetail.rpe).toBe(8.5);
    expect(withDetail.notes).toBe("Felt fast");
    expect(without.rpe).toBeNull();
    expect(without.notes).toBeNull();
  });

  it("returns the set with its numeric columns as numbers, not strings", async () => {
    const set = await logSet(sam, {
      exerciseId: squatId,
      weightKg: 102.5,
      reps: 5,
      rpe: 8,
    });

    expect(set.weightKg).toBe(102.5);
    expect(set.reps).toBe(5);
    expect(set.rpe).toBe(8);
    expect(typeof set.performedAt).toBe("string");
  });
});

describe("validation", () => {
  it("rejects zero reps and a negative weight", async () => {
    await expect(
      logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 0 }),
    ).rejects.toThrow();
    await expect(
      logSet(sam, { exerciseId: squatId, weightKg: -1, reps: 5 }),
    ).rejects.toThrow();
  });

  it("rejects an RPE outside 1–10", async () => {
    await expect(
      logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, rpe: 11 }),
    ).rejects.toThrow();
  });

  it("rejects an exercise that is not in the catalogue", async () => {
    await expect(
      logSet(sam, { exerciseId: "no-such-id", weightKg: 100, reps: 5 }),
    ).rejects.toThrow(UnknownExerciseError);

    await expect(
      logSet(sam, {
        exerciseId: "00000000-0000-4000-8000-000000000000",
        weightKg: 100,
        reps: 5,
      }),
    ).rejects.toThrow(UnknownExerciseError);
  });
});

describe("daily volume series", () => {
  it("totals weight × reps per day, oldest first", async () => {
    await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-20T09:00:00.000Z",
    });
    await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 3,
      performedAt: "2026-08-20T09:10:00.000Z",
    });
    await logSet(sam, {
      exerciseId: squatId,
      weightKg: 60,
      reps: 10,
      performedAt: "2026-08-21T09:00:00.000Z",
    });

    expect(await volumeByDay(sam, sam.id)).toEqual([
      { day: "2026-08-20", volumeKg: 800, sets: 2 },
      { day: "2026-08-21", volumeKg: 600, sets: 1 },
    ]);
  });

  it("is empty for a user who has logged nothing", async () => {
    expect(await volumeByDay(sam, sam.id)).toEqual([]);
  });
});

describe("soft delete (BRD §9)", () => {
  it("stamps deleted_at and drops the set from lists and totals", async () => {
    const set = await logSet(sam, {
      exerciseId: squatId,
      weightKg: 100,
      reps: 5,
      performedAt: "2026-08-20T09:00:00.000Z",
    });

    expect(await softDeleteSet(sam, set.id)).toBe(true);
    expect(await listSets(sam, sam.id)).toHaveLength(0);
    expect(await volumeByDay(sam, sam.id)).toEqual([]);

    const rows = await query<{ deleted_at: string | null }>(
      "SELECT deleted_at FROM workout_logs WHERE id = $1",
      [set.id],
    );
    // The row survives; only the erasure job removes it.
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("reports nothing deleted for an id that is not a set", async () => {
    expect(await softDeleteSet(sam, "not-a-uuid")).toBe(false);
    expect(await softDeleteSet(sam, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});
