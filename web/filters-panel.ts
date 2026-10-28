/**
 * The Filters panel, opened by the funnel button under the settings cog: a
 * pair of roller wheels (Min, Max) per range filter the index offers (word
 * length, for now), drawn from src/filters.ts. The funnel wears a dot while
 * any range is set.
 */
import type { FilterInfo, Range } from "../src/filters";
import type { FilterValues } from "./saved-filters";
import { Wheel } from "./wheel";
import { chooseMax, chooseMin, maxOptions, minOptions } from "./wheel-model";

type RangeInfo = Extract<FilterInfo, { kind: "range" }>;

export class FiltersPanel {
  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly ranges: HTMLElement,
    private readonly button: HTMLButtonElement,
    /** the current choices, kept up to date by `change` */
    private readonly values: FilterValues,
    private readonly change: (id: string, range: Range) => void,
  ) {
    button.addEventListener("click", () => dialog.showModal());
  }

  /** Draw the range filters this index has the data for. */
  offer(available: FilterInfo[]): void {
    const ranges = available.filter((f): f is RangeInfo => f.kind === "range");
    this.button.hidden = ranges.length === 0;
    this.ranges.replaceChildren(...ranges.map((f) => this.section(f)));
    this.mark();
  }

  private section(f: RangeInfo): HTMLElement {
    let range = this.offered(f);
    const name = f.label.toLowerCase();
    const update = (next: Range) => {
      range = next;
      this.change(f.id, range);
      this.mark();
    };
    const max = new Wheel(`Maximum ${name}`, (value) => update(chooseMax(range, value)));
    const min = new Wheel(`Minimum ${name}`, (value) => {
      update(chooseMin(range, value));
      max.set(maxOptions(range[0], f.min, f.max), range[1]);
    });
    min.set(minOptions(f.min, f.max), range[0]);
    max.set(maxOptions(range[0], f.min, f.max), range[1]);

    const section = el("section", "range");
    const title = el("h3", "setting-name");
    title.textContent = f.label;
    const help = el("p", "setting-help");
    help.textContent = f.help;
    const to = el("span", "wheels-to");
    to.textContent = "to";
    const wheels = el("div", "wheels");
    wheels.append(field("Min", min), to, field("Max", max));
    section.append(title, help, wheels);
    return section;
  }

  /** The saved range, with any end this index doesn't offer put back on Any. */
  private offered(f: RangeInfo): Range {
    const saved = (this.values[f.id] ?? [null, null]) as Range;
    const fits = (v: number | null, lowest: number) => (v !== null && v >= lowest && v <= f.max ? v : null);
    const min = fits(saved[0], f.min);
    const range: Range = [min, fits(saved[1], min ?? f.min)];
    if (range[0] !== saved[0] || range[1] !== saved[1]) this.change(f.id, range);
    return range;
  }

  /** A dot on the funnel while any range is set. */
  private mark() {
    const active = Object.values(this.values).some((v) => Array.isArray(v) && (v[0] !== null || v[1] !== null));
    this.button.toggleAttribute("data-active", active);
  }
}

function field(label: string, wheel: Wheel): HTMLElement {
  const box = el("div", "wheel-field");
  const name = el("span", "wheel-label");
  name.textContent = label;
  name.setAttribute("aria-hidden", "true"); // the wheel's own label says it in full
  box.append(name, wheel.el);
  return box;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
