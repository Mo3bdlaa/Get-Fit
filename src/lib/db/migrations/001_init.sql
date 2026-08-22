-- Get Fit — initial schema.
--
-- Three constraints from the BRD are load-bearing here and must not be relaxed
-- later (§9 "Non-negotiable fields from day one"):
--   1. workout_logs holds ONE ROW PER SET. Retrofitting this rewrites history.
--   2. Every user-generated record carries owner_id and visibility.
--   3. Soft delete via deleted_at everywhere; hard delete only via an erasure job.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  locale         TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  gender         TEXT CHECK (gender IN ('male', 'female', 'unspecified')),
  height_cm      REAL,
  goal           TEXT,
  -- §7: private by default. Sharing is always a deliberate action.
  photo_visibility TEXT NOT NULL DEFAULT 'private'
                   CHECK (photo_visibility IN ('private', 'team_coaches', 'gender_filtered')),
  role           TEXT NOT NULL DEFAULT 'trainee'
                   CHECK (role IN ('trainee', 'coach', 'admin')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

-- Case-insensitive uniqueness on live rows only: a soft-deleted account must not
-- block the address forever, and must not collide with the live one either.
CREATE UNIQUE INDEX users_email_live ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE exercises (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL,
  name_en            TEXT NOT NULL,
  name_ar            TEXT NOT NULL,
  equipment          TEXT NOT NULL,
  primary_muscle     TEXT NOT NULL,
  secondary_muscles  TEXT NOT NULL DEFAULT '',
  -- 'global' = the moderated catalogue. 'private' = owned by owner_id only
  -- (coach submissions awaiting moderation, §6 step 3).
  visibility         TEXT NOT NULL DEFAULT 'global'
                     CHECK (visibility IN ('global', 'private')),
  owner_id           TEXT REFERENCES users (id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);

CREATE UNIQUE INDEX exercises_slug_live ON exercises (slug) WHERE deleted_at IS NULL;

-- ONE ROW PER SET. set_index is the set's ordinal within one session/exercise.
CREATE TABLE workout_logs (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users (id),
  exercise_id   TEXT NOT NULL REFERENCES exercises (id),
  performed_at  TEXT NOT NULL,
  set_index     INTEGER NOT NULL CHECK (set_index >= 1),
  weight_kg     REAL NOT NULL CHECK (weight_kg >= 0),
  reps          INTEGER NOT NULL CHECK (reps >= 1),
  rpe           REAL CHECK (rpe >= 1 AND rpe <= 10),
  notes         TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private', 'team_coaches')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX workout_logs_owner_performed ON workout_logs (owner_id, performed_at);

-- NFR7: every access to another user's data is recorded. Written by the
-- authorisation layer, never by a route handler.
CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY,
  actor_id       TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX audit_log_subject ON audit_log (subject_id, created_at);
