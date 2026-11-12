#!/usr/bin/env bash
# Shared by the hooks in this folder: fails (exit 1) if the text it's given carries a chat
# trace, by the one list in .github/chat-traces.txt (which the "No chat traces" workflow and
# the Claude Code hook read too).
# Usage: no-chat-links.sh <file with the text to check> <what it is, for the message>

set -euo pipefail

text_file="$1"
what="$2"

list="$(cd "$(dirname "$0")/.." && pwd)/.github/chat-traces.txt"
if [[ ! -f "$list" ]]; then
  echo "Blocked: $list is missing, so the $what can't be checked for chat traces." >&2
  exit 1
fi
patterns="$(mktemp)"
trap 'rm -f "$patterns"' EXIT
grep -v -E '^(#|[[:space:]]*$)' "$list" > "$patterns"

# Line numbers only: the trace itself isn't repeated.
found="$(grep -n -i -E -f "$patterns" "$text_file" | cut -d: -f1 | paste -sd, - || true)"
if [[ -n "$found" ]]; then
  echo "Blocked: the $what carries a chat trace (line $found). Take it out: no link to a Claude chat or session, no session id, no session trailer. A Co-Authored-By line, and a generated-with footer that links to no chat, are fine." >&2
  exit 1
fi
