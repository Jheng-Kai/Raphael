// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { installedUpdateNotice, updateHTML } from "./updates";
import { toaster } from "./ui";
import { setLocale, t } from "./i18n";

vi.mock("./api", () => ({ updateControl: vi.fn() }));
vi.mock("./ui", async original => ({ ...await original<typeof import("./ui")>(), toaster: { info: vi.fn() } }));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); setLocale("zh-TW"); });

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
  expect(api.updateControl).toHaveBeenCalledExactlyOnceWith("status");
});

it("renders escaped release notes and default-off auto updates without making requests", () => {
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
