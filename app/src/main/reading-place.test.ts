// @vitest-environment happy-dom
// keepBottomOnResize (reading-place.ts): what stands under the thread grows or shrinks, a view at the bottom stays at the
// bottom and a view scrolled up stays where it is.
import { afterEach, expect, test, vi } from "vitest";
import { keepBottomOnResize } from "./reading-place";

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
