"""Tests for the index builder's explicit-word rule (safe search).

Run: python -m unittest scripts/test_build_fm_index.py
The entries are made up, in the shape Wiktionary data (wiktextract) uses.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_fm_index  # noqa: E402
from build_fm_index import Labels, explicit_keys, read_safe_search_list, safe_review_rows  # noqa: E402


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
    """A word is explicit when its main meaning (the first one listed) is."""

    def explicit(self, *entries):
        labels = Labels()
        for e in entries:
            labels.add(e)
        return labels.explicit_words()

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

    def test_an_ordinary_main_meaning_keeps_a_word_visible(self):
        # Like "cock" (a rooster first) or "ass" (a donkey first).
        found = self.explicit(entry("roosterword", sense(gloss="a farm bird"), sense("vulgar")))
        self.assertEqual(found, set())

    def test_later_ordinary_meanings_dont_save_a_vulgar_word(self):
        # Like "shit": vulgar first, with a meaning labelled only "slang" later.
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

    def test_inflections_and_spellings_follow_their_base_word(self):
        found = self.explicit(
            entry("rudeword", sense("vulgar")),
            entry("rudewords", sense("form-of", "plural", form_of="rudeword")),
            entry("rudewurd", sense("alt-of", alt_of="rudeword")),
            entry("rudewurds", sense("form-of", "plural", form_of="rudewurd")),  # a chain
            entry("roosterword", sense(gloss="a farm bird"), sense("vulgar")),
            entry("roosterwords", sense("form-of", "plural", form_of="roosterword")),
            entry("orphans", sense("form-of", "plural", form_of="no-such-entry")),
        )
        self.assertEqual(found, {"rudeword", "rudewords", "rudewurd", "rudewurds"})

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


class SlursAnywhere(unittest.TestCase):
    """Any meaning that is a slur, or plainly offensive, hides the word, wherever
    it is listed. Hedged labels and secondary vulgar meanings don't."""

    def explicit(self, *entries):
        labels = Labels()
        for e in entries:
            labels.add(e)
        return labels.explicit_words()

    def test_a_slur_in_second_or_third_place_hides_the_word(self):
        found = self.explicit(
            entry("raccoonword", sense(gloss="a raccoon"), sense("derogatory", "ethnic", "offensive", "slang", "slur")),
            entry("cookieword", sense(gloss="a biscuit"), sense(gloss="a firework"), sense("ethnic", "slur")),
            entry("bundleword", sense(gloss="a bundle of sticks"), sense("derogatory", "offensive", "slang", "vulgar")),
        )
        self.assertEqual(found, {"raccoonword", "cookieword", "bundleword"})

    def test_the_slur_category_counts_without_the_tag(self):
        found = self.explicit(entry("gapword", sense(gloss="a gap"), sense(categories=["English ethnic slurs"])))
        self.assertEqual(found, {"gapword"})

    def test_a_later_entry_with_a_slur_counts(self):
        found = self.explicit(entry("gapword", sense(gloss="a gap")), entry("gapword", sense("ethnic", "slur")))
        self.assertEqual(found, {"gapword"})

    def test_inflections_of_a_slur_follow_it(self):
        found = self.explicit(
            entry("gapword", sense(gloss="a gap"), sense("ethnic", "slur")),
            entry("gapwords", sense("form-of", "plural", form_of="gapword")),
        )
        self.assertEqual(found, {"gapword", "gapwords"})

    def test_a_spelling_listed_further_down_doesnt_tie_words_together(self):
        # "be" is also an old spelling of "by", "by" of "bye", "bye" of "boy";
        # one slur meaning of "boy" mustn't hide "be", and with it "is".
        found = self.explicit(
            entry("boyword", sense(gloss="a boy"), sense("ethnic", "slur")),
            entry("byword", sense(gloss="beside"), sense("alt-of", alt_of="boyword")),
            entry("beword", sense(gloss="to exist"), sense("alt-of", alt_of="byword")),
            entry("isword", sense("form-of", form_of="beword")),
            entry("Gapword", sense("ethnic", "slur")),
            entry("gapword", sense(gloss="a narrow gap"), sense("alt-of", alt_of="Gapword")),
        )
        self.assertEqual(found, {"boyword", "Gapword"})

    def test_hedged_offensive_labels_further_down_dont_count(self):
        # Like "colored": an everyday main meaning, and a dated, offensive one.
        found = self.explicit(
            entry("nationword", sense(gloss="a people"), sense("offensive", "sometimes")),
            entry("oldword", sense(gloss="plain"), sense("dated", "offensive")),
            entry("maybeword", sense(gloss="plain"), sense("offensive", "possibly")),
        )
        self.assertEqual(found, set())

    def test_a_main_meaning_counts_even_when_hedged(self):
        found = self.explicit(entry("oldterm", sense("dated", "offensive")))
        self.assertEqual(found, {"oldterm"})

    def test_reasons_are_reported(self):
        labels = Labels()
        for e in (
            entry("rudeword", sense("vulgar")),
            entry("gapword", sense(gloss="a gap"), sense("ethnic", "slur")),
            entry("gapwords", sense("form-of", form_of="gapword")),
        ):
            labels.add(e)
        reasons = labels.explicit_reasons()
        self.assertEqual(reasons, {"rudeword": "main meaning", "gapword": "a slur meaning", "gapwords": "form of gapword"})

    def test_secondary_vulgar_or_derogatory_meanings_alone_dont_hide_a_word(self):
        found = self.explicit(
            entry("roosterword", sense(gloss="a farm bird"), sense("slang", "vulgar")),
            entry("policeword", sense(gloss="a farm animal"), sense("derogatory", "slang")),
        )
        self.assertEqual(found, set())

    def test_a_spelling_further_down_doesnt_carry_a_vulgar_word_either(self):
        found = self.explicit(
            entry("arseword", sense("vulgar")),
            entry("donkeyword", sense(gloss="a donkey"), sense("alt-of", alt_of="arseword")),
        )
        self.assertEqual(found, {"arseword"})  # the donkey stays


class Corrections(unittest.TestCase):
    """Hand corrections (data/safe-search.txt): search keys to allow or block."""

    def labels(self, *entries):
        labels = Labels()
        for e in entries:
            labels.add(e)
        return labels

    def test_allowing_a_word_keeps_it_and_its_inflections_visible(self):
        labels = self.labels(
            entry("boyword", sense(gloss="a boy"), sense("ethnic", "slur")),
            entry("boywords", sense("form-of", "plural", form_of="boyword")),
            entry("rudeword", sense("vulgar")),
        )
        self.assertEqual(labels.explicit_words(allow={"boyword"}), {"rudeword"})

    def test_allow_matches_every_spelling_of_the_key(self):
        labels = self.labels(entry("Nameword", sense("offensive")), entry("nameword", sense("vulgar")))
        self.assertEqual(labels.explicit_words(allow={"nameword"}), set())

    def test_blocking_a_word_pulls_in_its_inflections(self):
        labels = self.labels(
            entry("gapword", sense(gloss="a narrow gap")),
            entry("Gapword", sense(gloss="a name")),
            entry("gapwords", sense("form-of", "plural", form_of="gapword")),
        )
        reasons = labels.explicit_reasons(block={"gapword"})
        self.assertEqual(reasons, {"gapwords": "form of gapword"})  # the key itself: see test_keys

    def test_blocking_reaches_inflections_of_words_without_labels(self):
        # The labels cache leaves out plain words, so a blocked base may be unknown.
        labels = self.labels(entry("gapwords", sense("form-of", "plural", form_of="gapword")))
        self.assertEqual(labels.explicit_words(block={"gapword"}), {"gapwords"})

    def test_keys(self):
        build_fm_index.FORM_ZIPF.update({"rude": 4.0, "Rude": 2.0, "name": 2.0, "Name": 4.0})
        keys = ["name", "rude", "plain", "gap", "fine"]
        forms = {"name": {"name", "Name"}, "rude": {"rude", "Rude"}, "plain": {"plain"}, "gap": {"gap"},
                 "fine": {"fine"}}
        reasons = {"rude": "main meaning", "name": "main meaning", "fine": "a slur meaning"}
        # "rude" (common) is explicit, "Name" (the common form of "name") isn't;
        # "gap" is blocked, "fine" allowed.
        found = explicit_keys(keys, forms, reasons, allow={"fine"}, block={"gap"})
        self.assertEqual(found, [(1, "main meaning"), (3, "blocked by hand")])

    def setUp(self):
        self.saved = dict(build_fm_index.FORM_ZIPF)

    def tearDown(self):
        build_fm_index.FORM_ZIPF.clear()
        build_fm_index.FORM_ZIPF.update(self.saved)


class CorrectionsFile(unittest.TestCase):
    def test_sections_comments_and_normalizing(self):
        allow, block = read_safe_search_list(
            "# a comment\n\n[allow]\nBoy\n  fun run  \nCafé\n[block]\n# why\nGapword\n"
        )
        self.assertEqual(allow, {"boy", "fun run", "cafe"})
        self.assertEqual(block, {"gapword"})

    def test_a_word_outside_a_section_is_an_error(self):
        with self.assertRaises(ValueError):
            read_safe_search_list("boy\n[allow]\n")

    def test_a_word_in_both_sections_is_an_error(self):
        with self.assertRaises(ValueError):
            read_safe_search_list("[allow]\nboy\n[block]\nBoy\n")

    def test_the_shipped_list_reads(self):
        with open(build_fm_index.SAFE_SEARCH_LIST, encoding="utf-8") as f:
            allow, block = read_safe_search_list(f.read())
        self.assertIn("it", allow)
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
        for allow, block in ((set(), set()), ({"gapword"}, {"plainword"})):
            self.assertEqual(loaded.explicit_reasons(allow, block), labels.explicit_reasons(allow, block))


class SafeReview(unittest.TestCase):
    """The review list: every hidden word, most common first, with why."""

    def setUp(self):
        self.saved = dict(build_fm_index.FORM_ZIPF)

    def tearDown(self):
        build_fm_index.FORM_ZIPF.clear()
        build_fm_index.FORM_ZIPF.update(self.saved)

    def test_most_common_first_with_reasons(self):
        keys = ["gapword", "plain", "rudeword"]
        forms = {"gapword": {"gapword"}, "plain": {"plain"}, "rudeword": {"rudeword", "Rudeword"}}
        build_fm_index.FORM_ZIPF.update({"rudeword": 4.2, "Rudeword": 1.0})
        hidden = [(0, "a slur meaning"), (2, "main meaning")]
        rows = safe_review_rows(keys, forms, [150, 500, 420], hidden)
        self.assertEqual(rows, [("4.20", "rudeword", "main meaning"), ("1.50", "gapword", "a slur meaning")])

    def test_without_frequencies_alphabetical(self):
        rows = safe_review_rows(["b", "a"], {"a": {"a"}, "b": {"b"}}, None, [(0, "x"), (1, "main meaning")])
        self.assertEqual(rows, [("", "a", "main meaning"), ("", "b", "x")])


if __name__ == "__main__":
    unittest.main()
