-- Get Fit — initial schema (PostgreSQL).
--
-- Three constraints from the BRD are load-bearing here and must not be relaxed
-- later (§9 "Non-negotiable fields from day one"):
--   1. workout_logs holds ONE ROW PER SET. Retrofitting this rewrites history.
--   2. Every user-generated record carries owner_id and visibility.
--   3. Soft delete via deleted_at everywhere; hard delete only via an erasure job.
--
-- Postgres notes, since this is not a transliteration of the SQLite schema it
-- replaces:
--   - Identifiers are unquoted and lower case throughout, so they fold
--     consistently however a client quotes them.
--   - Keys are `uuid` with a database-side default rather than app-generated
--     text: one fewer thing the application can get wrong, and `RETURNING id`
--     hands the value back on insert.
--   - Instants are `timestamptz`, never a text ISO string. The driver's type
--     parser converts them back to ISO strings at the boundary.
--   - Real numbers are `double precision`, not `numeric`: `numeric` comes back
--     from `pg` as a string, and none of these are money.

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  password_hash    text NOT NULL,
  display_name     text NOT NULL,
  locale           text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  gender           text CHECK (gender IN ('male', 'female', 'unspecified')),
  height_cm        double precision CHECK (height_cm > 0),
  goal             text,
  -- §7: private by default. Sharing is always a deliberate action.
  photo_visibility text NOT NULL DEFAULT 'private'
                   CHECK (photo_visibility IN ('private', 'team_coaches', 'gender_filtered')),
  role             text NOT NULL DEFAULT 'trainee'
                   CHECK (role IN ('trainee', 'coach', 'admin')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Case-insensitive uniqueness on live rows only: a soft-deleted account must not
-- block the address forever, and must not collide with the live one either.
CREATE UNIQUE INDEX users_email_live ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE exercises (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL,
  name_en           text NOT NULL,
  name_ar           text NOT NULL,
  equipment         text NOT NULL,
  primary_muscle    text NOT NULL,
  secondary_muscles text NOT NULL DEFAULT '',
  -- 'global' = the moderated catalogue. 'private' = owned by owner_id only
  -- (coach submissions awaiting moderation, §6 step 3).
  visibility        text NOT NULL DEFAULT 'global'
                    CHECK (visibility IN ('global', 'private')),
  owner_id          uuid REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  -- A private exercise without an owner has no one who can see it; a global one
  -- with an owner is a moderation decision that lost its provenance.
  CONSTRAINT exercises_owner_matches_visibility
    CHECK ((visibility = 'private') = (owner_id IS NOT NULL))
);

CREATE UNIQUE INDEX exercises_slug_live ON exercises (slug) WHERE deleted_at IS NULL;

-- ONE ROW PER SET. set_index is the set's ordinal within one session/exercise.
CREATE TABLE workout_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users (id),
  exercise_id  uuid NOT NULL REFERENCES exercises (id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  set_index    integer NOT NULL CHECK (set_index >= 1),
  weight_kg    double precision NOT NULL CHECK (weight_kg >= 0),
  reps         integer NOT NULL CHECK (reps >= 1),
  rpe          double precision CHECK (rpe >= 1 AND rpe <= 10),
  notes        text,
  visibility   text NOT NULL DEFAULT 'private'
               CHECK (visibility IN ('private', 'team_coaches')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX workout_logs_owner_performed ON workout_logs (owner_id, performed_at);

-- NFR7: every access to another user's data is recorded. Written by the
-- authorisation layer, never by a route handler.
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL,
  subject_id    uuid NOT NULL,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_subject ON audit_log (subject_id, created_at);
