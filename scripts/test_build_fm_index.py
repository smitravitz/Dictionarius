"""Tests for the index builder's explicit-word rule (safe search).

Run: python -m unittest scripts/test_build_fm_index.py
The entries are made up, in the shape Wiktionary data (wiktextract) uses.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from build_fm_index import Labels  # noqa: E402


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
    def explicit(self, *entries):
        labels = Labels()
        for e in entries:
            labels.add(e)
        return labels.explicit_words()

    def test_a_word_whose_every_meaning_is_vulgar_offensive_or_a_slur(self):
        found = self.explicit(
            entry("rudeword", sense("vulgar"), sense("slang", "vulgar")),
            entry("slurword", sense("ethnic", "slur", "offensive")),
            entry("insultword", sense("offensive")),
        )
        self.assertEqual(found, {"rudeword", "slurword", "insultword"})

    def test_a_category_label_counts_like_a_tag(self):
        found = self.explicit(entry("catword", sense(categories=["English vulgarities"])))
        self.assertEqual(found, {"catword"})

    def test_one_ordinary_meaning_keeps_a_word_visible(self):
        # Like "cock" (a rooster) or "ass" (a donkey).
        found = self.explicit(entry("mixedword", sense("vulgar"), sense(gloss="a farm bird")))
        self.assertEqual(found, set())

    def test_ordinary_meanings_in_another_entry_of_the_same_word_count_too(self):
        found = self.explicit(entry("twoword", sense("vulgar")), entry("twoword", sense(gloss="a verb meaning")))
        self.assertEqual(found, set())

    def test_derogatory_or_slang_alone_is_not_enough(self):
        found = self.explicit(entry("meanword", sense("derogatory")), entry("slangword", sense("slang")))
        self.assertEqual(found, set())

    def test_inflections_and_spellings_follow_their_base_word(self):
        found = self.explicit(
            entry("rudeword", sense("vulgar")),
            entry("rudewords", sense("form-of", "plural", form_of="rudeword")),
            entry("rudewurd", sense("alt-of", alt_of="rudeword")),
            entry("rudewurds", sense("form-of", "plural", form_of="rudewurd")),  # a chain
            entry("plainword", sense()),
            entry("plainwords", sense("form-of", "plural", form_of="plainword")),
            entry("orphans", sense("form-of", "plural", form_of="no-such-entry")),
        )
        self.assertEqual(found, {"rudeword", "rudewords", "rudewurd", "rudewurds"})

    def test_an_inflection_that_also_has_its_own_ordinary_meaning_stays(self):
        found = self.explicit(
            entry("rudeword", sense("vulgar")),
            entry("rudewords", sense("form-of", form_of="rudeword"), sense(gloss="a town")),
        )
        self.assertEqual(found, {"rudeword"})

    def test_meanings_without_a_gloss_are_ignored(self):
        found = self.explicit(entry("rudeword", sense("vulgar"), {"tags": ["no-gloss"]}))
        self.assertEqual(found, {"rudeword"})

    def test_other_languages_and_words_without_senses_are_ignored(self):
        labels = Labels()
        labels.add({"word": "rudeword", "lang_code": "en", "senses": [sense("vulgar")]})
        labels.add({"word": "plain"})
        self.assertEqual(labels.explicit_words(), {"rudeword"})
        self.assertTrue(labels.seen)
        self.assertFalse(Labels().seen)

    def test_surrounding_whitespace_is_trimmed_like_headwords(self):
        found = self.explicit(entry(" rudeword ", sense("vulgar")))
        self.assertEqual(found, {"rudeword"})


if __name__ == "__main__":
    unittest.main()
