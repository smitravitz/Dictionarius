"""Tests for the index builder's explicit-word rule (safe search).

Run: python -m unittest scripts/test_build_fm_index.py
The entries are made up, in the shape Wiktionary data (wiktextract) uses.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_fm_index  # noqa: E402
import safe_search_list  # noqa: E402
from build_fm_index import (  # noqa: E402
    Labels, candidate_keys, display_forms, explicit_keys, read_safe_search_list, safe_review_rows,
)


def entry(word, *senses):
    return {"word": word, "lang_code": "en", "senses": list(senses)}


def sense(*tags, gloss="a meaning", categories=(), form_of=None, alt_of=None):
    s = {"glosses": [gloss], "tags": list(tags), "categories": list(categories)}
    if form_of:
        s["form_of"] = [{"word": form_of}]
    if alt_of:
        s["alt_of"] = [{"word": alt_of}]
    return s


class ExplicitWords(unittest.TestCase):
    """A word is explicit when its main meaning (the first one listed) is, or
    is just a plural, tense or spelling of such a word."""

    def explicit(self, *entries, allow=frozenset()):
        labels = Labels()
        for e in entries:
            labels.add(e)
        return labels.explicit_words(allow)

    def test_main_meaning_vulgar_offensive_or_a_slur(self):
        found = self.explicit(
            entry("rudeword", sense("vulgar")),
            entry("slurword", sense("ethnic", "slur", "offensive")),
            entry("insultword", sense("offensive")),
        )
        self.assertEqual(found, {"rudeword", "slurword", "insultword"})

    def test_a_category_label_counts_like_a_tag(self):
        found = self.explicit(entry("catword", sense(categories=["English vulgarities"])))
        self.assertEqual(found, {"catword"})

    def test_a_main_meaning_counts_even_when_hedged(self):
        found = self.explicit(entry("oldterm", sense("dated", "offensive")))
        self.assertEqual(found, {"oldterm"})

    def test_later_ordinary_meanings_dont_save_a_vulgar_word(self):
        found = self.explicit(entry("rudeword", sense("vulgar"), sense("slang"), sense(gloss="plain")))
        self.assertEqual(found, {"rudeword"})

    def test_the_first_entry_decides(self):
        found = self.explicit(
            entry("nounfirst", sense(gloss="a plain noun")),
            entry("nounfirst", sense("vulgar")),  # a later part of speech
            entry("vulgarfirst", sense("vulgar")),
            entry("vulgarfirst", sense(gloss="a plain verb")),
        )
        self.assertEqual(found, {"vulgarfirst"})

    def test_derogatory_or_slang_alone_is_not_enough(self):
        found = self.explicit(entry("meanword", sense("derogatory")), entry("slangword", sense("slang")))
        self.assertEqual(found, set())

    def test_a_words_own_plurals_tenses_and_spellings_follow_it(self):
        found = self.explicit(
            entry("rudeword", sense("vulgar")),
            entry("rudewords", sense("form-of", "plural", form_of="rudeword")),
            entry("rudewurd", sense("alt-of", alt_of="rudeword")),
            entry("roosterword", sense(gloss="a farm bird"), sense("vulgar")),
            entry("roosterwords", sense("form-of", "plural", form_of="roosterword")),
            entry("orphans", sense("form-of", "plural", form_of="no-such-entry")),
        )
        self.assertEqual(found, {"rudeword", "rudewords", "rudewurd"})

    def test_one_step_only(self):
        # The plural of a spelling is two steps away: not hidden.
        found = self.explicit(
            entry("rudeword", sense("vulgar")),
            entry("rudewurd", sense("alt-of", alt_of="rudeword")),
            entry("rudewurds", sense("form-of", "plural", form_of="rudewurd")),
        )
        self.assertEqual(found, {"rudeword", "rudewurd"})

    def test_an_inflection_with_a_vulgar_label_of_its_own_counts(self):
        found = self.explicit(entry("rudeworded", sense("vulgar", "form-of", form_of="plainword")))
        self.assertEqual(found, {"rudeworded"})

    def test_meanings_without_a_gloss_are_skipped(self):
        found = self.explicit(entry("rudeword", {"tags": ["no-gloss"]}, sense("vulgar")))
        self.assertEqual(found, {"rudeword"})

    def test_words_without_senses_are_ignored(self):
        labels = Labels()
        labels.add({"word": "rudeword", "lang_code": "en", "senses": [sense("vulgar")]})
        labels.add({"word": "plain"})
        self.assertEqual(labels.explicit_words(), {"rudeword"})
        self.assertTrue(labels.seen)
        self.assertFalse(Labels().seen)

    def test_surrounding_whitespace_is_trimmed_like_headwords(self):
        found = self.explicit(entry(" rudeword ", sense("vulgar")))
        self.assertEqual(found, {"rudeword"})

    def test_allowing_a_word_keeps_it_and_its_forms_visible(self):
        found = self.explicit(
            entry("Nameword", sense("offensive")),
            entry("nameword", sense("vulgar")),
            entry("namewords", sense("form-of", "plural", form_of="nameword")),
            entry("rudeword", sense("vulgar")),
            allow={"nameword"},
        )
        self.assertEqual(found, {"rudeword"})


class FurtherDown(unittest.TestCase):
    """Labels further down a word's meanings hide nothing: a word mostly known
    as a bad word despite an innocent first meaning goes on the hand-picked
    list. They flag the word for review instead."""

    def labels(self, *entries):
        labels = Labels()
        for e in entries:
            labels.add(e)
        return labels

    def test_a_slur_or_vulgar_meaning_further_down_hides_nothing(self):
        labels = self.labels(
            entry("boyword", sense(gloss="a young man"), sense("ethnic", "slur")),
            entry("roosterword", sense(gloss="a farm bird"), sense("slang", "vulgar")),
            entry("gapword", sense(gloss="a gap")),
            entry("gapword", sense("ethnic", "slur")),  # a later entry
        )
        self.assertEqual(labels.explicit_words(), set())

    def test_nothing_is_hidden_through_a_chain_of_spellings(self):
        # "be" is also an old spelling of "by", "by" of "bye", "bye" of "boy".
        labels = self.labels(
            entry("boyword", sense("vulgar")),
            entry("byword", sense(gloss="beside"), sense("alt-of", alt_of="boyword")),
            entry("beword", sense(gloss="to exist"), sense("alt-of", alt_of="byword")),
            entry("isword", sense("form-of", form_of="beword")),
        )
        self.assertEqual(labels.explicit_words(), {"boyword"})

    def test_slurs_further_down_are_listed_for_review(self):
        labels = self.labels(
            entry("boyword", sense(gloss="a young man"), sense("ethnic", "slur")),
            entry("cookieword", sense(gloss="a biscuit"), sense(categories=["English ethnic slurs"])),
            entry("insultword", sense(gloss="plain"), sense("derogatory", "offensive")),
            entry("hedgeword", sense(gloss="plain"), sense("dated", "offensive")),
            entry("roosterword", sense(gloss="a farm bird"), sense("slang", "vulgar")),
            entry("slurword", sense("ethnic", "slur")),  # hidden already
        )
        found = labels.candidates(labels.explicit_reasons())
        self.assertEqual(set(found), {"boyword", "cookieword", "insultword"})


class Keys(unittest.TestCase):
    """A search key is hidden when it is blocked, or when its most common
    written form is explicit; allowed keys never are."""

    def setUp(self):
        self.saved = dict(build_fm_index.FORM_ZIPF)
        self.saved_explicit = set(build_fm_index.EXPLICIT_FORMS)

    def tearDown(self):
        build_fm_index.FORM_ZIPF.clear()
        build_fm_index.FORM_ZIPF.update(self.saved)
        build_fm_index.EXPLICIT_FORMS.clear()
        build_fm_index.EXPLICIT_FORMS.update(self.saved_explicit)

    def test_keys(self):
        build_fm_index.FORM_ZIPF.update({"rude": 4.0, "Rude": 2.0, "name": 2.0, "Name": 4.0})
        keys = ["name", "rude", "plain", "gap", "fine", "gaps"]
        forms = {"name": {"name", "Name"}, "rude": {"rude", "Rude"}, "plain": {"plain"}, "gap": {"gap"},
                 "fine": {"fine"}, "gaps": {"gaps"}}
        reasons = {"rude": "main meaning", "name": "main meaning", "fine": "main meaning"}
        # "rude" (common) is explicit, "Name" (the common form of "name") isn't;
        # "gap" is blocked (not its plural), "fine" allowed.
        found = explicit_keys(keys, forms, reasons, allow={"fine"}, block={"gap"})
        self.assertEqual(found, [(1, "main meaning"), (3, "blocked by hand")])

    def test_an_offensive_spelling_loses_a_tie(self):
        # Word frequencies ignore case, so "Russian" and a slur spelling of it
        # ("RuSSian") tie. The plain spelling shows, and decides; the key
        # itself still comes first ("rude" stays hidden, though "Rude" isn't).
        build_fm_index.FORM_ZIPF.update({"Nameword": 5.0, "NaMEword": 5.0, "rude": 4.0, "Rude": 4.0})
        reasons = {"NaMEword": "main meaning", "rude": "main meaning"}
        build_fm_index.EXPLICIT_FORMS.update(reasons)
        forms = {"nameword": {"Nameword", "NaMEword"}, "rude": {"rude", "Rude"}}
        self.assertEqual(display_forms("nameword", forms["nameword"]), ["Nameword", "NaMEword"])
        self.assertEqual(display_forms("rude", forms["rude"]), ["rude", "Rude"])
        self.assertEqual(explicit_keys(["nameword", "rude"], forms, reasons), [(1, "main meaning")])

    def test_visible_keys_worth_a_look(self):
        build_fm_index.FORM_ZIPF.update({"name": 2.0, "Name": 4.0})
        keys = ["boy", "name", "plain", "rude", "fine"]
        forms = {"boy": {"boy"}, "name": {"name", "Name"}, "plain": {"plain"}, "rude": {"rude"}, "fine": {"fine"}}
        notes = {"boy": "a slur meaning further down", "name": "main meaning", "rude": "main meaning",
                 "fine": "a slur meaning further down"}
        hidden = [(3, "main meaning")]
        found = candidate_keys(keys, forms, notes, hidden, allow={"fine"})
        self.assertEqual(found, [(0, "a slur meaning further down"), (1, "as name: main meaning")])


class HandPickedList(unittest.TestCase):
    def test_round_trip_and_normalizing(self):
        text = safe_search_list.render({"allow": ["Boy", "fun run", "Café"], "block": ["Gapword"]})
        self.assertNotIn("Gapword", text)  # encoded
        allow, block = read_safe_search_list(text)
        self.assertEqual(allow, {"boy", "fun run", "cafe"})
        self.assertEqual(block, {"gapword"})

    def test_a_word_outside_a_section_is_an_error(self):
        with self.assertRaises(ValueError):
            safe_search_list.parse(safe_search_list.encode("boy") + "\n[allow]\n")

    def test_a_plain_word_is_an_error(self):
        with self.assertRaises(ValueError):
            safe_search_list.parse("[block]\nnot encoded!\n")

    def test_a_word_in_both_sections_is_an_error(self):
        with self.assertRaises(ValueError):
            read_safe_search_list(safe_search_list.render({"allow": ["boy"], "block": ["Boy"]}))

    def test_the_shipped_list_reads(self):
        with open(safe_search_list.PATH, encoding="utf-8") as f:
            allow, block = read_safe_search_list(f.read())
        self.assertTrue(allow)
        self.assertTrue(block)


class LabelsCache(unittest.TestCase):
    def test_a_rebuild_from_the_cache_gives_the_same_answers(self):
        import tempfile
        labels = Labels()
        for e in (
            entry("rudeword", sense("vulgar")),
            entry("rudewords", sense("form-of", "plural", form_of="rudeword")),
            entry("gapword", sense(gloss="a gap"), sense("ethnic", "slur")),
            entry("hedgeword", sense(gloss="plain"), sense("dated", "offensive")),
            entry("plainword", sense(gloss="plain")),
            entry("roosterword", sense(gloss="a farm bird"), sense("slang", "vulgar")),
        ):
            labels.add(e)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "labels.jsonl.gz")
            labels.save(path)
            loaded = Labels.load(path)
        self.assertNotIn("plainword", loaded.main)  # plain words aren't stored
        for allow in (set(), {"rudeword"}):
            self.assertEqual(loaded.explicit_reasons(allow), labels.explicit_reasons(allow))
        self.assertEqual(loaded.candidates({}), labels.candidates({}))


class SafeReview(unittest.TestCase):
    """The review list: every hidden word, most common first, with why."""

    def setUp(self):
        self.saved = dict(build_fm_index.FORM_ZIPF)

    def tearDown(self):
        build_fm_index.FORM_ZIPF.clear()
        build_fm_index.FORM_ZIPF.update(self.saved)

    def test_most_common_first_with_why(self):
        keys = ["gapword", "plain", "rudeword", "boy"]
        forms = {"gapword": {"gapword"}, "plain": {"plain"}, "rudeword": {"rudeword", "Rudeword"}, "boy": {"boy"}}
        build_fm_index.FORM_ZIPF.update({"rudeword": 4.2, "Rudeword": 1.0})
        hidden = [(0, "blocked by hand"), (2, "main meaning")]
        shown = [(3, "a slur meaning further down")]
        rows = safe_review_rows(keys, forms, [150, 500, 420, 520], hidden, shown)
        self.assertEqual(rows, [
            ("5.20", "boy", "shown", "a slur meaning further down"),
            ("4.20", "rudeword", "hidden", "main meaning"),
            ("1.50", "gapword", "hidden", "blocked by hand"),
        ])

    def test_without_frequencies_alphabetical(self):
        rows = safe_review_rows(["b", "a"], {"a": {"a"}, "b": {"b"}}, None, [(0, "x"), (1, "main meaning")])
        self.assertEqual(rows, [("", "a", "hidden", "main meaning"), ("", "b", "hidden", "x")])


if __name__ == "__main__":
    unittest.main()
