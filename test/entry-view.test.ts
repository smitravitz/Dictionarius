import { describe, it, expect } from "vitest";
import { entryView, peekView } from "../src/entry-view";
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
          { n: 1, gloss: "Calm, peaceful.", labels: [], of: [] },
          { n: 2, gloss: "Clear, fair.", labels: ["archaic"], of: [] },
        ] },
        { form: "serene", pos: "noun", meanings: [
          { n: 1, gloss: "Serenity.", labels: [], of: [] },
          { n: 2, gloss: "A made-up slur.", labels: ["slur"], of: [] },
        ] },
        { form: "Serene", pos: "proper noun", meanings: [{ n: 1, gloss: "A made-up surname.", labels: [], of: [] }] },
      ],
      hidden: 0,
    });
  });

  it("leaves safe search's meanings out, counting them, and drops a class left empty", () => {
    const view = entryView(serene, { safe: true });
    expect(view.hidden).toBe(1);
    expect(view.classes[1].meanings.map((m) => m.gloss)).toEqual(["Serenity."]);
    const allRude: Definition[] = [{ form: "gapword", pos: "noun", meanings: [{ gloss: "Rude.", explicit: true }] }];
    expect(entryView(allRude, { safe: true })).toEqual({ classes: [], hidden: 1 });
  });

  it("keeps the words a plural or spelling links to, and an unknown word class as given", () => {
    const view = entryView([{ form: "zorbles", pos: "particle-ish", meanings: [{ gloss: "plural of zorble", of: ["zorble"] }] }], {
      safe: true,
    });
    expect(view.classes[0]).toEqual({
      form: "zorbles",
      pos: "particle-ish",
      meanings: [{ n: 1, gloss: "plural of zorble", labels: [], of: ["zorble"] }],
    });
  });
});

describe("peekView", () => {
  it("shows the first word class's first two meanings, and how many more the entry has", () => {
    expect(peekView(entryView(serene, { safe: false }))).toEqual({
      form: "serene",
      pos: "adjective",
      meanings: [
        { n: 1, gloss: "Calm, peaceful.", labels: [], of: [] },
        { n: 2, gloss: "Clear, fair.", labels: ["archaic"], of: [] },
      ],
      more: 3,
      hidden: 0,
    });
    expect(peekView(entryView(serene, { safe: true }))!.more).toBe(2); // the hidden one isn't "more"
  });

  it("has nothing to show when safe search hides every meaning", () => {
    expect(peekView({ classes: [], hidden: 2 })).toBeNull();
  });
});
