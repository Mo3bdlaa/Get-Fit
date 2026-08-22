import { beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { AuthorizationError, assertCan, can } from "@/lib/authz";
import { findExerciseBySlug } from "@/lib/repo/exercises";
import { listSets, logSet, softDeleteSet, volumeByDay } from "@/lib/repo/workoutLogs";
import type { Actor } from "@/lib/authz";
import { freshDatabase, makeUser } from "./helpers";

let sam: Actor;
let alex: Actor;
let coach: Actor;
let admin: Actor;

async function auditRowCount(): Promise<number> {
  const rows = await query<{ n: number }>("SELECT COUNT(*)::integer AS n FROM audit_log");
  return rows[0].n;
}

beforeEach(async () => {
  await freshDatabase();
  sam = await makeUser("sam@example.com");
  alex = await makeUser("alex@example.com");
  coach = await makeUser("coach@example.com", { role: "coach" });
  admin = await makeUser("admin@example.com", { role: "admin" });

  await logSet(sam, {
    exerciseId: (await findExerciseBySlug("barbell-back-squat"))!.id,
    weightKg: 100,
    reps: 5,
  });
});

describe("a trainee's logs are theirs alone", () => {
  it("lets the owner read, list, and delete their own sets", async () => {
    expect(await listSets(sam, sam.id)).toHaveLength(1);
    expect(can(sam, "delete", { type: "workout_log", ownerId: sam.id })).toBe(true);
  });

  it("refuses another trainee, by list, by total, and by delete", async () => {
    await expect(listSets(alex, sam.id)).rejects.toThrow(AuthorizationError);
    await expect(volumeByDay(alex, sam.id)).rejects.toThrow(AuthorizationError);

    const setId = (await listSets(sam, sam.id))[0].id;
    await expect(softDeleteSet(alex, setId)).rejects.toThrow(AuthorizationError);
    expect(await listSets(sam, sam.id)).toHaveLength(1);
  });

  it("refuses a coach with no team membership (teams arrive in R3)", async () => {
    await expect(listSets(coach, sam.id)).rejects.toThrow(AuthorizationError);
  });

  it("refuses an admin write even though admin reads are allowed", () => {
    expect(can(admin, "read", { type: "workout_log", ownerId: sam.id })).toBe(true);
    expect(can(admin, "update", { type: "workout_log", ownerId: sam.id })).toBe(false);
    expect(can(admin, "delete", { type: "workout_log", ownerId: sam.id })).toBe(false);
  });
});

describe("audit log (NFR7)", () => {
  it("records an admin reading another user's data", async () => {
    await listSets(admin, sam.id);

    const rows = await query<{
      actor_id: string;
      subject_id: string;
      action: string;
      resource_type: string;
    }>("SELECT actor_id, subject_id, action, resource_type FROM audit_log");

    expect(rows).toEqual([
      {
        actor_id: admin.id,
        subject_id: sam.id,
        action: "read",
        resource_type: "workout_log",
      },
    ]);
  });

  it("does not record a user reading their own data", async () => {
    await listSets(sam, sam.id);
    expect(await auditRowCount()).toBe(0);
  });

  it("does not record a refused access as a grant", async () => {
    await expect(listSets(alex, sam.id)).rejects.toThrow(AuthorizationError);
    expect(await auditRowCount()).toBe(0);
  });

  it("commits the audit row before the data is returned", async () => {
    // assertCan is awaited, not fire-and-forget: by the time the caller has the
    // rows, the NFR7 record is already durable.
    const sets = await listSets(admin, sam.id);
    expect(sets).toHaveLength(1);
    expect(await auditRowCount()).toBe(1);
  });
});

describe("catalogue permissions (§6, §10)", () => {
  it("is readable by everyone and writable only by an admin", () => {
    expect(can(sam, "read", { type: "exercise", visibility: "global", ownerId: null })).toBe(true);
    expect(can(coach, "update", { type: "exercise", visibility: "global", ownerId: null })).toBe(false);
    expect(can(admin, "update", { type: "exercise", visibility: "global", ownerId: null })).toBe(true);
  });

  it("hides another coach's unmoderated submission", () => {
    expect(can(sam, "read", { type: "exercise", visibility: "private", ownerId: coach.id })).toBe(false);
    expect(can(coach, "read", { type: "exercise", visibility: "private", ownerId: coach.id })).toBe(true);
  });

  it("throws AuthorizationError rather than returning silently", async () => {
    await expect(
      assertCan(alex, "read", { type: "workout_log", ownerId: sam.id }),
    ).rejects.toThrow(AuthorizationError);
  });
});
