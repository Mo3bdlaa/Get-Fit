import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/authz";
import { findExerciseById } from "@/lib/repo/exercises";
import { sessionForSet } from "@/lib/repo/workoutSessions";
import { isUuid } from "@/lib/ids";

/**
 * One row per set — the BRD's first non-negotiable (§9). Nothing here ever
 * aggregates sets into a "3x5" record; the chart derives volume from the rows.
 *
 * A set belongs to a **session**, not to a day: `set_index` counts within
 * (session, exercise). The chart still groups by the UTC calendar day, across
 * whatever sessions fall in it, so what the user sees there is unchanged.
 * Per-user timezones are R1 work, alongside the profile.
 */

export type LoggedSet = {
  id: string;
  ownerId: string;
  sessionId: string;
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
  session_id: string;
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

const SELECT_SET = `
  SELECT w.id, w.owner_id, w.session_id, w.exercise_id, e.name_en, e.name_ar,
         w.performed_at, w.set_index, w.weight_kg, w.reps, w.rpe, w.notes
  FROM workout_logs w
  JOIN exercises e ON e.id = w.exercise_id`;

/** The UTC calendar day of a timestamp column, as Postgres sees it. */
const UTC_DAY = (column: string) => `(${column} AT TIME ZONE 'UTC')::date`;

function toSet(row: SetRow): LoggedSet {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
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

export async function logSet(actor: Actor, input: SetInput): Promise<LoggedSet> {
  const parsed = setSchema.parse(input);
  await assertCan(actor, "create", { type: "workout_log", ownerId: actor.id });

  if (!(await findExerciseById(parsed.exerciseId))) throw new UnknownExerciseError();

  const performedAt = parsed.performedAt ?? new Date().toISOString();
  const session = await sessionForSet(actor, performedAt);

  // set_index is derived, never supplied: the next set of that exercise in this
  // session. Deriving it inside the INSERT rather than in a prior SELECT means
  // two sets logged at once cannot both read the same maximum — and the unique
  // index on (session_id, exercise_id, set_index) rejects it if they somehow do.
  const rows = await query<{ id: string }>(
    `INSERT INTO workout_logs
       (owner_id, session_id, exercise_id, performed_at, set_index, weight_kg, reps, rpe, notes)
     SELECT $1::uuid, $2::uuid, $3::uuid, $4::timestamptz,
            COALESCE(MAX(w.set_index), 0) + 1,
            $5::double precision, $6::integer, $7::double precision, $8::text
     FROM workout_logs w
     WHERE w.session_id = $2::uuid
       AND w.exercise_id = $3::uuid
       AND w.deleted_at IS NULL
     RETURNING id`,
    [
      actor.id,
      session.id,
      parsed.exerciseId,
      performedAt,
      parsed.weightKg,
      parsed.reps,
      parsed.rpe ?? null,
      parsed.notes ?? null,
    ],
  );

  return (await findSet(actor, rows[0].id))!;
}

export async function findSet(actor: Actor, id: string): Promise<LoggedSet | null> {
  if (!isUuid(id)) return null;

  const row = await queryOne<SetRow>(
    `${SELECT_SET} WHERE w.id = $1 AND w.deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;

  await assertCan(actor, "read", { type: "workout_log", ownerId: row.owner_id });
  return toSet(row);
}

export async function listSets(
  actor: Actor,
  ownerId: string,
  limit = 50,
): Promise<LoggedSet[]> {
  await assertCan(actor, "read", { type: "workout_log", ownerId });
  const rows = await query<SetRow>(
    `${SELECT_SET}
     WHERE w.owner_id = $1 AND w.deleted_at IS NULL
     ORDER BY w.performed_at DESC, w.set_index DESC
     LIMIT $2`,
    [ownerId, limit],
  );
  return rows.map(toSet);
}

export async function softDeleteSet(actor: Actor, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;

  const row = await queryOne<{ owner_id: string }>(
    "SELECT owner_id FROM workout_logs WHERE id = $1 AND deleted_at IS NULL",
    [id],
  );
  if (!row) return false;

  await assertCan(actor, "delete", { type: "workout_log", ownerId: row.owner_id });
  await query(
    "UPDATE workout_logs SET deleted_at = now(), updated_at = now() WHERE id = $1",
    [id],
  );
  return true;
}

export type VolumePoint = { day: string; volumeKg: number; sets: number };

/**
 * Daily training volume (Σ weight × reps) — the R0 chart's series.
 *
 * Aggregates across sessions: two workouts on one day are one point, which is
 * what the chart showed before sessions existed.
 */
export async function volumeByDay(
  actor: Actor,
  ownerId: string,
): Promise<VolumePoint[]> {
  await assertCan(actor, "read", { type: "workout_log", ownerId });

  // `count(*)` is bigint, which `pg` hands back as a string — cast it here so
  // the domain type is honest. `to_char` keeps the day a calendar string rather
  // than a Date pinned to the server's zone.
  const rows = await query<{ day: string; volume_kg: number; sets: number }>(
    `SELECT to_char(${UTC_DAY("performed_at")}, 'YYYY-MM-DD') AS day,
            SUM(weight_kg * reps)::double precision AS volume_kg,
            COUNT(*)::integer AS sets
     FROM workout_logs
     WHERE owner_id = $1 AND deleted_at IS NULL
     GROUP BY ${UTC_DAY("performed_at")}
     ORDER BY 1`,
    [ownerId],
  );

  return rows.map((row) => ({
    day: row.day,
    volumeKg: row.volume_kg,
    sets: row.sets,
  }));
}
