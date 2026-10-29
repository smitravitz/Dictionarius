"""Tests for the definitions the app shows: what the builder keeps of each
Wiktionary entry.

Run: python -m unittest scripts/test_definitions.py
The entries are made up, in the shape Wiktionary data (wiktextract) uses.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_fm_index  # noqa: E402
from definitions import (  # noqa: E402
    DefinitionSpool, definition_of, pack, packing_tables, read_definitions, unpack, write_definitions,
)


def sense(gloss=None, tags=(), categories=(), form_of=None, alt_of=None, qualifier=None, glosses=None, links=None):
    s = {"tags": list(tags), "categories": list(categories)}
    if links:
        s["links"] = links
    if glosses is not None:
        s["glosses"] = glosses
    elif gloss is not None:
        s["glosses"] = [gloss]
    if form_of:
        s["form_of"] = [{"word": form_of}]
    if alt_of:
        s["alt_of"] = [{"word": alt_of}]
    if qualifier:
        s["qualifier"] = qualifier
    return s


def entry(word, *senses, pos="noun", etymology=None, ipa=()):
    e = {"word": word, "lang_code": "en", "pos": pos, "senses": list(senses)}
    if etymology:
        e["etymology_text"] = etymology
    if ipa:
        e["sounds"] = [{"ipa": i} for i in ipa] + [{"audio": "x.ogg"}]
    return e


class DefinitionOf(unittest.TestCase):
    def test_word_class_and_meanings_in_order(self):
        d = definition_of(entry("serene", sense("Calm, peaceful."), sense("Clear, fair.", tags=["archaic"]), pos="adj"))
        self.assertEqual(d, {
            "form": "serene", "pos": "adj",
            "meanings": [{"gloss": "Calm, peaceful."}, {"gloss": "Clear, fair.", "labels": ["archaic"]}],
        })

    def test_a_sub_meaning_shows_its_own_gloss(self):
        # Wiktionary lists a sub-meaning's parent glosses first.
        d = definition_of(entry("zorble", sense(glosses=["To move.", "To wobble."]), pos="verb"))
        self.assertEqual(d["meanings"], [{"gloss": "To wobble."}])

    def test_meanings_without_a_gloss_are_left_out(self):
        d = definition_of(entry("zorble", sense(tags=["no-gloss"]), sense("To wobble.")))
        self.assertEqual(d["meanings"], [{"gloss": "To wobble."}])
        self.assertIsNone(definition_of(entry("zorble", sense(tags=["no-gloss"]))))
        self.assertIsNone(definition_of({"word": "zorble", "pos": "noun"}))

    def test_a_plural_or_spelling_links_its_word_and_drops_labels_the_gloss_says(self):
        d = definition_of(entry(
            "zorbles",
            sense("plural of zorble", tags=["form-of", "plural"], form_of="zorble"),
            sense("archaic spelling of zorble", tags=["alt-of", "archaic", "obsolete"], alt_of="zorble"),
        ))
        self.assertEqual(d["meanings"], [
            {"gloss": "plural of zorble", "of": ["zorble"]},
            {"gloss": "archaic spelling of zorble", "labels": ["obsolete"], "of": ["zorble"]},
        ])

    def test_a_qualifier_is_a_label_too(self):
        d = definition_of(entry("zorble", sense("To wobble.", tags=["intransitive"], qualifier="of jelly")))
        self.assertEqual(d["meanings"], [{"gloss": "To wobble.", "labels": ["intransitive", "of jelly"]}])

    def test_wiktionarys_links_inside_a_meaning_come_along(self):
        # As on Wiktionary, words in a definition link to theirs. Anchors go;
        # links to other wiki pages, or repeating the plural's word, don't come.
        d = definition_of(entry("serene", sense(
            "Calm and peaceful; running smoothly.",
            links=[["Calm", "calm#English"], ["peaceful", "peaceful"], ["running", "run"],
                   ["smoothly", "w:Smoothly"], ["absent", "absent"]]), pos="adj"))
        self.assertEqual(d["meanings"][0]["links"], [["Calm", "calm"], ["peaceful"], ["running", "run"]])
        plural = definition_of(entry("zorbles", sense("plural of zorble", tags=["form-of"], form_of="zorble",
                                                      links=[["zorble", "zorble"]])))
        self.assertNotIn("links", plural["meanings"][0])

    def test_a_meaning_keeps_one_short_example_of_its_use(self):
        # A usage example first; else a short quotation; never one too long to
        # read under a meaning on a phone.
        long_quote = {"text": "Q" * 201, "type": "quotation", "ref": "1603, Someone"}
        d = definition_of(entry(
            "zorble",
            dict(sense("To wobble."), examples=[{"text": "A short quote zorbles.", "type": "quotation", "ref": "1899"},
                                                {"text": "  The jelly began to zorble. ", "type": "example"}]),
            dict(sense("To quiver."), examples=[long_quote, {"text": "It zorbled, she wrote.", "type": "quotation", "ref": "2001"}]),
            dict(sense("To shake."), examples=[long_quote, {"type": "example"}]),
            pos="verb"))
        self.assertEqual([m.get("example") for m in d["meanings"]],
                         ["The jelly began to zorble.", "It zorbled, she wrote.", None])

    def test_etymology_and_pronunciation_come_along(self):
        d = definition_of(entry("serene", sense("Calm."), pos="adj", etymology="From Latin serēnus.", ipa=["/səˈriːn/"]))
        self.assertEqual((d["etymology"], d["ipa"]), ("From Latin serēnus.", ["/səˈriːn/"]))
        plain = definition_of(entry("zorble", sense("To wobble.")))
        self.assertNotIn("etymology", plain)
        self.assertNotIn("ipa", plain)

    def test_an_etymology_tree_drawn_as_text_is_left_out_and_its_prose_kept(self):
        # Wiktionary's "Etymology tree" diagram comes through as one ancestor per
        # line, unreadable as text; the prose after it is the etymology.
        tree = ("Etymology tree\nProto-Indo-European *né\nOld English nān\n▲\nLatin sēnsuslbor.\nEnglish nonsense\n"
                "From non- (“no, none”) + sense, from c. 1610.")
        d = definition_of(entry("nonsense", sense("Nonsense."), etymology=tree))
        self.assertEqual(d["etymology"], "From non- (“no, none”) + sense, from c. 1610.")
        short = definition_of(entry("serene", sense("Calm."), etymology="Etymology tree\nLatin serēnus\nFrom Latin serēnus."))
        self.assertEqual(short["etymology"], "From Latin serēnus.")
        only = definition_of(entry("zorble", sense("To wobble."), etymology="Etymology tree\nProto-Zorble *zorb\nEnglish zorble"))
        self.assertNotIn("etymology", only)

    def test_vulgar_offensive_or_slur_meanings_are_marked_for_safe_search(self):
        # The same labels safe search reads, tags or categories, hedged or not.
        d = definition_of(entry(
            "gapword",
            sense("A gap."),
            sense("A made-up slur.", tags=["ethnic", "slur"]),
            sense("A rude meaning.", categories=["English vulgarities"]),
            sense("An old insult.", tags=["dated", "offensive"]),
        ))
        self.assertEqual([m.get("explicit", False) for m in d["meanings"]], [False, True, True, True])
        self.assertEqual(d["meanings"][1]["labels"], ["ethnic", "slur"])


class PerKey(unittest.TestCase):
    """Definitions are kept per search key: every written form's entries, the
    most common form first, then in Wiktionary's order."""

    def setUp(self):
        self.saved = dict(build_fm_index.FORM_ZIPF)
        build_fm_index.FORM_ZIPF.update({"bill": 4.5, "Bill": 3.0})

    def tearDown(self):
        build_fm_index.FORM_ZIPF.clear()
        build_fm_index.FORM_ZIPF.update(self.saved)

    def spool(self, *entries):
        import tempfile
        spool = DefinitionSpool(tempfile.TemporaryFile())
        for e in entries:
            spool.add(e)
        return spool

    def test_forms_most_common_first_then_entry_order(self):
        spool = self.spool(
            entry("Bill", sense("A made-up name."), pos="name"),
            entry("bill", sense("A beak."), pos="noun"),
            entry("bill", sense("To invoice."), pos="verb"),
            entry("zorble", sense("To wobble."), pos="verb"),
            entry("nothing", sense(tags=["no-gloss"])),
        )
        keys = ["bill", "nothing", "plain", "zorble"]
        forms = {"bill": {"bill", "Bill"}, "nothing": {"nothing"}, "plain": {"plain"}, "zorble": {"zorble"}}
        got = {i: [(d["form"], d["pos"]) for d in defs] for i, defs in spool.by_key(keys, forms)}
        self.assertEqual(got, {0: [("bill", "noun"), ("bill", "verb"), ("Bill", "name")], 3: [("zorble", "verb")]})


class Packing(unittest.TestCase):
    """A word's definitions packed small (docs/definitions-format.md): the
    common link glosses ("plural of X") as a template and a word, written
    forms that equal the search key and word classes as numbers, etymologies
    and pronunciations once per word. Unpacking gives back exactly the same."""

    defs = [
        {"form": "zorbles", "pos": "noun", "etymology": "From zorble.", "ipa": ["/ˈzɔː.bəlz/"],
         "meanings": [{"gloss": "plural of zorble", "of": ["zorble"]},
                      {"gloss": "A made-up crowd.", "labels": ["slang"], "explicit": True,
                       "example": "The zorbles gathered."},
                      {"gloss": "A crowd that wobbles.", "links": [["crowd"], ["wobbles", "wobble"]]}]},
        {"form": "Zorbles", "pos": "name", "etymology": "From zorble.",
         "meanings": [{"gloss": "Alternative form of Zorble.", "of": ["Zorble"]},
                      {"gloss": "Made up; see also zorble and zorbled.", "of": ["zorble", "zorbled"]}]},
    ]

    def test_tables_list_word_classes_and_link_templates_most_common_first(self):
        tables = packing_tables([self.defs, self.defs[:1]], min_uses=2)
        self.assertEqual(tables["pos"], ["noun", "name"])
        self.assertEqual(tables["templates"], ["plural of \u0000"])  # used twice; the others once

    def test_round_trip(self):
        tables = packing_tables([self.defs], min_uses=1)
        line = pack("zorbles", self.defs, tables)
        self.assertEqual(unpack("zorbles", line, tables), self.defs)
        self.assertLess(len(line), len(encode_plain(self.defs)) * 0.7)


def encode_plain(value):
    import json
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class File(unittest.TestCase):
    """The definitions file: one line of definitions per word id, in blocks
    compressed separately, tied to the index's keys. docs/definitions-format.md"""

    def test_round_trip_by_word_id_in_blocks(self):
        import tempfile
        keys = ["a", "b", "c", "d", "e", "zorble", "zorbles"]
        defs = {0: [{"form": "a", "pos": "noun", "meanings": [{"gloss": "The letter."}]}],
                5: [{"form": "zorble", "pos": "verb", "ipa": ["/ˈzɔː.bəl/"],
                     "meanings": [{"gloss": "To wobble.", "labels": ["intransitive"], "example": "It zorbled."}]}],
                6: [{"form": "zorbles", "pos": "noun", "meanings": [{"gloss": "plural of zorble", "of": ["zorble"]}]}]}
        tables = packing_tables(defs.values(), min_uses=1)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "d.bin")
            write_definitions(path, keys, sorted(defs.items()), b"k" * 32, tables, per_block=3)
            back = read_definitions(path, keys)
            only = read_definitions(path, keys, ids=[6])
        self.assertEqual((back["numWords"], back["keysHash"], back["blocks"]), (7, b"k" * 32, 3))  # ids 0-2, 3-5, 6
        self.assertEqual(back["tables"], tables)
        self.assertEqual(back["entries"], defs)
        self.assertEqual(only["entries"], {6: defs[6]})

    def test_the_same_file_however_many_cores_compress_it(self):
        # Blocks are compressed in parallel; the file mustn't depend on how many
        # at once, or the published checksums would change from one computer to another.
        import tempfile
        keys = [f"w{i:03d}" for i in range(40)]
        defs = [(i, [{"form": keys[i], "pos": "noun", "meanings": [{"gloss": f"Meaning number {i}."}]}])
                for i in range(0, 40, 3)]
        tables = packing_tables([d for _, d in defs], min_uses=1)
        files = []
        with tempfile.TemporaryDirectory() as tmp:
            for workers in (1, 3, 8):
                path = os.path.join(tmp, f"d{workers}.bin")
                blocks = write_definitions(path, keys, iter(defs), b"k" * 32, tables, per_block=4, workers=workers)
                with open(path, "rb") as f:
                    files.append(f.read())
            back = read_definitions(path, keys)
        self.assertEqual(blocks, 10)
        self.assertEqual(files[1], files[0])
        self.assertEqual(files[2], files[0])
        self.assertEqual(back["entries"], dict(defs))


if __name__ == "__main__":
    unittest.main()
