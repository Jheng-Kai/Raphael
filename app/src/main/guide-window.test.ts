// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { fitGuideWindow, releaseGuideWindow, type GuideWindow } from "./guide-window";

/** A window that, maximized, reports the whole screen as its size and place, as Windows does. */
function fakeWindow(maximized: boolean) {
  const calls: string[] = [];
  const win: GuideWindow = {
    isMaximized: async () => maximized,
    outerSize: async () => (maximized ? { width: 1936, height: 1048, type: "Physical" } : { width: 1600, height: 1000, type: "Physical" }) as never,
    outerPosition: async () => (maximized ? { x: -8, y: -8, type: "Physical" } : { x: 40, y: 30, type: "Physical" }) as never,
    unmaximize: async () => { calls.push("unmaximize"); maximized = false; },
    maximize: async () => { calls.push("maximize"); maximized = true; },
    setSize: async (size) => { calls.push(`size ${(size as { width: number }).width}x${(size as { height: number }).height}`); },
    setPosition: async (position) => { calls.push(`position ${(position as { x: number }).x},${(position as { y: number }).y}`); },
    setResizable: async (on) => { calls.push(`resizable ${on}`); },
    setMaximizable: async (on) => { calls.push(`maximizable ${on}`); },
    center: async () => { calls.push("center"); },
  };
  return { win, calls };
}

describe("the guide's window", () => {
  // A maximized window gives back its ordinary size, never the screen's, so 「還原」 still returns to it (owner, 2026-11-08).
  test("is the card under the control strip, fixed, and comes back as it was, its ordinary size under the maximized one", async () => {
    const root = document.createElement("div");
    const { win, calls } = fakeWindow(true);
    await fitGuideWindow(win, 32, root);
    expect(calls).toEqual(["unmaximize", "size 1080x752", "resizable false", "maximizable false", "center"]);
    expect(root.dataset.windowFixed).toBe("true");
    calls.length = 0;
    await releaseGuideWindow(root);
    expect(calls).toEqual(["resizable true", "maximizable true", "size 1600x1000", "position 40,30", "maximize"]);
    expect(root.dataset.windowFixed).toBeUndefined();
  });

  test("a second start keeps the first size to return to, and a release without a start does nothing", async () => {
    const root = document.createElement("div");
    const { win, calls } = fakeWindow(false);
    await releaseGuideWindow(root);
    expect(calls).toEqual([]);
    await fitGuideWindow(win, 32, root);
    await fitGuideWindow(win, 32, root);
    expect(calls.filter((call) => call === "center")).toHaveLength(1);
    calls.length = 0;
    await releaseGuideWindow(root);
    expect(calls).toEqual(["resizable true", "maximizable true", "size 1600x1000", "position 40,30"]);
  });

  test("on a small screen it takes what the screen has, never less than the app's smallest window", async () => {
    const small = fakeWindow(false);
    await fitGuideWindow(small.win, 32, document.createElement("div"), async () => ({ width: 1024, height: 700 }));
    expect(small.calls[0]).toBe("size 992x668");
    await releaseGuideWindow(document.createElement("div"));
    const tiny = fakeWindow(false);
    await fitGuideWindow(tiny.win, 32, document.createElement("div"), async () => ({ width: 600, height: 400 }));
    expect(tiny.calls[0]).toBe("size 720x480");
    await releaseGuideWindow(document.createElement("div"));
    const unknown = fakeWindow(false);
    await fitGuideWindow(unknown.win, 32, document.createElement("div"), async () => { throw new Error("no monitor"); });
    expect(unknown.calls[0]).toBe("size 1080x752");
    await releaseGuideWindow(document.createElement("div"));
  });
});
