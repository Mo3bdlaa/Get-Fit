# Get Fit

A mobile-first workout tracker. Log every set, watch the line go up.

This repository is at **R0 — the walking skeleton**: a registered user can sign
in, log a set of a catalogue exercise, and see their training volume on a chart,
in English or Arabic. The AI equipment scan, programmes, teams, coaches, and
nutrition are on the roadmap, not in the code.

- [`docs/brd.md`](docs/brd.md) — the business requirements document
- [`docs/spec.md`](docs/spec.md) — R0's acceptance criteria, each mapped to a test
- [`docs/decisions.md`](docs/decisions.md) — what was chosen while building it, and what it costs to change
- [`docs/autopilot.md`](docs/autopilot.md) — the autonomous review loop this repo runs

## Running it

```shell
npm install
npm run dev            # http://localhost:3000
```

The database is Postgres. With no `DATABASE_URL` set, `npm run dev` starts
PGlite — Postgres 18 compiled to WebAssembly, in-process — so there is nothing
to install to get going. Point `DATABASE_URL` at a real Postgres and it uses
that instead; in production it insists on one.

Migrations in `src/lib/db/migrations/` apply on first use behind an advisory
lock, and the exercise catalogue seeds itself. Run them ahead of traffic with:

```shell
DATABASE_URL='postgres://…' npm run db:migrate
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | insecure dev value | signs the session cookie; **required** in production |
| `DATABASE_URL` | PGlite in-process | Postgres connection string; **required** in production |
| `PGPOOL_MAX` | `5` | connection pool size |
| `SCRYPT_COST_LOG2` | `14` | password hashing cost; lowered only by the test suite |

## Checks

```shell
npm run verify         # lint + typecheck + unit tests + build  (~30s)
npm run test:e2e       # Playwright, builds and boots the app   (~30s)
npm run verify:full    # both
```

`npm run verify` is what the autopilot Stop hook runs, so it has to stay inside
the hook's 45-second budget. The browser test is deliberately outside it.

The browser test needs no database service: `scripts/e2e-server.ts` starts
PGlite as a *server* on a port and the app connects to it with the same `pg`
driver it uses against Neon. Set `E2E_DATABASE_URL` to run it against a real
Postgres instead.

## Layout

```
src/app/            routes and server actions
src/components/     client components
src/lib/db/         connection, driver selection, migrations
src/lib/repo/       every query lives here — nothing else touches the database
src/lib/authz.ts    the single authorisation layer (BRD §10)
src/lib/i18n/       en + ar message catalogues
tests/              unit tests (fast, in `verify`)
e2e/                Playwright (slow, outside `verify`)
```

Three rules from the BRD are load-bearing in the code and should not be relaxed:

1. `workout_logs` holds **one row per set** (§9).
2. Every user-owned read and write goes through `assertCan` — route handlers do
   not filter by owner themselves (§10).
3. Deletes are soft; only an erasure job removes rows (§9).
