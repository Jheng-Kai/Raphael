// @vitest-environment happy-dom
// The code of a device sign-in (device-login.ts): one dialog over the window, wherever the sign-in began.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MainEvent } from "./types";

const api = vi.hoisted(() => ({ integrationsConnectCancel: vi.fn(), openLink: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("./ui", async (original) => ({
  ...(await original<typeof import("./ui")>()),
  toaster: { info: vi.fn() },
  copyButton: vi.fn(),
}));

import { followDeviceLogin } from "./device-login";
import { setLocale } from "./i18n";
import { copyButton, toaster } from "./ui";

const code: MainEvent = {
  type: "DeviceCode", catalog_id: "github", name: "GitHub", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900,
};
const done: MainEvent = { type: "DeviceDone", catalog_id: "github" };
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".mb-dialog.dl-dialog");
const press = (act: string): void => dialog()!.querySelector<HTMLButtonElement>(`[data-dlg="${act}"]`)!.click();
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  api.integrationsConnectCancel.mockReset().mockResolvedValue({ cancelled: true });
  api.openLink.mockReset().mockResolvedValue(undefined);
  vi.mocked(copyButton).mockReset().mockResolvedValue(true);
  vi.mocked(toaster.info).mockReset();
});
afterEach(() => {
  followDeviceLogin(done);
  setLocale("zh-TW");
  document.body.innerHTML = "";
});

describe("the code of a device sign-in", () => {
  test("comes up over the window with the code in keycaps, 取消 and one copy-and-open button, which has the focus", () => {
    followDeviceLogin(code);
    const shown = dialog()!;
    expect(shown.querySelector("h2")!.textContent).toBe("連結 GitHub");
    expect(shown.querySelector(".dl-hint")!.textContent).toBe("在開啟的頁面貼上這組代碼");
    expect([...shown.querySelectorAll(".dl-cap")].map((cap) => cap.textContent).join("")).toBe("WDJBMJHT");
    expect(shown.querySelector(".dl-code")!.getAttribute("aria-label")).toBe("WDJB-MJHT");
    expect([...shown.querySelectorAll(".mb-dlg-act .btn")].map((b) => b.textContent)).toEqual(["取消", "複製代碼並開啟 GitHub"]);
    expect(document.activeElement).toBe(shown.querySelector('[data-dlg="open"]'));
  });

  test.each([
    ["en", "Copy code and open GitHub"],
    ["ja", "コードをコピーして GitHub を開く"],
  ] as const)("says it in %s", (locale, label) => {
    setLocale(locale);
    followDeviceLogin(code);
    expect(dialog()!.textContent).toContain(label);
  });

  test("the button copies the code and opens the address, and the code stays while the sign-in waits", async () => {
    followDeviceLogin(code);
    press("open");
    await settle();
    expect(copyButton).toHaveBeenCalledWith(expect.anything(), "WDJB-MJHT");
    expect(api.openLink).toHaveBeenCalledWith("https://github.com/login/device");
    expect(dialog()).not.toBeNull();
  });

  test("a link that may not be opened is told", async () => {
    api.openLink.mockRejectedValue(new Error("that link may not be opened"));
    followDeviceLogin(code);
    press("open");
    await settle();
    expect(toaster.info).toHaveBeenCalled();
  });

  test("goes when the core says the sign-in ended, and nothing is cancelled", () => {
    followDeviceLogin(code);
    followDeviceLogin({ type: "DeviceDone", catalog_id: "notion" });
    expect(dialog()).not.toBeNull();
    followDeviceLogin(done);
    expect(dialog()).toBeNull();
    expect(api.integrationsConnectCancel).not.toHaveBeenCalled();
  });

  test("取消 and Escape end the sign-in", () => {
    followDeviceLogin(code);
    press("cancel");
    expect(dialog()).toBeNull();
    expect(api.integrationsConnectCancel).toHaveBeenCalledTimes(1);
    followDeviceLogin(code);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialog()).toBeNull();
    expect(api.integrationsConnectCancel).toHaveBeenCalledTimes(2);
  });

  test("a newer code takes the place of the one before, and a core that started again takes it down", () => {
    followDeviceLogin(code);
    followDeviceLogin({ ...code, user_code: "ABCD-EFGH" } as MainEvent);
    expect(document.querySelectorAll(".dl-dialog")).toHaveLength(1);
    expect(dialog()!.querySelector(".dl-code")!.getAttribute("aria-label")).toBe("ABCD-EFGH");
    followDeviceLogin({ type: "CoreReady" } as MainEvent);
    expect(dialog()).toBeNull();
    expect(api.integrationsConnectCancel).not.toHaveBeenCalled();
  });

  test("other events leave it as it is", () => {
    followDeviceLogin({ type: "ConnectionsChanged" });
    expect(dialog()).toBeNull();
    followDeviceLogin(code);
    followDeviceLogin({ type: "ConnectionsChanged" });
    expect(dialog()).not.toBeNull();
  });
});
