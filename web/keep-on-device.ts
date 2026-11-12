/**
 * Keeping the dictionary on this device (a browser): once the word list is in, a worker of its
 * own downloads every data file and keeps it (web/data-worker.ts). A thin bar under the title
 * says how far along it is and how good the connection is (web/connection.ts); once it's all
 * in it says so and fades out over 5 seconds. With no connection it says so, stays, and
 * carries on once the signal's back. Settings says only how it ended.
 */
import { connectionQuality, type Quality, type Sample } from "./connection";
import type { FromDataWorker, ToDataWorker } from "./protocol";

export interface ToKeep {
  keep: { url: string; bytes: number }[];
  alsoKeep: string[];
}

const QUALITY: Record<Quality, string> = {
  fast: "Fast connection",
  slow: "Slow connection",
  "very slow": "Very slow connection",
  none: "No connection",
};
const FADE_MS = 5000;
/** Saving failed on a connection that looked fine: tried again this often, this many times. */
const RETRY_MS = 15_000;
const RETRIES = 3;

const RESULT = {
  kept: "Saved on this device: works offline.",
  space: "Not enough space on this device to save the dictionary for offline use.",
  "saving-data": "Data Saver is on, so the dictionary isn’t saved for offline use.",
  error: "Couldn’t save the dictionary for offline use. It still works online.",
} as const;

export function keepOnDevice(toKeep: ToKeep, bar: HTMLElement, result: HTMLElement) {
  if (toKeep.keep.length === 0) return;
  const text = bar.querySelector<HTMLElement>(".download-text")!;
  const track = bar.querySelector<HTMLElement>(".download-track")!;
  const fill = bar.querySelector<HTMLElement>(".download-fill")!;
  const total = toKeep.keep.reduce((sum, file) => sum + file.bytes, 0) || 1;
  let samples: Sample[] = [];
  let share = 0;
  let retries = 0;
  let ticking: ReturnType<typeof setInterval> | undefined;

  const draw = () => {
    const quality = connectionQuality(samples, performance.now(), navigator.onLine);
    const words = `Downloading ${Math.floor(share * 100)}%${quality ? ` · ${QUALITY[quality]}` : ""}`;
    if (text.textContent !== words) text.textContent = words;
    fill.style.transform = `scaleX(${share})`;
    track.setAttribute("aria-valuenow", String(Math.floor(share * 100)));
    track.setAttribute("aria-valuetext", words);
  };
  const show = () => {
    if (!bar.hidden) return;
    bar.getAnimations().forEach((a) => a.cancel());
    bar.hidden = false;
    ticking = setInterval(draw, 1000); // a stalled download sends nothing: the quality still moves on
  };
  /** The end: what it says, then a 5 s fade, then gone. Settings keeps the result. */
  const end = (words: string, outcome: keyof typeof RESULT) => {
    clearInterval(ticking);
    window.removeEventListener("online", again);
    window.removeEventListener("offline", draw);
    result.textContent = RESULT[outcome];
    result.hidden = false;
    if (bar.hidden) return; // never shown (all kept already, or refused at once): nothing to fade
    text.textContent = words;
    track.setAttribute("aria-valuetext", words);
    if (outcome === "kept") fill.style.transform = "scaleX(1)";
    const from = getComputedStyle(bar).opacity;
    bar.animate([{ opacity: from }, { opacity: 0 }], { duration: FADE_MS, easing: "linear", fill: "forwards" }).finished.then(
      () => (bar.hidden = true),
      () => {},
    );
  };

  let worker: Worker | null = null;
  function start() {
    worker?.terminate();
    samples = [];
    worker = new Worker(new URL("./data-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<FromDataWorker>) => {
      if (data.type === "keeping") {
        share = Math.max(share, data.share); // a restart may redo part of a file: never backwards
        samples.push({ at: performance.now(), bytes: data.share * total });
        if (share < 1) show();
        draw();
      } else if (data.type === "kept") {
        worker?.terminate();
        share = 1;
        end("Downloaded · works offline", "kept");
      } else {
        worker?.terminate();
        if (data.why !== "error") return end("Not saved for offline use", data.why);
        // No connection (or a failure while it looked fine): it says so, and tries again once
        // the browser says it's back, or every so often, a few times while online.
        draw();
        if (navigator.onLine && ++retries > RETRIES) return end("Not saved for offline use", "error");
        failed = true;
        retry = setTimeout(again, RETRY_MS);
      }
    };
    const message: ToDataWorker = { type: "keep", files: toKeep.keep, alsoKeep: toKeep.alsoKeep };
    worker.postMessage(message);
  }
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failed = false;
  function again() {
    if (!failed) return; // running: nothing to resume
    failed = false;
    clearTimeout(retry);
    start();
  }
  window.addEventListener("online", again);
  window.addEventListener("offline", draw);
  start();
}
