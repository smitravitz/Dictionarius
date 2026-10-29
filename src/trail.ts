/**
 * The trail: the words followed since leaving the results, and where you are
 * on it, as a browser keeps its history. Opening a word from the results
 * starts a trail; following a link adds to it (dropping any words ahead, as a
 * browser does). Steps go back and forward one word at a time, back past the
 * first word to the results. Home goes straight to the results but keeps the
 * words, so a step forward takes them up again.
 *
 * Depth 0 is the results; depth n is the trail's nth word.
 */
export class Trail<T> {
  private words: T[] = [];
  private at = 0;

  /** The word on screen, or null at the results. */
  get here(): T | null {
    return this.at > 0 ? this.words[this.at - 1] : null;
  }

  get depth(): number {
    return this.at;
  }

  get canBack(): boolean {
    return this.at > 0;
  }

  get canForward(): boolean {
    return this.at < this.words.length;
  }

  /** A word opened from the results: a new trail. */
  start(word: T): void {
    this.words = [word];
    this.at = 1;
  }

  /** A word followed from the one on screen. */
  follow(word: T): void {
    this.words = [...this.words.slice(0, this.at), word];
    this.at = this.words.length;
  }

  /** One step back: the word now on screen, or null for the results. */
  back(): T | null {
    if (this.at > 0) this.at--;
    return this.here;
  }

  /** One step forward: the word now on screen, or null when there's none ahead. */
  forward(): T | null {
    if (!this.canForward) return null;
    this.at++;
    return this.here;
  }

  /** Straight back to the results, keeping the words ahead. */
  home(): void {
    this.at = 0;
  }

  /** A new search: the words followed from the old one are gone. */
  clear(): void {
    this.words = [];
    this.at = 0;
  }
}
