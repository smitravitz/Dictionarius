/**
 * The background loading channel (a browser only): once the word list is in, keeps every
 * data file on the device (web/data-cache.ts), one at a time at low priority, so the
 * search worker's own requests (a word's page, read a block at a time) go first. Its own
 * thread: the search worker answers the page meanwhile, untouched by it. Skipped when
 * there's no room, or the browser is saving data (Data Saver).
 */
import { keepAll } from "./data-cache";
import type { FromDataWorker, ToDataWorker } from "./protocol";

interface WorkerScope {
  postMessage(message: FromDataWorker): void;
  onmessage: ((event: MessageEvent<ToDataWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

/** Told how far along it is at most this often (ms). */
const TELL_MS = 250;

scope.onmessage = ({ data }) => {
  if (data.type === "keep") void keep(data.files, data.alsoKeep);
};

async function keep(files: { url: string; bytes: number }[], alsoKeep: string[]) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return scope.postMessage({ type: "unkept", why: "saving-data" });
  const needed = files.reduce((sum, f) => sum + f.bytes, 0);
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota !== undefined && usage !== undefined && quota - usage < needed) return scope.postMessage({ type: "unkept", why: "space" });
  } catch {
    // No estimate: try anyway; a full device refuses below.
  }
  let told = 0;
  try {
    await keepAll(files, alsoKeep, (share) => {
      if (performance.now() - told < TELL_MS) return;
      told = performance.now();
      scope.postMessage({ type: "keeping", share });
    });
    scope.postMessage({ type: "kept" });
  } catch {
    scope.postMessage({ type: "unkept", why: "error" });
  }
}
