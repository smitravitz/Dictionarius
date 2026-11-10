/**
 * Fetching the data files in a browser (in a worker): the starter, and the word list,
 * gzipped when the starter says there's a gzipped copy (about 40% of the size), with how
 * far along it is. Files the starter lists are named with their hash (`?v=`), so a new
 * version is never mistaken for an old one, by the browser's cache or the device's
 * (web/data-cache.ts).
 */
import { readStarter, starterUrl, type DataFile, type Starter } from "../src/starter";
import { kept } from "./data-cache";

/** A data file's address with its version, when the starter knows it. */
export function versioned(url: string, file: DataFile | undefined): string {
  return file ? `${url}${url.includes("?") ? "&" : "?"}v=${file.sha256.slice(0, 16)}` : url;
}

/** The file name at the end of an address. */
export const nameOf = (url: string) => new URL(url).pathname.split("/").pop()!;

/** The starter beside the word list at `indexUrl`, or null when there's none this page can
 *  use (an older build, or the app). Asked fresh each start; the device's copy when offline. */
export async function fetchStarter(indexUrl: string): Promise<Starter | null> {
  const url = starterUrl(indexUrl);
  try {
    const response = await kept(url, null, { fresh: true });
    if (!response?.ok || !/json/.test(response.headers.get("Content-Type") ?? "")) return null;
    return readStarter(await response.json());
  } catch {
    return null;
  }
}

/** The word list's bytes: gzipped if the starter lists a gzipped copy (and it reads), else
 *  as it is. `progress` hears the share of it that has arrived, 0 to 1. */
export async function fetchWordList(url: string, starter: Starter | null, progress: (share: number) => void): Promise<Uint8Array> {
  const name = nameOf(url);
  const gzipped = starter?.files[`${name}.gz`];
  if (gzipped) {
    try {
      const response = await kept(versioned(`${url}.gz`, gzipped), gzipped, {});
      if (response?.ok && response.body) {
        // Some servers send a .gz file "Content-Encoding: gzip", and the browser unpacks it on
        // the way (vite preview does); then it comes as it is. The first bytes tell which.
        const { stream, isGzip } = await sniffed(response.body);
        const bytes = isGzip
          ? await collect(
              stream.pipeThrough(counting(gzipped.bytes, progress)).pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>),
              starter.files[name]?.bytes,
            )
          : await collect(stream.pipeThrough(counting(starter.files[name]?.bytes ?? null, progress)), starter.files[name]?.bytes);
        if (!starter.files[name] || bytes.byteLength === starter.files[name].bytes) return bytes;
      }
    } catch {
      // Cut off, or not what it said: the word list as it is, below.
    }
  }
  const file = starter?.files[name];
  const response = await kept(versioned(url, file), file ?? null, {});
  if (!response?.ok || !response.body) throw new Error(`HTTP ${response?.status ?? "error"} loading ${url}`);
  const size = file?.bytes ?? (Number(response.headers.get("Content-Length")) || null);
  return collect(response.body.pipeThrough(counting(size, progress)), size ?? undefined);
}

/** Passes bytes through, telling `progress` the share of `size` that has passed (nothing
 *  when the size isn't known), at most once per whole percent. */
function counting(size: number | null, progress: (share: number) => void): TransformStream<Uint8Array, Uint8Array> {
  let passed = 0;
  let told = -1;
  return new TransformStream({
    transform(chunk, out) {
      passed += chunk.byteLength;
      const percent = size ? Math.min(100, Math.floor((passed / size) * 100)) : -1;
      if (percent > told) {
        told = percent;
        progress(percent / 100);
      }
      out.enqueue(chunk);
    },
  });
}

/** A stream, and whether it starts as gzip does (0x1f 0x8b), its first chunk read to tell. */
async function sniffed(body: ReadableStream<Uint8Array>): Promise<{ stream: ReadableStream<Uint8Array>; isGzip: boolean }> {
  const reader = body.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array(0);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.byteLength > 0) controller.enqueue(head);
      if (first.done) controller.close();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { stream, isGzip: head[0] === 0x1f && head[1] === 0x8b };
}

/** A stream's bytes, in one array (sized up front when the size is known). */
async function collect(stream: ReadableStream<Uint8Array>, size?: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const out = new Uint8Array(size !== undefined && size === length ? size : length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
