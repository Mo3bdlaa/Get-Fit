-- workout_sessions: a set belongs to a workout, not to a calendar day.
--
-- Day-based attribution could not tell two workouts on one day apart, had
-- nowhere to record which programme prescribed the work, and would not survive
-- R1's "execute a programme session by session".
--
-- `user_id` and `owner_id` are both required by the brief and are the same
-- person for every row that exists today, so the check constraint stops them
-- drifting apart by accident. See docs/decisions.md.

CREATE TABLE workout_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  owner_id   uuid NOT NULL REFERENCES users (id),
  -- No FK yet: `programs` arrives in R1. The column exists now so that logged
  -- sets can be traced back to what prescribed them from the first programme.
  program_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  visibility text NOT NULL DEFAULT 'private'
             CHECK (visibility IN ('private', 'team_coaches')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT workout_sessions_owner_is_user CHECK (owner_id = user_id),
  CONSTRAINT workout_sessions_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Finding the open session is the hot path on every logged set.
CREATE INDEX workout_sessions_owner_open
  ON workout_sessions (owner_id, started_at DESC)
  WHERE deleted_at IS NULL AND ended_at IS NULL;

ALTER TABLE workout_logs ADD COLUMN session_id uuid REFERENCES workout_sessions (id);

-- Backfill: one session per owner per UTC day, spanning that day's sets. This
-- reproduces exactly what day-based attribution meant, so no set changes the
-- workout it belongs to and no set_index changes value.
INSERT INTO workout_sessions (user_id, owner_id, started_at, ended_at, created_at)
SELECT owner_id, owner_id, MIN(performed_at), MAX(performed_at), MIN(performed_at)
FROM workout_logs
GROUP BY owner_id, (performed_at AT TIME ZONE 'UTC')::date;

UPDATE workout_logs w
SET session_id = s.id
FROM workout_sessions s
WHERE s.owner_id = w.owner_id
  AND (w.performed_at AT TIME ZONE 'UTC')::date = (s.started_at AT TIME ZONE 'UTC')::date
  AND w.session_id IS NULL;

ALTER TABLE workout_logs ALTER COLUMN session_id SET NOT NULL;

-- set_index is now unique within (session, exercise) rather than within a day.
CREATE UNIQUE INDEX workout_logs_session_exercise_set
  ON workout_logs (session_id, exercise_id, set_index)
  WHERE deleted_at IS NULL;
