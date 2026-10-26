import type { Entry } from "./source";

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

/**
 * Build the credit line required by share-alike licenses (e.g. CC-BY-SA).
 * Throws if attribution is incomplete — an entry must never be shown or shared
 * without crediting its source and license.
 */
export function attributionNotice(entry: Entry): string {
  const { source, license } = entry.attribution;
  if (!source || !license) {
    throw new Error("Entry is missing required attribution (source and license).");
  }

  const known = KNOWN_LICENSES[license];
  if (known) {
    return `From ${source} — ${known.label} (${known.url})`;
  }
  return `From ${source} — ${license}`;
}
