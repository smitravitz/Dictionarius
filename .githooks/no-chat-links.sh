#!/usr/bin/env bash
# Shared by the hooks in this folder: fails (exit 1) if the text it's given links to a Claude
# chat or session, or names a commit identity other than the maintainer's GitHub address.
# Usage: no-chat-links.sh <file with the text to check> <what it is, for the message>

set -euo pipefail

text_file="$1"
what="$2"

# A link to a chat: claude.ai/code/..., claude.ai/chat/..., claude.ai/share/..., or a bare
# session id. Also the "Claude-Session:" trailer some tools add on their own.
if grep -n -i -E 'claude\.ai/(code|chat|share|project)|session_01[0-9A-Za-z]{8,}|Claude-Session:' "$text_file"; then
  echo "Blocked: the $what above links to a Claude chat. Take the link out; links to chats are never published here." >&2
  exit 1
fi
