import { afterEach, describe, expect, it, vi } from "vitest";
import { DROP_AFTER_MS, keepAll, Stalled } from "../web/data-cache";

// Keeping the dictionary on the device (web/data-cache.ts, keepAll): a download that goes
// quiet without an error (a connection that died without saying so) is dropped once nothing
// has come for the stall time (3 s), so the caller can start it again, and told apart from
// a failed request (Stalled). Before, it was waited on for ever: the bar under the title
// stayed where it was until the page was reloaded.
// The network and the device's store are stand-ins here; the stall time is short.

const STALL_MS = 60;
const FILE = { url: "https://example.test/headwords.pronunciation.bin?v=1", bytes: 6 };

/** A device store in memory: what was put (once its whole body was in), by address. */
function deviceStore() {
  const kept = new Map<string, Uint8Array>();
  const store = {
    match: async (url: string) => (kept.has(url) ? new Response(new Blob([new Uint8Array(kept.get(url)!)])) : undefined),
    put: async (url: string, response: Response) => void kept.set(url, new Uint8Array(await response.arrayBuffer())),
    keys: async () => [...kept.keys()].map((url) => ({ url })),
    delete: async (request: { url: string }) => kept.delete(request.url),
  };
  vi.stubGlobal("caches", { open: async () => store });
  return kept;
}

/** A network whose answer to every request is a body sent by `send`: it gets `chunk` (send
 *  these bytes) and `end` (that's all). Like a browser's, it gives up when told to abort. */
function network(send: (chunk: (bytes: number[]) => void, end: () => void) => void, { answers = true } = {}) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    asked.push(url);
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      const aborted = () => new DOMException("aborted", "AbortError");
      signal?.addEventListener("abort", () => reject(aborted()));
      if (!answers) return; // no answer at all: not even its first line
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(aborted()));
          send(
            (bytes) => controller.enqueue(new Uint8Array(bytes)),
            () => controller.close(),
          );
        },
      });
      resolve(new Response(body, { status: 200 }));
    });
  });
  return asked;
}

const within = <T>(ms: number, work: Promise<T>) =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms))]);

afterEach(() => vi.unstubAllGlobals());

describe("keeping the dictionary on the device", () => {
  it("drops a download whose bytes stop coming, and keeps nothing of that file", async () => {
    const kept = deviceStore();
    network((chunk) => chunk([1, 2, 3])); // half of it, then nothing more, and no error
    await expect(within(STALL_MS * 10, keepAll([FILE], [], () => {}, { stallMs: STALL_MS }))).rejects.toBeInstanceOf(Stalled);
    expect(kept.size).toBe(0);
  });

  it("drops a download that gets no answer at all", async () => {
    deviceStore();
    network(() => {}, { answers: false });
    await expect(within(STALL_MS * 10, keepAll([FILE], [], () => {}, { stallMs: STALL_MS }))).rejects.toBeInstanceOf(Stalled);
  });

  it("waits 3 seconds with nothing in before dropping a download, unless told otherwise", () => {
    expect(DROP_AFTER_MS).toBe(3000);
  });

  it("a request the server refuses is a failure, not a stall", async () => {
    deviceStore();
    vi.stubGlobal("fetch", async () => new Response("no", { status: 503 }));
    const failure = await keepAll([FILE], [], () => {}, { stallMs: STALL_MS }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(Stalled);
  });

  it("keeps a slow download that keeps coming, however long it takes", async () => {
    const kept = deviceStore();
    // Six bytes, one every third of the stall time: four times the stall time in all.
    network((chunk, end) => {
      let sent = 0;
      const next = () => {
        chunk([sent + 1]);
        if (++sent === 6) end();
        else setTimeout(next, STALL_MS / 3);
      };
      next();
    });
    const shares: number[] = [];
    await keepAll([FILE], [], (share) => shares.push(share), { stallMs: STALL_MS });
    expect([...kept.get(FILE.url)!]).toStrictEqual([1, 2, 3, 4, 5, 6]);
    expect(shares.at(-1)).toBe(1);
  });

  it("started again after a stall, asks only for the file it hadn't kept", async () => {
    const kept = deviceStore();
    const first = { url: "https://example.test/headwords.definitions.bin?v=1", bytes: 2 };
    let stall = true;
    const asked = network((chunk, end) => {
      if (stall && asked.at(-1) === FILE.url) return chunk([1]); // the last file goes quiet
      chunk([7, 7]);
      end();
    });
    await expect(keepAll([first, FILE], [], () => {}, { stallMs: STALL_MS })).rejects.toThrow();
    stall = false;
    asked.length = 0;
    await keepAll([first, FILE], [], () => {}, { stallMs: STALL_MS });
    expect(asked).toStrictEqual([FILE.url]);
    expect([...kept.keys()].sort()).toStrictEqual([first.url, FILE.url].sort());
  });
});
