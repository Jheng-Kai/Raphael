// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountHostBrowserToolbar, type HostBrowserModel } from "./host-browser-toolbar";
import { t } from "./i18n";

const tabs = [
  { id: "page", title: "Work page", url: "https://work.example.test", favicon: "" },
  { id: "popup", title: "Sign-in window", url: "https://sign-in.example.test", favicon: "data:image/png;base64,aGVsbG8=" },
];

function setup() {
  const screen = document.createElement("div");
  document.body.append(screen);
  const send = vi.fn();
  const toolbar = mountHostBrowserToolbar(screen, send);
  const button = (selector: string) => screen.querySelector<HTMLButtonElement>(selector)!;
  const address = screen.querySelector<HTMLInputElement>(".host-browser-address")!;
  const model: HostBrowserModel = { tabs, shown: "popup", back: true, forward: false };
  return { screen, send, toolbar, button, address, model };
}

afterEach(() => document.body.replaceChildren());

it("shows the selected Chrome tab, allows watch-only selection and keeps the address plain text", () => {
  const { screen, send, toolbar, button, address, model } = setup();
  toolbar.draw(model, false);
  expect(button('[data-browser-tab="popup"][aria-pressed="true"]').getAttribute("aria-label")).toBe(tabs[1].title);
  expect(screen.querySelector(".host-browser-favicon img")?.getAttribute("src")).toBe(tabs[1].favicon);
  expect(screen.querySelector(".host-browser-url")?.textContent).toBe(tabs[1].url);
  expect(address.hidden).toBe(true);
  for (const action of ["new", "back", "forward", "reload"]) {
    expect(button(`[data-browser-action="${action}"]`).disabled).toBe(true);
  }
  button('[data-browser-tab="page"][data-browser-action="select"]').click();
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0]).toEqual({ action: "select", tab: "page" });
  const close = button('[data-browser-tab="popup"][data-browser-action="close"]');
  expect(close.disabled).toBe(false);
  close.click();
  expect(send).toHaveBeenLastCalledWith({ action: "close", tab: "popup" }, expect.any(Number));
  toolbar.draw(undefined, false);
  expect(screen.hasAttribute("data-host-browser")).toBe(false);
});

it("submits the address for the displayed tab and preserves an in-progress edit through state updates", () => {
  const { screen, send, toolbar, button, address, model } = setup();
  toolbar.draw(model, true);
  expect(address.hidden).toBe(false);
  expect(button('[data-browser-action="back"]').disabled).toBe(false);
  expect(button('[data-browser-action="forward"]').disabled).toBe(true);
  address.focus();
  address.value = "work.example.test/next";
  address.dispatchEvent(new Event("input"));
  toolbar.draw({ ...model, forward: true }, true);
  expect(address.value).toBe("work.example.test/next");
  address.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }));
  expect(send).not.toHaveBeenCalled();
  address.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(send.mock.calls[0][0]).toEqual({ action: "navigate", tab: "popup", url: "https://work.example.test/next" });
  toolbar.result(send.mock.calls[0][1], false);
  expect(address.getAttribute("aria-invalid")).toBe("true");
  expect(screen.querySelector(".host-browser-error")?.textContent).toBe(t("browser.navigationFailed"));
  toolbar.draw({ ...model, shown: "page" }, true);
  expect(address.hasAttribute("aria-invalid")).toBe(false);
  expect(address.value).toBe(tabs[0].url);
  button('[data-browser-action="reload"]').click();
  expect(send.mock.calls[1][0]).toEqual({ action: "reload", tab: "page" });
});
