import { describe, it, expect } from "vitest";
import { attributionNotice, sourcePageUrl } from "../src/attribution";
import type { Entry } from "../src/source";

const entryWith = (source: string, license: string, headword = "run"): Entry => ({
  headword,
  senses: [{ partOfSpeech: "verb", gloss: "to move swiftly" }],
  attribution: { source, license },
});

describe("attributionNotice", () => {
  it("credits the entry's Wiktionary page and the license, both linked", () => {
    const notice = attributionNotice(entryWith("Wiktionary", "CC-BY-SA-4.0"));

    // CC BY-SA credit = link to the source page (where author history lives)
    // + license name + license link. Independent expected literal.
    expect(notice).toBe(
      "From Wiktionary (https://en.wiktionary.org/wiki/run) — CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)",
    );
  });

  it("still credits source page + raw license id when the license is unknown", () => {
    const notice = attributionNotice(entryWith("Wiktionary", "PD-custom"));
    expect(notice).toBe("From Wiktionary (https://en.wiktionary.org/wiki/run) — PD-custom");
  });

  it("links to the exact Wiktionary page for awkward headwords", () => {
    const url = (headword: string) =>
      sourcePageUrl(entryWith("Wiktionary", "CC-BY-SA-4.0", headword));

    // MediaWiki page URLs: spaces -> underscores, UTF-8 percent-encoding,
    // '#' encoded (else it's a fragment), '/' kept literal.
    expect(url("ice cream")).toBe("https://en.wiktionary.org/wiki/ice_cream");
    expect(url("café")).toBe("https://en.wiktionary.org/wiki/caf%C3%A9");
    expect(url("C#")).toBe("https://en.wiktionary.org/wiki/C%23");
    expect(url("and/or")).toBe("https://en.wiktionary.org/wiki/and/or");
  });

  it("credits a source with no known page scheme by name only, never a wrong link", () => {
    const entry = entryWith("Webster's 1913", "Public domain");

    expect(sourcePageUrl(entry)).toBeNull();
    expect(attributionNotice(entry)).toBe("From Webster's 1913 — Public domain");
  });

  it("refuses to produce a notice when attribution is missing (enforcement)", () => {
    expect(() => attributionNotice(entryWith("", "CC-BY-SA-4.0"))).toThrow();
    expect(() => attributionNotice(entryWith("Wiktionary", ""))).toThrow();
  });
});
