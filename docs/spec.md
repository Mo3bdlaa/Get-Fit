# Spec — Get Fit R0 (walking skeleton)

Scope for this round is **R0** from the BRD's release plan (§13): auth, one
exercise, log one set, see it on a chart. Everything else in the BRD — the AI
equipment scan, programmes, teams, coaches, progress photos, nutrition — is out
of scope here and stays in the backlog until R0's exit criterion is met.

Section references below (§n) point at `docs/brd.md`.

## Goal

A registered user can sign in on a phone, log a set of a catalogue exercise, and
see their training volume on a chart. The slice runs end to end against a real
database, in English and Arabic, with the data model's non-negotiable fields and
the central authorisation layer in place from the first commit — because §9 says
retrofitting either one means rewriting history.

## Verify command

`npm run verify` — lint, typecheck, unit tests, production build. Runs in about
30 seconds, inside the Stop hook's 45-second budget.

The end-to-end browser test is **not** in `verify`: it builds and boots the app,
which takes about 30 seconds on its own. Run it with `npm run test:e2e`, or
`npm run verify:full` for both. CI runs the full set on every push.

## Acceptance criteria

1. A new user registers with email, password, name, and language, and lands
   signed in on the log screen. A password under 10 characters is rejected, and
   a second registration with the same address in any casing is rejected with a
   distinct error. — Test: `tests/auth.test.ts`, `e2e/walking-skeleton.spec.ts`
2. The stored password is not recoverable: the `users.password_hash` column
   contains neither the password nor a reversible encoding of it, and two
   registrations of the same password produce different hashes. — Test:
   `tests/auth.test.ts`
3. Signing in with the wrong password, or an unknown address, returns no session
   and no user object. Address matching is case-insensitive. — Test:
   `tests/auth.test.ts`
4. A session token round-trips the user id; a missing, tampered, expired, or
   foreign-signed token resolves to no session. — Test: `tests/auth.test.ts`
5. An unauthenticated request to `/log` or `/progress` redirects to `/login`. —
   Test: `e2e/walking-skeleton.spec.ts`
6. Logging three sets of one exercise on one day writes **three rows** to
   `workout_logs` with `set_index` 1, 2, 3; the next day's first set is
   `set_index` 1 again. No code path aggregates sets into a single row (§9). —
   Test: `tests/workout-log.test.ts`
7. A set records weight, reps, and optional RPE and notes. Zero reps, a negative
   weight, an RPE outside 1–10, and an exercise id absent from the catalogue are
   each rejected. — Test: `tests/workout-log.test.ts`
8. Deleting a set is a soft delete: `deleted_at` is stamped, the row remains in
   the table, and the set disappears from listings and from the volume totals
   (§9). — Test: `tests/workout-log.test.ts`
9. The progress chart series is daily volume, Σ (weight × reps) per calendar day,
   ordered oldest first, and empty for a user who has logged nothing. — Test:
   `tests/workout-log.test.ts`
10. Chart geometry is correct without a DOM: an empty series draws nothing, a
    single day renders one centred dot rather than a degenerate line, the highest
    day sits at the top, days run left to right, and every point stays inside the
    viewbox. — Test: `tests/chart.test.ts`
11. Every read or write of a user-owned record goes through `assertCan` in
    `src/lib/authz.ts`. A second trainee cannot list, total, or delete another
    user's sets; a coach with no team membership cannot either; an admin may read
    but not write. No route handler filters by owner itself (§10). — Test:
    `tests/authz.test.ts`
12. An admin reading another user's data writes exactly one `audit_log` row
    naming actor, subject, action, and resource type. Reading one's own data
    writes none, and a refused access writes none (NFR7). — Test:
    `tests/authz.test.ts`
13. The catalogue is readable by any signed-in user and writable only by an
    admin; a coach's unmoderated private submission is invisible to other users
    (§6). — Test: `tests/authz.test.ts`
14. Every user-facing string is externalised, and the Arabic catalogue supplies a
    non-empty, actually-translated value for every English key (NFR6). — Test:
    `tests/i18n.test.ts`
15. An account whose locale is `ar` gets `<html lang="ar" dir="rtl">` and Arabic
    copy; an `en` account gets `lang="en" dir="ltr"` (NFR6). — Test:
    `tests/i18n.test.ts`, `e2e/walking-skeleton.spec.ts`
16. The "not medical advice" disclaimer is present on every screen in both
    languages, as page content rather than a dismissible modal (§8.3). — Test:
    `tests/i18n.test.ts`, `e2e/walking-skeleton.spec.ts`
17. Migrations apply from an empty database and are idempotent; the catalogue
    seed can run repeatedly without duplicating rows, and every seeded exercise
    carries an Arabic name (§6). — Test: `tests/db.test.ts`
18. The end-to-end path works in a real browser at a phone viewport: register,
    log a set, see it in the recent list, see it on the chart, sign out. — Test:
    `e2e/walking-skeleton.spec.ts`

## Out of scope

- AI equipment scan and AI programme generation (R2) — including the §8.3
  guardrails and the §8.4 quota, which land with the feature that needs them.
- Teams, invites, coach applications, coach visibility (R3).
- Progress photos and the `gender_filtered` visibility mode (R3, §7). The
  `photo_visibility` column exists and defaults to `private`; nothing reads it
  yet, and no UI offers the other modes until the §7 copy requirement is met.
- Nutrition (R4).
- Programme entity, equipment profile, measurements log, full 800-exercise
  catalogue import, offline logging and sync (R1).
- Billing — v1 is free (D1).
- Deployment to a hosted environment. R0's BRD exit criterion includes it; it is
  blocked on two open decisions, recorded in `docs/decisions.md`.
