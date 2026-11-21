// @vitest-environment happy-dom
// 編輯快捷鍵 (shortcut-editor.ts): the one place where the shortcuts are changed, through the real key recorder and dialog.
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ hotkeysPause: vi.fn(async () => {}) }));
vi.mock("./api", () => api);
import { setLocale, t } from "./i18n";
import { openShortcutEditor } from "./shortcut-editor";
import type { DeviceSettings } from "./types";

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  setLocale("zh-TW");
});

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function open(refuse?: string) {
  let current = {
    dictation_keys: ["AltRight"], paste_last_keys: ["AltRight+V"], agent_keys: ["AltRight+Space"], tidy_keys: ["AltRight+T"],
  } as DeviceSettings;
  const app = {
    device: () => current,
    setDevice: vi.fn(async (patch: Partial<DeviceSettings>) => {
      if (refuse) throw new Error(refuse);
      current = { ...current, ...patch };
      return current;
    }),
  };
  const saved = vi.fn();
  const dialog = openShortcutEditor(app, saved);
  return { app, saved, dialog, el: dialog.el };
}

const button = (el: HTMLElement, field: string): HTMLButtonElement => el.querySelector<HTMLButtonElement>(`[data-dlg="record"][data-field="${field}"]`)!;
const rowOf = (el: HTMLElement, field: string): HTMLElement => el.querySelector<HTMLElement>(`.kd-row[data-kd-row="${field}"]`)!;
const capsOf = (el: HTMLElement, field: string): string[] => [...rowOf(el, field).querySelectorAll(".caps kbd")].map((cap) => cap.textContent ?? "");
/** Presses the keys in order, then lets them go in reverse, as a person does. */
function chord(...codes: string[]): void {
  const target = document.activeElement ?? document.body;
  for (const code of codes) target.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true }));
  for (const code of [...codes].reverse()) target.dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true, cancelable: true }));
}
async function record(el: HTMLElement, field: string, ...codes: string[]): Promise<void> {
  button(el, field).click();
  await flush();
  chord(...codes);
  await flush();
}

test("lists all five shortcuts in the order of use as the lists' rows, every one but Esc with a pencil that records new keys", () => {
  const { el } = open();
  expect(el.getAttribute("role")).toBe("dialog");
  expect(el.querySelector("h2")?.textContent).toBe("編輯快捷鍵");
  const rows = [...el.querySelectorAll<HTMLElement>(".kd-list > .row")];
  expect(rows.map((line) => line.querySelector(".lbl .t")?.textContent)).toEqual(["聽寫", "問拉斐爾", "整理選取文字", "貼上上一次", "取消"]);
  // The rows of the read-only lists (`row-shortcut`): the caps stand in the row itself, never on a framed button.
  expect(rows.every((line) => line.matches(".row.row-shortcut") && line.querySelector(".ctl > .caps"))).toBe(true);
  expect(el.querySelector(".kd-list .btn:not(.icon), .kd-list .caps button")).toBeNull();
  const pencils = [...el.querySelectorAll<HTMLElement>('[data-dlg="record"]')];
  expect(pencils.map((b) => b.dataset.field)).toEqual(["dictation_keys", "agent_keys", "tidy_keys", "paste_last_keys"]);
  expect(pencils.every((b) => b.matches(".ctl > .caps + .btn.icon.row") && b.querySelector("svg.i") && b.textContent === "")).toBe(true);
  // 貼上上一次 can be changed like the others; Esc cancels and stays.
  expect(capsOf(el, "paste_last_keys")).toEqual(["右 Alt", "V"]);
  expect(button(el, "paste_last_keys").getAttribute("aria-label")).toBe("變更「貼上上一次」的按鍵");
  expect(el.querySelector(".kd-fixed button")).toBeNull();
  expect(el.querySelector(".kd-fixed .caps kbd")?.textContent).toBe("Esc");
  expect([...el.querySelectorAll(".mb-dlg-act .btn")].map((b) => b.textContent)).toEqual(["取消", "儲存"]);
});

test("a recorded key waits in the dialog, and 儲存 sends what changed through the device settings and closes it", async () => {
  const { app, saved, el } = open();
  button(el, "paste_last_keys").click();
  await flush();
  expect(api.hotkeysPause).toHaveBeenLastCalledWith(true);
  // The caps give way to the words that ask for the keys, in the row itself; the pencil stays where it was.
  expect(rowOf(el, "paste_last_keys").hasAttribute("data-recording")).toBe(true);
  expect(rowOf(el, "paste_last_keys").querySelector(".caps")?.textContent).toContain("按下新的按鍵");
  expect(rowOf(el, "paste_last_keys").querySelector(".caps kbd")).toBeNull();
  expect(button(el, "paste_last_keys").isConnected).toBe(true);
  chord("ControlRight", "F8");
  await flush();
  expect(api.hotkeysPause).toHaveBeenLastCalledWith(false);
  expect(capsOf(el, "paste_last_keys").slice(-1)).toEqual(["F8"]);
  expect(rowOf(el, "paste_last_keys").hasAttribute("data-recording")).toBe(false);
  expect(app.setDevice).not.toHaveBeenCalled();
  el.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
  await flush();
  expect(app.setDevice).toHaveBeenCalledExactlyOnceWith({ paste_last_keys: ["ControlRight+F8"] });
  expect(el.isConnected).toBe(false);
  expect(saved).toHaveBeenCalledOnce();
});

test("the shell's refusal is said in the dialog, which stays open with nothing saved", async () => {
  const { app, saved, el } = open("聽寫和貼上上一次聽寫不能用同一組按鍵");
  await record(el, "dictation_keys", "F9");
  el.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
  await flush();
  expect(app.setDevice).toHaveBeenCalledExactlyOnceWith({ dictation_keys: ["F9"] });
  const said = el.querySelector<HTMLElement>(".kd-error")!;
  expect(said.hidden).toBe(false);
  expect(said.getAttribute("role")).toBe("alert");
  expect(said.textContent).toBe(t("backend.conflictingKeys"));
  expect(el.isConnected).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  expect(el.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.disabled).toBe(false);
});

test("Esc stops recording before it closes the dialog and Cancel discards edits", async () => {
  const { app, saved, el } = open();
  button(el, "dictation_keys").click();
  await flush();
  chord("Escape");
  await flush();
  expect(el.isConnected).toBe(true);
  expect(capsOf(el, "dictation_keys")).toEqual(["右 Alt"]);
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  expect(el.isConnected).toBe(false);
  const again = open();
  await record(again.el, "dictation_keys", "F9");
  again.el.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
  expect(again.el.isConnected).toBe(false);
  for (const one of [app, again.app]) expect(one.setDevice).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
});

test("duplicate and invalid shortcuts are refused and reassigned keys save in one patch", async () => {
  const { app, el } = open();
  await record(el, "tidy_keys", "AltRight", "Space");
  expect(el.querySelector(".kd-error")?.textContent).toBe("這組按鍵已經是「問拉斐爾」的快捷鍵");
  expect(capsOf(el, "tidy_keys")).toEqual(["右 Alt", "T"]);
  await record(el, "tidy_keys", "KeyV");
  expect(el.querySelector(".kd-error")?.textContent).toBe(t("keys.006"));
  // Recording again clears what was said; the question key gives its keys up, and the tidy key takes them.
  await record(el, "agent_keys", "F9");
  expect(el.querySelector<HTMLElement>(".kd-error")!.hidden).toBe(true);
  await record(el, "tidy_keys", "AltRight", "Space");
  el.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
  await flush();
  expect(app.setDevice).toHaveBeenCalledExactlyOnceWith({ agent_keys: ["F9"], tidy_keys: ["AltRight+Space"] });
});

test("儲存 with nothing changed closes without writing, and the dialog speaks the window's language", async () => {
  const { app, el } = open();
  el.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
  await flush();
  expect(el.isConnected).toBe(false);
  expect(app.setDevice).not.toHaveBeenCalled();
  setLocale("en");
  const english = open().el;
  expect(english.querySelector("h2")?.textContent).toBe("Edit shortcuts");
  expect(button(english, "paste_last_keys").getAttribute("aria-label")).toBe("Change the keys for Paste last dictation");
});
