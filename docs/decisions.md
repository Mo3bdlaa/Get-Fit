# R0 build decisions

Choices made while building the walking skeleton that the BRD did not settle,
plus the ones it settled that constrained the code. Each says what it costs to
change later, so R1 knows what is cheap and what is not.

## Storage: SQLite now, Postgres at R1

`better-sqlite3` against a file on disk. It needs no service to provision, which
is what makes R0 runnable end to end today, and its SQL is close enough to
Postgres that the migration is mechanical.

Every query lives in `src/lib/repo/*`. Route handlers and components never touch
the database directly, so the swap is confined to those files plus
`src/lib/db/index.ts`.

**Cost of changing:** low, and it has to happen before deployment — SQLite on a
local disk does not survive a serverless host.

## The schema honours §9's non-negotiables from the first migration

`workout_logs` is one row per set. Every user-generated table has `owner_id`,
`visibility`, and `deleted_at`. `audit_log` exists and is written by the
authorisation layer. `users.photo_visibility` exists and defaults to `private`.

None of these are used to their full extent yet — there is no team, so nothing
reads `visibility` beyond the owner check — but they are the fields §9 says
cannot be retrofitted, so they are here before there is history to rewrite.

## Authorisation is a layer, not a set of WHERE clauses

`src/lib/authz.ts` holds every decision. `assertCan` throws, and it writes the
NFR7 audit row on cross-user access as a side effect of granting, so an access
path that skips the layer also skips the audit and is visible as a missing row.

Coaches are denied outright: a coach reaches a trainee only through a team
membership, and teams do not exist until R3. Inventing an interim path is how
the coach layer leaks.

**Cost of changing:** this is the one file R3 must extend rather than work
around.

## Sessions: HS256 JWT in an httpOnly cookie, 24h

No session table, so no revocation before expiry. Acceptable for R0; a logout-
everywhere feature needs a session store, which is an additive change.

`SESSION_SECRET` must be set in production — the code throws at startup if it is
missing rather than falling back to the development secret.

## Passwords: scrypt via `node:crypto`

Stored as `scrypt$<salt>$<key>`. The scheme prefix is there so a future move to
argon2 can rehash on next sign-in rather than forcing a reset.

## Chart: inline SVG, no charting library

`buildChartGeometry` is pure and unit-tested without a DOM; the component only
renders it. Costs nothing in bundle size and keeps the chart testable in the fast
suite.

## Catalogue: three hand-written exercises

The seed's shape mirrors `free-exercise-db` (§6) so the full public-domain import
normalises into these columns rather than the source's own shape. Arabic names
are hand-written per §6 step 2.

## Verify command excludes the browser test

`npm run verify` is lint, typecheck, unit tests, and the production build — about
30 seconds, inside the Stop hook's 45-second budget. The build is in it
deliberately: `next build` catches the server/client boundary errors that `tsc`
does not.

`npm run test:e2e` builds and boots the app for the Playwright run, which does
not fit in that budget. CI runs `npm run verify:full`.

## Not done, and why

- **Deployment.** R0's BRD exit criterion includes production. It is blocked on
  two decisions that are the owner's, not the code's: which host, and which
  managed Postgres. The app is otherwise deployable — one config change to the
  storage layer and a `SESSION_SECRET`.
- **Open decisions O1–O5 (§3).** Untouched; they are product decisions. O2
  (default UI language) is currently English, in code as `DEFAULT_LOCALE` in
  `src/lib/i18n/index.ts` — a one-line change when O2 is answered.
- **O3, minimum age.** No age field, no gate. It blocks the signup flow and is
  wanted before Sprint 2, not R0.
