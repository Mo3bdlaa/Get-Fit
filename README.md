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

The database is a SQLite file at `data/get-fit.db`, created on first run.
Migrations in `src/lib/db/migrations/` apply automatically, and the exercise
catalogue seeds itself.

Set `SESSION_SECRET` for anything other than local development — the app refuses
to start in production without it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | insecure dev value | signs the session cookie; **required** in production |
| `GETFIT_DB_PATH` | `data/get-fit.db` | SQLite file, or `:memory:` |

## Checks

```shell
npm run verify         # lint + typecheck + unit tests + build  (~30s)
npm run test:e2e       # Playwright, builds and boots the app   (~30s)
npm run verify:full    # both
```

`npm run verify` is what the autopilot Stop hook runs, so it has to stay inside
the hook's 45-second budget. The browser test is deliberately outside it.

## Layout

```
src/app/            routes and server actions
src/components/     client components
src/lib/db/         connection, migrations
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
