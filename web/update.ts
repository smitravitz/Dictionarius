// A new build of the published web app (a browser only; web/sw.js keeps the page on the
// device). The page opens from the device at once, so what opens is the build kept, even when
// a newer one is published. The browser fetches the new build's service worker in the
// background; once that has its files, this page tells it to take over and then reloads
// itself into it, so a new build is what the person has within moments of opening, with no
// second visit and no tab to close. main.ts keeps the person's place across that reload.
// The reload waits until their hands are off (no key, touch or wheel for a moment): nothing
// typed is lost to it. Never in the Android app, nor while developing: no service worker there.

/** No input for this long (ms): hands off. */
const HANDS_OFF_MS = 1000;

/** Register the service worker and keep up with new builds. `beforeReload` runs just before
 *  the page reloads itself into one. */
export function keepUpWithNewBuilds(beforeReload: () => void) {
  const workers = navigator.serviceWorker;
  // A first visit has no service worker in charge yet: its own taking charge is no new build.
  let inCharge = workers.controller !== null;
  let reloading = false;
  workers.addEventListener("controllerchange", () => {
    if (!inCharge) return void (inCharge = true);
    if (reloading) return; // once
    reloading = true;
    whenHandsOff(() => {
      beforeReload();
      location.reload();
    });
  });
  /** A new build's worker has its files: it takes over now, not when every page has closed. */
  const takeOver = (worker: ServiceWorker | null) => {
    if (worker && workers.controller) worker.postMessage({ type: "take-over" });
  };
  workers
    .register("./sw.js")
    .then((registration) => {
      takeOver(registration.waiting); // came down during an earlier visit
      registration.addEventListener("updatefound", () => {
        const coming = registration.installing;
        coming?.addEventListener("statechange", () => coming.state === "installed" && takeOver(coming));
      });
      // The browser looks for a new build as the page opens. A tab left open looks again
      // whenever the person comes back to it.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => {}); // offline: next time
      });
    })
    .catch(() => {}); // a build without one: online only
}

/** `then`, once there's been no key, touch, click or wheel for HANDS_OFF_MS and no finger or
 *  button is down; at once when the page isn't on screen. */
function whenHandsOff(then: () => void) {
  let last = performance.now();
  let down = 0;
  const touched = () => (last = performance.now());
  const pressed = () => (down++, touched());
  const released = () => ((down = Math.max(0, down - 1)), touched());
  const heard = { capture: true, passive: true } as const;
  for (const kind of ["keydown", "input", "wheel", "touchmove"] as const) window.addEventListener(kind, touched, heard);
  window.addEventListener("pointerdown", pressed, heard);
  for (const kind of ["pointerup", "pointercancel"] as const) window.addEventListener(kind, released, heard);
  const look = () => {
    if (document.visibilityState === "hidden" || (down === 0 && performance.now() - last >= HANDS_OFF_MS)) then();
    else setTimeout(look, 100);
  };
  look();
}
