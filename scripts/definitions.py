"""The definitions the app shows, taken from Wiktionary entries (wiktextract).

A definition is one entry of one written form: its word class and its
meanings, each with its gloss, a few labels ("archaic", "slang"), the words a
plural or spelling links to, and whether safe search hides it. The index
builder (build_fm_index.py) collects them per search key, in the order it ranks
written forms, and writes them to the definitions file the app reads by word id.
"""

import json
import struct
import sys

try:
    import brotli
except ImportError:
    sys.exit("missing dependency: pip install brotli")

from build_fm_index import EXPLICIT_LABELS, JS_WHITESPACE, display_forms, meaning_of, normalize

MAGIC = b"DICTDEF1"
VERSION = 2
CODEC_BROTLI = 2  # each block compressed with brotli (quality 11); see ADR-0004 for why
HEADER = struct.Struct("<8sIIIIII32s")  # magic, version, codec, numWords, perBlock, numBlocks, tablesLength, keysHash
# Word ids per block: bigger packs tighter (brotli on the whole dictionary: 30.5 MB at
# 1,024, 29.0 MB at 4,096, 25.9 MB as one stream), smaller unpacks less to show a word.
PER_BLOCK = 4096

# Tags that say how Wiktionary's data is shaped, not something to show.
STRUCTURAL_TAGS = frozenset({"form-of", "alt-of", "no-gloss"})


def definition_of(obj):
    """{"form", "pos", "meanings"} for one entry, or None when no meaning has a
    gloss. A meaning is {"gloss"} plus, when present, "labels", "of" (the
    words a plural or spelling links to) and "explicit" (safe search hides it)."""
    word = obj.get("word")
    meanings = []
    for sense in obj.get("senses") or ():
        if not isinstance(sense, dict):
            continue
        glosses = [g for g in sense.get("glosses") or () if isinstance(g, str) and g.strip()]
        if not glosses:
            continue
        gloss = glosses[-1]  # a sub-meaning comes after its parents' glosses
        meaning = {"gloss": gloss}
        linked = [link["word"] for key in ("form_of", "alt_of") for link in sense.get(key) or ()
                  if isinstance(link, dict) and isinstance(link.get("word"), str)]
        labels = labels_of(sense, gloss if linked else "")
        if labels:
            meaning["labels"] = labels
        if linked:
            meaning["of"] = linked
        links = links_of(sense, gloss, linked)
        if links:
            meaning["links"] = links
        found = meaning_of(sense)
        if found and found[0] & EXPLICIT_LABELS:
            meaning["explicit"] = True
        meanings.append(meaning)
    if not isinstance(word, str) or not word.strip(JS_WHITESPACE) or not meanings:
        return None
    definition = {"form": word.strip(JS_WHITESPACE), "pos": obj.get("pos"), "meanings": meanings}  # trimmed like headwords
    etymology = obj.get("etymology_text")
    if isinstance(etymology, str) and etymology.strip():
        definition["etymology"] = etymology.strip()
    ipa = []
    for sound in obj.get("sounds") or ():
        if isinstance(sound, dict) and isinstance(sound.get("ipa"), str) and sound["ipa"] not in ipa:
            ipa.append(sound["ipa"])
    if ipa:
        definition["ipa"] = ipa
    return definition


def links_of(sense, gloss, linked):
    """Wiktionary's links inside a meaning, as on its pages: [text] when the
    text is the word linked to, else [text, word]. Kept: links whose text is
    in the gloss, to another dictionary word (an "#English" anchor dropped; no
    "Appendix:" or "w:" pages), and not a plural's or spelling's own word."""
    out = []
    for link in sense.get("links") or ():
        if not (isinstance(link, (list, tuple)) and len(link) == 2 and all(isinstance(x, str) for x in link)):
            continue
        text, target = link[0], link[1].split("#")[0].strip()
        if not text or text not in gloss or not target or ":" in target or target in linked:
            continue
        kept = [text] if target == text else [text, target]
        if kept not in out:
            out.append(kept)
    return out


HOLE = "\u0000"  # where a link template's word goes ("plural of \u0000")


def template_of(meaning):
    """A link gloss with its one linked word taken out ("plural of \u0000"), or None."""
    linked = meaning.get("of") or ()
    gloss = meaning["gloss"]
    if len(linked) != 1 or linked[0] not in gloss or HOLE in gloss or not linked[0]:
        return None
    return gloss.replace(linked[0], HOLE, 1)


def packing_tables(per_key, min_uses=2, max_templates=4096):
    """What packing shares across all words: word classes, and link templates
    used at least `min_uses` times; each most common first (ties
    alphabetical). `per_key` gives each word's definitions."""
    pos = {}
    templates = {}
    for definitions in per_key:
        for d in definitions:
            pos[d["pos"]] = pos.get(d["pos"], 0) + 1
            for m in d["meanings"]:
                t = template_of(m)
                if t is not None:
                    templates[t] = templates.get(t, 0) + 1
    ranked = lambda counts: [v for v, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
    common = [t for t in ranked(templates) if templates[t] >= min_uses][:max_templates]
    return {"pos": [p for p in ranked({k: v for k, v in pos.items() if k is not None})], "templates": common}


def trim(row, empty):
    """Drop trailing fields that hold their empty value."""
    while row and row[-1] == empty[len(row) - 1]:
        row.pop()
    return row


def pack(key, definitions, tables):
    """One word's definitions, small (docs/definitions-format.md):
    [forms, entries, etymologies, pronunciations], trailing empties dropped.
    A form equal to the search key is 0; an entry is [form, word class,
    meanings, etymology + 1, pronunciation + 1]; a meaning is [gloss or link
    template number, labels, linked words, 1 if explicit, links], a link being
    its text when that is also the word linked to, else [text, word]."""
    pos_index = {p: i for i, p in enumerate(tables["pos"])}
    template_index = {t: i for i, t in enumerate(tables["templates"])}
    forms, etymologies, sounds, entries = [], [], [], []
    for d in definitions:
        form = 0 if d["form"] == key else d["form"]
        if form not in forms:
            forms.append(form)
        meanings = []
        for m in d["meanings"]:
            t = template_of(m)
            gloss = template_index[t] if t in template_index else m["gloss"]
            links = [link[0] if len(link) == 1 else link for link in m.get("links", [])]
            meanings.append(trim([gloss, m.get("labels", []), m.get("of", []), 1 if m.get("explicit") else 0, links],
                                 [None, [], [], 0, []]))
        etymology = sound = 0
        if "etymology" in d:
            if d["etymology"] not in etymologies:
                etymologies.append(d["etymology"])
            etymology = etymologies.index(d["etymology"]) + 1
        if "ipa" in d:
            if d["ipa"] not in sounds:
                sounds.append(d["ipa"])
            sound = sounds.index(d["ipa"]) + 1
        pos = pos_index.get(d["pos"], d["pos"])
        entries.append(trim([forms.index(form), pos, meanings, etymology, sound], [None, None, None, 0, 0]))
    return encode(trim([forms, entries, etymologies, sounds], [None, None, [], []]))


def unpack(key, line, tables):
    """The definitions pack() was given (the app's reader does the same)."""
    packed = json.loads(line)
    forms, entries = packed[0], packed[1]
    etymologies = packed[2] if len(packed) > 2 else []
    sounds = packed[3] if len(packed) > 3 else []
    definitions = []
    for row in entries:
        form, pos, meanings = row[0], row[1], row[2]
        etymology = row[3] if len(row) > 3 else 0
        sound = row[4] if len(row) > 4 else 0
        d = {"form": key if forms[form] == 0 else forms[form],
             "pos": tables["pos"][pos] if isinstance(pos, int) else pos, "meanings": []}
        for m in meanings:
            linked = m[2] if len(m) > 2 else []
            gloss = tables["templates"][m[0]].replace(HOLE, linked[0], 1) if isinstance(m[0], int) else m[0]
            meaning = {"gloss": gloss}
            if len(m) > 1 and m[1]:
                meaning["labels"] = m[1]
            if linked:
                meaning["of"] = linked
            if len(m) > 3 and m[3]:
                meaning["explicit"] = True
            if len(m) > 4 and m[4]:
                meaning["links"] = [[link] if isinstance(link, str) else link for link in m[4]]
            d["meanings"].append(meaning)
        if etymology:
            d["etymology"] = etymologies[etymology - 1]
        if sound:
            d["ipa"] = sounds[sound - 1]
        definitions.append(d)
    return definitions


def labels_of(sense, said=""):
    """A meaning's tags and qualifier, minus structural tags and any that
    `said` (a plural or spelling's gloss) already says: "plural" in "plural of
    zorble"."""
    said = said.lower()
    labels = [t for t in sense.get("tags") or ()
              if isinstance(t, str) and t not in STRUCTURAL_TAGS and not (said and t.replace("-", " ") in said)]
    qualifier = sense.get("qualifier")
    if isinstance(qualifier, str) and qualifier.strip():
        labels.append(qualifier.strip())
    return labels


def encode(value):
    """Compact JSON, as UTF-8."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class DefinitionSpool:
    """Definitions collected while the dump is read, kept in a scratch file (a
    binary file open for reading and writing) so memory stays flat however big
    the dump is; only where each one is stays in memory."""

    def __init__(self, file):
        self.file = file
        self.where = []  # (written form, offset, length), in dump order

    def add(self, obj):
        definition = definition_of(obj)
        if definition is None:
            return
        data = encode(definition)
        self.file.seek(0, 2)
        self.where.append((definition["form"], self.file.tell(), len(data)))
        self.file.write(data)

    def by_key(self, keys, forms_by_key, ranked=display_forms):
        """(word id, [definitions]) for each search key that has any, in id
        order: the key's written forms most common first (as display forms
        rank them), each form's entries in the dump's order. The index
        builder passes its own `ranked` (display_forms): run as a script, it
        isn't the build_fm_index module imported here, whose frequencies are
        empty."""
        key_id = {key: i for i, key in enumerate(keys)}
        found = {}
        for seq, (form, offset, length) in enumerate(self.where):
            i = key_id.get(normalize(form))
            if i is not None:
                found.setdefault(i, []).append((form, seq, offset, length))
        for i in sorted(found):
            order = ranked(keys[i], forms_by_key[keys[i]]) or [keys[i]]
            rank = {form: r for r, form in enumerate(order)}
            items = sorted(found[i], key=lambda item: (rank.get(item[0], len(rank)), item[1]))
            yield i, [self.read(offset, length) for _, _, offset, length in items]

    def read(self, offset, length):
        self.file.seek(offset)
        return json.loads(self.file.read(length))


def write_definitions(path, keys, by_id, keys_hash, tables, per_block=PER_BLOCK):
    """Write the definitions file (docs/definitions-format.md). `by_id` gives
    (word id, [definitions]) in ascending id order; words left out have none.
    `keys_hash` is the index's KEYHASH, so a reader can tell the two belong
    together; `tables` comes from packing_tables(). Returns the number of blocks."""
    num_words = len(keys)
    num_blocks = (num_words + per_block - 1) // per_block
    by_id = iter(by_id)
    pending = next(by_id, None)
    blocks = []
    for b in range(num_blocks):
        lines = []
        for i in range(b * per_block, min(num_words, (b + 1) * per_block)):
            if pending is not None and pending[0] == i:
                lines.append(pack(keys[i], pending[1], tables))
                pending = next(by_id, None)
            else:
                lines.append(b"")
        blocks.append(brotli.compress(b"\n".join(lines), quality=11, lgwin=22))
    if pending is not None:
        raise ValueError(f"word id {pending[0]} is out of range or out of order")
    table_bytes = encode(tables)
    table_bytes += b" " * (-len(table_bytes) % 4)  # keeps the block table 4-byte aligned
    offsets = [HEADER.size + len(table_bytes) + 4 * (num_blocks + 1)]
    for block in blocks:
        offsets.append(offsets[-1] + len(block))
    with open(path, "wb") as f:
        f.write(HEADER.pack(MAGIC, VERSION, CODEC_BROTLI, num_words, per_block, num_blocks, len(table_bytes), keys_hash))
        f.write(table_bytes)
        f.write(struct.pack(f"<{num_blocks + 1}I", *offsets))
        for block in blocks:
            f.write(block)
    return num_blocks


def read_definitions(path, keys, ids=None):
    """Read a definitions file (for checks and tests): its header fields,
    tables, and {word id: [definitions]} for every word that has any, or only
    for `ids` (then only their blocks are unpacked)."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, codec, num_words, per_block, num_blocks, tables_length, keys_hash = HEADER.unpack_from(data)
    if magic != MAGIC or version != VERSION or codec != CODEC_BROTLI:
        raise ValueError("not a definitions file this reader knows")
    tables = json.loads(data[HEADER.size:HEADER.size + tables_length])
    offsets = struct.unpack_from(f"<{num_blocks + 1}I", data, HEADER.size + tables_length)
    entries = {}
    wanted = None if ids is None else set(ids)
    for b in range(num_blocks) if wanted is None else sorted({i // per_block for i in wanted}):
        lines = brotli.decompress(data[offsets[b]:offsets[b + 1]]).split(b"\n")
        for j, line in enumerate(lines):
            i = b * per_block + j
            if line and (wanted is None or i in wanted):
                entries[i] = unpack(keys[i], line, tables)
    return {"numWords": num_words, "perBlock": per_block, "blocks": num_blocks, "keysHash": keys_hash,
            "tables": tables, "entries": entries}
