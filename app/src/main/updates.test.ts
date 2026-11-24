// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { installedUpdateNotice, updateHTML } from "./updates";
import { mountUpdateNotice } from "./update-notice";
import { mountNewerDataUpdate } from "./missing";
import { toaster } from "./ui";
import { setLocale, t } from "./i18n";

vi.mock("./api", () => ({ updateControl: vi.fn() }));
vi.mock("./ui", async original => ({ ...await original<typeof import("./ui")>(), toaster: { info: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.clearAllMocks(); vi.restoreAllMocks(); setLocale("zh-TW"); });

it("keeps the installation receipt until the owner can see its one notice", async () => {
  let hidden = true;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.mocked(api.updateControl).mockResolvedValue({ state:"idle", version:"", notes:"", error:"", installed:"1.1.0" });
  await installedUpdateNotice();
  expect(api.updateControl).not.toHaveBeenCalled();
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(toaster.info).toHaveBeenCalledOnce());
  document.dispatchEvent(new Event("visibilitychange"));
  expect(api.updateControl).toHaveBeenCalledExactlyOnceWith("receipt");
});

it("renders escaped release notes and a disabled background check without making requests", () => {
  const html = updateHTML({state:"found", version:"1.1.0", notes:"<script>untrusted</script>", error:""}, false);
  expect(html).toContain("&lt;script&gt;untrusted&lt;/script&gt;");
  expect(html).toContain('aria-checked="false"');
  expect(api.updateControl).not.toHaveBeenCalled();
});

it.each(["zh-TW", "en", "ja"] as const)("offers the release page without update controls when no key is configured in %s", locale => {
  setLocale(locale);
  const html = updateHTML({ state: "error", version: "", notes: "", error: "not_configured" }, false, "0.2.0");
  const root = document.createElement("div");
  root.innerHTML = html;
  expect(root.textContent).toContain(t("update.currentVersion", { p0: "0.2.0" }));
  expect(root.textContent).toContain(t("update.releasePageHint"));
  expect(root.querySelector('button[data-act="update-releases"]')?.textContent).toBe(t("update.openReleases"));
  expect(root.querySelectorAll("button")).toHaveLength(1);
  expect(root.querySelector('[data-act="update-check"], [data-act="update-install"], [data-k="auto-update"], [role="alert"], .error')).toBeNull();
  expect(api.updateControl).not.toHaveBeenCalled();
});

it.each(["idle", "found", "ready", "error"] as const)("preserves the configured-key %s controls", state => {
  const available = state === "found" || state === "ready";
  const html = updateHTML({ state, version: available ? "1.1.0" : "", notes: "", error: state === "error" ? "feed" : "" }, false, "0.2.0");
  expect(html).toContain(`data-act="${available ? "update-install" : "update-check"}"`);
  expect(html).toContain('data-k="auto-update"');
  expect(html).not.toContain('data-act="update-releases"');
  if (state === "error") expect(html).toContain(t("update.feedError"));
  expect(api.updateControl).not.toHaveBeenCalled();
});

const state = (value: api.UpdateView["state"], version = "", error = ""): api.UpdateView =>
  ({ state: value, version, notes: "", error });

it("offers an update in the sidebar and cancels the owner's queued request", async () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  vi.mocked(api.updateControl).mockResolvedValueOnce(state("ready", "1.2.0"))
    .mockResolvedValueOnce(state("waiting", "1.2.0"))
    .mockResolvedValueOnce(state("ready", "1.2.0"));
  const stop = mountUpdateNotice(slot);
  const button = () => slot.querySelector<HTMLButtonElement>("[data-update-now]")!;
  try {
    await vi.waitFor(() => expect(button()?.textContent).toContain(t("update.restart")));
    button().click();
    await vi.waitFor(() => expect(button().textContent).toContain(t("update.waiting")));
    expect(button().textContent).toContain(t("update.cancel"));
    button().click();
    await vi.waitFor(() => expect(button().textContent).toContain(t("update.restart")));
    expect(vi.mocked(api.updateControl).mock.calls).toEqual([["status"], ["install"], ["cancel"]]);
    expect(toaster.info).not.toHaveBeenCalled();
  } finally { stop(); }
});

it("offers cancellation in About while members finish", () => {
  const html = updateHTML(state("waiting", "1.2.0"), false);
  expect(html).toContain(t("update.waiting"));
  expect(html).toContain('data-act="update-cancel"');
  expect(html).toContain(t("update.cancel"));
});

it.each(["idle", "error"] as const)("checks and downloads on the startup screen before reporting %s", async result => {
  vi.useFakeTimers();
  const panel = document.createElement("main");
  document.body.append(panel);
  let finish!: (view: api.UpdateView) => void;
  vi.mocked(api.updateControl)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(state("downloading", "1.2.0"));
  const button = () => panel.querySelector<HTMLButtonElement>("[data-startup-update]");
  mountNewerDataUpdate(panel);
  expect(button()?.classList.contains("pri")).toBe(true);
  expect(button()?.textContent).toBe(t("update.now"));
  button()!.click();
  expect(button()!.disabled).toBe(true);
  expect(button()!.textContent).toBe(t("update.checking"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(button()!.textContent).toBe(t("update.downloading"));
  finish(state(result, "", result === "error" ? "not_configured" : ""));
  await Promise.resolve();
  expect(panel.querySelector(".startup-update-result:not([hidden])")?.textContent)
    .toBe(t(result === "error" ? "update.unavailable" : "update.current"));
  expect(panel.querySelector("a")).toBeNull();
  if (result === "error") expect(button()).toBeNull();
  else expect(button()?.disabled).toBe(false);
  expect(vi.mocked(api.updateControl).mock.calls).toEqual([["install"], ["status"]]);
  expect(toaster.info).not.toHaveBeenCalled();
});
