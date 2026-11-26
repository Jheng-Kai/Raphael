// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { createSidebar } from "./sidebar";

// R-PERF-25: a pane dragged by its edge restyles the few elements that use its width, never the whole window.

const strip = (file: string): string => readFileSync(`src/main/${file}`, "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

test("a drag writes the list's width to the pane grid and the caption strip alone, never to the root, once for each move", async () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.body.innerHTML = '<div class="window-chrome" id="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!, chrome = document.getElementById("window-chrome")!, column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="search"></button><button data-col="add"></button></div>';
  const rootWrites = vi.spyOn(document.documentElement.style, "setProperty");
  createSidebar(nav, column);
  const edge = nav.querySelector<HTMLElement>(".side-edge")!;
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  const writes: string[] = [];
  const watch = new MutationObserver(records => { for (const record of records) writes.push((record.target as HTMLElement).id || record.target.nodeName); });
  watch.observe(document.body, { attributes: true, attributeFilter: ["style"], subtree: true });
  edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 348, bubbles: true }));
  for (const x of [340, 330, 320]) edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, bubbles: true }));
  expect(document.body.style.getPropertyValue("--side-live")).toBe("320px");
  expect(chrome.style.getPropertyValue("--side-live")).toBe("320px");
  expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("");
  expect(rootWrites).not.toHaveBeenCalled();
  await Promise.resolve();
  // Three moves, three writes to the grid and three to the strip, and nothing else drew a style.
  expect(writes.filter(id => id === "BODY")).toHaveLength(3);
  expect(writes.filter(id => id === "window-chrome")).toHaveLength(3);
  expect(writes.filter(id => id !== "BODY" && id !== "window-chrome")).toEqual([]);
  edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  watch.disconnect();
  rootWrites.mockRestore();
  document.body.style.removeProperty("--side-live");
});

test("the stylesheet reads the dragged widths from properties that are not inherited, so one write restyles one element", () => {
  const styles = strip("styles.css"), members = strip("members.css"), store = strip("member-store.css");
  // A property inherited from the root or the page is read again by every element beneath it (a whole window of style
  // recalculation for each pointer move); these are registered as not inherited and set on the few elements that use them.
  expect(styles).toMatch(/@property --side-live \{ syntax: "\*"; inherits: false; \}/);
  expect(styles).toMatch(/@property --panel-live \{ syntax: "\*"; inherits: false; \}/);
  expect(styles).toContain("grid-template-columns: var(--side-live, var(--sidebar-width)) minmax(0, 1fr)");
  expect(styles).toContain("left: var(--side-live, var(--sidebar-width))");
  expect(store).toContain("inset: 0 0 0 var(--side-live, var(--sidebar-width))");
  expect(members).toContain("min(var(--panel-live, var(--pa-det)), calc(100% - var(--pa-conv-min)))");
  expect(members).toContain("width: var(--panel-live, var(--pa-det))");
  // The panel's room is the grid's own width, not the window's less the list's.
  expect(members).not.toMatch(/100vw - var\(--sidebar-width\)/);
});

test("holding an edge sets no inherited property on the root: one shield over the window keeps the cursor and the press", () => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-sidebar-collapsed");
  document.body.innerHTML = '<div class="window-chrome" id="window-chrome"></div><nav id="nav"></nav><main id="main"></main>';
  const nav = document.getElementById("nav")!, column = document.createElement("aside");
  column.innerHTML = '<div class="mb-top"><button data-col="search"></button><button data-col="add"></button></div>';
  createSidebar(nav, column);
  const edge = nav.querySelector<HTMLElement>(".side-edge")!;
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  const rootAttributes = (): string => [...document.documentElement.attributes].map(attribute => attribute.name).sort().join(",");
  const before = rootAttributes();
  edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 348, bubbles: true }));
  expect(rootAttributes()).toBe(before);
  expect(document.querySelectorAll(".edge-shield")).toHaveLength(1);
  edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  expect(document.querySelectorAll(".edge-shield")).toHaveLength(0);
  expect(rootAttributes()).toBe(before);
  expect(strip("sidebar.css")).toContain(".edge-shield { position: fixed; inset: 0; z-index: 400; cursor: col-resize; user-select: none; }");
  expect(strip("sidebar.css")).not.toContain(":root[data-resizing]");
});

test("a centred column lands on whole pixels, so it moves by whole pixels while the pane beside it is dragged", () => {
  const agent = strip("agent.css");
  // Centred with `margin: auto` a column sits half a pixel off whenever the pane's width and the column's differ by an odd number,
  // and moves by half a pixel for each pixel the pane is dragged: its words are drawn a pixel further on every other frame.
  const block = /@supports \(margin-left: round\(down, 1px, 1px\)\) \{([\s\S]*?)\n\}/.exec(agent)?.[1] ?? "";
  expect(block).toContain("--pa-lead: max(0px, round(down, calc((100% - var(--pa-colw)) / 2), 1px));");
  for (const selector of [".ra-col", ".ra-dock > .composer", ".ra-dock > .ask-card", ".ra-dock > .draft-panel", ".peer-thread"]) {
    expect(block, selector).toContain(`.page-agent ${selector}`);
  }
  expect(block).toContain("margin-inline: var(--pa-lead) 0;");
  // Where the round function is unknown the columns keep the centring they had.
  expect(agent).toContain(".ra-col { max-width: var(--pa-colw); margin: 0 auto; }");
});
