import { describe, it, expect } from "vitest";
import { History } from "../src/history";
import type { KeyValueStore } from "../src/store";

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    async get(k) {
      return m.has(k) ? m.get(k)! : null;
    },
    async set(k, v) {
      m.set(k, v);
    },
  };
}

describe("History", () => {
  it("records lookups newest-first", async () => {
    const h = new History(memStore());
    await h.record("run");
    await h.record("walk");
    await h.record("read");
    expect(await h.recent()).toEqual(["read", "walk", "run"]);
  });

  it("bumps a re-looked word to the top instead of duplicating", async () => {
    const h = new History(memStore());
    await h.record("run");
    await h.record("walk");
    await h.record("run");
    expect(await h.recent()).toEqual(["run", "walk"]);
  });

  it("caps the history at its maximum, dropping the oldest", async () => {
    const h = new History(memStore(), { max: 3 });
    await h.record("a");
    await h.record("b");
    await h.record("c");
    await h.record("d");
    expect(await h.recent()).toEqual(["d", "c", "b"]);
  });

  it("recent(limit) returns only the newest N", async () => {
    const h = new History(memStore());
    await h.record("a");
    await h.record("b");
    await h.record("c");
    expect(await h.recent(2)).toEqual(["c", "b"]);
  });

  it("persists through the store (verified via the interface)", async () => {
    const store = memStore();
    await new History(store).record("run");
    expect(await new History(store).recent()).toEqual(["run"]);
  });
});
