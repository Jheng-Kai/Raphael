// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ desktopStatus: vi.fn(), desktopOpen: vi.fn(), desktopRenew: vi.fn(), desktopControl: vi.fn(), desktopClose: vi.fn() }));
vi.mock("./api", () => api);
import { mountDesktopViewer, type DesktopState } from "./desktop-viewer";
import { setLocale } from "./i18n";

let host: HTMLElement, mounted: ReturnType<typeof mountDesktopViewer>, member = 1;
const running: DesktopState = { state: "running", ready: true, control: "member" };
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const entry = (): HTMLButtonElement => host.querySelector('[data-desktop="open"]')!;
const frame = (): HTMLIFrameElement => document.querySelector(".desktop-viewer iframe")!;
const control = (): HTMLButtonElement => document.querySelector('[data-dlg="control"]')!;
function connected(): void {
  window.dispatchEvent(new MessageEvent("message", { source: frame().contentWindow, origin: "http://127.0.0.1:5000", data: { type: "raphael-desktop", state: "connected" } }));
}
async function open(): Promise<void> { mounted.show(); await flush(); entry().click(); await flush(); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  setLocale("zh-TW");
  member = 1;
  api.desktopStatus.mockResolvedValue({ ...running });
  api.desktopRenew.mockResolvedValue({ ...running });
  api.desktopOpen.mockResolvedValue({ session: "session-one", url: "http://127.0.0.1:5000/session-one/vnc.html" });
  api.desktopClose.mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host);
  mounted = mountDesktopViewer(host, () => member);
});
afterEach(async () => {
  mounted.hide(); await flush(); document.body.replaceChildren(); vi.useRealTimers();
});

test("Docker absent has no entry; a running computer has one accessible icon and native tooltip", async () => {
  api.desktopStatus.mockResolvedValue({ ...running, state: "absent" });
  mounted.show(); await flush(); expect(entry().hidden).toBe(true);
  api.desktopStatus.mockResolvedValue(running);
  await vi.advanceTimersByTimeAsync(2000);
  expect(entry().hidden).toBe(false);
  expect(entry().getAttribute("aria-label")).toBe("即時桌面");
  expect(entry().title).toBe("即時桌面");
  expect(host.querySelectorAll('[data-desktop="open"]')).toHaveLength(1);
});

test("the selected member opens in the shared dialog and only a trusted frame can announce a connection", async () => {
  await open();
  expect(api.desktopOpen).toHaveBeenCalledWith(1);
  expect(frame().src).toBe("http://127.0.0.1:5000/session-one/vnc.html");
  expect(control().disabled).toBe(true);
  window.dispatchEvent(new MessageEvent("message", { origin: "http://foreign.test", data: { type: "raphael-desktop", state: "connected" } }));
  expect(control().disabled).toBe(true);
  connected();
  expect(frame().hidden).toBe(false);
  expect(document.querySelector(".desktop-status")!.textContent).toBe("成員正在控制電腦");
  expect(document.body.innerHTML).not.toContain("password=");
});

test("taking and handing back control uses the core lease and closing releases its session", async () => {
  await open(); connected();
  api.desktopControl.mockResolvedValue({ ...running, control: "owner" });
  control().click(); await flush(); connected();
  expect(api.desktopControl).toHaveBeenLastCalledWith("session-one", true);
  expect(control().textContent).toBe("交還控制");
  api.desktopControl.mockResolvedValue(running);
  control().click(); await flush(); connected();
  expect(api.desktopControl).toHaveBeenLastCalledWith("session-one", false);
  document.querySelector<HTMLButtonElement>('.desktop-viewer [data-dlg="close"]')!.click(); await flush();
  expect(api.desktopClose).toHaveBeenCalledWith("session-one");
  expect(document.querySelector(".desktop-viewer")).toBeNull();
});

test.each(["stopped", "missing", "unavailable"] as const)("%s has a clear state and no blank frame; restarting reconnects", async state => {
  api.desktopStatus.mockResolvedValue({ ...running, state });
  await open();
  expect(frame().hasAttribute("src")).toBe(false);
  expect(frame().hidden).toBe(true);
  expect(document.querySelector(".desktop-placeholder")!.textContent).toMatch(/已停止|無法使用/);
  expect(control().disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(frame().hasAttribute("src")).toBe(true);
  connected();
  expect(frame().hidden).toBe(false);
});

test("changing member or leaving while open is pending closes the late session", async () => {
  let finish!: (session: { session: string; url: string }) => void;
  api.desktopOpen.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open();
  member = 2; mounted.refresh();
  finish({ session: "late", url: "http://127.0.0.1:5000/late/vnc.html" }); await flush();
  expect(document.querySelector(".desktop-viewer")).toBeNull();
  expect(api.desktopClose).toHaveBeenCalledWith("late");
});

test("a stopped lease request stays contextual and never claims ownership", async () => {
  await open(); connected(); api.desktopControl.mockRejectedValue(new Error("desktop busy"));
  control().click(); await flush();
  expect(document.querySelector(".desktop-error")!.textContent).toContain("請稍後再試");
  expect(control().textContent).toBe("接手控制");
});

test("an expired session is replaced after waking up and the new desktop reconnects", async () => {
  await open(); connected();
  api.desktopRenew.mockRejectedValueOnce(new Error("desktop viewer expired"));
  api.desktopOpen.mockResolvedValue({ session: "session-two", url: "http://127.0.0.1:5000/session-two/vnc.html" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.desktopClose).toHaveBeenCalledWith("session-one");
  expect(frame().hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.desktopRenew).toHaveBeenLastCalledWith("session-two");
  expect(frame().src).toContain("session-two");
  connected(); expect(frame().hidden).toBe(false);
});

test("the owner can hand back even when Docker becomes unavailable", async () => {
  api.desktopStatus.mockResolvedValue({ ...running, control: "owner" });
  await open(); connected();
  api.desktopRenew.mockResolvedValue({ ...running, state: "unavailable", control: "owner" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(frame().hasAttribute("src")).toBe(false);
  expect(control().disabled).toBe(false);
  api.desktopControl.mockResolvedValue({ ...running, state: "unavailable" });
  control().click(); await flush();
  expect(api.desktopControl).toHaveBeenLastCalledWith("session-one", false);
});

test.each([false, true])("initial load retry preserves an established connection (%s)", async established => {
  await open();
  if (established) connected();
  const remove = vi.spyOn(frame(), "removeAttribute");
  await vi.advanceTimersByTimeAsync(30000);
  expect(remove.mock.calls.some(([name]) => name === "src")).toBe(!established);
  expect(frame().src).toContain("session-one");
});
