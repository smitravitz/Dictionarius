import { describe, it, expect } from "vitest";
import { attributionNotice } from "../src/attribution";
import type { Entry } from "../src/source";

const entryWith = (source: string, license: string): Entry => ({
  headword: "run",
  senses: [{ partOfSpeech: "verb", gloss: "to move swiftly" }],
  attribution: { source, license },
});

describe("attributionNotice", () => {
  it("builds a credit with the canonical URL for a known license", () => {
    const notice = attributionNotice(entryWith("Wiktionary", "CC-BY-SA-4.0"));

    // Independent expected literal (the required CC-BY-SA credit format).
    expect(notice).toBe(
      "From Wiktionary — CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)",
    );
  });

  it("still credits source + raw license id when the license is unknown", () => {
    const notice = attributionNotice(entryWith("Wiktionary", "PD-custom"));
    expect(notice).toBe("From Wiktionary — PD-custom");
  });

  it("refuses to produce a notice when attribution is missing (enforcement)", () => {
    expect(() => attributionNotice(entryWith("", "CC-BY-SA-4.0"))).toThrow();
    expect(() => attributionNotice(entryWith("Wiktionary", ""))).toThrow();
  });
});
