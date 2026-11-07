// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { fitGuideWindow, releaseGuideWindow, type GuideWindow } from "./guide-window";

function fakeWindow(maximized: boolean) {
  const calls: string[] = [];
  const win: GuideWindow = {
    isMaximized: async () => maximized,
    outerSize: async () => ({ width: 1600, height: 1000, type: "Physical" }) as never,
    outerPosition: async () => ({ x: 40, y: 30, type: "Physical" }) as never,
    unmaximize: async () => { calls.push("unmaximize"); },
    maximize: async () => { calls.push("maximize"); },
    setSize: async (size) => { calls.push(`size ${(size as { width: number }).width}x${(size as { height: number }).height}`); },
    setPosition: async (position) => { calls.push(`position ${(position as { x: number }).x},${(position as { y: number }).y}`); },
    setResizable: async (on) => { calls.push(`resizable ${on}`); },
    setMaximizable: async (on) => { calls.push(`maximizable ${on}`); },
    center: async () => { calls.push("center"); },
  };
  return { win, calls };
}

describe("the guide's window", () => {
  test("is the card under the control strip, fixed, and comes back as it was", async () => {
    const root = document.createElement("div");
    const { win, calls } = fakeWindow(true);
    await fitGuideWindow(win, 32, root);
    expect(calls).toEqual(["unmaximize", "size 960x672", "resizable false", "maximizable false", "center"]);
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
});
