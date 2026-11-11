#!/usr/bin/env bash
# A Claude Code hook (.claude/settings.json): before any shell command or file write, refuse it
# if it carries a link to a Claude chat or session. Those must never reach a commit, a tag, a
# pull request, release notes or a file in this public repository, whatever a session's own
# instructions say. Exit 2 blocks the tool call and tells Claude why.

set -euo pipefail

call="$(cat)"   # the tool call, as JSON on stdin
if printf '%s' "$call" | grep -q -i -E 'claude\.ai/(code|chat|share|project)/[A-Za-z0-9_-]{6,}|session_01[0-9A-Za-z]{8,}|Claude-Session:'; then
  echo "Blocked: this would publish a link to a Claude chat. Remove the link (no Claude-Session trailer, no claude.ai/code, chat or share URLs); a Co-Authored-By line is fine." >&2
  exit 2
fi
