# R0 build decisions

Choices made while building the walking skeleton that the BRD did not settle,
plus the ones it settled that constrained the code. Each says what it costs to
change later, so R1 knows what is cheap and what is not.

## Storage: Neon Postgres, `pg` driver

Superseded the R0 SQLite choice. Managed Postgres is Neon and the host is
Vercel; both were settled by the owner, so neither is an open decision.

One driver, `pg`, against Neon's **pooled** endpoint (the `-pooler` host). Neon
speaks the standard wire protocol, so nothing in the code is Neon-specific and a
move to another managed Postgres is a connection string. The serverless HTTP
driver was considered and rejected: it only talks to Neon, and it would have made
local development and the browser test dependent on a Neon account.

Where there is no `DATABASE_URL`, the same code runs against **PGlite** —
Postgres 18 compiled to WebAssembly, in-process. It is the same engine, so the
migrations and queries the unit tests exercise are the ones that run in
production. In production a missing `DATABASE_URL` throws rather than falling
back.

**Cost of changing:** the swap stayed inside `src/lib/db/index.ts` and
`src/lib/repo/*`, exactly as the R0 note predicted. Nothing in the routes or
components changed.

## The migration is a rewrite, not a transliteration

The SQLite DDL was not ported line by line. What changed and why:

| SQLite | Postgres | Why |
| --- | --- | --- |
| `TEXT` keys, ids from `randomUUID()` | `uuid` with `DEFAULT gen_random_uuid()` | the database owns identity; `RETURNING id` hands it back |
| `TEXT` timestamps holding ISO strings | `timestamptz` | a real instant type, comparable and indexable |
| `REAL` | `double precision` | `numeric` would come back from `pg` as a string, and none of these are money |
| `date(performed_at)` | `(performed_at AT TIME ZONE 'UTC')::date` | "day" is now explicit rather than a property of the storage format |
| `COUNT(*)` | `COUNT(*)::integer` | `pg` returns `bigint` as a *string*; the cast keeps the domain type honest |
| `INSERT OR IGNORE` | `ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING` | the arbiter index is partial, so Postgres needs the predicate restated to infer it |
| read-max-then-insert | one `INSERT … SELECT COALESCE(MAX(set_index), 0) + 1` | SQLite's single writer hid the race; Postgres does not |

Two behaviours are unchanged on purpose: "day" still means the UTC calendar day
(a per-user timezone is R1 work, with the profile), and set numbering still
restarts daily until Task 2 moves it to sessions.

Identifiers are unquoted and lower case throughout, so they fold the same way
whatever a client does with quoting.

## Async: the type checker was not enough

`better-sqlite3` is synchronous; `pg` is not. `tsc` catches a dropped `await`
only where the result is used as a value — it is perfectly happy with
`if (somePromise)`, or with `expect(() => repoCall()).toThrow()`, which passes
whatever the code does.

So `eslint.config.mjs` now runs typescript-eslint's **type-checked** rules over
`src/`, `tests/`, and `e2e/`, for `no-floating-promises` and
`no-misused-promises` above all. Deliberately dropping one `await` turns up 19
lint errors. It costs about 6s of the verify budget and is the reason the
missing-await audit is mechanical rather than a careful read.

It also caught something unrelated and real: `String(formData.get(x))` renders a
`File` as `"[object Object]"`, which would have gone into the database as a
plausible-looking value.

## PGlite, and where it stops

Unit tests run against in-process PGlite: one instance shared by the whole run
(`isolate: false`, one worker), because booting it costs ~5s and paying that per
file put `npm run verify` over budget. Each database test truncates in
`beforeEach`.

The browser test cannot use it in-process. `next start` serves page renders and
server actions from **separate module instances**, so an in-process database
gets opened twice — writes land in one copy, reads come from the other, and the
symptom is a set that logs successfully and then does not appear. So
`scripts/e2e-server.ts` runs PGlite as a *server* over the Postgres wire
protocol and the app connects with `pg`, one database, real driver. Its
`maxConnections` defaults to 1 and has to be raised for the same reason.

What none of this exercises is Neon itself — the network, the pooler, TLS. That
is what the manual smoke test of the deployed URL is for.

## The schema honours §9's non-negotiables from the first migration

`workout_logs` is one row per set. Every user-generated table has `owner_id`,
`visibility`, and `deleted_at`. `audit_log` exists and is written by the
authorisation layer. `users.photo_visibility` exists and defaults to `private`.

None of these are used to their full extent yet — there is no team, so nothing
reads `visibility` beyond the owner check — but they are the fields §9 says
cannot be retrofitted, so they are here before there is history to rewrite.

## Sessions: `user_id` and `owner_id` are both there, and constrained equal

The brief asked for both. On `workout_sessions` they name the same person in
every row that can exist today, and two columns that must always agree are a
divergence waiting to happen — so `CHECK (owner_id = user_id)` holds them
together. `owner_id` is what the authorisation layer reads; `user_id` is the
domain relationship R1's programme execution will talk about.

**A note for the product owner:** if they are still identical when the coach
layer lands, one of them should go. The constraint is the thing to drop first if
a coach ever needs to open a session *for* a trainee — at which point they stop
meaning the same thing and both earn their place.

## Sessions have an idle window, because they have no UI yet

Sets are attributed to a session, and a set logged with no session open creates
one. With no start/stop screen, nothing would ever close it — so every set a
user ever logged would join their first session and the "Set 47" they saw in the
recent list would climb without end. That is a visible regression on today's
per-day numbering, so:

A session stops being current once nothing has been logged into it for
`SESSION_IDLE_MINUTES` (default six hours). The window is measured from the
*set's own timestamp*, not from `now()`, so importing a week of past training
produces a session per workout rather than one enormous one.

**Cost of changing:** small and expected. R1's session UI replaces the implicit
open with an explicit start and finish; the idle window then becomes a safety
net for sessions a user forgot to end, not the mechanism.

## Authorisation is enforced, not merely available

`assertCan` was correct and optional. Nothing failed when a path skipped it, and
the R0 note's claim — that a missing audit row would show up — was not detection,
because nobody was looking.

**Chosen: (a), a static-analysis test** (`tests/authz-enforcement.test.ts`),
over (b) a lint rule. The reason is coverage, not taste:

- A lint rule can state *rule 1* — do not import the database outside the
  repositories. That is an import-graph property, which is what lint is good at.
- It cannot state *rule 2* — an exported repository function that reaches the
  database must call `assertCan`. That is a property of what a function does,
  including through a local helper, and it needs the transitive call set within
  the file. Expressing it means writing and packaging a custom ESLint plugin.
- Nor *rule 3* — that the exemption list contains no entry that has stopped
  describing a real function. Without it a waiver list rots into a blanket one.

So all four rules live in one place, in the suite that already runs, and read as
ordinary code rather than plugin scaffolding. They cost about 0.15s.

What the checks actually assert:

| Rule | Fails when |
| --- | --- |
| 1 | anything outside `lib/db`, `lib/repo`, `authz.ts` imports `query`/`queryOne`/`execute`, or a driver, or `@/lib/db` wholesale — including `await import(...)` |
| 2 | an exported repository function reaches the database, directly or through a local helper, without calling `assertCan` |
| 3 | an exemption names a function that no longer exists or no longer touches the database, or gives no reason |
| 4 | an exported server action other than register/login/sign-out does not call `requireUser()` |

Demonstrated both ways round: a server action doing its own `SELECT … WHERE
owner_id = $1` fails rules 1 and 4; a repository function querying without
`assertCan` fails rule 2. Both were reverted.

The six exemptions are all pre-authorisation or reference data — registration,
the credential check, resolving the session cookie, and the exercise catalogue —
and each carries its reason in the file.

**What this does not catch:** a repository function that authorises the *wrong*
resource, or an actor assembled from something other than the session cookie. The
first is what `tests/authz.test.ts` is for; the second is rule 4's job only at the
entry point.

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

## A devDependency must not reach production, and a check says so

*(This was a real defect, found while chasing a deployment failure. It did not
turn out to be that failure's cause — the fix is worth keeping on its own
merits.)*

`serverExternalPackages` is not just "do not bundle this" — it is "require this
at runtime", and Next's file tracer follows it into the serverless output. Point
it at a devDependency and the build stays green while the deployment breaks,
because the pruning happens after the build. The failure surfaces on the host,
with no local reproduction.

Two ways out. Moving the package to `dependencies` is simplest but ships a WASM
Postgres to a production path that never runs. Instead the import is hidden from
static analysis: the specifier is assembled from parts and carries
`webpackIgnore`, so neither webpack nor the tracer can resolve it, and Node
resolves it at runtime where it exists.

`scripts/check-traces.mjs` runs after every build and reads the trace manifests
the build just wrote, failing if any devDependency appears. It is in `verify`, so
the loop catches it, and it costs milliseconds.

**Cost of changing:** none to speak of. If a package genuinely needs to be in the
serverless output, move it to `dependencies` and the check stops complaining —
which is the correct fix, and the message says so.

## Not done, and why

- **Deployment.** The cause was the Vercel project's **framework preset**, and it
  is fixed in `vercel.json`.

  The build failed with:

  ```
  No Output Directory named "public" found after the Build completed.
  Configure the Output Directory in your Project Settings.
  ```

  `public` is the default output directory for Vercel's **"Other"** preset. The
  project was created while this repository still held only the Autopilot
  template — no `package.json`, no framework — so Vercel detected nothing and
  settled on "Other". It ran no Next.js build and then looked for a static site
  this project does not produce. That also explains the timing: the failure
  landed nine seconds after the pull request opened, far too fast for a Next
  build, because no Next build was ever run.

  `vercel.json` now pins `"framework": "nextjs"` — the fix the error message
  itself offers as the alternative to changing the dashboard. Keeping it in the
  repository rather than in project settings means it is version controlled,
  reviewable, and survives the project being recreated. The setting that broke
  this was invisible both from here and from the code.

  **Two earlier diagnoses in this document were wrong**, and both were reached the
  same way: inferred from local reproduction and GitHub commit statuses, because
  this session's Vercel token 404s on the project, its deployments, and their
  build logs. The first guessed a missing environment variable; the second
  guessed a devDependency traced into the serverless output. The second was a
  real defect and its fix stands on its own merits — but it was not this. One
  line of the actual build log settled in seconds what two rounds of inference
  did not. Recorded because it will recur: when the log is unreadable, say so and
  ask for it, rather than publishing the best available hypothesis as a cause.


  **Still unverified, and not closable until a deployment succeeds:** the
  end-to-end flow on the deployed URL, both locales and RTL there, and migrations
  applied against Neon.

  Two things also remain unobservable from this environment, and this document
  makes no claim about them:

  - **That `DATABASE_URL` and `SESSION_SECRET` are set and scoped to Production.**
    The Vercel MCP surface has no environment-variable API, and this session's
    token cannot see the project at all — `list_projects` returns empty,
    `get_project` 404s, and reading the failed deployment's build logs 404s too,
    while the GitHub commit status names the project plainly. That is a token
    scope limit, not evidence of absence.
  - **Whether `DATABASE_URL` is the pooled endpoint.** Serverless runtime wants
    the `-pooler` host; the direct host exhausts connections under concurrency.
    The value is the owner's secret to read and rotate.

- **Deployed URL:** https://get-fit-amber.vercel.app — connected and building
  from `main`, but no deployment has yet succeeded. Not usable.

- **CI now genuinely runs, and did not before.** Recorded because it changes what
  every earlier report in this repository was worth: for the whole of R0's
  development, *every* passing result came from a local run. The first four
  Actions runs failed in 2–4 seconds with `runner_id: 0`, no runner name, no
  steps, and logs that 404 — jobs that never acquired a runner, reproducing
  across three unrelated commits.

  That is now closed. Run `32607349683` on `main` at `876ba3a` acquired runner
  `1000003441` and executed nine real steps, with `npm run verify:full`
  succeeding in 46 seconds — lint, typecheck, 76 unit tests, build, and both
  browser tests. The run on the merge commit before it passed the same way.
  Results from `main` onward are CI-backed; anything reported before
  2026-08-23 00:16Z was local-only.
- **Open decisions O1–O5 (§3).** Untouched; they are product decisions. O2
  (default UI language) is currently English, in code as `DEFAULT_LOCALE` in
  `src/lib/i18n/index.ts` — a one-line change when O2 is answered.
- **O3, minimum age.** No age field, no gate. It blocks the signup flow and is
  wanted before Sprint 2, not R0.
