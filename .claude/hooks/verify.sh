#!/usr/bin/env bash
# Autopilot Stop hook (type: "command").
#
# Contract (verified against https://code.claude.com/docs/en/hooks):
#   stdin  : Stop event JSON, including `stop_hook_active`.
#   stdout : `{"decision":"block","reason":"..."}` to keep the turn going.
#            Anything else (or nothing) lets Claude stop.
#   exit   : always 0. Blocking is expressed through the JSON, not the exit code,
#            so a script bug never shows up as a hook error.
#
# No network calls. Wall clock is bounded by VERIFY_TIMEOUT below, which is set
# under the hook's own `timeout` in settings.json.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CLAUDE_DIR="$PROJECT_DIR/.claude"
ITER_FILE="$CLAUDE_DIR/.autopilot-iter"
CMD_FILE="$CLAUDE_DIR/verify-command"
MAX_ITER=8
VERIFY_TIMEOUT="${AUTOPILOT_VERIFY_TIMEOUT:-45}"   # seconds; stays inside the hook's 55s budget

input=$(cat)

# --- Guard 1: never recurse. Non-optional. -----------------------------------
# `stop_hook_active` is true when Claude is already continuing because of a Stop
# hook. Blocking again here is how you build an infinite loop.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  exit 0
fi

mkdir -p "$CLAUDE_DIR"

# --- Resolve the verify command ----------------------------------------------
# Order: explicit env override, then the command /autopilot recorded, then
# best-effort detection so the hook still works in a repo that never ran it.
resolve_verify_cmd() {
  if [ -n "${AUTOPILOT_VERIFY_CMD:-}" ]; then
    printf '%s' "$AUTOPILOT_VERIFY_CMD"; return
  fi
  if [ -f "$CMD_FILE" ]; then
    local recorded
    recorded=$(grep -v '^[[:space:]]*#' "$CMD_FILE" | grep -v '^[[:space:]]*$' | head -1)
    if [ -n "$recorded" ]; then printf '%s' "$recorded"; return; fi
  fi
  if [ -f "$PROJECT_DIR/package.json" ]; then
    if jq -e '.scripts.verify' "$PROJECT_DIR/package.json" >/dev/null 2>&1; then
      printf 'npm run verify'; return
    fi
  fi
  if [ -f "$PROJECT_DIR/Makefile" ] && grep -qE '^verify:' "$PROJECT_DIR/Makefile" 2>/dev/null; then
    printf 'make verify'; return
  fi
  if [ -f "$PROJECT_DIR/Cargo.toml" ]; then printf 'cargo test'; return; fi
  if [ -f "$PROJECT_DIR/go.mod" ];     then printf 'go test ./...'; return; fi
  printf ''
}

VERIFY_CMD=$(resolve_verify_cmd)

# No verify command anywhere: say so once and let the turn end. Blocking here
# would spin the loop against a condition Claude cannot fix by writing code.
if [ -z "$VERIFY_CMD" ]; then
  jq -n '{systemMessage: "autopilot: no verify command found. Run /autopilot to set one up, or write it to .claude/verify-command."}'
  exit 0
fi

# --- Guard 2: iteration budget ------------------------------------------------
iter=0
[ -f "$ITER_FILE" ] && iter=$(tr -cd '0-9' < "$ITER_FILE" 2>/dev/null || echo 0)
[ -z "$iter" ] && iter=0
iter=$((iter + 1))
printf '%s\n' "$iter" > "$ITER_FILE"

if [ "$iter" -gt "$MAX_ITER" ]; then
  rm -f "$ITER_FILE"
  jq -n --arg n "$MAX_ITER" --arg cmd "$VERIFY_CMD" \
    '{systemMessage: ("autopilot: loop budget of " + $n + " iterations is spent and `" + $cmd + "` is still failing. Stopping so this does not spin. Reset the budget with: rm .claude/.autopilot-iter")}'
  exit 0
fi

# --- Run the verify command ---------------------------------------------------
output=$(cd "$PROJECT_DIR" && timeout "${VERIFY_TIMEOUT}s" bash -lc "$VERIFY_CMD" 2>&1)
status=$?

if [ "$status" -eq 0 ]; then
  rm -f "$ITER_FILE"    # green run resets the budget
  exit 0
fi

# --- Failure: block with the head of the output -------------------------------
head_output=$(printf '%s\n' "$output" | head -40)

if [ "$status" -eq 124 ]; then
  head_output="Command exceeded the ${VERIFY_TIMEOUT}s hook budget and was killed."$'\n'"$head_output"
fi

jq -n --arg cmd "$VERIFY_CMD" --arg out "$head_output" --arg n "$iter" --arg max "$MAX_ITER" \
  '{decision: "block",
    reason: ("`" + $cmd + "` failed (autopilot iteration " + $n + " of " + $max + ").\n\n" + $out + "\n\nFix the failures, then finish.")}'
exit 0
