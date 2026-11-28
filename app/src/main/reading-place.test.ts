// @vitest-environment happy-dom
// keepReadingPlace (reading-place.ts): a scroller that is not drawn (the member settings page over the conversation) keeps the
// place it had, it does not read as "at the bottom". What stands under the thread growing or shrinking is the thread's one stick
// to the bottom (message-rich.test.ts).
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { followLines, keepReadingPlace, LINE_STEP_PX, NUDGE_PX, SETTLE_MS } from "./reading-place";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("a conversation hidden and drawn again at the same width comes back where it was read", () => {
  let notify: () => void = () => {};
  let listener: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const view = { width: 800, client: 600, height: 4000, top: 1200 };
  const scroller = document.createElement("div");
  scroller.addEventListener = ((type: string, run: () => void) => { if (type === "scroll") listener = run; }) as typeof scroller.addEventListener;
  const item = document.createElement("div");
  item.className = "item";
  scroller.append(item);
  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, get: () => view.width },
    clientHeight: { configurable: true, get: () => view.client },
    scrollHeight: { configurable: true, get: () => view.height },
    scrollTop: { configurable: true, get: () => view.top, set: (value: number) => { view.top = Math.max(0, Math.min(value, view.height - view.client)); } },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  item.getBoundingClientRect = () => ({ top: -view.top + 1180, bottom: -view.top + 1700 } as DOMRect);
  keepReadingPlace(scroller, ".item");
  // The settings page takes the place: the box has no size, its scroll position is gone, its events fire.
  Object.assign(view, { width: 0, client: 0, height: 0, top: 0 });
  notify();
  listener();
  // The way back: the box is drawn again, the page puts the place back, then the observer reports the new size.
  Object.assign(view, { width: 800, client: 600, height: 4000, top: 1200 });
  notify();
  expect(scroller.scrollTop).toBe(1200);
});

test("a wider, shorter thread clamped to its new end before the width is reported keeps the place read in the middle, and says the owner holds it", () => {
  let listener: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor() {} observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // 1800 px above the bottom of a 7000 px thread; the line read is 40 px under the view's top.
  const view = { width: 800, client: 600, height: 7000, top: 4600, itemAt: 4640 };
  const scroller = document.createElement("div");
  const added = scroller.addEventListener.bind(scroller);
  scroller.addEventListener = ((type: string, run: EventListener, options?: AddEventListenerOptions) => { if (type === "scroll") listener = run as () => void; else added(type, run, options); }) as typeof scroller.addEventListener;
  const holds: string[] = [];
  scroller.addEventListener("conversation-hold", () => holds.push("hold"));
  const item = document.createElement("div");
  item.className = "item";
  scroller.append(item);
  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, get: () => view.width },
    clientHeight: { configurable: true, get: () => view.client },
    scrollHeight: { configurable: true, get: () => view.height },
    scrollTop: { configurable: true, get: () => view.top, set: (value: number) => { view.top = Math.max(0, Math.min(value, view.height - view.client)); } },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  item.getBoundingClientRect = () => ({ top: view.itemAt - view.top, bottom: view.itemAt - view.top + 300 } as DOMRect);
  document.body.append(scroller);
  keepReadingPlace(scroller, ".item", 4, false);
  // The details panel closes: the lines rewrap, the thread is 5100 px, the line now stands at 3400, and the browser clamps the
  // view to the new end (4500) with a scroll before any size is reported.
  Object.assign(view, { width: 1100, height: 5100, itemAt: 3400 });
  view.top = Math.min(view.top, view.height - view.client);
  listener();
  expect(view.top).toBe(3400 - 40);
  expect(holds.length).toBeGreaterThan(0);
  scroller.remove();
});

/** A scroller at `top` of a 4000 px thread in a 600 px view, whose ResizeObserver this hands back. */
function scrollerAt(top: number): { scroller: HTMLElement; view: { width: number; client: number; height: number; top: number }; notify: () => void; tops: number[]; frames: (() => void)[] } {
  let notify: () => void = () => {};
  const frames: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { frames.push(run); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const view = { width: 800, client: 600, height: 4000, top }, tops: number[] = [];
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, get: () => view.width },
    clientHeight: { configurable: true, get: () => view.client },
    scrollHeight: { configurable: true, get: () => view.height },
    scrollTop: { configurable: true, get: () => view.top, set: (value: number) => { view.top = Math.max(0, Math.min(value, view.height - view.client)); tops.push(view.top); } },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  return { scroller, view, notify: () => notify(), tops, frames };
}
const frame = (frames: (() => void)[]): void => { frames.splice(0).forEach(run => run()); };

/**
 * A conversation of one text whose lines this lays out: `perLine` characters to a line, `LINE` px to a line, the view `top` px down
 * the thread. The observers the page made hand their callbacks back, in the order they were made.
 */
const LINE = 20;
function textIn(scroller: HTMLElement, chars = 2000): { model: { perLine: number; base: number; top: number; client: number; col: number }; column: HTMLElement; fire(): void; topOf(at: number): number } {
  const callbacks: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} disconnect() { callbacks.length = 0; } });
  const item = document.createElement("div");
  item.className = "item";
  item.append(document.createTextNode("字".repeat(chars)));
  const column = document.createElement("div");
  column.className = "ra-col";
  column.append(item);
  scroller.append(column);
  document.body.append(scroller);
  const model = { perLine: 20, base: 100, top: 0, client: 600, col: 600 };
  const topOf = (at: number): number => model.base + Math.floor(at / model.perLine) * LINE - model.top;
  const rect = (top: number, height: number): DOMRect => ({ top, bottom: top + height, left: 0, right: 10, width: 10, height } as DOMRect);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = {
      at: 0, setStart(_node: Node, at: number) { this.at = at; }, setEnd() {}, selectNodeContents() {},
      getBoundingClientRect: () => rect(topOf(range.at), LINE),
      getClientRects: () => Array.from({ length: Math.ceil(chars / model.perLine) }, (_, line) => rect(model.base + line * LINE - model.top, LINE)),
    };
    return range as unknown as Range;
  });
  item.getBoundingClientRect = () => rect(model.base - model.top, Math.ceil(chars / model.perLine) * LINE);
  scroller.getBoundingClientRect = () => rect(0, model.client);
  column.getBoundingClientRect = () => ({ ...rect(model.base - model.top, 400), width: model.col } as DOMRect);
  Object.defineProperties(scroller, {
    scrollTop: { configurable: true, get: () => model.top, set: (value: number) => { model.top = Math.max(0, value); } },
    clientWidth: { configurable: true, get: () => 600 }, clientHeight: { configurable: true, get: () => model.client },
    scrollHeight: { configurable: true, get: () => model.base + Math.ceil(chars / model.perLine) * LINE + 40 },
  });
  return { model, column, fire: () => callbacks.slice().forEach(run => run()), topOf };
}

test("a dragged edge leaves the column its own width: no word is held at an old width, covered or cut", () => {
  const at = scrollerAt(1200);
  const column = document.createElement("div");
  column.className = "ra-col";
  at.scroller.className = "ra-scroll";
  at.scroller.append(column);
  document.body.append(at.scroller);
  keepReadingPlace(at.scroller, ".item", 4, false);
  const letGo = followLines();
  at.view.width = 640; at.notify(); frame(at.frames);
  letGo();
  expect(column.getAttribute("style")).toBeNull();
  at.scroller.remove();
});

test("a dragged edge keeps the line read where it stands on the screen while the lines wrap again around it, in every frame", () => {
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 1; });
  const scroller = document.createElement("div");
  scroller.className = "ra-scroll";
  const at = textIn(scroller);
  // The view's top is in the middle of the text.
  at.model.top = 160;
  keepReadingPlace(scroller, ".item", 4, false);
  const held: string[] = [];
  scroller.addEventListener("conversation-hold", () => held.push("hold"));
  const letGo = followLines();
  // The first line whole in view: the character that starts it.
  const line = [...Array(2000).keys()].find(index => at.topOf(index) >= 0)!;
  const stood = at.topOf(line);
  expect(held).toEqual(["hold"]);
  // The pane is dragged narrower, then wider: each step changes the lines, and the frame's own correction runs once.
  for (const perLine of [19, 17, 14, 11, 12, 15, 18, 20]) {
    at.model.perLine = perLine;
    at.fire();
    expect(at.topOf(line), `${perLine}`).toBeCloseTo(stood, 0);
  }
  letGo();
  expect(at.topOf(line)).toBeCloseTo(stood, 0);
  scroller.remove();
});

test("a dragged edge keeps a conversation at its bottom at its bottom, whatever the lines add", () => {
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 1; });
  const scroller = document.createElement("div");
  scroller.className = "ra-scroll";
  const at = textIn(scroller);
  at.model.top = scroller.scrollHeight - at.model.client;
  keepReadingPlace(scroller, ".item", 4, false);
  const held: string[] = [];
  scroller.addEventListener("conversation-hold", () => held.push("hold"));
  const letGo = followLines();
  for (const perLine of [18, 14, 9, 12, 20]) {
    at.model.perLine = perLine;
    at.fire();
    expect(scroller.scrollTop, `${perLine}`).toBe(scroller.scrollHeight);
  }
  // The bottom is not a place the owner holds in the middle: the thread goes on following its newest turn.
  expect(held).toEqual([]);
  letGo();
  scroller.remove();
});

test("each frame is measured for its own lines before the line read is put back, and letting go ends the correction", () => {
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 1; });
  const scroller = document.createElement("div");
  scroller.className = "ra-scroll";
  const at = textIn(scroller);
  at.model.top = 160;
  keepReadingPlace(scroller, ".item", 4, false);
  const order: string[] = [];
  scroller.addEventListener("conversation-measure", () => order.push("measure"));
  const letGo = followLines();
  // Frames in which the column keeps its width do not measure; the one that crosses a step does.
  at.fire();
  expect(order).toEqual([]);
  at.model.perLine = 15; at.model.col = 552;
  at.fire();
  expect(order).toEqual(["measure"]);
  letGo();
  order.length = 0;
  at.fire();
  expect(order).toEqual([]);
  scroller.remove();
});
/** The width changes, the keeper's own frame runs, and what is written from then on is recorded. */
function widen(at: ReturnType<typeof scrollerAt>, width = 700): void {
  at.view.width = width; at.notify(); frame(at.frames); at.tops.length = 0;
}

test("on a Mac, once a width change has settled, the view scrolls up and back in two frames, which WebKit paints afresh", () => {
  vi.useFakeTimers();
  const at = scrollerAt(3400);
  keepReadingPlace(at.scroller, ".item", 4, true);
  // The details panel is dragged: three widths in a row, the view at the bottom.
  for (const width of [760, 700]) { at.view.width = width; at.notify(); }
  widen(at, 640);
  vi.advanceTimersByTime(SETTLE_MS - 1);
  frame(at.frames);
  expect(at.tops).toEqual([]);
  vi.advanceTimersByTime(1);
  frame(at.frames);
  expect(at.tops).toEqual([3400 - NUDGE_PX]);
  frame(at.frames);
  expect(at.tops).toEqual([3400 - NUDGE_PX, 3400]);
});

test("a view at the very top steps down instead, and a thread with nothing to scroll is left alone", () => {
  vi.useFakeTimers();
  const top = scrollerAt(0);
  keepReadingPlace(top.scroller, ".item", 4, true);
  widen(top);
  vi.advanceTimersByTime(SETTLE_MS);
  frame(top.frames); frame(top.frames);
  expect(top.tops).toEqual([NUDGE_PX, 0]);
  const short = scrollerAt(0);
  short.view.height = 600;
  keepReadingPlace(short.scroller, ".item", 4, true);
  widen(short);
  vi.advanceTimersByTime(SETTLE_MS);
  frame(short.frames); frame(short.frames);
  expect(short.tops).toEqual([]);
});

test("a view a few px short of the bottom, where its reader may have stopped on purpose, is not scrolled", () => {
  // Any scroll there would hand a held place back to following (message-rich.ts readingAnchor).
  vi.useFakeTimers();
  for (const gap of [1, 2, 4]) {
    const at = scrollerAt(3400 - gap);
    keepReadingPlace(at.scroller, ".item", 4, true);
    widen(at);
    at.view.top = 3400 - gap;
    vi.advanceTimersByTime(SETTLE_MS);
    frame(at.frames); frame(at.frames);
    expect(at.tops, `${gap}`).toEqual([]);
  }
});

test("on Windows a width change never nudges the view", () => {
  vi.useFakeTimers();
  const at = scrollerAt(3400);
  keepReadingPlace(at.scroller, ".item", 4, false);
  widen(at);
  vi.advanceTimersByTime(SETTLE_MS * 4);
  frame(at.frames); frame(at.frames);
  expect(at.tops).toEqual([]);
});

test("a scroll of the person's own in the nudge's frame is not taken back", () => {
  vi.useFakeTimers();
  const at = scrollerAt(3400);
  keepReadingPlace(at.scroller, ".item", 4, true);
  widen(at);
  vi.advanceTimersByTime(SETTLE_MS);
  frame(at.frames);
  at.scroller.scrollTop = 2000;
  frame(at.frames);
  expect(at.scroller.scrollTop).toBe(2000);
});

test("a dragged edge steps the column's width: a grid through the width it has, taken at the press and given back at the release", () => {
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 1; });
  const scroller = document.createElement("div");
  scroller.className = "ra-scroll";
  const at = textIn(scroller);
  at.model.top = 160; at.model.col = 611;
  keepReadingPlace(scroller, ".item", 4, false);
  expect(scroller.dataset.stepping).toBeUndefined();
  const letGo = followLines();
  // 611 = 25 * 24 + 11: the grid is 11 px (less a hair, so the width it has is never rounded down a step) plus whole steps.
  expect(scroller.dataset.stepping).toBe("");
  expect(parseFloat(at.column.style.getPropertyValue("--step-r"))).toBeCloseTo(10.98, 2);
  expect(LINE_STEP_PX).toBe(24);
  letGo();
  expect(scroller.dataset.stepping).toBeUndefined();
  expect(at.column.style.getPropertyValue("--step-r")).toBe("");
  scroller.remove();
});

test("the stylesheet steps the column's width down to the grid and never past the pane", () => {
  const css = readFileSync(join(__dirname, "agent.css"), "utf8");
  const rule = css.match(/\.ra-scroll\[data-stepping\] > \.ra-col \{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toContain("round(down, calc(100% - var(--step-r)), 24px)");
  expect(rule).toContain("min(var(--pa-colw)");
  expect(css).toMatch(/@property --step-r \{ syntax: "<length>"; inherits: false;/);
});
