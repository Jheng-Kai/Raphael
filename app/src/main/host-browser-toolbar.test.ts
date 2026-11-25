// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountHostBrowserToolbar, type HostBrowserModel } from "./host-browser-toolbar";
import { getLocale, t } from "./i18n";

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

it("opens, selects and closes Chrome tabs and offers history while watching", () => {
  const { screen, send, toolbar, button, address, model } = setup();
  toolbar.draw(model);
  expect(button('[data-browser-tab="popup"][aria-pressed="true"]').getAttribute("aria-label")).toBe(tabs[1].title);
  expect(screen.querySelector(".host-browser-favicon img")?.getAttribute("src")).toBe(tabs[1].favicon);
  expect(address.value).toBe(tabs[1].url);
  expect(address.hidden).toBe(false);
  expect(button('[data-browser-action="forward"]').disabled).toBe(true);
  for (const action of ["new", "back", "reload"]) {
    const control = button(`[data-browser-action="${action}"]`);
    expect(control.disabled).toBe(false);
    control.click();
    expect(send).toHaveBeenLastCalledWith({action, tab:"popup"}, expect.any(Number));
  }
  send.mockClear();
  button('[data-browser-tab="page"][data-browser-action="select"]').click();
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0]).toEqual({ action: "select", tab: "page" });
  const close = button('[data-browser-tab="popup"][data-browser-action="close"]');
  expect(close.disabled).toBe(false);
  close.click();
  expect(send).toHaveBeenLastCalledWith({ action: "close", tab: "popup" }, expect.any(Number));
  toolbar.draw(undefined);
  expect(screen.hasAttribute("data-host-browser")).toBe(false);
});

it("submits the address for the displayed tab and preserves an in-progress edit through state updates", () => {
  const { screen, send, toolbar, button, address, model } = setup();
  toolbar.draw(model);
  expect(address.hidden).toBe(false);
  expect(button('[data-browser-action="back"]').disabled).toBe(false);
  expect(button('[data-browser-action="forward"]').disabled).toBe(true);
  address.focus();
  address.value = "work.example.test/next";
  address.dispatchEvent(new Event("input"));
  toolbar.draw({ ...model, forward: true });
  expect(address.value).toBe("work.example.test/next");
  address.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }));
  expect(send).not.toHaveBeenCalled();
  address.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  expect(send.mock.calls[0][0]).toEqual({ action: "navigate", tab: "popup", url: "https://work.example.test/next" });
  toolbar.result(send.mock.calls[0][1], false);
  expect(address.getAttribute("aria-invalid")).toBe("true");
  expect(screen.querySelector(".host-browser-error")?.textContent).toBe(t("browser.navigationFailed"));
  toolbar.draw({ ...model, shown: "page" });
  expect(address.hasAttribute("aria-invalid")).toBe(false);
  expect(address.value).toBe(tabs[0].url);
  button('[data-browser-action="reload"]').click();
  expect(send.mock.calls[1][0]).toEqual({ action: "reload", tab: "page" });
});

it("shows a page's dialog to a watching owner, who must take control to answer it", () => {
  const { screen, send, toolbar, model } = setup();
  const dialog = { dialog_id: "d1", type: "confirm" as const, message: "Delete the draft?\nIt cannot be restored." };
  toolbar.draw({ ...model, dialog });
  const card = screen.querySelector<HTMLElement>(".host-browser-dialog")!;
  expect(card.hidden).toBe(false);
  expect(screen.hasAttribute("data-host-dialog")).toBe(true);
  expect(card.getAttribute("role")).toBe("alertdialog");
  expect(card.hasAttribute("data-readonly")).toBe(true);
  expect(card.querySelector(".host-browser-dialog-from")?.textContent).toBe(t("browser.dialogFrom", { p0: "sign-in.example.test" }));
  expect(card.querySelector(".host-browser-dialog-message")?.textContent).toBe(dialog.message);
  expect(card.querySelector(".host-browser-dialog-hint")?.textContent).toBe(t("browser.dialogTakeOver"));
  const buttons = [...card.querySelectorAll<HTMLButtonElement>("[data-dialog-answer]")];
  expect(buttons.map(button => [button.dataset.dialogAnswer, button.disabled])).toEqual([["dismiss", true], ["accept", true]]);
  buttons[1].click();
  expect(send).not.toHaveBeenCalled();
  toolbar.draw(model);
  expect(card.hidden).toBe(true);
  expect(screen.hasAttribute("data-host-dialog")).toBe(false);
});

it("lets the owner holding the tab answer a prompt, an alert and a confirm, once each", () => {
  const { screen, send, toolbar, model } = setup();
  const card = () => screen.querySelector<HTMLElement>(".host-browser-dialog")!;
  toolbar.draw({ ...model, dialog: { dialog_id: "p1", type: "prompt", message: "Enter the code", default_prompt: "000" } }, true);
  const answer = card().querySelector<HTMLInputElement>(".host-browser-dialog-answer")!;
  expect(answer.value).toBe("000");
  expect(document.activeElement).toBe(answer);
  expect(card().querySelector(".host-browser-dialog-hint")).toBeNull();
  expect(card().hasAttribute("data-readonly")).toBe(false);
  answer.value = "482913";
  answer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(send).toHaveBeenLastCalledWith({ action: "dialog", tab: "popup", dialog: "p1", accept: true, text: "482913" }, expect.any(Number));
  const [, id] = send.mock.calls[0];
  expect(card().querySelector<HTMLButtonElement>('[data-dialog-answer="accept"]')!.disabled).toBe(true);
  card().querySelector<HTMLButtonElement>('[data-dialog-answer="dismiss"]')!.click();
  expect(send).toHaveBeenCalledOnce();
  // Refused (the tab was handed back meanwhile), it can be answered again with what was typed.
  toolbar.result(id, false);
  expect(card().querySelector<HTMLInputElement>(".host-browser-dialog-answer")!.value).toBe("482913");
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  card().querySelector<HTMLInputElement>(".host-browser-dialog-answer")!.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(send).toHaveBeenLastCalledWith({ action: "dialog", tab: "popup", dialog: "p1", accept: false }, expect.any(Number));
  send.mockClear();
  toolbar.draw({ ...model, dialog: { dialog_id: "a1", type: "alert", message: "Saved" } }, true);
  expect([...card().querySelectorAll<HTMLButtonElement>("[data-dialog-answer]")].map(button => button.dataset.dialogAnswer)).toEqual(["accept"]);
  card().querySelector<HTMLButtonElement>('[data-dialog-answer="accept"]')!.click();
  expect(send).toHaveBeenLastCalledWith({ action: "dialog", tab: "popup", dialog: "a1", accept: true }, expect.any(Number));
  toolbar.draw({ ...model, dialog: { dialog_id: "c1", type: "confirm", message: "Leave the page?" } }, true);
  card().querySelector<HTMLButtonElement>('[data-dialog-answer="dismiss"]')!.click();
  expect(send).toHaveBeenLastCalledWith({ action: "dialog", tab: "popup", dialog: "c1", accept: false }, expect.any(Number));
});

it("says how much of a long dialog's message is left out between its two ends", () => {
  const { screen, toolbar, model } = setup();
  const card = screen.querySelector<HTMLElement>(".host-browser-dialog")!;
  toolbar.draw({ ...model, dialog: { dialog_id: "l1", type: "confirm", message: "Context.\n…\nPay $40 now?", omitted: 1712 } });
  expect(card.querySelector(".host-browser-dialog-omitted")?.textContent).toBe(t("browser.dialogOmitted", { p0: new Intl.NumberFormat(getLocale()).format(1712) }));
  toolbar.draw({ ...model, dialog: { dialog_id: "s1", type: "confirm", message: "Pay $40 now?" } });
  expect(card.querySelector(".host-browser-dialog-omitted")).toBeNull();
});

it("takes the owner's keys into an open dialog once they hold the tab, never while they watch", () => {
  const { screen, toolbar, model, address } = setup();
  const dialog = { dialog_id: "p2", type: "prompt" as const, message: "Enter the code" };
  toolbar.draw({ ...model, dialog });
  expect(toolbar.focusDialog()).toBe(false);
  // Taking control focuses the page after drawing: the open dialog keeps the keys, so Enter and Escape answer it.
  toolbar.draw({ ...model, dialog }, true);
  address.focus();
  expect(toolbar.focusDialog()).toBe(true);
  expect(document.activeElement).toBe(screen.querySelector(".host-browser-dialog-answer"));
  toolbar.draw(model, true);
  expect(toolbar.focusDialog()).toBe(false);
});
