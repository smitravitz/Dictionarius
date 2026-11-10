/**
 * The data files on the device (a browser's Cache Storage), so a second visit downloads
 * nothing and works offline. Files listed in the starter are kept by version (their
 * address carries their hash, web/data-files.ts), so an old copy is never read for a new
 * one, and matched by address alone (a server's "Vary" headers don't make a kept copy a
 * miss). Filled as the word list is fetched, and by the data worker in the background
 * (web/data-worker.ts); read before the network. Where Cache Storage isn't there (an
 * insecure page, a private window that refuses it), everything comes from the network.
 */
import { openSource, type ByteSource } from "../src/definitions";
import type { DataFile } from "../src/starter";

export const DATA_CACHE = "dictionarius-data";

/** The device's store, or null where there's none. */
export async function deviceStore(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(DATA_CACHE);
  } catch {
    return null;
  }
}

/** A data file: the device's copy if it has one, else the network's, kept as it comes when
 *  it's a known version (`file`). `fresh`: the network first, as it may have changed (the
 *  starter); the device's copy only when the network can't answer. */
export async function kept(url: string, file: DataFile | null, { fresh = false }: { fresh?: boolean }): Promise<Response | null> {
  const store = await deviceStore();
  if (fresh) {
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok && store) await store.put(url, response.clone()).catch(() => {});
      return response;
    } catch {
      return (await store?.match(url, { ignoreVary: true })) ?? null;
    }
  }
  if (store && file) {
    const copy = await store.match(url, { ignoreVary: true });
    if (copy) return copy;
  }
  const response = await fetch(url);
  // Kept as it streams in: the page reads its half while the device takes the other.
  if (response.ok && store && file) void store.put(url, response.clone()).catch(() => {});
  return response;
}

/** A definitions file, read a block at a time: from the device's copy when it has the whole
 *  file, else with Range requests (or whole, where the server can't send ranges), switching
 *  to the device's copy as soon as the data worker has kept it. */
export async function definitionsSource(url: string, file: DataFile | undefined): Promise<ByteSource | null> {
  const store = file ? await deviceStore() : null;
  const onDevice = async (): Promise<ByteSource | null> => {
    const copy = await store?.match(url, { ignoreVary: true });
    if (!copy) return null;
    const blob = await copy.blob();
    return { size: blob.size, read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) };
  };
  const device = await onDevice();
  if (device) return device;
  const network = await openSource(url, { inPlace: true });
  if (!network || !store) return network;
  let local: ByteSource | null = null;
  return {
    size: network.size,
    async read(start, end) {
      local ??= await onDevice().catch(() => null);
      return (local ?? network).read(start, end);
    },
  };
}

/** Keeps `urls` on the device, fetched in turn at low priority (others' requests go
 *  first), skipping those it has; then lets go of every other file but `alsoKeep`.
 *  `progress` hears the share of `bytes` in. Throws if a file can't be fetched or kept. */
export async function keepAll(
  files: readonly { url: string; bytes: number }[],
  alsoKeep: readonly string[],
  progress: (share: number) => void,
): Promise<void> {
  const store = await deviceStore();
  if (!store) throw new Error("no Cache Storage");
  const total = files.reduce((sum, f) => sum + f.bytes, 0) || 1;
  let done = 0;
  for (const { url, bytes } of files) {
    if (!(await store.match(url, { ignoreVary: true }))) {
      const response = await fetch(url, { priority: "low" } as RequestInit);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
      let seen = 0;
      const counted = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, out) {
            seen += chunk.byteLength;
            progress(Math.min(1, (done + seen) / total));
            out.enqueue(chunk);
          },
        }),
      );
      await store.put(url, new Response(counted, { headers: response.headers }));
    }
    done += bytes;
    progress(Math.min(1, done / total));
  }
  const wanted = new Set([...files.map((f) => f.url), ...alsoKeep]);
  for (const request of await store.keys()) {
    if (!wanted.has(request.url)) await store.delete(request);
  }
}
