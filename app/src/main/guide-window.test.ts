// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { GUIDE_HEIGHT, GUIDE_WIDTH, fitGuideWindow, releaseGuideWindow, type GuideWindow } from "./guide-window";

/** A window that, maximized, reports itself as the whole screen, as Windows does. */
function fakeWindow(maximized: boolean) {
  const calls: string[] = [];
  const win: GuideWindow = {
    isMaximized: async () => maximized,
    unmaximize: async () => { calls.push("unmaximize"); maximized = false; },
    setSize: async (size) => { calls.push(`size ${(size as { width: number }).width}x${(size as { height: number }).height}`); },
    setResizable: async (on) => { calls.push(`resizable ${on}`); },
    setMaximizable: async (on) => { calls.push(`maximizable ${on}`); },
    center: async () => { calls.push("center"); },
  };
  return { win, calls };
}

describe("the guide's window", () => {
  // Leaving the guide changes nothing about where the window stands or how large it is: a resize on the way into the app
  // showed the webview's white at the window's edge and made the app a new window.
  test("is the card under the control strip, fixed, and leaving gives back only its resizing, never a size or a place", async () => {
    const root = document.createElement("div");
    const { win, calls } = fakeWindow(true);
    await fitGuideWindow(win, 32, root);
    expect(calls).toEqual(["unmaximize", "size 1080x752", "resizable false", "maximizable false", "center"]);
    expect(root.dataset.windowFixed).toBe("true");
    calls.length = 0;
    await releaseGuideWindow(root);
    expect(calls).toEqual(["resizable true", "maximizable true"]);
    expect(root.dataset.windowFixed).toBeUndefined();
  });

  test("a second start does not fix the window again, and a release without a start does nothing", async () => {
    const root = document.createElement("div");
    const { win, calls } = fakeWindow(false);
    await releaseGuideWindow(root);
    expect(calls).toEqual([]);
    await fitGuideWindow(win, 32, root);
    await fitGuideWindow(win, 32, root);
    expect(calls.filter((call) => call === "center")).toHaveLength(1);
    calls.length = 0;
    await releaseGuideWindow(root);
    expect(calls).toEqual(["resizable true", "maximizable true"]);
  });

  test("the shell opens a first run's window at the size the guide fixes it at, under the same control strip", () => {
    // lib.rs `GUIDE_WINDOW` and the page's guide are one size: a window opened at the designed 1280x800 and then made the card
    // resized under the owner's eyes, and the end of the guide resized it again.
    const shell = readFileSync(resolve(__dirname, "../../src-tauri/src/lib.rs"), "utf8");
    const sized = shell.match(/const GUIDE_WINDOW: \(f64, f64\) = \((\d+)\.0, (\d+)\.0 \+ (\d+)\.0\);/);
    expect(sized).toBeTruthy();
    const strip = Number(readFileSync(resolve(__dirname, "styles.css"), "utf8").match(/--window-controls-height: (\d+)px/)![1]);
    expect(sized!.slice(1).map(Number)).toEqual([GUIDE_WIDTH, GUIDE_HEIGHT, strip]);
    expect(shell).toMatch(/opening_size\(device\.onboarded\)/);
  });

  test("the webview's own white is never what shows at the window's edge: the shell paints the window's backdrop with its theme", () => {
    const shell = readFileSync(resolve(__dirname, "../../src-tauri/src/lib.rs"), "utf8");
    const device = readFileSync(resolve(__dirname, "../../src-tauri/src/commands.rs"), "utf8");
    // when it is created, when the system's theme changes and when the owner's appearance does
    expect(shell).toMatch(/\.background_color\(backdrop\(first_paint\)\)/);
    expect(shell).toMatch(/let window = builder\.build\(\)\?;\s+paint_backdrop\(&window\);/);
    expect(shell).toMatch(/WindowEvent::ThemeChanged\(_\)\)[^}]*paint_backdrop\(&webview\)/);
    expect(device).toMatch(/window\.set_theme\(theme\)[\s\S]{0,250}crate::paint_backdrop\(&window\)/);
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
