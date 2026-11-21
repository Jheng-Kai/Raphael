// Recording a new shortcut: the keys are listened to on the whole window while the global hotkeys
// are paused, shown in the key caps as they are held, and handed back when they are let go. The
// shortcuts dialog (shortcut-editor.ts) records with it and keeps what was recorded until 儲存.

import { emptyNavKeyState, reduceNavKey } from "./nav-input";
import { bindNavLayer } from "./nav-layers";
import { t } from "./i18n";

import * as api from "./api";
import { describeError } from "./format";
import { KeyRecorder, bindingClash, bindingLabels, keyLabel } from "./keys";
import type { DeviceSettings } from "./types";
import { esc, keys, toaster } from "./ui";

/** The shortcuts that can be changed: every one but Esc, which cancels. */
export type HotkeyField = "dictation_keys" | "agent_keys" | "tidy_keys" | "paste_last_keys";

/** The keys of each shortcut, as the device settings hold them or as the dialog's draft does. */
export type ShortcutKeys = Partial<Pick<DeviceSettings, HotkeyField>>;

/**
 * The shortcuts in the order every list of them shows (Settings, the 聽寫 overview, the dialog): the most used first.
 * Esc, which cancels, comes after them and is no field.
 */
export const SHORTCUTS: ReadonlyArray<{ field: HotkeyField; name: () => string }> = [
  { field: "dictation_keys", name: () => t("home.020") },
  { field: "agent_keys", name: () => t("settings.agentKeys") },
  { field: "tidy_keys", name: () => t("settings.tidyKeys") },
  { field: "paste_last_keys", name: () => t("home.021") },
];

/** A shortcut's keys as caps, 「或」 between two combinations, or 尚未設定 when it has none. */
export const shortcutCaps = (bindings: readonly string[]): string =>
  bindings.length > 0
    ? bindings.map((binding) => keys(bindingLabels(binding))).join(t("common.or"))
    : `<span class="val">${esc(t("home.noKeys"))}</span>`;

/** The name of the other shortcut that already has `binding` in `keys`, if one has: no two actions share their keys. */
export function shortcutTakenBy(keys: ShortcutKeys, field: HotkeyField, binding: string): string | null {
  return bindingClash(binding, SHORTCUTS.filter((s) => s.field !== field).map((s) => [s.name(), keys[s.field] ?? []] as const));
}

export interface HotkeyRecording {
  /** Starts recording `field`, showing the keys in `cell`. Nothing happens while one is under way. */
  start(field: HotkeyField, cell: HTMLElement): Promise<void>;
  /** Whether a recording is under way: Escape belongs to it then. */
  active(): boolean;
  /** Drops a recording that is under way: the dialog went away. */
  cancel(): Promise<void>;
}

/**
 * `recorded` is handed the keys once they are all let go (Esc before any key, a lost focus or a step back hands nothing);
 * `ended` is told when a recording is over, recorded or not, so that the row is drawn again.
 */
export function createHotkeyRecording(recorded: (field: HotkeyField, codes: string[]) => void, ended: () => void): HotkeyRecording {
  let recording: { recorder: KeyRecorder; field: HotkeyField; cell: HTMLElement; finishing: boolean } | null = null;
  let nav = emptyNavKeyState();

  /** Whether the key is a step of the window's own (Alt+Left / Alt+Right, ⌘[ / ⌘] on a Mac): never a shortcut, it is left
   *  to the navigation (nav-input.ts), which steps the recording back or starts it again. */
  function navigates(e: KeyboardEvent): boolean {
    const result = reduceNavKey(nav, {
      code: e.code, type: e.type === "keyup" ? "keyup" : "keydown", repeat: e.repeat,
      altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, handled: false,
    });
    nav = result.state;
    return result.step !== null;
  }

  // On the window, in the capture phase: every other key reaches the recorder before anything of the page (the dialog's
  // own Escape included), and goes no further.
  function onKeyDown(e: KeyboardEvent): void {
    if (!recording || !e.code || e.code === "Unidentified" || navigates(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (recording.finishing) return;
    const result = recording.recorder.keyDown(e.code, { altGraph: e.getModifierState("AltGraph") });
    if (result.type === "cancel") void end();
    else if (result.type === "progress") recording.cell.innerHTML = keys(result.codes.map(keyLabel));
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (!recording) return;
    navigates(e);
    e.preventDefault();
    e.stopPropagation();
    if (recording.finishing) return;
    const result = recording.recorder.keyUp(e.code);
    if (result?.type === "done") void finish(result.codes);
  }

  /** The window lost focus: the key-up events would not arrive, so the recording is dropped. */
  const onBlur = (): void => void end();

  /** Stops listening and lets the hotkeys work again. */
  async function end(): Promise<void> {
    if (!recording) return;
    recording = null;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    try {
      await api.hotkeysPause(false);
    } catch (err) {
      toaster.info(describeError(err));
    }
    ended();
  }

  async function finish(codes: string[]): Promise<void> {
    if (!recording || recording.finishing) return;
    recording.finishing = true;
    recorded(recording.field, codes);
    await end();
  }

  async function start(field: HotkeyField, cell: HTMLElement): Promise<void> {
    if (recording) return;
    try {
      await api.hotkeysPause(true);
    } catch (err) {
      toaster.info(describeError(err));
      return;
    }
    recording = { recorder: new KeyRecorder(), field, cell, finishing: false };
    nav = emptyNavKeyState();
    cell.innerHTML = t("settings.084");
    bindNavLayer(cell, () => void end(), {
      active: () => recording?.cell === cell,
      step(direction) {
        if (direction !== "forward" || !recording) return false;
        // The navigation chord may already have supplied its modifier to the recorder.
        recording.recorder = new KeyRecorder();
        cell.innerHTML = t("settings.084");
        return true;
      },
    });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
  }

  return { start, active: () => recording !== null, cancel: end };
}
