---
description: Set up an autonomous review loop — spec with testable criteria, one verify command, and Stop hooks that keep working until the spec is met.
argument-hint: [optional one-line description of what you're building]
---

# Autopilot setup

Set up the autonomous review loop in the current repository. Work through the
four steps in order. Do not skip ahead — each step depends on the one before it.

If `$ARGUMENTS` is non-empty, treat it as the user's opening description of the
project and let it replace your first question.

---

## Step 1 — Write `docs/spec.md`

Ask the user **at most 5 questions** about what they are building. Use
`AskUserQuestion` and batch them; do not interrogate one at a time. Aim at what
you cannot infer from the repo — read the code first so you don't spend a
question on something `package.json` already answers.

Cover, in priority order:

1. What the thing does, and what "done" means for this round of work.
2. The observable behaviours that must hold — the things worth testing.
3. Anything explicitly out of scope.
4. Constraints that decide a criterion's pass/fail (target runtime, supported
   inputs, performance or compatibility floors).
5. What already exists versus what is being built now.

Then write `docs/spec.md` with **numbered acceptance criteria**.

**Every criterion must be objectively testable and mapped to a named test.**
A criterion is only admissible if you can state the test that decides it and
the observation that makes it pass. If you cannot name that test, the criterion
is not ready.

Reject vague criteria and rewrite them with the user until they are checkable.
Show the user the rewrite and confirm it says what they meant — do not silently
reinterpret their intent into something merely convenient to test.

| Rejected | Why | Rewritten |
| --- | --- | --- |
| "The API should be fast" | No threshold, no measurement | "3. `GET /items` returns in under 200ms at p95 over 100 sequential requests. Test: `tests/perf/items.bench.ts`" |
| "Handle errors gracefully" | "Gracefully" is not observable | "4. A malformed JSON body returns HTTP 400 with `{\"error\": string}` and does not log a stack trace. Test: `tests/api/errors.test.ts`" |
| "Good test coverage" | No target, no boundary | "5. Line coverage of `src/core/**` is at least 85%. Test: `npm run coverage` threshold gate" |
| "Users can log in" | No failure paths | "6. Valid credentials return a signed JWT expiring in 24h; wrong password returns 401 with no token. Test: `tests/auth.test.ts`" |

Use this structure:

```markdown
# Spec — <project>

## Goal
<two or three sentences>

## Verify command
`<the single command from Step 2>`

## Acceptance criteria
1. <criterion> — Test: `<test file or command>`
2. <criterion> — Test: `<test file or command>`

## Out of scope
- <item>
```

The loop judges the work against this file. A criterion that is not checkable
is a criterion the loop will spin on forever, so this step is the one that
matters most.

---

## Step 2 — One command that runs test + build

There must be exactly one command that runs the full test suite **and** the
build. The loop calls it, so it needs to be a single entry point.

Detect it first. Look for, in order:

- `package.json` → a `verify`, `check`, `ci`, or `validate` script
- `Makefile` → a `verify`, `check`, or `ci` target
- `justfile`, `Taskfile.yml`, `noxfile.py`, `tox.ini`
- language defaults: `cargo test && cargo build`, `go test ./... && go build ./...`

If nothing runs both, create it. Match the repo's existing tooling rather than
introducing a new runner. For example, in `package.json`:

```json
{
  "scripts": {
    "verify": "npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

Or as a `Makefile` target:

```make
verify:
	npm run lint && npm test && npm run build
```

Then:

- **Run it once and confirm it passes** before wiring the loop to it. A verify
  command that is already red gives the loop nothing to work from.
- Record it in `docs/spec.md` under **Verify command**.
- Write the command on a single line to `.claude/verify-command` so the hook
  runs exactly what the spec claims:

  ```bash
  echo 'npm run verify' > .claude/verify-command
  ```

**Keep it under 45 seconds.** The Stop hook kills it past that and reports a
timeout as a failure. If the full suite is slower, point `verify` at the fast
subset — unit tests, typecheck, build — and leave the slow suite (e2e,
integration) to CI. Tell the user which tests you left out and why.

---

## Step 3 — Write the hook configuration

Write `.claude/settings.json` and `.claude/hooks/verify.sh`.

If this repository already has them from a previous run, read them and update
in place rather than overwriting the user's edits.

**Prefer copying over regenerating.** If `$CLAUDE_PLUGIN_ROOT` is set — you are
running as the installed plugin — copy the tested files instead of writing them
from memory:

```bash
mkdir -p .claude/hooks
cp "$CLAUDE_PLUGIN_ROOT/templates/verify.sh"     .claude/hooks/verify.sh
cp "$CLAUDE_PLUGIN_ROOT/templates/settings.json" .claude/settings.json
chmod +x .claude/hooks/verify.sh
```

Then merge, don't clobber: if the repo already had a `.claude/settings.json`,
keep its existing keys and add only the `hooks` block and the missing
permission rules. Regenerating these by hand reintroduces bugs the templates
already fixed, so only fall back to writing them from the shapes below when no
plugin root is available.

Two `Stop` hooks:

1. **`.claude/hooks/verify.sh`** (`type: "command"`) — the cheap objective
   check. Reads the Stop JSON on stdin, returns early when `stop_hook_active`
   is `true`, counts iterations in `.claude/.autopilot-iter`, runs the verify
   command, and returns `{"decision":"block","reason":"..."}` on failure.

2. **A prompt hook** (`type: "prompt"`) — the judgment check. Compares the
   transcript and the current diff against `docs/spec.md`. Returns
   `{"ok": true}` when every criterion is met, `{"ok": false, "reason": "..."}`
   naming the lowest-numbered unmet criterion as an instruction to execute, and
   `{"ok": false, "impossible": true, "reason": "..."}` when a criterion can
   never be satisfied, so the loop ends instead of spinning.

> **Ordering:** Claude Code runs all matching hooks for an event **in parallel**
> — array position does not sequence them. The objective check does not gate the
> judgment check; both evaluate the same turn and both reasons come back
> together. This is why the prompt hook's prompt tells it not to re-run or
> second-guess the test suite: separation of concerns does the work that
> ordering cannot.

Then make `verify.sh` executable:

```bash
chmod +x .claude/hooks/verify.sh
```

Add the iteration counter to `.gitignore` — it is per-checkout state, not
shared configuration:

```
.claude/.autopilot-iter
```

Pre-approve test, build, lint, and ordinary git commands under
`permissions.allow` so the loop never stops to ask. Keep destructive commands
out of `allow` and in `deny`: `rm -rf`, force push, hard reset, and anything
that reads or writes `.env`, `secrets/`, or key material.

**`permissions.defaultMode` matters more than the allow list.** Left unset,
sessions start in `default`, which runs *only reads* without asking — so every
file edit stops and waits. A permission prompt is not a `Stop` event, so the
hooks never fire and the loop dies at the first edit. The template sets
`"defaultMode": "acceptEdits"`, which is the most autonomous mode that both
works from project settings and is honored by Claude Code on the web.

`auto` is more autonomous still, but it does **not** take effect from project or
local settings — it only works from `~/.claude/settings.json`, which never
reaches a cloud session. Mention it to the user as a laptop-only upgrade; never
put it in the repo's settings, where it is silently ignored.

---

## Step 4 — Tell the user to restart

Hooks are read at session start. The ones you just wrote are **not active in
this session**.

End by telling the user plainly:

> Setup is complete, but the hooks are not running yet — Claude Code loads hook
> configuration when a session starts. Exit and start a new session, then the
> loop is live.

Also tell them:

- The verify command the loop will run.
- That the loop stops itself after 8 consecutive failed iterations, and that
  `rm .claude/.autopilot-iter` resets the budget.
- That `/hooks` shows what is registered, and `claude --debug` shows each hook
  firing if something looks wrong.
