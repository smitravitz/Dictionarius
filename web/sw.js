// The published web app's service worker: keeps the page itself (its HTML, scripts,
// styles and fonts) on the device, so after one visit the app opens from the device, at
// once, as an installed app should, whatever the network is doing. A new build comes down in
// the background and opens from the next start, once no page of the old one is open.
// The data files aren't its business: the workers keep those (web/data-cache.ts) and it
// lets their requests through. Written out by tools/web-app.ts for the web build only,
// with this build's name and files filled in below; never in the Android app.

const BUILD = "__BUILD__";
const FILES = __FILES__;
const SHELL = `dictionarius-shell-${BUILD}`;
const PAGE = new URL("./", self.registration.scope).href;

// A new build: its files kept before it takes over. It takes over once no page of the old
// build is open (the browser's own rule, with no skipWaiting): an open page goes on with the
// old build's files, which stay kept until then, so it never asks for one that's gone.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll([PAGE, ...FILES.map((file) => new URL(file, PAGE).href)])));
});

// The old builds' files let go of; this build serves the pages from now on.
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

/** The page: the one kept with this build, at once; with nothing kept yet (a first visit),
 *  the network's, however long it takes. */
async function page(request) {
  const kept = await caches.match(PAGE, { cacheName: SHELL, ignoreVary: true });
  return kept ?? fetch(request).catch(() => Response.error());
}
