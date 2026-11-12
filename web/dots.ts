// "Still working" dots after a line of text, one, two, three and back (". .. ... .."), drawn by
// styles.css's .dots: each dot keeps its place and only its opacity changes, so the words
// beside them never move. Hidden from screen readers: the line is read once, not dot by dot.
// The loading screen's (index.html) are the same three dots.

/** `text`, then its dots, as one line (an inline box whose width never changes). */
export function stillWorking(text: string): HTMLElement {
  const line = document.createElement("span");
  line.className = "still";
  const dots = document.createElement("span");
  dots.className = "dots";
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) dots.append(Object.assign(document.createElement("i"), { textContent: "." }));
  line.append(text, dots);
  return line;
}
