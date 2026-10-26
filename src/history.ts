import type { KeyValueStore } from "./store";

const DEFAULT_KEY = "history";
const DEFAULT_MAX = 100;

export class History {
  private readonly key: string;
  private readonly max: number;

  constructor(
    private readonly store: KeyValueStore,
    options: { key?: string; max?: number } = {},
  ) {
    this.key = options.key ?? DEFAULT_KEY;
    this.max = options.max ?? DEFAULT_MAX;
  }

  async recent(limit?: number): Promise<string[]> {
    const raw = await this.store.get(this.key);
    const list = raw === null ? [] : JSON.parse(raw);
    const arr: string[] = Array.isArray(list) ? list : [];
    return limit === undefined ? arr : arr.slice(0, limit);
  }

  async record(word: string): Promise<void> {
    const current = await this.recent();
    const bumped = [word, ...current.filter((w) => w !== word)].slice(0, this.max);
    await this.store.set(this.key, JSON.stringify(bumped));
  }
}
