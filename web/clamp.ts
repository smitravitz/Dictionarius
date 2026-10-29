/**
 * Text folded to a few lines, with "more" to unfold it: the entry page's
 * pronunciations (two lines) and origin brief (three). "more" shows only when
 * the text runs past its lines, which only layout can tell: fitClamps() checks
 * once the page is on screen, and again when its width changes.
 */

/** `text`, folded to `lines` lines, followed by its more/less button. */
export function clamp(text: HTMLElement, lines: number): DocumentFragment {
  text.classList.add("clamped");
  text.style.setProperty("--lines", String(lines));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "clamp-toggle";
  toggle.textContent = "more";
  toggle.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const folded = text.classList.toggle("clamped");
    toggle.textContent = folded ? "more" : "less";
    toggle.setAttribute("aria-expanded", String(!folded));
  });
  const both = document.createDocumentFragment();
  both.append(text, toggle);
  return both;
}

/** Offer "more" wherever folded text runs past its lines. */
export function fitClamps(root: ParentNode) {
  for (const toggle of root.querySelectorAll<HTMLButtonElement>(".clamp-toggle")) {
    const text = toggle.previousElementSibling as HTMLElement;
    if (text.classList.contains("clamped")) toggle.hidden = text.scrollHeight <= text.clientHeight + 1;
  }
}
