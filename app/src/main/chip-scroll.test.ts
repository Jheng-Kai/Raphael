// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { chipEdges, chipSteps, revealChip, watchChipRows } from "./chip-scroll";

let resized: ((entries: { target: Element }[]) => void)[] = [];
class FakeResize {
  constructor(readonly report: (entries: { target: Element }[]) => void) { resized.push(report); }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** A row 300 wide holding chips 900 wide, scrolled to `left`. */
function row(left = 0): { row: HTMLElement; scroller: HTMLElement } {
  document.body.innerHTML = `<div data-chip-row><div data-chip-scroll><button>All</button><button>Other</button></div>${chipSteps()}</div>`;
  const scroller = document.querySelector<HTMLElement>("[data-chip-scroll]")!;
  Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 900 });
  Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 300 });
  scroller.scrollLeft = left;
  return { row: document.querySelector<HTMLElement>("[data-chip-row]")!, scroller };
}
const wheel = (target: Element, init: WheelEventInit): WheelEvent => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  // happy-dom leaves the modifier keys of a wheel event unset.
  if (init.ctrlKey) Object.defineProperty(event, "ctrlKey", { value: true });
  target.dispatchEvent(event);
  return event;
};
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

let stop: () => void = () => {};
beforeEach(() => {
  resized = [];
  vi.stubGlobal("ResizeObserver", FakeResize);
  document.body.innerHTML = "";
  stop = watchChipRows(document.body);
});
afterEach(() => { stop(); vi.unstubAllGlobals(); });

test("the mouse wheel moves a row of chips sideways, and hands the page back at either end", async () => {
  const { scroller } = row();
  await flush();
  expect(wheel(scroller, { deltaY: 100 }).defaultPrevented).toBe(true);
  expect(scroller.scrollLeft).toBe(100);
  expect(wheel(scroller, { deltaY: 3, deltaMode: 1 }).defaultPrevented).toBe(true);
  expect(scroller.scrollLeft).toBe(220);
  scroller.scrollLeft = 600;
  expect(wheel(scroller, { deltaY: 100 }).defaultPrevented).toBe(false);
  scroller.scrollLeft = 0;
  expect(wheel(scroller, { deltaY: -100 }).defaultPrevented).toBe(false);
  // A sideways swipe scrolls the row by itself, and a pinch zooms.
  expect(wheel(scroller, { deltaX: 80, deltaY: 10 }).defaultPrevented).toBe(false);
  expect(wheel(scroller, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
  expect(scroller.scrollLeft).toBe(0);
});

test("an arrow and a fade stand only at an end with more chips behind it", () => {
  const { row: line, scroller } = row();
  chipEdges(scroller);
  expect([line.hasAttribute("data-more-before"), line.hasAttribute("data-more-after")]).toEqual([false, true]);
  scroller.scrollLeft = 300;
  chipEdges(scroller);
  expect([line.hasAttribute("data-more-before"), line.hasAttribute("data-more-after")]).toEqual([true, true]);
  scroller.scrollLeft = 600;
  chipEdges(scroller);
  expect([line.hasAttribute("data-more-before"), line.hasAttribute("data-more-after")]).toEqual([true, false]);
  Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 300 });
  scroller.scrollLeft = 0;
  chipEdges(scroller);
  expect([line.hasAttribute("data-more-before"), line.hasAttribute("data-more-after")]).toEqual([false, false]);
});

test("a row drawn later is measured when it gets its size and again as it scrolls", async () => {
  const { row: line, scroller } = row();
  await flush();
  for (const report of resized) report([{ target: scroller }]);
  expect(line.hasAttribute("data-more-after")).toBe(true);
  scroller.scrollLeft = 600;
  scroller.dispatchEvent(new Event("scroll"));
  expect([line.hasAttribute("data-more-before"), line.hasAttribute("data-more-after")]).toEqual([true, false]);
});

test("the arrows are real named buttons that move the row by most of its width", async () => {
  const { scroller } = row(300);
  await flush();
  const moves: ScrollToOptions[] = [];
  scroller.scrollBy = ((options: ScrollToOptions) => { moves.push(options); }) as typeof scroller.scrollBy;
  const [before, after] = document.querySelectorAll<HTMLButtonElement>("[data-chip-step]");
  expect([before!.type, before!.getAttribute("aria-label"), after!.getAttribute("aria-label")]).toEqual(["button", "向左捲動", "向右捲動"]);
  after!.click();
  before!.click();
  expect(moves.map(move => move.left)).toEqual([210, -210]);
});

test("a chip reached by the keyboard stands clear of the faded ends, and one pressed with the mouse stays under the pointer", async () => {
  const { row: line, scroller } = row();
  line.style.setProperty("--chip-fade", "24px");
  const [first, last] = scroller.querySelectorAll<HTMLButtonElement>("button");
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === scroller) return new DOMRect(0, 0, 300, 28);
    return new DOMRect((this === last ? 290 : 10) - scroller.scrollLeft, 0, 40, 28);
  });
  try {
    await flush();
    last!.focus();
    expect(scroller.scrollLeft).toBe(0);
    last!.blur();
    document.documentElement.setAttribute("data-keys", "");
    last!.focus();
    expect(scroller.scrollLeft).toBe(54);
    first!.focus();
    expect(scroller.scrollLeft).toBe(0);
    revealChip(last!);
    expect(scroller.scrollLeft).toBe(54);
  } finally { geometry.mockRestore(); document.documentElement.removeAttribute("data-keys"); }
});

test("the stylesheet hides an arrow until its end has more chips", () => {
  const css = readFileSync("src/main/styles.css", "utf8");
  expect(css).toContain('[data-chip-row][data-more-before] > .chip-step[data-chip-step="-1"], [data-chip-row][data-more-after] > .chip-step[data-chip-step="1"] { display: inline-flex;');
  expect(css).toMatch(/\[data-chip-row\] > \.btn\.icon\.chip-step \{[^}]*display: none;/);
});
