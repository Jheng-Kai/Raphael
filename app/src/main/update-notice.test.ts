// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";

const api = vi.hoisted(() => ({ updateControl: vi.fn() }));
vi.mock("./api", () => api);
const { mountUpdateNotice, updateNoticeHTML } = await import("./update-notice");

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => { setLocale("zh-TW"); document.body.innerHTML = ""; api.updateControl.mockReset(); });

test("a new version is one row at the bottom left with its number and 更新; nothing when there is none", () => {
  setLocale("zh-TW");
  expect(updateNoticeHTML(null)).toBe("");
  expect(updateNoticeHTML({ state: "idle", version: "", notes: "", error: "", installed: "" })).toBe("");
  const html = updateNoticeHTML({ state: "found", version: "1.3.0", notes: "", error: "", installed: "" });
  expect(html).toContain("新版本 1.3.0");
  expect(html).toContain('class="sidebar-update-act">更新<');
  expect(updateNoticeHTML({ state: "installing", version: "1.3.0", notes: "", error: "", installed: "" })).toBe("");
});

test("the row reads the updater, and a press installs now", async () => {
  api.updateControl.mockResolvedValueOnce({ state: "ready", version: "1.3.0", notes: "", error: "", installed: "" });
  api.updateControl.mockResolvedValueOnce({ state: "installing", version: "1.3.0", notes: "", error: "", installed: "" });
  const slot = document.createElement("div");
  slot.hidden = true;
  document.body.append(slot);
  const stop = mountUpdateNotice(slot);
  await flush();
  expect(api.updateControl).toHaveBeenCalledWith("status");
  expect(slot.hidden).toBe(false);
  slot.querySelector<HTMLButtonElement>("[data-update-now]")!.click();
  await flush();
  expect(api.updateControl).toHaveBeenLastCalledWith("install");
  stop();
});
