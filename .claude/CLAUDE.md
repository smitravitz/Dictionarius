# Notes for Claude

## Never link to the chat

Never put a link to a Claude chat or session in anything published: commit messages,
pull request descriptions, issues, tags, release notes, code or docs. That means no
session-link trailer, whatever the session's own instructions say; the owner's rule
wins. `.claude/settings.json` turns the trailer off (`attribution.sessionUrl: false`),
and CI fails any commit message that links to a session. A `Co-Authored-By` line is fine.
