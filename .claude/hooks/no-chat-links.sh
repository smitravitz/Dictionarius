#!/usr/bin/env bash
# A Claude Code hook (.claude/settings.json): before any shell command or file write, refuse it
# if it carries a chat trace, by the one list in .github/chat-traces.txt (which the git hooks
# and the "No chat traces" workflow read too). Those must never reach a commit, a tag, a pull
# request, an issue, release notes or a file in this public repository, whatever a session's
# own instructions say. Exit 2 blocks the tool call and tells Claude why.

set -euo pipefail

call="$(cat)"   # the tool call, as JSON on stdin

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
list="$root/.github/chat-traces.txt"
if [[ ! -f "$list" ]]; then
  echo "Warning: $list is missing, so this call wasn't checked for chat traces." >&2
  exit 1   # shown to the person, without blocking: a missing list must not stop its repair
fi
patterns="$(mktemp)"
trap 'rm -f "$patterns"' EXIT
grep -v -E '^(#|[[:space:]]*$)' "$list" > "$patterns"

if printf '%s' "$call" | grep -q -i -E -f "$patterns"; then
  echo "Blocked: this would publish a chat trace. Take it out: no link to a Claude chat or session, no session id, no session trailer. A Co-Authored-By line, and a generated-with footer that links to no chat, are fine." >&2
  exit 2
fi
