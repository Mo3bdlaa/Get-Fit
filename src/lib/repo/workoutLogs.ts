import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/ids";
import { assertCan, type Actor } from "@/lib/authz";
import { findExerciseById } from "@/lib/repo/exercises";

/**
 * One row per set — the BRD's first non-negotiable (§9). Nothing here ever
 * aggregates sets into a "3x5" record; the chart derives volume from the rows.
 */

export type LoggedSet = {
  id: string;
  ownerId: string;
  exerciseId: string;
  exerciseNameEn: string;
  exerciseNameAr: string;
  performedAt: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  notes: string | null;
};

export const setSchema = z.object({
  exerciseId: z.string().min(1),
  performedAt: z.string().datetime().optional(),
  weightKg: z.coerce.number().min(0).max(1000),
  reps: z.coerce.number().int().min(1).max(100),
  rpe: z.coerce.number().min(1).max(10).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export type SetInput = z.input<typeof setSchema>;

export class UnknownExerciseError extends Error {
  constructor() {
    super("That exercise is not in the catalogue");
    this.name = "UnknownExerciseError";
  }
}

type SetRow = {
  id: string;
  owner_id: string;
  exercise_id: string;
  name_en: string;
  name_ar: string;
  performed_at: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  notes: string | null;
};

const SELECT_SETS = `
  SELECT w.id, w.owner_id, w.exercise_id, e.name_en, e.name_ar,
         w.performed_at, w.set_index, w.weight_kg, w.reps, w.rpe, w.notes
  FROM workout_logs w
  JOIN exercises e ON e.id = w.exercise_id
  WHERE w.owner_id = ? AND w.deleted_at IS NULL`;

function toSet(row: SetRow): LoggedSet {
  return {
    id: row.id,
    ownerId: row.owner_id,
    exerciseId: row.exercise_id,
    exerciseNameEn: row.name_en,
    exerciseNameAr: row.name_ar,
    performedAt: row.performed_at,
    setIndex: row.set_index,
    weightKg: row.weight_kg,
    reps: row.reps,
    rpe: row.rpe,
    notes: row.notes,
  };
}

/** set_index is derived, never supplied: it is the next set of that exercise that day. */
function nextSetIndex(ownerId: string, exerciseId: string, day: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(set_index), 0) AS max_index
       FROM workout_logs
       WHERE owner_id = ? AND exercise_id = ? AND date(performed_at) = date(?)
         AND deleted_at IS NULL`,
    )
    .get(ownerId, exerciseId, day) as { max_index: number };
  return row.max_index + 1;
}

export function logSet(actor: Actor, input: SetInput): LoggedSet {
  const parsed = setSchema.parse(input);
  assertCan(actor, "create", { type: "workout_log", ownerId: actor.id });

  if (!findExerciseById(parsed.exerciseId)) throw new UnknownExerciseError();

  const performedAt = parsed.performedAt ?? nowIso();
  const now = nowIso();
  const id = newId();

  getDb()
    .prepare(
      `INSERT INTO workout_logs
         (id, owner_id, exercise_id, performed_at, set_index, weight_kg, reps, rpe, notes,
          visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
    )
    .run(
      id,
      actor.id,
      parsed.exerciseId,
      performedAt,
      nextSetIndex(actor.id, parsed.exerciseId, performedAt),
      parsed.weightKg,
      parsed.reps,
      parsed.rpe ?? null,
      parsed.notes ?? null,
      now,
      now,
    );

  return findSet(actor, id)!;
}

export function findSet(actor: Actor, id: string): LoggedSet | null {
  const row = getDb()
    .prepare(
      `SELECT w.id, w.owner_id, w.exercise_id, e.name_en, e.name_ar,
              w.performed_at, w.set_index, w.weight_kg, w.reps, w.rpe, w.notes
       FROM workout_logs w JOIN exercises e ON e.id = w.exercise_id
       WHERE w.id = ? AND w.deleted_at IS NULL`,
    )
    .get(id) as SetRow | undefined;
  if (!row) return null;

  assertCan(actor, "read", { type: "workout_log", ownerId: row.owner_id });
  return toSet(row);
}

export function listSets(actor: Actor, ownerId: string, limit = 50): LoggedSet[] {
  assertCan(actor, "read", { type: "workout_log", ownerId });
  const rows = getDb()
    .prepare(`${SELECT_SETS} ORDER BY w.performed_at DESC, w.set_index DESC LIMIT ?`)
    .all(ownerId, limit) as SetRow[];
  return rows.map(toSet);
}

export function softDeleteSet(actor: Actor, id: string): boolean {
  const row = getDb()
    .prepare("SELECT owner_id FROM workout_logs WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { owner_id: string } | undefined;
  if (!row) return false;

  assertCan(actor, "delete", { type: "workout_log", ownerId: row.owner_id });
  const now = nowIso();
  getDb()
    .prepare("UPDATE workout_logs SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  return true;
}

export type VolumePoint = { day: string; volumeKg: number; sets: number };

/** Daily training volume (Σ weight × reps) — the R0 chart's series. */
export function volumeByDay(actor: Actor, ownerId: string): VolumePoint[] {
  assertCan(actor, "read", { type: "workout_log", ownerId });
  const rows = getDb()
    .prepare(
      `SELECT date(performed_at) AS day,
              SUM(weight_kg * reps) AS volume_kg,
              COUNT(*) AS sets
       FROM workout_logs
       WHERE owner_id = ? AND deleted_at IS NULL
       GROUP BY date(performed_at)
       ORDER BY day`,
    )
    .all(ownerId) as { day: string; volume_kg: number; sets: number }[];

  return rows.map((row) => ({
    day: row.day,
    volumeKg: row.volume_kg,
    sets: row.sets,
  }));
}
