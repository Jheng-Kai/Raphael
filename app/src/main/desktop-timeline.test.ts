// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ desktopOpen: vi.fn(), desktopRenew: vi.fn(), desktopClose: vi.fn() }));
vi.mock("./api", () => api);
import { mountDesktopTimeline, type DesktopWork } from "./desktop-timeline";
import { setLocale } from "./i18n";
const work: DesktopWork = { id: "one-task", request_id: "one-request", turn_id: 42, state: "running", reason: "", tool: "click" };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { document.body.replaceChildren(); vi.resetAllMocks(); });

test("updates one live card in place across timeline redraws, suppresses owner previews and opens the same request", async () => {
  setLocale("zh-TW");
  document.body.innerHTML = '<ol><li><div data-desktop-slot="42"></div></li></ol>';
  const host = document.querySelector("ol")!, open = vi.fn();
  api.desktopOpen.mockResolvedValue({ session: "preview", url: "http://127.0.0.1:1/preview" });
  api.desktopRenew.mockResolvedValue({}); api.desktopClose.mockResolvedValue({});
  const timeline = mountDesktopTimeline(host, () => 1, () => 11, open);
  const running = { state: "running", ready: true, control: "member", works: [{ ...work }] } as const;
  timeline.update({ ...running, works: [...running.works] }); await flush();
  const card = host.querySelector('[data-desktop-work]'), frame = host.querySelector("iframe");
  expect(api.desktopOpen).toHaveBeenCalledWith(1, { conversation_id: 11, preview: true });
  host.innerHTML = '<li><div data-desktop-slot="42"></div></li>';
  timeline.sync(); await flush();
  expect(host.querySelector('[data-desktop-work]')).toBe(card);
  expect(host.querySelector("iframe")).toBe(frame);
  expect(api.desktopOpen).toHaveBeenCalledTimes(1);
  timeline.update({ ...running, preview_allowed: false, works: [...running.works] }); await flush();
  expect(host.querySelector("iframe")).toBeNull();
  const pending: DesktopWork = { ...work, state: "waiting_control", reason: "two_factor" };
  timeline.update({ ...running, control: "owner", works: [pending] }); await flush();
  expect(host.querySelectorAll('[data-desktop-work]')).toHaveLength(1);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).toContain("雙重驗證");
  host.querySelector<HTMLButtonElement>('[data-desktop-card-open]')!.click();
  expect(open).toHaveBeenCalledWith(pending);
  timeline.clear(); expect(host.querySelector('[data-desktop-work]')).toBeNull();
});

test("a preview arriving after navigation is closed without entering another conversation", async () => {
  document.body.innerHTML = '<ol><li><div data-desktop-slot="42"></div></li></ol>';
  let resolve!: (value: { session: string; url: string }) => void;
  api.desktopOpen.mockImplementation(() => new Promise(done => { resolve = done; }));
  api.desktopClose.mockResolvedValue({});
  const timeline = mountDesktopTimeline(document.querySelector("ol")!, () => 1, () => 11, vi.fn());
  timeline.update({ state: "running", ready: true, control: "member", works: [work] });
  timeline.clear(); resolve({ session: "late", url: "http://127.0.0.1:1/late" }); await flush();
  expect(api.desktopClose).toHaveBeenCalledWith("late");
  expect(document.querySelector("iframe")).toBeNull();
});
