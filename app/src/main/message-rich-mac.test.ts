// @vitest-environment happy-dom
// The thread's stick to its bottom on a Mac (message-rich.ts readingAnchor, R-FOLLOW-03): WebKit left a thread black when a long
// reply landed while it followed, until a scroll, so the view is painted afresh once the following settles, and at least every
// REPAINT_MAX_MS while a reply keeps coming. The other platforms scroll nothing (message-rich.test.ts).
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../shared/platform", async original => ({ ...(await original<typeof import("../shared/platform")>()), IS_MAC: true, PLATFORM: "macos" }));
const { REPAINT_MAX_MS, richScrollFollows } = await import("./message-rich");
const { NUDGE_PX, SETTLE_MS } = await import("./reading-place");

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

test("a long reply that lands in a following thread is painted afresh on a Mac once it settles, and at least every few hundred ms while it keeps coming", () => {
  vi.useFakeTimers();
  let resized: () => void = () => {};
  const frames: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {});
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { frames.push(run); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const view = { height: 2000, client: 600, top: 1400 }, writes: number[] = [];
  const root = document.createElement("div");
  root.innerHTML = '<div class="ra-col"><ol class="thread"></ol></div><span class="conversation-end"></span>';
  document.body.append(root);
  Object.defineProperties(root, {
    scrollHeight: { configurable: true, get: () => view.height },
    clientHeight: { configurable: true, get: () => view.client },
    scrollTop: { configurable: true, get: () => view.top, set: (value: number) => { view.top = Math.max(0, Math.min(value, view.height - view.client)); writes.push(view.top); } },
  });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  richScrollFollows(root);
  const run = (): void => { frames.splice(0).forEach(frame => frame()); };
  // A long reply lands: the thread is 9000 px in one change and the stick takes the new bottom.
  Object.assign(view, { height: 9000 }); resized();
  expect(view.top).toBe(8400);
  writes.length = 0;
  vi.advanceTimersByTime(SETTLE_MS); run(); run();
  // One step up and back down, after the change settled.
  expect(writes).toEqual([8400 - NUDGE_PX, 8400]);
  // A reply that keeps coming every 100 ms is still painted afresh within REPAINT_MAX_MS of its first growth.
  writes.length = 0;
  let grown = 0;
  for (let elapsed = 0; elapsed < REPAINT_MAX_MS; elapsed += 100) {
    Object.assign(view, { height: view.height + 200 }); resized(); grown++;
    vi.advanceTimersByTime(100); run(); run();
  }
  const nudges = writes.filter((top, index) => index > 0 && top === writes[index - 1]! - NUDGE_PX);
  expect(grown).toBe(REPAINT_MAX_MS / 100);
  expect(nudges.length).toBeGreaterThan(0);
});
