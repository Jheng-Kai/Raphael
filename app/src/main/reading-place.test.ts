// @vitest-environment happy-dom
// keepReadingPlace (reading-place.ts): a scroller that is not drawn (the member settings page over the conversation) keeps the
// place it had, it does not read as "at the bottom". What stands under the thread growing or shrinking is the thread's one stick
// to the bottom (message-rich.test.ts).
import { afterEach, expect, test, vi } from "vitest";
import { keepReadingPlace, NUDGE_PX, repaintAfterWork, SETTLE_MS } from "./reading-place";

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

test("on a Mac the end of a member's work paints the thread afresh once it has settled, and work going on or Windows scrolls nothing", () => {
  vi.useFakeTimers();
  const at = scrollerAt(3400);
  const mac = repaintAfterWork(at.scroller, true), windows = repaintAfterWork(at.scroller, false);
  for (const told of [mac, windows]) { told(false); told(true); told(true); }
  vi.advanceTimersByTime(SETTLE_MS); frame(at.frames);
  expect(at.tops).toEqual([]);
  // The work ends: the thread at its bottom steps up and back down in two frames, after the change has settled.
  mac(false); windows(false);
  frame(at.frames);
  expect(at.tops).toEqual([]);
  vi.advanceTimersByTime(SETTLE_MS);
  frame(at.frames); frame(at.frames);
  expect(at.tops).toEqual([3400 - NUDGE_PX, 3400]);
  // Drawn again with nothing at work, nothing more is scrolled.
  at.tops.length = 0;
  mac(false); vi.advanceTimersByTime(SETTLE_MS); frame(at.frames);
  expect(at.tops).toEqual([]);
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
