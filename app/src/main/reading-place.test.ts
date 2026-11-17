// @vitest-environment happy-dom
// keepReadingPlace (reading-place.ts): a scroller that is not drawn (the member settings page over the conversation) keeps the
// place it had, it does not read as "at the bottom". What stands under the thread growing or shrinking is the thread's one stick
// to the bottom (message-rich.test.ts).
import { afterEach, expect, test, vi } from "vitest";
import { keepReadingPlace, SETTLE_MS } from "./reading-place";

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

test("on a Mac, once a width change has settled, the view scrolls one pixel and back, which WebKit paints afresh", () => {
  vi.useFakeTimers();
  const { scroller, view, notify, tops, frames } = scrollerAt(3400);
  keepReadingPlace(scroller, ".item", 4, true);
  // The details panel is dragged: three widths in a row, the view at the bottom.
  for (const width of [760, 700, 640]) { view.width = width; notify(); }
  frames.splice(0).forEach(run => run());
  tops.length = 0;
  vi.advanceTimersByTime(SETTLE_MS - 1);
  expect(tops).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(tops).toEqual([3399]);
  frames.splice(0).forEach(run => run());
  expect(tops).toEqual([3399, 3400]);
  expect(scroller.scrollTop).toBe(3400);
});

test("a view at the very top steps down a pixel instead, and a thread with nothing to scroll is left alone", () => {
  vi.useFakeTimers();
  const top = scrollerAt(0);
  keepReadingPlace(top.scroller, ".item", 4, true);
  top.view.width = 700; top.notify();
  top.frames.splice(0).forEach(run => run());
  top.tops.length = 0;
  vi.advanceTimersByTime(SETTLE_MS);
  top.frames.splice(0).forEach(run => run());
  expect(top.tops).toEqual([1, 0]);
  const short = scrollerAt(0);
  short.view.height = 600;
  keepReadingPlace(short.scroller, ".item", 4, true);
  short.view.width = 700; short.notify();
  short.frames.splice(0).forEach(run => run());
  short.tops.length = 0;
  vi.advanceTimersByTime(SETTLE_MS);
  expect(short.tops).toEqual([]);
});

test("on Windows a width change never nudges the view", () => {
  vi.useFakeTimers();
  const { scroller, view, notify, tops, frames } = scrollerAt(3400);
  keepReadingPlace(scroller, ".item", 4, false);
  view.width = 700; notify();
  frames.splice(0).forEach(run => run());
  tops.length = 0;
  vi.advanceTimersByTime(SETTLE_MS * 4);
  frames.splice(0).forEach(run => run());
  expect(tops).toEqual([]);
});

test("a scroll of the person's own in the nudge's frame is not taken back", () => {
  vi.useFakeTimers();
  const { scroller, view, notify, frames } = scrollerAt(3400);
  keepReadingPlace(scroller, ".item", 4, true);
  view.width = 700; notify();
  frames.splice(0).forEach(run => run());
  vi.advanceTimersByTime(SETTLE_MS);
  scroller.scrollTop = 2000;
  frames.splice(0).forEach(run => run());
  expect(scroller.scrollTop).toBe(2000);
});
