# Claude Autopilot

Stops you having to come back to Claude Code every few minutes to read its
output and say "keep going".

When Claude finishes a turn, a `Stop` hook runs before control returns to you.
If the project's tests fail, or the work doesn't yet meet the spec, the hook
sends Claude back to work with a specific instruction. You only get the session
back when it's actually done.

## The two things that make you come back

A loop like this only works if it closes **both** doors:

1. **Claude finishes and stops.** Handled by the two `Stop` hooks below.
2. **Claude stops to ask permission.** Handled by `permissions` in
   `.claude/settings.json`. This is the one that's easy to miss — a permission
   prompt is *not* a `Stop` event, so the hooks never fire. Left at the default
   permission mode, Claude runs *only reads* without asking and the loop dies at
   the first file edit.

## How it works

Two hooks fire on `Stop`:

| Hook | Type | Job |
| --- | --- | --- |
| `.claude/hooks/verify.sh` | `command` | Runs the project's verify command. On failure, returns `{"decision":"block","reason":"..."}` with the first 40 lines of output. |
| a prompt in `settings.json` | `prompt` | Compares the transcript and diff against `docs/spec.md`. Returns `{"ok":false,"reason":"..."}` naming the lowest-numbered unmet criterion. |

The objective check is free and deterministic; the judgment check costs a model
call. They run **in parallel** — Claude Code runs all matching hooks for an
event concurrently, and array order does not sequence them. The prompt hook is
told not to re-run or second-guess the test suite, which is what keeps the two
from overlapping.

### Guards

- **`stop_hook_active`** — true when Claude is already continuing because of a
  Stop hook. `verify.sh` exits immediately when it sees this. Without it, the
  session never stops.
- **Iteration budget** — a counter in `.claude/.autopilot-iter`, capped at 8.
  Past that the hook reports the budget is spent and lets the turn end. A green
  run resets it. (Claude Code separately overrides a Stop hook after 8
  consecutive blocks, so this is belt-and-braces — but it's the half that
  resets and that tells you what happened.)
- **`impossible`** — the prompt hook returns `{"ok":false,"impossible":true}`
  when a criterion can never be satisfied (missing credentials, contradictory
  requirements). On `Stop` that ends the turn instead of spinning.
- **Timeout** — the verify command is killed at 45s and the timeout is reported
  as a failure, inside the hook's own 55s budget.

## Using it

### As a template

Copy `.claude/` into a new project, then run `/autopilot` and answer its
questions. It writes `docs/spec.md`, establishes a single verify command, and
records it in `.claude/verify-command`.

### As a plugin (recommended on your own machine)

```shell
/plugin marketplace add Mo3bdlaa/Claude-Autopilot
/plugin install autopilot@autopilot
```

`/autopilot` is then available in every repo without copying anything. When it
runs as the installed plugin it copies the tested files out of
`$CLAUDE_PLUGIN_ROOT/templates/` rather than writing them from memory.

> **Plugins installed only in your user settings do not reach cloud sessions.**
> Neither does `~/.claude/commands/`. For a repo you'll drive from your phone,
> the `.claude/` directory has to be committed to that repo. The plugin is a
> convenience for your laptop; the committed `.claude/` is what actually travels.

**Restart the session after setup.** Hooks are read at session start, so they
are not active in the session that wrote them.

## Permission modes

| Mode | Autonomy | Works from repo settings? | Works on web/mobile? |
| --- | --- | --- | --- |
| `default` | reads only, prompts on every edit | — | — |
| **`acceptEdits`** *(what the template sets)* | edits + `mkdir`/`mv` without asking | **yes** | **yes** |
| `auto` | everything, with background safety checks | **no** — user settings only | yes, if set there |

`auto` is the most autonomous option, but Claude Code ignores it in project and
local settings. To use it on your own machine, put it in `~/.claude/settings.json`:

```json
{ "permissions": { "defaultMode": "auto" } }
```

That file stays on your machine, so cloud and mobile sessions keep using
`acceptEdits` from the repo. Deny rules apply in every mode.

## Running from your phone

Everything lives in the repo, so a cloud session gets it from the clone. Start a
task from the Claude app, the loop runs on Anthropic's servers, and the hooks
send Claude back to work without you. You come back to a finished branch.

The limit: cloud sessions run in an isolated VM against a GitHub repo. If your
project needs a local database or service, use your own machine or a VPS.

## Layout

```
.claude-plugin/marketplace.json      marketplace catalog
plugins/autopilot/
  .claude-plugin/plugin.json         plugin manifest
  commands/autopilot.md              the /autopilot command
  templates/                         canonical verify.sh + settings.json
.claude/                             working copy — this is what you clone
scripts/sync-template.sh             keeps the two in step
```

The plugin directory is the source of truth: an installed plugin can only read
files inside itself, so the templates have to live there. `.claude/` is a synced
copy.

```shell
./scripts/sync-template.sh           # templates -> .claude/
./scripts/sync-template.sh --check   # exit 1 if they've drifted
```

## Writing a spec the loop can actually judge

This is the part that decides whether the loop converges. Every criterion must
be objectively testable and mapped to a named test. A criterion nobody can
measure is one the loop will spin on until the budget runs out.

| Don't | Do |
| --- | --- |
| "The API should be fast" | "`GET /items` returns under 200ms at p95 over 100 requests — Test: `tests/perf/items.bench.ts`" |
| "Handle errors gracefully" | "A malformed body returns 400 with `{error: string}` — Test: `tests/api/errors.test.ts`" |
| "Users can log in" | "Valid credentials return a JWT expiring in 24h; a wrong password returns 401 with no token — Test: `tests/auth.test.ts`" |

`/autopilot` rejects vague criteria and rewrites them with you.

## Cost

Every blocked stop is another turn. The iteration cap and a spec with real
acceptance criteria are what keep that bounded — start with a tight spec rather
than a broad one.
