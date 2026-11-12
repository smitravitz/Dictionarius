// The published web app's service worker: keeps the page itself (its HTML, scripts,
// styles and fonts) on the device, so after one visit the app opens with no network.
// The data files aren't its business: the workers keep those (web/data-cache.ts) and it
// lets their requests through. Written out by tools/web-data.ts for the web build only,
// with this build's name and files filled in below; never in the Android app.

const BUILD = "__BUILD__";
const FILES = __FILES__;
const SHELL = `dictionarius-shell-${BUILD}`;
const PAGE = new URL("./", self.registration.scope).href;
/** How long opening the page waits for the network's copy before opening the kept one (ms):
 *  plenty for a connection that works; on a weak signal, not long to look at nothing. */
const PATIENCE_MS = 2000;

// A new build: its files kept before it takes over.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([PAGE, ...FILES.map((file) => new URL(file, PAGE).href)]))
      .then(() => self.skipWaiting()),
  );
});

// The old builds' files let go of; this build serves the open pages from now on.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("dictionarius-shell-") && name !== SHELL).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (/\.(bin|gz)$/.test(url.pathname) || url.pathname.endsWith(".starter.json")) return; // the workers' own
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  // Scripts, styles, fonts: named by their content, so a kept one is always right. Matched
  // by address alone: a module script or font asks with an Origin header the kept copy
  // didn't (a server's "Vary: Origin" would otherwise rule it out).
  event.respondWith(caches.match(request, { cacheName: SHELL, ignoreVary: true }).then((kept) => kept ?? fetch(request)));
});

/** The page: the network's, so a new build shows at once; the kept one when the network
 *  can't answer, or hasn't within PATIENCE_MS (a weak signal). With nothing kept yet, the
 *  network's, however long it takes. */
async function page(request) {
  const network = fetch(request);
  const kept = await caches.match(PAGE, { cacheName: SHELL, ignoreVary: true });
  if (!kept) return network.catch(() => Response.error());
  let timer = 0;
  const late = new Promise((resolve) => (timer = setTimeout(resolve, PATIENCE_MS, kept)));
  return Promise.race([network.catch(() => kept), late]).finally(() => clearTimeout(timer));
}
