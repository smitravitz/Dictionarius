#!/usr/bin/env python3
"""Show or edit safe search's hand-picked list (data/safe-search.list).

The list is what Wiktionary's labels get wrong: bad words whose first meaning
is innocent (block), ordinary words or names that share a search key with
an offensive one (allow), and pieces of a slur that every word containing them
reads as (contains: "snigger"). Its words are stored encoded, one per line, so
the file isn't a readable list of slurs; this script decodes them for you.

  python scripts/safe_search_list.py show [allow|block|contains]
  python scripts/safe_search_list.py add block WORD [WORD ...]
  python scripts/safe_search_list.py add allow WORD [WORD ...]
  python scripts/safe_search_list.py add contains PIECE [PIECE ...]
  python scripts/safe_search_list.py remove WORD [WORD ...]

Quote a phrase: add block "two words". The index builder applies the list (an
allowed word's plurals and tenses stay visible too; a blocked word is just
that word, so list its plural as well; a piece hides every word containing
it, unless allowed), and so does the app when it loads, so an edit shows
without rebuilding the index. Each build writes headwords.safe-review.tsv to
find candidates in.
"""

import base64
import codecs
import os
import sys

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "safe-search.list")
SECTIONS = ("allow", "block", "contains")
HEADER = """\
# Safe search: hand-picked words to allow (always shown) or block (always
# hidden), and pieces that hide every word containing them, on top of the
# rule in docs/index-format.md#safe-search.
# Encoded (ROT13, then base64) so the file isn't a readable word list.
# Show or edit it with: python scripts/safe_search_list.py
"""


def encode(word):
    return base64.b64encode(codecs.encode(word, "rot13").encode("utf-8")).decode("ascii")


def decode(token):
    return codecs.decode(base64.b64decode(token, validate=True).decode("utf-8"), "rot13")


def parse(text):
    """{"allow": [words], "block": [words], "contains": [pieces]}, decoded, in file order."""
    sections = {name: [] for name in SECTIONS}
    current = None
    for n, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]") and line[1:-1] in SECTIONS:
            current = sections[line[1:-1]]
        elif current is None:
            raise ValueError(f"line {n}: an entry before a section ([allow], [block] or [contains])")
        else:
            try:
                current.append(decode(line))
            except ValueError as error:
                raise ValueError(f"line {n}: not an encoded word ({error})") from None
    return sections


def render(sections):
    out = [HEADER]
    for name in SECTIONS:
        out.append(f"[{name}]")
        out.extend(encode(w) for w in sorted(set(sections.get(name, ())), key=lambda w: (w.lower(), w)))
        out.append("")
    return "\n".join(out)


def main(argv):
    with open(PATH, encoding="utf-8") as f:
        sections = parse(f.read())
    command = argv[0] if argv else "show"
    if command == "show":
        names = [argv[1]] if len(argv) > 1 else SECTIONS
        for name in names:
            print(f"[{name}]")
            for w in sorted(sections[name], key=lambda w: (w.lower(), w)):
                print(w)
        return
    if command == "add" and len(argv) > 2 and argv[1] in SECTIONS:
        other = {"allow": "block", "block": "allow"}.get(argv[1])
        for w in argv[2:]:
            if other and w in sections[other]:
                sections[other].remove(w)
            sections[argv[1]].append(w)
    elif command == "remove" and len(argv) > 1:
        for w in argv[1:]:
            for name in SECTIONS:
                while w in sections[name]:
                    sections[name].remove(w)
    else:
        sys.exit(__doc__)
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(render(sections))
    print(f"{len(sections['allow'])} allowed, {len(sections['block'])} blocked, "
          f"{len(sections['contains'])} piece(s)")


if __name__ == "__main__":
    main(sys.argv[1:])
