// @vitest-environment happy-dom
// keepBottomOnResize (reading-place.ts): what stands under the thread grows or shrinks, a view at the bottom stays at the
// bottom and a view scrolled up stays where it is. keepReadingPlace: a scroller that is not drawn (the member settings page
// over the conversation) keeps the place it had, it does not read as "at the bottom".
import { afterEach, expect, test, vi } from "vitest";
import { keepBottomOnResize, keepReadingPlace } from "./reading-place";

afterEach(() => vi.unstubAllGlobals());

function setup(view: { client: number; height: number; top: number }) {
  let notify: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  const scroller = document.createElement("div");
  let top = view.top;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, get: () => view.client },
    scrollHeight: { configurable: true, get: () => view.height },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.min(value, view.height - view.client); } },
  });
  const followed = vi.fn();
  keepBottomOnResize(scroller, followed);
  return { scroller, followed, resize(client: number) { view.client = client; top = Math.min(top, view.height - client); notify(); } };
}

test("a view at the bottom stays at the bottom when the composer grows under it", () => {
  const place = setup({ client: 600, height: 2000, top: 1400 });
  place.resize(520);
  expect(place.scroller.scrollTop).toBe(1480);
  expect(place.followed).toHaveBeenCalledOnce();
});

test("a view scrolled up stays where it is", () => {
  const place = setup({ client: 600, height: 2000, top: 900 });
  place.resize(520);
  expect(place.scroller.scrollTop).toBe(900);
  expect(place.followed).not.toHaveBeenCalled();
});

test("a taller scroller needs no move, and a scroller that was not drawn has no place to keep", () => {
  const place = setup({ client: 600, height: 2000, top: 1400 });
  place.resize(680);
  expect(place.followed).not.toHaveBeenCalled();
  const hidden = setup({ client: 0, height: 0, top: 0 });
  hidden.resize(500);
  expect(hidden.followed).not.toHaveBeenCalled();
});

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
