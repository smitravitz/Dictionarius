"""Chat traces: find them in text, using the one list in .github/chat-traces.txt.

A chat trace is anything that points at one Claude chat or session: a link to a session, a
chat, a shared chat or a project, a session's id, the session trailer. None is ever published
in this repository (CLAUDE.md). A Co-Authored-By line is allowed, and so is a generated-with
footer that links only to Claude Code itself, not to a chat.
"""

import re
from pathlib import Path

PATTERNS = Path(__file__).resolve().parent.parent / ".github" / "chat-traces.txt"


def _load(path=PATTERNS):
    lines = path.read_text(encoding="utf-8").splitlines()
    return [re.compile(line, re.IGNORECASE) for line in lines if line.strip() and not line.startswith("#")]


TRACES = _load()


def has_trace(line):
    return any(pattern.search(line) for pattern in TRACES)


def find(text):
    """The lines of `text` that carry a trace, as (line number from 1, line)."""
    return [(number, line) for number, line in enumerate(text.splitlines(), 1) if has_trace(line)]


_RULE = re.compile(r"^ {0,3}([-*_])( *\1){2,} *$")  # a Markdown horizontal rule: ---, ***, ___
_IN_TITLE = [re.compile(r"\S*(?:" + pattern.pattern + r")\S*", re.IGNORECASE) for pattern in TRACES]


def _is_content(line):
    bare = line.rstrip("\r\n")
    return bare.strip() != "" and not _RULE.match(bare)


def remove(text):
    """`text` without the lines that carry a trace; every other line kept as it was.

    When the traces were at the end (as a footer), the blank lines and the rule left above them go
    too, so the text ends where its own content does.
    """
    lines = text.splitlines(keepends=True)
    kept, last_content, last_trace = [], -1, -1
    for line in lines:
        if has_trace(line):
            last_trace = len(kept)
            continue
        kept.append(line)
        if _is_content(line):
            last_content = len(kept) - 1
    if last_trace < 0:
        return text
    if last_trace > last_content:
        kept = kept[: last_content + 1]
        if kept:
            kept[-1] = kept[-1].rstrip("\r\n")
    return "".join(kept)


def remove_from_title(title):
    """A one-line title without its traces, the words around them kept."""
    for pattern in _IN_TITLE:
        title = pattern.sub("", title)
    return " ".join(title.split())

