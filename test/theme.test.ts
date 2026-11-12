import { describe, it, expect } from "vitest";
import { DEFAULT_THEME, themeShown, themeToKeep } from "../web/theme-choice";

// Light or dark: dark on every device, whatever the system says, unless the person picks
// light. Only a pick away from the default is kept; picking dark again forgets it.

describe("the theme shown", () => {
  it("is dark, with nothing picked", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(themeShown(null)).toBe("dark");
  });

  it("is the pick", () => {
    expect(themeShown("light")).toBe("light");
    expect(themeShown("dark")).toBe("dark");
  });

  it("is dark for anything kept that isn't a theme (an old or broken value)", () => {
    for (const kept of ["", "auto", "LIGHT", "{}", "null"]) expect(themeShown(kept), kept).toBe("dark");
  });
});

describe("the pick kept", () => {
  it("is light, when light is picked", () => {
    expect(themeToKeep("light")).toBe("light");
  });

  it("is nothing for dark, the default", () => {
    expect(themeToKeep("dark")).toBeNull();
  });
});
