// Equations (`$x^2$`, `$$ … $$`) as HTML, by KaTeX: in the composer's field (composer-rich-views.ts) and in the messages the
// renderer draws (message-content.ts). The source is never trusted: no macro may define another, none runs commands or loads a
// link, and an equation KaTeX cannot read stays as the words that were written.
import katex from "katex";
import "katex/dist/katex.min.css";
import { esc } from "./ui";

/** The longest equation drawn: a longer one stays as its words. */
export const MATH_MAX = 2000;
const drawn = new Map<string, string>();

/** The equation `latex` as HTML; `display` sets it as a block of its own. Never throws. */
export function mathHTML(latex: string, display = false): string {
  const key = `${display ? "d" : "i"}\0${latex}`, known = drawn.get(key);
  if (known !== undefined) return known;
  let html: string;
  try {
    if (latex.length > MATH_MAX) throw new Error("long");
    html = katex.renderToString(latex, { displayMode: display, throwOnError: true, output: "htmlAndMathml", trust: false, strict: "ignore", maxExpand: 200, maxSize: 30 });
  } catch {
    html = `<span class="math-source">${esc(display ? `$$${latex}$$` : `$${latex}$`)}</span>`;
  }
  if (drawn.size >= 300) drawn.delete(drawn.keys().next().value!);
  drawn.set(key, html);
  return html;
}
