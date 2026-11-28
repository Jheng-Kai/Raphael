// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { composerHTML } from "./chat-composer";
import { mountPageView } from "./page-view";

// R-PAGE-15: while a page stands in the conversation's place, the composer under it is one line: the words and the send or voice
// button. The +, the permission, the folder and branch and the model (everything that sets the next message up) are away, and all of
// them are back when the page is put away. The stylesheet's own rules are read from the file (the test window loads none).
const css = readFileSync(join(__dirname, "page-view.css"), "utf8");
const setUp = ["cmp-attach", "cmp-mode", "cmp-folder", "cmp-branch", "cmp-model"];
const kept = ["cmp-field", "cmp-input", "cmp-pair", "cmp-send", "cmp-voice"];

function mount() {
  document.head.insertAdjacentHTML("beforeend", `<style>${css.replace(/\/\*[\s\S]*?\*\//g, "")}</style>`);
  const pane = document.createElement("section");
  pane.className = "mb-chat";
  pane.innerHTML = `<div class="ra-stage"><div class="ra-scroll"><ol class="thread"></ol></div><div class="ra-dock"><form class="composer">${composerHTML(true)}</form></div></div>`;
  document.body.append(pane);
  const stage = pane.querySelector<HTMLElement>(".ra-stage")!;
  // A member that has a folder shows its two buttons; the model host holds the brain's mark.
  stage.querySelectorAll<HTMLElement>(".cmp-work").forEach(button => { button.hidden = false; });
  stage.querySelector(".cmp-model")!.innerHTML = `<button type="button" class="mp-trigger">model</button>`;
  return { stage, view: mountPageView(stage) };
}
const display = (stage: HTMLElement, name: string): string => getComputedStyle(stage.querySelector(`.${name}`)!).display;

beforeEach(() => { document.head.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; document.head.innerHTML = ""; });

test("while a page is open the composer is one line: the words and send, none of the controls that set the next message up", () => {
  const { stage, view } = mount();
  // The composer as it is in a conversation: every control is drawn.
  for (const name of [...setUp, ...kept]) expect(display(stage, name), name).not.toBe("none");

  view.open({ id: "p1", title: "頁面", kind: "page", leave() { /* nothing to put away */ } });
  expect(stage.classList.contains("is-page")).toBe(true);
  for (const name of setUp) expect(display(stage, name), `${name} is away while a page stands`).toBe("none");
  // What stays is the line itself and the one button that sends it (or speaks it).
  for (const name of kept) expect(display(stage, name), `${name} stays`).not.toBe("none");
  // The line and the button stand side by side, in one row.
  expect(css).toMatch(/\.ra-stage\.is-page > \.ra-dock \.composer \.cmp-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);

  // Put away, with the arrow: every control is back, none of them lost.
  view.close();
  expect(stage.classList.contains("is-page")).toBe(false);
  for (const name of [...setUp, ...kept]) expect(display(stage, name), `${name} is back`).not.toBe("none");
});

test("the one-line composer is the page's alone: the rule names only a stage with a page open, and takes away nothing else", () => {
  const rule = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.ra-stage\.is-page > \.ra-dock \.composer :is\(([^)]*)\) \{ display: none; \}/);
  expect(rule).not.toBeNull();
  expect(rule![1]!.split(",").map(part => part.trim()).sort()).toEqual([".cmp-attach", ".cmp-mode", ".cmp-model", ".cmp-work"]);
  // The send, the voice button, the words and the quote or files already in the message are not in it.
  expect(rule![1]).not.toMatch(/cmp-(send|voice|pair|field|input|files|quote)/);
});
