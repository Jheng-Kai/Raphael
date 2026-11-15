// @vitest-environment happy-dom
// keepReadingPlace (reading-place.ts): a scroller that is not drawn (the member settings page over the conversation) keeps the
// place it had, it does not read as "at the bottom". What stands under the thread growing or shrinking is the thread's one stick
// to the bottom (message-rich.test.ts).
import { afterEach, expect, test, vi } from "vitest";
import { keepReadingPlace } from "./reading-place";

afterEach(() => vi.unstubAllGlobals());

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
