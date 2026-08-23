import { beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { AuthorizationError } from "@/lib/authz";
import { findExerciseBySlug } from "@/lib/repo/exercises";
import { listSets, logSet, volumeByDay } from "@/lib/repo/workoutLogs";
import {
  endSession,
  findSession,
  listSessions,
  startSession,
} from "@/lib/repo/workoutSessions";
import type { Actor } from "@/lib/authz";
import { freshDatabase, makeUser } from "./helpers";

let sam: Actor;
let alex: Actor;
let admin: Actor;
let squatId: string;
let benchId: string;

const DAY = "2026-08-20";
const at = (time: string) => `${DAY}T${time}:00.000Z`;

beforeEach(async () => {
  await freshDatabase();
  sam = await makeUser("sam@example.com");
  alex = await makeUser("alex@example.com");
  admin = await makeUser("admin@example.com", { role: "admin" });
  squatId = (await findExerciseBySlug("barbell-back-squat"))!.id;
  benchId = (await findExerciseBySlug("barbell-bench-press"))!.id;
});

describe("every set belongs to a session", () => {
  it("opens one implicitly for the first set and reuses it for the rest", async () => {
    const first = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("09:00") });
    const second = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("09:05") });

    expect(first.sessionId).toBeTruthy();
    expect(second.sessionId).toBe(first.sessionId);
    expect(await listSessions(sam, sam.id)).toHaveLength(1);
  });

  it("never leaves a set without a session", async () => {
    await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("09:00") });
    const orphans = await query<{ n: number }>(
      "SELECT COUNT(*)::integer AS n FROM workout_logs WHERE session_id IS NULL",
    );
    expect(orphans[0].n).toBe(0);
  });
});

describe("two sessions on one calendar day", () => {
  it("numbers each session's sets from 1 and keeps them apart", async () => {
    const morningFirst = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("07:00") });
    const morningSecond = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("07:10") });
    await endSession(sam, morningFirst.sessionId, at("07:30"));

    const eveningFirst = await logSet(sam, { exerciseId: squatId, weightKg: 110, reps: 3, performedAt: at("18:00") });
    const eveningSecond = await logSet(sam, { exerciseId: squatId, weightKg: 110, reps: 3, performedAt: at("18:10") });

    expect([morningFirst.setIndex, morningSecond.setIndex]).toEqual([1, 2]);
    expect([eveningFirst.setIndex, eveningSecond.setIndex]).toEqual([1, 2]);
    expect(eveningFirst.sessionId).not.toBe(morningFirst.sessionId);
    expect(await listSessions(sam, sam.id)).toHaveLength(2);
  });

  it("charts them as one day, exactly as before sessions existed", async () => {
    const morning = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("07:00") });
    await endSession(sam, morning.sessionId, at("07:30"));
    await logSet(sam, { exerciseId: squatId, weightKg: 50, reps: 10, performedAt: at("18:00") });

    expect(await volumeByDay(sam, sam.id)).toEqual([
      { day: DAY, volumeKg: 1000, sets: 2 },
    ]);
  });

  it("counts each exercise separately within one session", async () => {
    const squat = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("09:00") });
    const bench = await logSet(sam, { exerciseId: benchId, weightKg: 60, reps: 8, performedAt: at("09:20") });

    expect(squat.sessionId).toBe(bench.sessionId);
    expect(squat.setIndex).toBe(1);
    expect(bench.setIndex).toBe(1);
  });
});

describe("an idle session stops being the current one", () => {
  it("opens a new session once nothing has been logged for the idle window", async () => {
    const first = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("06:00") });
    // Default idle window is six hours; this is seven after the last set.
    const later = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("13:00") });

    expect(later.sessionId).not.toBe(first.sessionId);
    expect(later.setIndex).toBe(1);
  });

  it("keeps a long session together while sets keep arriving", async () => {
    const first = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("06:00") });
    await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("11:00") });
    const last = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("16:00") });

    expect(last.sessionId).toBe(first.sessionId);
    expect(last.setIndex).toBe(3);
  });

  it("does not swallow a backdated set into an unrelated later session", async () => {
    const today = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("09:00") });
    const lastWeek = await logSet(sam, {
      exerciseId: squatId,
      weightKg: 90,
      reps: 5,
      performedAt: "2026-08-13T09:00:00.000Z",
    });

    expect(lastWeek.sessionId).not.toBe(today.sessionId);
    expect(await listSessions(sam, sam.id)).toHaveLength(2);
  });
});

describe("closing a session", () => {
  it("stamps ended_at and refuses to end before the last set", async () => {
    const set = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5, performedAt: at("09:00") });

    expect(await endSession(sam, set.sessionId, at("08:00"))).toBe(true);

    const session = (await findSession(sam, set.sessionId))!;
    expect(session.endedAt).not.toBeNull();
    expect(new Date(session.endedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(at("09:00")).getTime(),
    );
  });

  it("reports nothing closed for an id that is not a session", async () => {
    expect(await endSession(sam, "not-a-uuid")).toBe(false);
    expect(await endSession(sam, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});

describe("sessions go through the authorisation layer (§10)", () => {
  it("refuses another trainee reading, listing, or closing them", async () => {
    const set = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5 });

    await expect(findSession(alex, set.sessionId)).rejects.toThrow(AuthorizationError);
    await expect(listSessions(alex, sam.id)).rejects.toThrow(AuthorizationError);
    await expect(endSession(alex, set.sessionId)).rejects.toThrow(AuthorizationError);
  });

  it("lets an admin read one, and records it in the audit log (NFR7)", async () => {
    const set = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5 });
    await findSession(admin, set.sessionId);

    const rows = await query<{ subject_id: string; resource_type: string }>(
      "SELECT subject_id, resource_type FROM audit_log WHERE actor_id = $1",
      [admin.id],
    );
    expect(rows).toEqual([{ subject_id: sam.id, resource_type: "workout_session" }]);
  });

  it("refuses an admin closing one", async () => {
    const set = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5 });
    await expect(endSession(admin, set.sessionId)).rejects.toThrow(AuthorizationError);
  });

  it("only ever opens a session for the actor themselves", async () => {
    const session = await startSession(sam);
    const rows = await query<{ user_id: string; owner_id: string }>(
      "SELECT user_id, owner_id FROM workout_sessions WHERE id = $1",
      [session.id],
    );
    expect(rows[0]).toEqual({ user_id: sam.id, owner_id: sam.id });
  });
});

describe("the sets of a session", () => {
  it("come back with the session they belong to", async () => {
    const set = await logSet(sam, { exerciseId: squatId, weightKg: 100, reps: 5 });
    const [listed] = await listSets(sam, sam.id);
    expect(listed.sessionId).toBe(set.sessionId);
  });
});
