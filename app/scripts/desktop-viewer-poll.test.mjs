// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  desktopWallpaper: vi.fn(), desktopStatus: vi.fn(), desktopOpen: vi.fn(),
  desktopRenew: vi.fn(), desktopClose: vi.fn(),
}));
vi.mock("../src/main/api", () => api);
import { mountDesktopViewer } from "../src/main/desktop-viewer";

let host, viewer;
const stopped = { state: "stopped", ready: false, control: "member" };
const running = { state: "running", ready: true, control: "member" };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const advance = async ms => { await vi.advanceTimersByTimeAsync(ms); await flush(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  api.desktopStatus.mockResolvedValue(stopped);
  api.desktopRenew.mockResolvedValue(running);
  api.desktopClose.mockResolvedValue({});
  api.desktopOpen.mockResolvedValue({ session: "one", url: "http://127.0.0.1:5000/one/vnc.html" });
  host = document.createElement("aside");
  host.innerHTML = '<div class="mb-det-scroll"></div><ol></ol>';
  document.body.append(host);
  viewer = mountDesktopViewer(host, () => 1, {
    timeline: host.querySelector("ol"), conversation: () => 11, name: () => "Sample",
    openPanel() {}, panelVisible: () => true,
  });
});

afterEach(async () => {
  viewer.hide(true);
  await flush();
  document.body.replaceChildren();
  vi.useRealTimers();
});

test("unchanged viewer status backs off to ten seconds and a changed state restores two seconds", async () => {
  viewer.show(); await flush();
  expect(api.desktopStatus).toHaveBeenCalledTimes(1);
  for (const [delay, calls] of [[2000, 2], [4000, 3], [8000, 4], [10000, 5]]) {
    await advance(delay - 1);
    expect(api.desktopStatus).toHaveBeenCalledTimes(calls - 1);
    await advance(1);
    expect(api.desktopStatus).toHaveBeenCalledTimes(calls);
  }
  api.desktopStatus.mockResolvedValue({ state: "unavailable", ready: false, control: "member" });
  await advance(10000);
  expect(api.desktopStatus).toHaveBeenCalledTimes(6);
  await advance(2000);
  expect(api.desktopStatus).toHaveBeenCalledTimes(7);
});

test("a connected viewer only renews its captured lease while unchanged polls back off", async () => {
  api.desktopStatus.mockResolvedValue(running);
  viewer.show(); await flush();
  const frame = host.querySelector("iframe");
  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin: "http://127.0.0.1:5000",
    data: { type: "raphael-desktop", state: "connected" },
  }));
  await advance(24000);
  expect(api.desktopStatus).toHaveBeenCalledTimes(1);
  expect(api.desktopRenew).toHaveBeenCalledTimes(4);
  expect(api.desktopRenew).toHaveBeenLastCalledWith("one");
  expect(host.querySelector("iframe")).toBe(frame);
  expect(api.desktopClose).not.toHaveBeenCalled();
});
