import { describe, it, expect } from "vitest";
import { themeShown, themeToKeep } from "../web/theme-choice";

// Light or dark: the system's setting, unless the person picked the other one. Only a pick
// against the system is kept; picking the system's own again forgets it, so the page follows
// the system again (a phone that turns dark at night, say).

describe("the theme shown", () => {
  it("is the system's, with nothing picked", () => {
    expect(themeShown(null, "light")).toBe("light");
    expect(themeShown(null, "dark")).toBe("dark");
  });

  it("is the pick, whatever the system says", () => {
    expect(themeShown("dark", "light")).toBe("dark");
    expect(themeShown("light", "dark")).toBe("light");
  });

  it("ignores anything kept that isn't a theme (an old or broken value)", () => {
    for (const kept of ["", "auto", "DARK", "{}", "null"]) expect(themeShown(kept, "light"), kept).toBe("light");
  });
});

describe("the pick kept", () => {
  it("is the pick when it's against the system", () => {
    expect(themeToKeep("dark", "light")).toBe("dark");
    expect(themeToKeep("light", "dark")).toBe("light");
  });

  it("is nothing when it's the system's own, so the page follows the system again", () => {
    expect(themeToKeep("light", "light")).toBeNull();
    expect(themeToKeep("dark", "dark")).toBeNull();
  });
});
