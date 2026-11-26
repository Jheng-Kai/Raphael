// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { type ScreenScale, ZOOM_LEVELS, installWindowZoom, nextZoom, zoomAction, zoomLevels } from "./window-zoom";

const key = (code: string, init: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { code, ctrlKey: true, cancelable: true, ...init });

function memory(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [["raphael.zoom", initial]]);
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), values };
}

/** A screen of `scale`, and `move` to put the window on a screen of another. */
function screenOf(scale: number) {
  let listener: ((scale: number) => void) | undefined;
  const screen: ScreenScale = { read: async () => scale, watch: (heard) => void (listener = heard) };
  return { screen, move: (next: number) => listener?.(next) };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("window zoom", () => {
  test("three steps either way of 100%, and no further", () => {
    expect(ZOOM_LEVELS).toEqual([0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]);
    expect(nextZoom(1, "in")).toBe(1.1);
    expect(nextZoom(1.3, "in")).toBe(1.3);
    expect(nextZoom(0.7, "out")).toBe(0.7);
    expect(nextZoom(1.2, "reset")).toBe(1);
    // A level saved by another version snaps to the nearest step before moving.
    expect(nextZoom(1.25, "in")).toBe(1.3);
    expect(nextZoom(4, "out")).toBe(1.2);
  });

  test("zooming out stops where a CSS pixel would get less than one of the screen's pixels", () => {
    // A screen at 100%: a 1080p monitor on Windows, or on a Mac, which has no scale for it between 1x and 2x.
    expect(zoomLevels(1)).toEqual([1, 1.1, 1.2, 1.3]);
    expect(zoomLevels(1.25)).toEqual([0.8, 0.9, 1, 1.1, 1.2, 1.3]);
    expect(zoomLevels(1.5)).toEqual([...ZOOM_LEVELS]);
    expect(zoomLevels(2)).toEqual([...ZOOM_LEVELS]);
    // A scale reported a hair off its value keeps its steps.
    expect(zoomLevels(1.2499999)).toEqual(zoomLevels(1.25));
    expect(zoomLevels(1.5000000596)).toEqual([...ZOOM_LEVELS]);
    // A scale that is not a number counts as a screen at 100%.
    expect(zoomLevels(Number.NaN)).toEqual(zoomLevels(1));
    expect(zoomLevels(0)).toEqual(zoomLevels(1));
    expect(nextZoom(1, "out", zoomLevels(1))).toBe(1);
    expect(nextZoom(0.7, "in", zoomLevels(1))).toBe(1.1);
  });

  test("Ctrl with plus, minus or zero on either keyboard row", () => {
    expect(zoomAction(key("Equal"))).toBe("in");
    expect(zoomAction(key("NumpadAdd"))).toBe("in");
    expect(zoomAction(key("Minus"))).toBe("out");
    expect(zoomAction(key("NumpadSubtract"))).toBe("out");
    expect(zoomAction(key("Digit0"))).toBe("reset");
    expect(zoomAction(key("Equal", { ctrlKey: false }))).toBeNull();
    expect(zoomAction(key("Equal", { altKey: true }))).toBeNull();
    expect(zoomAction(key("KeyA"))).toBeNull();
  });

  test("keys move the zoom within the limits, stop the browser's own zoom and remember the level", async () => {
    const target = new EventTarget();
    const applied: number[] = [];
    const storage = memory("1.2");
    installWindowZoom(target, async (factor) => { applied.push(factor); }, screenOf(2).screen, storage);
    await settled();
    expect(applied).toEqual([1.2]);
    for (let i = 0; i < 5; i++) {
      const event = key("Equal");
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(applied[applied.length - 1]).toBe(1.3);
    expect(storage.values.get("raphael.zoom")).toBe("1.3");
    target.dispatchEvent(key("Digit0"));
    expect(applied[applied.length - 1]).toBe(1);
  });

  test("a screen at 100% stops at 100%, and a level it cannot draw comes back on a screen that can", async () => {
    const target = new EventTarget();
    const applied: number[] = [];
    const storage = memory("0.7");
    const { screen, move } = screenOf(1);
    installWindowZoom(target, async (factor) => { applied.push(factor); }, screen, storage);
    await settled();
    // Nothing is applied before the screen is read, and then 70% shows as this screen's least.
    expect(applied).toEqual([1]);
    move(2);
    expect(applied[applied.length - 1]).toBe(0.7);
    move(1);
    expect(applied[applied.length - 1]).toBe(1);
    const out = key("Minus");
    target.dispatchEvent(out);
    expect(out.defaultPrevented).toBe(true);
    expect(applied[applied.length - 1]).toBe(1);
    // A key steps from what shows, and that becomes the remembered level.
    expect(storage.values.get("raphael.zoom")).toBe("1");
  });

  test("a screen whose scale cannot be read counts as one at 100%", async () => {
    const applied: number[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const screen: ScreenScale = { read: () => Promise.reject(new Error("no window")), watch: () => {} };
    installWindowZoom(new EventTarget(), async (factor) => { applied.push(factor); }, screen, memory("0.8"));
    await settled();
    expect(applied).toEqual([1]);
    warn.mockRestore();
  });

  test("a missing or broken saved value starts at 100%", async () => {
    const applied: number[] = [];
    installWindowZoom(new EventTarget(), async (factor) => { applied.push(factor); }, screenOf(2).screen, memory("nonsense"));
    await settled();
    expect(applied).toEqual([1]);
  });
});
