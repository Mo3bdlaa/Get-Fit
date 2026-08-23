import { query, queryOne } from "@/lib/db";
import { assertCan, type Actor } from "@/lib/authz";
import { isUuid } from "@/lib/ids";

/**
 * A workout. Sets belong to one of these, not to a calendar day.
 *
 * There is no start/stop UI yet, so sessions are opened implicitly by the first
 * set and left open. "Open" therefore cannot mean "open forever": without a
 * bound, every set a user ever logged would join their first session and the
 * set numbering they see would climb without end. A session stops being current
 * once nothing has been logged into it for `SESSION_IDLE_MINUTES`, and the next
 * set opens a new one. R1's session UI replaces this with an explicit finish.
 */

export type WorkoutSession = {
  id: string;
  userId: string;
  programId: string | null;
  startedAt: string;
  endedAt: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  program_id: string | null;
  started_at: string;
  ended_at: string | null;
};

const COLUMNS = "id, user_id, program_id, started_at, ended_at";

/** The last moment a session saw activity: its newest live set, else its start. */
const LAST_ACTIVITY = `GREATEST(
  s.started_at,
  COALESCE((SELECT MAX(w.performed_at) FROM workout_logs w
            WHERE w.session_id = s.id AND w.deleted_at IS NULL), s.started_at)
)`;

function idleMinutes(): number {
  const configured = Number(process.env.SESSION_IDLE_MINUTES);
  return Number.isInteger(configured) && configured > 0 ? configured : 6 * 60;
}

function toSession(row: SessionRow): WorkoutSession {
  return {
    id: row.id,
    userId: row.user_id,
    programId: row.program_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export async function startSession(
  actor: Actor,
  options: { programId?: string | null; startedAt?: string } = {},
): Promise<WorkoutSession> {
  await assertCan(actor, "create", { type: "workout_session", ownerId: actor.id });

  const row = await queryOne<SessionRow>(
    `INSERT INTO workout_sessions (user_id, owner_id, program_id, started_at)
     VALUES ($1, $1, $2, COALESCE($3::timestamptz, now()))
     RETURNING ${COLUMNS}`,
    [actor.id, options.programId ?? null, options.startedAt ?? null],
  );
  return toSession(row!);
}

export async function endSession(
  actor: Actor,
  sessionId: string,
  endedAt?: string,
): Promise<boolean> {
  if (!isUuid(sessionId)) return false;

  const owner = await queryOne<{ owner_id: string }>(
    "SELECT owner_id FROM workout_sessions WHERE id = $1 AND deleted_at IS NULL",
    [sessionId],
  );
  if (!owner) return false;

  await assertCan(actor, "update", {
    type: "workout_session",
    ownerId: owner.owner_id,
  });

  // Never earlier than the last set it contains, or the check constraint rejects it.
  await query(
    `UPDATE workout_sessions s
     SET ended_at = GREATEST(COALESCE($2::timestamptz, now()), ${LAST_ACTIVITY}),
         updated_at = now()
     WHERE s.id = $1 AND s.ended_at IS NULL`,
    [sessionId, endedAt ?? null],
  );
  return true;
}

export async function findSession(
  actor: Actor,
  id: string,
): Promise<WorkoutSession | null> {
  if (!isUuid(id)) return null;

  const row = await queryOne<SessionRow & { owner_id: string }>(
    `SELECT ${COLUMNS}, owner_id FROM workout_sessions
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;

  await assertCan(actor, "read", { type: "workout_session", ownerId: row.owner_id });
  return toSession(row);
}

export async function listSessions(
  actor: Actor,
  ownerId: string,
  limit = 50,
): Promise<WorkoutSession[]> {
  await assertCan(actor, "read", { type: "workout_session", ownerId });
  const rows = await query<SessionRow>(
    `SELECT ${COLUMNS} FROM workout_sessions
     WHERE owner_id = $1 AND deleted_at IS NULL
     ORDER BY started_at DESC
     LIMIT $2`,
    [ownerId, limit],
  );
  return rows.map(toSession);
}

/**
 * The session a set performed at `at` belongs to: the most recent open session
 * that had not gone idle by that moment, or a new one.
 *
 * Keyed on `at` rather than `now()`, because a set can be logged with an
 * explicit time — importing a week of training must not collapse into one
 * session.
 */
export async function sessionForSet(
  actor: Actor,
  at: string,
): Promise<WorkoutSession> {
  await assertCan(actor, "create", { type: "workout_session", ownerId: actor.id });

  const open = await queryOne<SessionRow>(
    `SELECT ${COLUMNS} FROM workout_sessions s
     WHERE s.owner_id = $1
       AND s.deleted_at IS NULL
       AND s.ended_at IS NULL
       AND s.started_at <= $2::timestamptz
       AND $2::timestamptz <= ${LAST_ACTIVITY} + make_interval(mins => $3::integer)
     ORDER BY s.started_at DESC
     LIMIT 1`,
    [actor.id, at, idleMinutes()],
  );

  return open ? toSession(open) : startSession(actor, { startedAt: at });
}
