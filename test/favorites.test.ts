import { describe, it, expect } from "vitest";
import { Favorites } from "../src/favorites";
import type { KeyValueStore } from "../src/store";

// In-memory fake of the persistence boundary (real impls: localStorage / SQLite /
// Capacitor Preferences). A fake at a system boundary is fine; we never mock
// Favorites' own logic.
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

describe("Favorites", () => {
  it("lists added words newest-first", async () => {
    const favs = new Favorites(memStore());
    await favs.add("run");
    await favs.add("walk");
    expect(await favs.list()).toEqual(["walk", "run"]);
  });

  it("does not duplicate an already-favorited word", async () => {
    const favs = new Favorites(memStore());
    await favs.add("run");
    await favs.add("walk");
    await favs.add("run");
    expect(await favs.list()).toEqual(["walk", "run"]);
  });

  it("removes a word", async () => {
    const favs = new Favorites(memStore());
    await favs.add("run");
    await favs.add("walk");
    await favs.remove("run");
    expect(await favs.list()).toEqual(["walk"]);
  });

  it("persists through the store (verified via the interface, not a store peek)", async () => {
    const store = memStore();
    await new Favorites(store).add("run");

    // Fresh instance, same store — proves it was persisted, tested through list().
    const reopened = new Favorites(store);
    expect(await reopened.list()).toEqual(["run"]);
  });
});
