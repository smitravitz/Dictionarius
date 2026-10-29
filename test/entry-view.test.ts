import { describe, it, expect } from "vitest";
import { entryView, glossParts, peekView } from "../src/entry-view";
import type { Definition } from "../src/definitions";

// What a word's entry shows: each written form's word classes in order,
// numbered meanings with their labels, safe search's meanings left out (and
// counted), and the peek: the first meanings, and how many more there are.

const serene: Definition[] = [
  { form: "serene", pos: "adj", meanings: [{ gloss: "Calm, peaceful." }, { gloss: "Clear, fair.", labels: ["archaic"] }] },
  { form: "serene", pos: "noun", meanings: [{ gloss: "Serenity." }, { gloss: "A made-up slur.", labels: ["slur"], explicit: true }] },
  { form: "Serene", pos: "name", meanings: [{ gloss: "A made-up surname." }] },
];

describe("entryView", () => {
  it("numbers each word class's meanings, with readable word classes", () => {
    expect(entryView(serene, { safe: false })).toEqual({
      classes: [
        { form: "serene", pos: "adjective", meanings: [
          { n: 1, gloss: "Calm, peaceful.", labels: [], links: [] },
          { n: 2, gloss: "Clear, fair.", labels: ["archaic"], links: [] },
        ] },
        { form: "serene", pos: "noun", meanings: [
          { n: 1, gloss: "Serenity.", labels: [], links: [] },
          { n: 2, gloss: "A made-up slur.", labels: ["slur"], links: [] },
        ] },
        { form: "Serene", pos: "proper noun", meanings: [{ n: 1, gloss: "A made-up surname.", labels: [], links: [] }] },
      ],
      hidden: 0,
      ipa: [],
    });
  });

  it("leaves safe search's meanings out, counting them, and drops a class left empty", () => {
    const view = entryView(serene, { safe: true });
    expect(view.hidden).toBe(1);
    expect(view.classes[1].meanings.map((m) => m.gloss)).toEqual(["Serenity."]);
    const allRude: Definition[] = [{ form: "gapword", pos: "noun", meanings: [{ gloss: "Rude.", explicit: true }] }];
    expect(entryView(allRude, { safe: true })).toEqual({ classes: [], hidden: 1, ipa: [] });
  });

  it("keeps the words a plural or spelling links to, and an unknown word class as given", () => {
    const view = entryView([{ form: "zorbles", pos: "particle-ish", meanings: [{ gloss: "plural of zorble", of: ["zorble"] }] }], {
      safe: true,
    });
    expect(view.classes[0]).toEqual({
      form: "zorbles",
      pos: "particle-ish",
      meanings: [{ n: 1, gloss: "plural of zorble", labels: [], links: [{ text: "zorble", word: "zorble" }] }],
    });
  });
});

describe("examples of use", () => {
  it("carries a meaning's example along with it", () => {
    const view = entryView(
      [{ form: "zorble", pos: "verb", meanings: [{ gloss: "To wobble.", example: "The jelly began to zorble." }, { gloss: "To quiver." }] }],
      { safe: true },
    );
    expect(view.classes[0].meanings.map((m) => m.example)).toEqual(["The jelly began to zorble.", undefined]);
  });

  it("leaves them out of the peek, which is meanings only", () => {
    const view = entryView([{ form: "zorble", pos: "verb", meanings: [{ gloss: "To wobble.", example: "It zorbled." }] }], { safe: true });
    expect(peekView(view)!.meanings[0]).not.toHaveProperty("example");
  });
});

describe("peekView", () => {
  it("shows the first word class's first two meanings, and how many more the entry has", () => {
    expect(peekView(entryView(serene, { safe: false }))).toEqual({
      form: "serene",
      pos: "adjective",
      meanings: [
        { n: 1, gloss: "Calm, peaceful.", labels: [], links: [] },
        { n: 2, gloss: "Clear, fair.", labels: ["archaic"], links: [] },
      ],
      more: 3,
      hidden: 0,
    });
    expect(peekView(entryView(serene, { safe: true }))!.more).toBe(2); // the hidden one isn't "more"
  });

  it("has nothing to show when safe search hides every meaning", () => {
    expect(peekView({ classes: [], hidden: 2, ipa: [] })).toBeNull();
  });
});

describe("pronunciation and origin brief", () => {
  const lead: Definition[] = [
    { form: "lead", pos: "noun", etymology: "From Old English lēad.", ipa: ["/lɛd/"], meanings: [{ gloss: "A metal." }] },
    { form: "lead", pos: "verb", etymology: "From Old English lǣdan.", ipa: ["/liːd/", "/lɛd/"], meanings: [{ gloss: "To guide." }] },
    { form: "lead", pos: "noun", etymology: "From Old English lǣdan.", meanings: [{ gloss: "The front." }] },
    { form: "Lead", pos: "name", ipa: ["/liːd/ (place)"], meanings: [{ gloss: "A made-up town." }] },
  ];

  it("lists the main written form's pronunciations once each", () => {
    expect(entryView(lead, { safe: true }).ipa).toEqual(["/lɛd/", "/liːd/"]);
    expect(entryView([{ form: "a", pos: "noun", meanings: [{ gloss: "x" }] }], { safe: true }).ipa).toEqual([]);
  });

  it("briefs the word's origin once, at the top, when its word classes share one", () => {
    const ingot: Definition[] = [
      { form: "ingot", pos: "noun", etymology: "From Middle English.", meanings: [{ gloss: "A bar." }] },
      { form: "ingot", pos: "verb", etymology: "From Middle English.", meanings: [{ gloss: "To cast." }] },
      { form: "ingot", pos: "noun", meanings: [{ gloss: "No origin given." }] },
    ];
    const view = entryView(ingot, { safe: true });
    expect(view.origin).toBe("From Middle English.");
    expect(view.classes.every((c) => !("etymology" in c))).toBe(true);
  });

  it("has no brief for a word with several origins (that's the planned Etymology section)", () => {
    expect(entryView(lead, { safe: true }).origin).toBeUndefined();
    expect(entryView([{ form: "a", pos: "noun", meanings: [{ gloss: "x" }] }], { safe: true }).origin).toBeUndefined();
  });
});

describe("links inside a meaning", () => {
  it("joins Wiktionary's links and a plural's word, each linking to its word", () => {
    const view = entryView(
      [{ form: "zorbles", pos: "noun", meanings: [
        { gloss: "plural of zorble", of: ["zorble"] },
        { gloss: "Crowds, running about.", links: [["Crowds", "crowd"], ["running", "run"], ["about"]] },
      ] }],
      { safe: true },
    );
    expect(view.classes[0].meanings.map((m) => m.links)).toEqual([
      [{ text: "zorble", word: "zorble" }],
      [{ text: "Crowds", word: "crowd" }, { text: "running", word: "run" }, { text: "about", word: "about" }],
    ]);
  });

  it("splits a gloss into text and tappable words, in order", () => {
    const links = [{ text: "running", word: "run" }, { text: "Calm", word: "calm" }];
    expect(glossParts("Calm and peaceful; running smoothly.", links)).toEqual([
      { text: "Calm", word: "calm" },
      " and peaceful; ",
      { text: "running", word: "run" },
      " smoothly.",
    ]);
  });

  it("links a repeated text where it next appears, and adds a plural's word the gloss doesn't spell out", () => {
    expect(glossParts("a b a", [{ text: "a", word: "x" }, { text: "a", word: "y" }])).toEqual([
      { text: "a", word: "x" },
      " b ",
      { text: "a", word: "y" },
    ]);
    expect(glossParts("Its plural.", [{ text: "zorble", word: "zorble" }])).toEqual([
      "Its plural. → ",
      { text: "zorble", word: "zorble" },
    ]);
  });
});
