/**
 * Persistence boundary. Real implementations wrap localStorage, SQLite, or
 * Capacitor Preferences. Tests inject an in-memory fake. Never mock the logic
 * that sits on top of this — only the store itself.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
