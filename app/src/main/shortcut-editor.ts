// 編輯快捷鍵: the one place where the shortcuts are changed. Settings › 聽寫與快捷鍵 and the 聽寫 overview list them
// read-only, each with a 編輯 at the top right of its list that opens this dialog (the app's own, member-dialogs.ts).
// Every shortcut but Esc has its keys on a button: pressed, it records new ones (hotkey-recording.ts) into a draft, and
// 儲存 sends what changed to the device settings in one patch, where the shell refuses a combination two actions would
// share; its refusal is said in the dialog, which stays open. Esc, × and 取消 close it with nothing saved.

import { t } from "./i18n";
import { describeError } from "./format";
import { type HotkeyField, type ShortcutKeys, SHORTCUTS, createHotkeyRecording, shortcutCaps, shortcutTakenBy } from "./hotkey-recording";
import { bindingFromCodes, validateCodes } from "./keys";
import { type Dialog, openDialog } from "./member-dialogs";
import type { AppContext, DeviceSettings } from "./types";
import { btn, esc } from "./ui";
import "./shortcut-editor.css";

/** The dialog's rows: each shortcut's name and its keys on the button that records new ones, then Esc, which stays. */
export function shortcutEditorHTML(draft: ShortcutKeys): string {
  const rows = SHORTCUTS.map(({ field, name }) =>
    `<div class="kd-row" data-kd-row="${field}"><span class="kd-name">${esc(name())}</span>` +
    btn(`<span class="caps">${shortcutCaps(draft[field] ?? [])}</span>`, "kd-rec",
      ` data-dlg="record" data-field="${field}" aria-label="${esc(t("keys.change", { p0: name() }))}"`) +
    `</div>`).join("");
  const cancel = `<div class="kd-row kd-fixed"><span class="kd-name">${esc(t("common.cancel"))}</span><span class="kd-esc">${shortcutCaps(["Escape"])}</span></div>`;
  return `<div class="kd-list">${rows}${cancel}</div><p class="kd-error" role="alert" hidden></p>`;
}

/** The fields whose keys the draft changed, as the patch that saves them. */
export function changedKeys(draft: ShortcutKeys, device: DeviceSettings): ShortcutKeys {
  const patch: ShortcutKeys = {};
  for (const { field } of SHORTCUTS) {
    const now = draft[field] ?? [], was = device[field] ?? [];
    if (now.length !== was.length || now.some((binding, at) => binding !== was[at])) patch[field] = [...now];
  }
  return patch;
}

/** Opens the dialog over the window; `saved` is told after a save went through, so that the list is drawn again. */
export function openShortcutEditor(app: Pick<AppContext, "device" | "setDevice">, saved: () => void): Dialog {
  const draft: ShortcutKeys = Object.fromEntries(SHORTCUTS.map(({ field }) => [field, [...(app.device()[field] ?? [])]]));
  let busy = false;
  let recordingField: HotkeyField | null = null;
  const recording = createHotkeyRecording((field, codes) => take(field, codes), () => paintRow(recordingField));
  const dialog = openDialog({
    title: t("keys.editTitle"),
    cls: "mb-confirm kd-dialog",
    body: shortcutEditorHTML(draft),
    actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("keys.save")), attrs: ' data-dlg="save"' } },
    onAct(act, target) {
      if (act === "cancel") { if (!busy && !recording.active()) dialog.close(); }
      else if (act === "save") void save();
      else if (act === "record") record(target.dataset.field as HotkeyField, target);
    },
    // A recording owns Escape and the presses until it ends; a save under way finishes first.
    canClose: () => !busy && !recording.active(),
    onClosing: () => { void recording.cancel(); },
  });
  const error = dialog.el.querySelector<HTMLElement>(".kd-error")!;
  const say = (text: string): void => { error.textContent = text; error.hidden = !text; };

  function paintRow(field: HotkeyField | null): void {
    if (!field) return;
    const button = dialog.el.querySelector<HTMLElement>(`[data-dlg="record"][data-field="${field}"]`);
    button?.removeAttribute("data-recording");
    const caps = button?.querySelector<HTMLElement>(".caps");
    if (caps) caps.innerHTML = shortcutCaps(draft[field] ?? []);
    recordingField = null;
  }

  function record(field: HotkeyField, button: HTMLElement): void {
    if (busy || recording.active()) return;
    say("");
    recordingField = field;
    button.setAttribute("data-recording", "");
    void recording.start(field, button.querySelector<HTMLElement>(".caps")!).then(() => {
      // The hotkeys could not be paused: nothing is being recorded.
      if (!recording.active() && recordingField === field) paintRow(field);
    });
  }

  /** The keys just let go: a combination that is no good, or that another shortcut of the draft has, is said and kept out. */
  function take(field: HotkeyField, codes: string[]): void {
    const problem = validateCodes(codes);
    if (problem) { say(problem); return; }
    const binding = bindingFromCodes(codes);
    const taken = shortcutTakenBy(draft, field, binding);
    if (taken) { say(t("settings.keyTaken", { p0: taken })); return; }
    draft[field] = [binding];
  }

  async function save(): Promise<void> {
    if (busy || recording.active()) return;
    const patch = changedKeys(draft, app.device());
    if (!Object.keys(patch).length) { dialog.close(); return; }
    busy = true;
    const buttons = [...dialog.el.querySelectorAll<HTMLButtonElement>("button")];
    for (const button of buttons) button.disabled = true;
    say("");
    try {
      await app.setDevice(patch);
      busy = false;
      dialog.close();
      saved();
    } catch (err) {
      say(describeError(err));
    } finally {
      busy = false;
      if (dialog.el.isConnected) for (const button of buttons) button.disabled = false;
    }
  }

  return dialog;
}
