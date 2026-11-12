// The store listings (fastlane/metadata): each store cuts off or refuses text past its limit,
// and both refuse a listing that names the other platform. The limits are the stores' own:
// Google Play's "Create and set up your app" and Apple's "App information" pages.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PLAY = "fastlane/metadata/android/en-US";
const APP_STORE = "fastlane/metadata/en-US";

/** A listing field as the store takes it: the file's text without the newline that ends it. */
const field = (path: string) => readFileSync(path, "utf8").replace(/\n$/, "");
/** Its length as the stores count it: characters, not bytes. */
const length = (path: string) => [...field(path)].length;

describe("the Google Play listing", () => {
  it.each([
    ["title.txt", 30],
    ["short_description.txt", 80],
    ["full_description.txt", 4000],
  ])("%s fits in %i characters", (name, limit) => {
    expect(length(`${PLAY}/${name}`)).toBeGreaterThan(0);
    expect(length(`${PLAY}/${name}`)).toBeLessThanOrEqual(limit);
  });

  it("has its 512 px icon and 1024 by 500 feature graphic", () => {
    const size = (path: string) => {
      const png = readFileSync(path);
      return [png.readUInt32BE(16), png.readUInt32BE(20)];
    };
    expect(size(`${PLAY}/images/icon.png`)).toEqual([512, 512]);
    expect(size(`${PLAY}/images/featureGraphic.png`)).toEqual([1024, 500]);
  });
});

describe("the App Store listing", () => {
  it.each([
    ["name.txt", 30],
    ["subtitle.txt", 30],
    ["promotional_text.txt", 170],
    ["keywords.txt", 100],
    ["description.txt", 4000],
  ])("%s fits in %i characters", (name, limit) => {
    expect(length(`${APP_STORE}/${name}`)).toBeGreaterThan(0);
    expect(length(`${APP_STORE}/${name}`)).toBeLessThanOrEqual(limit);
  });

  it("gives a privacy policy and a support page that are this project's own", () => {
    for (const name of ["privacy_url.txt", "support_url.txt"]) {
      expect(field(`${APP_STORE}/${name}`)).toMatch(/^https:\/\/github\.com\/smitravitz\/Dictionarius\//);
    }
  });
});

describe("both listings", () => {
  const texts = [
    ...["title.txt", "short_description.txt", "full_description.txt"].map((name) => `${PLAY}/${name}`),
    ...["name.txt", "subtitle.txt", "promotional_text.txt", "keywords.txt", "description.txt"].map((name) => `${APP_STORE}/${name}`),
  ];

  // Apple rejects a listing that mentions Android; Google Play one that mentions other stores.
  it.each(texts)("%s names no other platform or store", (path) => {
    expect(field(path)).not.toMatch(/android|google|play store|iphone|ios\b|apple|app store|f-droid|obtainium/i);
  });

  it("point at a privacy policy that exists", () => {
    expect(existsSync("PRIVACY.md")).toBe(true);
    expect(field(`${APP_STORE}/privacy_url.txt`)).toBe("https://github.com/smitravitz/Dictionarius/blob/main/PRIVACY.md");
  });
});
