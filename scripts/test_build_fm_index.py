"""Tests for the index builder's explicit-word rule (safe search).

Run: python -m unittest scripts/test_build_fm_index.py
The entries are made up, in the shape Wiktionary data (wiktextract) uses.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_fm_index  # noqa: E402
from build_fm_index import Labels, explicit_key_ids, safe_review_rows  # noqa: E402


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

    def test_a_spelling_of_a_slur_is_hidden_wherever_it_is_listed(self):
        # Lowercase "chink" lists "alternative letter-case form of Chink" after "a gap".
        found = self.explicit(
            entry("Gapword", sense("derogatory", "ethnic", "offensive", "slur")),
            entry("gapword", sense(gloss="a narrow gap"), sense("alt-of", alt_of="Gapword")),
            entry("gapwords", sense("form-of", "plural", form_of="gapword")),
        )
        self.assertEqual(found, {"Gapword", "gapword", "gapwords"})

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

    def test_secondary_slurs_reach_through_spellings_but_vulgar_ones_dont(self):
        found = self.explicit(
            entry("arseword", sense("vulgar")),
            entry("donkeyword", sense(gloss="a donkey"), sense("alt-of", alt_of="arseword")),
        )
        self.assertEqual(found, {"arseword"})  # the donkey stays


class ExplicitKeys(unittest.TestCase):
    """A search key is explicit when its most common written form is."""

    def setUp(self):
        self.saved = dict(build_fm_index.FORM_ZIPF)

    def tearDown(self):
        build_fm_index.FORM_ZIPF.clear()
        build_fm_index.FORM_ZIPF.update(self.saved)

    def test_the_most_common_form_decides(self):
        build_fm_index.FORM_ZIPF.update({"rude": 4.0, "Rude": 2.0, "name": 2.0, "Name": 4.0})
        keys = ["name", "rude", "plain"]
        forms = {"name": {"name", "Name"}, "rude": {"rude", "Rude"}, "plain": {"plain"}}
        # "rude" (common) is explicit, "Name" (the common form of "name") isn't.
        explicit = {"rude", "name"}
        self.assertEqual(explicit_key_ids(keys, forms, explicit), [1])



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
        reasons = {"gapword": "a slur meaning", "rudeword": "main meaning"}
        rows = safe_review_rows(keys, forms, [150, 500, 420], [0, 2], reasons)
        self.assertEqual(rows, [("4.20", "rudeword", "main meaning"), ("1.50", "gapword", "a slur meaning")])

    def test_without_frequencies_alphabetical(self):
        keys = ["b", "a"]
        rows = safe_review_rows(keys, {"a": {"a"}, "b": {"b"}}, None, [0, 1], {"a": "main meaning", "b": "x"})
        self.assertEqual(rows, [("", "a", "main meaning"), ("", "b", "x")])


if __name__ == "__main__":
    unittest.main()
