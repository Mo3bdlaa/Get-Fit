#!/usr/bin/env bash
# Keeps the repo's live .claude/ in step with the plugin's canonical templates.
#
# The plugin is the single source of truth: an installed plugin can only read
# files inside its own directory, so the templates have to live there. This
# repo's .claude/ is a working copy of them, which is what you clone or copy
# into a new project.
#
#   ./scripts/sync-template.sh          copy plugin templates -> .claude/
#   ./scripts/sync-template.sh --check  exit 1 if they have drifted apart
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/plugins/autopilot"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# canonical -> live copy
PAIRS=(
  "$SRC/templates/verify.sh:$ROOT/.claude/hooks/verify.sh"
  "$SRC/templates/settings.json:$ROOT/.claude/settings.json"
  "$SRC/commands/autopilot.md:$ROOT/.claude/commands/autopilot.md"
)

drift=0
for pair in "${PAIRS[@]}"; do
  from="${pair%%:*}"
  to="${pair##*:}"
  rel="${to#"$ROOT"/}"

  if [ ! -f "$from" ]; then
    echo "missing template: ${from#"$ROOT"/}" >&2
    exit 1
  fi

  if [ "$CHECK" -eq 1 ]; then
    if ! diff -q "$from" "$to" >/dev/null 2>&1; then
      echo "drift: $rel differs from ${from#"$ROOT"/}"
      drift=1
    fi
  else
    mkdir -p "$(dirname "$to")"
    cp "$from" "$to"
    echo "synced: $rel"
  fi
done

if [ "$CHECK" -eq 1 ]; then
  if [ "$drift" -eq 1 ]; then
    echo
    echo "Run ./scripts/sync-template.sh to bring them back in step." >&2
    exit 1
  fi
  echo "in sync: .claude/ matches the plugin templates"
fi

chmod +x "$ROOT/.claude/hooks/verify.sh" "$SRC/templates/verify.sh" 2>/dev/null || true
