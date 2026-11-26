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

it("shows the site's sign-in prompt and sends the owner's user name and password only while they hold the tab", () => {
  const { screen, send, toolbar, model } = setup();
  const card = () => screen.querySelector<HTMLElement>(".host-browser-dialog")!;
  const fields = () => [...card().querySelectorAll<HTMLInputElement>(".host-browser-dialog-answer")];
  const auth = { auth_id: "a1", origin: "https://intranet.example.test", realm: "Staff", scheme: "basic" };
  toolbar.draw({ ...model, auth });
  expect(card().hidden).toBe(false);
  expect(card().querySelector(".host-browser-dialog-from")?.textContent).toBe(t("browser.authFrom", { p0: "intranet.example.test" }));
  expect(card().querySelector(".host-browser-dialog-message")?.textContent).toBe("Staff");
  expect(card().querySelector(".host-browser-dialog-hint")?.textContent).toBe(t("browser.authTakeOver"));
  expect(fields().map(field => [field.dataset.field, field.type, field.disabled])).toEqual([["username", "text", true], ["password", "password", true]]);
  toolbar.draw({ ...model, auth }, true);
  expect(document.activeElement).toBe(fields()[0]);
  fields()[0].value = "staff";
  fields()[1].value = "s3cret";
  // A redraw of the same prompt keeps what was typed.
  toolbar.draw({ ...model, auth, back: false }, true);
  expect(fields().map(field => field.value)).toEqual(["staff", "s3cret"]);
  fields()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(send).toHaveBeenLastCalledWith({ action: "auth", tab: "popup", auth: "a1", accept: true, username: "staff", password: "s3cret" }, expect.any(Number));
  // Sent to Chrome, the password no longer stays in the card.
  expect(fields().map(field => field.value)).toEqual(["staff", ""]);
  // A new prompt starts empty; cancelling it sends no user name or password.
  toolbar.draw({ ...model, auth: { ...auth, auth_id: "a2" } }, true);
  expect(fields().map(field => field.value)).toEqual(["", ""]);
  card().querySelector<HTMLButtonElement>('[data-dialog-answer="dismiss"]')!.click();
  expect(send).toHaveBeenLastCalledWith({ action: "auth", tab: "popup", auth: "a2", accept: false }, expect.any(Number));
  // A JavaScript dialog holds the page, so it comes first.
  toolbar.draw({ ...model, auth, dialog: { dialog_id: "d9", type: "alert", message: "Saved" } }, true);
  expect(card().querySelector(".host-browser-dialog-message")?.textContent).toBe("Saved");
  // A prompt gone takes what was typed along.
  toolbar.draw({ ...model, auth: { ...auth, auth_id: "a3" } }, true);
  fields()[1].value = "typed";
  toolbar.draw(model, true);
  expect(card().hidden).toBe(true);
  expect(card().querySelectorAll("input")).toHaveLength(0);
});

it("lets the owner holding the tab choose files for a page's file chooser, or close it", async () => {
  const screen = document.createElement("div");
  document.body.append(screen);
  const send = vi.fn();
  const store = vi.fn(async (file: File) => `stored-${file.name}`);
  const toolbar = mountHostBrowserToolbar(screen, send, store);
  const model: HostBrowserModel = { tabs, shown: "popup", back: true, forward: false };
  const card = () => screen.querySelector<HTMLElement>(".host-browser-dialog")!;
  const accept = () => card().querySelector<HTMLButtonElement>('[data-dialog-answer="accept"]')!;
  const picker = screen.querySelector<HTMLInputElement>(".host-browser-picker")!;
  const choose = (...files: File[]) => {
    Object.defineProperty(picker, "files", { configurable: true, value: files });
    picker.dispatchEvent(new Event("change"));
  };
  const opened = vi.spyOn(picker, "click").mockImplementation(() => {});
  const chooser = { chooser_id: "c1", mode: "multiple" as const };
  toolbar.draw({ ...model, chooser });
  expect(card().querySelector(".host-browser-dialog-from")?.textContent).toBe(t("browser.chooserFrom", { p0: "sign-in.example.test" }));
  expect(card().querySelector(".host-browser-dialog-hint")?.textContent).toBe(t("browser.chooserTakeOver"));
  expect(accept().disabled).toBe(true);
  toolbar.draw({ ...model, chooser }, true);
  expect(picker.multiple).toBe(true);
  accept().click();
  expect(opened).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  // Files not stored: the chooser can be answered again.
  store.mockRejectedValueOnce(new Error("too large"));
  choose(new File(["a"], "a.pdf"));
  await vi.waitFor(() => expect(accept().disabled).toBe(false));
  expect(send).not.toHaveBeenCalled();
  // Files picked for this chooser go nowhere once the view has left it: another tab's chooser never gets them.
  accept().click();
  toolbar.draw({ ...model, shown: "page", chooser: { chooser_id: "c9", mode: "multiple" } }, true);
  choose(new File(["a"], "a.pdf"));
  // Nor does the chooser that replaced it on the same tab.
  toolbar.draw({ ...model, chooser }, true);
  accept().click();
  toolbar.draw({ ...model, chooser: { chooser_id: "c7", mode: "multiple" } }, true);
  choose(new File(["a"], "a.pdf"));
  await Promise.resolve();
  expect(store).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  toolbar.draw({ ...model, chooser }, true);
  accept().click();
  choose(new File(["a"], "a.pdf"), new File(["b"], "b.pdf"));
  await vi.waitFor(() => expect(send).toHaveBeenCalled());
  expect(send).toHaveBeenLastCalledWith({ action: "upload", tab: "popup", chooser: "c1",
    files: [{ stored_id: "stored-a.pdf", name: "a.pdf" }, { stored_id: "stored-b.pdf", name: "b.pdf" }] }, expect.any(Number));
  expect(accept().disabled).toBe(true);
  toolbar.draw({ ...model, chooser: { chooser_id: "c2", mode: "single" } }, true);
  expect(picker.multiple).toBe(false);
  card().querySelector<HTMLButtonElement>('[data-dialog-answer="dismiss"]')!.click();
  expect(send).toHaveBeenLastCalledWith({ action: "chooser", tab: "popup", chooser: "c2" }, expect.any(Number));
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
