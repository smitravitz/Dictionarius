/** What a credit needs: the word, where its definition comes from, and the license. */
export interface Credited {
  headword: string;
  /** e.g. "Wiktionary" */
  source: string;
  /** SPDX-style id, e.g. "CC-BY-SA-4.0" */
  license: string;
}

/** Known FLOSS/open-content licenses -> human label + canonical URL. */
const KNOWN_LICENSES: Record<string, { label: string; url: string }> = {
  "CC-BY-SA-4.0": {
    label: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  "CC-BY-SA-3.0": {
    label: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
};

/** MediaWiki page URL: spaces -> underscores, then percent-encode (so '#'
 *  can't become a fragment), keeping '/' literal as MediaWiki does. */
function mediaWikiPage(base: string, title: string): string {
  const path = encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");
  return `${base}${path}`;
}

/** Known sources -> how to build the page for a headword (where its author
 *  history lives). Sources not listed here are credited by name only. */
const KNOWN_SOURCES: Record<string, (headword: string) => string> = {
  Wiktionary: (headword) => mediaWikiPage("https://en.wiktionary.org/wiki/", headword),
};

/**
 * Link to the entry's page on its source, or null when the source has no known
 * page scheme. Derived from the headword at display time, so no URL is stored
 * per entry.
 */
export function sourcePageUrl(entry: Credited): string | null {
  const pageFor = KNOWN_SOURCES[entry.source];
  return pageFor ? pageFor(entry.headword) : null;
}

/**
 * Build the credit line required by share-alike licenses (e.g. CC-BY-SA):
 * source (linked to the entry's page when known) + license (linked when known).
 * Throws if attribution is incomplete — an entry must never be shown or shared
 * without crediting its source and license.
 */
export function attributionNotice(entry: Credited): string {
  const { source, license } = entry;
  if (!source || !license) {
    throw new Error("Entry is missing required attribution (source and license).");
  }

  const page = sourcePageUrl(entry);
  const credit = page ? `${source} (${page})` : source;
  const known = KNOWN_LICENSES[license];
  if (known) {
    return `From ${credit} — ${known.label} (${known.url})`;
  }
  return `From ${credit} — ${license}`;
}
