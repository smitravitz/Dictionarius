import type { KeyValueStore } from "./store";

const DEFAULT_KEY = "favorites";

export class Favorites {
  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string = DEFAULT_KEY,
  ) {}

  async list(): Promise<string[]> {
    const raw = await this.store.get(this.key);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  async add(word: string): Promise<void> {
    const current = await this.list();
    if (current.includes(word)) return;
    await this.store.set(this.key, JSON.stringify([word, ...current]));
  }

  async remove(word: string): Promise<void> {
    const current = await this.list();
    await this.store.set(this.key, JSON.stringify(current.filter((w) => w !== word)));
  }
}
