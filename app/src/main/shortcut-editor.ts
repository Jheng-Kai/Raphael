// 編輯快捷鍵: the one place where the shortcuts are changed. Settings › 聽寫與快捷鍵 and the 聽寫 overview list them
// read-only, each with a 編輯 at the top right of its list that opens this dialog (the app's own, member-dialogs.ts).
// Its rows are the list's rows: a name at the left and key caps at the right, with no frame, and every shortcut but Esc has
// a pencil after its caps. The pencil records new keys (hotkey-recording.ts) into a draft, the caps giving way to the words
// that ask for them meanwhile, and 儲存 sends what changed to the device settings in one patch, where the shell refuses a
// combination two actions would share; its refusal is said in the dialog, which stays open. Esc, × and 取消 close it with
// nothing saved.

import { t } from "./i18n";
import { describeError } from "./format";
import { type HotkeyField, type ShortcutKeys, SHORTCUTS, createHotkeyRecording, shortcutCaps, shortcutTakenBy } from "./hotkey-recording";
import { bindingFromCodes, validateCodes } from "./keys";
import { type Dialog, openDialog } from "./member-dialogs";
import type { AppContext, DeviceSettings } from "./types";
import { btn, esc, iconBtn, row } from "./ui";
import "./shortcut-editor.css";

/** A row as the lists draw it (`row-shortcut`): the name, then the caps and, for a shortcut that can be changed, its pencil. */
const keyRow = (name: string, bindings: readonly string[], field?: HotkeyField): string =>
  row(esc(name), "", `<span class="caps">${shortcutCaps(bindings)}</span>` +
    (field ? iconBtn("pencil", t("keys.change", { p0: name }), ` data-dlg="record" data-field="${field}"`) : ""),
  { cls: `row-shortcut kd-row${field ? "" : " kd-fixed"}`, attrs: field ? ` data-kd-row="${field}"` : "" });

/** The dialog's rows: each shortcut with its keys and the pencil that records new ones, then Esc, which stays. */
export function shortcutEditorHTML(draft: ShortcutKeys): string {
  const rows = SHORTCUTS.map(({ field, name }) => keyRow(name(), draft[field] ?? [], field)).join("");
  return `<div class="kd-list">${rows}${keyRow(t("common.cancel"), ["Escape"])}</div><p class="kd-error" role="alert" hidden></p>`;
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
      else if (act === "record") record(target.dataset.field as HotkeyField);
    },
    // A recording owns Escape and the presses until it ends; a save under way finishes first.
    canClose: () => !busy && !recording.active(),
    onClosing: () => { void recording.cancel(); },
  });
  const error = dialog.el.querySelector<HTMLElement>(".kd-error")!;
  const say = (text: string): void => { error.textContent = text; error.hidden = !text; };

  const rowOf = (field: HotkeyField): HTMLElement | null => dialog.el.querySelector<HTMLElement>(`[data-kd-row="${field}"]`);

  function paintRow(field: HotkeyField | null): void {
    if (!field) return;
    const line = rowOf(field);
    line?.removeAttribute("data-recording");
    const caps = line?.querySelector<HTMLElement>(".caps");
    if (caps) caps.innerHTML = shortcutCaps(draft[field] ?? []);
    recordingField = null;
  }

  /** The pencil was pressed: the row's caps give way to the words that ask for the new keys, and the focus stays on it. */
  function record(field: HotkeyField): void {
    const line = rowOf(field);
    if (busy || recording.active() || !line) return;
    say("");
    recordingField = field;
    line.setAttribute("data-recording", "");
    void recording.start(field, line.querySelector<HTMLElement>(".caps")!).then(() => {
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
