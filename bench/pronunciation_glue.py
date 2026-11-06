#!/usr/bin/env python3
"""How often gluing the parts' pronunciations together gives a word's pronunciation.

Tests it on the words that have both a pronunciation and an etymology naming their
parts ("From art + -hood."): glues the parts' transcriptions (the first part keeps
its stress, a one-syllable part gets the stress mark Wiktionary leaves off, affixes
lose theirs, a later word's becomes secondary) and compares with the word's own,
ignoring syllable dots and secondary stress. Prints the share right per pattern
(suffix, prefix, compound of words), with each part's first transcription and with
the best combination of their transcriptions (the gap is mixed accents).

    npx vite-node scripts/missing-pronunciations.ts dist/headwords.bin missing.txt --tsv words.tsv
    python bench/pronunciation_glue.py words.tsv

Measured 2026-11-06 on the v0.6 data: 11,716 words tested; right 50% with first
transcriptions, 60% with the best; -ish 88%, -less 86%, -ing 84%, un- 81%,
compounds of words 64%, -ic 12%, -ity 5%, over- 1%.
"""
import collections, csv, itertools, re, sys
csv.field_size_limit(10**8)
rows = list(csv.reader(open(sys.argv[1]), delimiter="\t"))[1:]
known = {w: [v for v in ipa.split(" | ") if v.startswith("/")] for w, ipa, _, _ in rows if ipa}
plus = re.compile(r"^(?:From|Compound of)\s+(.+?)(?:\.|,|;| \(|$)")
def parts_of(word, ety):
    m = plus.match(ety.split(" | ")[0])
    if not m or " + " not in m.group(1): return None
    parts = [p.strip() for p in m.group(1).split(" + ")]
    if any(not re.fullmatch(r"-?[\w'’]+-?", p) for p in parts): return None
    return parts if "".join(p.strip("-") for p in parts) == word else None
def forms(v):  # a transcription with its optional sounds, and without
    v = v.strip("/").replace("-", "").replace("ɡ", "g")
    return {re.sub(r"\(([^)]*)\)", r"\1", v), re.sub(r"\([^)]*\)", "", v)}
def variants(word, head, affix, first_head):
    out = []
    for v in known.get(word, [])[:4]:
        for f in forms(v):
            if head and first_head and "ˈ" not in f: f = "ˈ" + f.lstrip("ˌ")   # one syllable: stress unwritten
            if affix: f = f.replace("ˈ", "").replace("ˌ", "")
            elif not first_head: f = f.replace("ˈ", "ˌ")
            out.append(f)
    return out
def guesses(parts):
    heads = [p for p in parts if not (p.startswith("-") or p.endswith("-"))]
    options = []
    for p in parts:
        affix = p.startswith("-") or p.endswith("-")
        vs = variants(p, not affix, affix, bool(heads) and p == heads[0])
        if not vs: return []
        options.append(vs)
    return ["".join(c) for c in itertools.product(*options)]
def key(ipa, stress):
    ipa = ipa.replace(".", "").replace("ɹ", "r").replace("ˌ", "")
    return ipa if stress else ipa.replace("ˈ", "")
def kind(parts):
    return "suffix " + parts[-1] if parts[-1].startswith("-") else "prefix " + parts[0] if parts[0].endswith("-") else "compound of words"
stats = collections.defaultdict(lambda: [0, 0, 0])
for w, ipa, ety, _ in rows:
    if not known.get(w): continue
    parts = parts_of(w, ety)
    if not parts: continue
    gs = guesses(parts)
    if not gs: continue
    truth = {f for t in known[w] for f in forms(t)}
    s = stats[kind(parts)]; s[0] += 1
    s[1] += any(key(g, True) in {key(t, True) for t in truth} for g in gs[:2])        # its first transcriptions
    s[2] += any(key(g, True) in {key(t, True) for t in truth} for g in gs)            # some combination
tot = [sum(s[i] for s in stats.values()) for i in range(3)]
print(f"tested {tot[0]:,}: sounds+stress right with first transcriptions {100*tot[1]/tot[0]:.0f}%, with some combination {100*tot[2]/tot[0]:.0f}%")
print("\n| Pattern | Tested | First transcriptions | Some combination |\n|---|---|---|---|")
for k, (n, a, b) in sorted(stats.items(), key=lambda kv: -kv[1][0])[:30]:
    print(f"| {k} | {n} | {100*a/n:.0f}% | {100*b/n:.0f}% |")
