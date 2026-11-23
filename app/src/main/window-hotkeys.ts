// Focused-main-window fallback for keyboard input the global hook does not receive.
// Kept independent of pages so the first-run try box uses the same listener.
import { invoke } from "@tauri-apps/api/core";
import { canonicalKey } from "./keys";
import { IS_MAC } from "../shared/platform";

export type WindowHotkey = "dictation_down" | "dictation_up" | "dictation_prefix_down" | "dictation_prefix_up" |
  "dictation_blur" | "paste_last" | "tidy" | "cancel" | "cancel_key" | "agent_down" | "agent_up";
/** `agent_keys` and `tidy_keys` are missing from the settings of an app that does not know those keys yet. */
interface Bindings { dictation_keys: string[]; paste_last_keys: string[]; agent_keys?: string[]; tidy_keys?: string[] }
export interface KeyInput {
  code: string;
  type: "keydown" | "keyup";
  repeat: boolean;
  altGraph: boolean;
}
interface HotkeyState {
  held: string[];
  swallowed: string[];
  dictation: string[];
  dictationPrefix: boolean;
  agent: string[];
}

const MODIFIERS = new Set([
  "altleft", "altright", "controlleft", "controlright",
  "shiftleft", "shiftright", "metaleft", "metaright",
]);

export const emptyHotkeyState = (): HotkeyState => ({ held: [], swallowed: [], dictation: [], dictationPrefix: false, agent: [] });

// Settings records browser codes; device.json's default uses the alias V (see canonicalKey).
// Legacy handy-keys aliases beyond letters/digits and these modifiers are not supported here.
const codeName = canonicalKey;

// Older device files can spell Alt+Space with the native modifier aliases. Resolve those to
// browser codes so the window recognizes the same quick-ask chord as the system menu guard.
function windowsAgentBindings(bindings: string[]): string[] {
  return bindings.flatMap((binding) => {
    const parts = binding.split("+").map(codeName);
    if (!parts.includes("space")) return [binding];
    const normalized = parts.map((part) => {
      if (/^(opt|option)$/.test(part)) return "alt";
      if (/^(?:(?:alt|opt|option)_?left|l(?:alt|opt|option))$/.test(part)) return "altleft";
      if (/^(?:(?:alt|opt|option)_?right|r(?:alt|opt|option)|altgr)$/.test(part)) return "altright";
      return part;
    });
    if (!normalized.includes("alt")) return [normalized.join("+")];
    return ["altleft", "altright"].map((side) => normalized.map((part) => part === "alt" ? side : part).join("+"));
  });
}

function matchBinding(bindings: string[], held: string[], code: string): string[] | undefined {
  return bindings.map((binding) => binding.split("+").map(codeName)).find((parts) =>
    parts.includes(code) && parts.every((part) => held.includes(part)) &&
    held.filter((part) => MODIFIERS.has(part)).every((part) => parts.includes(part)),
  );
}

/** Pure keyboard transition. The worker checks pauses, cancel enablement and hook duplicates again. */
export function reduceHotkey(previous: HotkeyState, event: KeyInput, bindings: Bindings, paused = false, mac = IS_MAC): {
  state: HotkeyState; actions: WindowHotkey[]; preventDefault: boolean;
} {
  if (paused) return { state: emptyHotkeyState(), actions: [], preventDefault: false };
  const code = codeName(event.code);
  const state: HotkeyState = {
    held: previous.held.filter((part) => part !== code),
    swallowed: [...previous.swallowed],
    dictation: [...previous.dictation],
    dictationPrefix: previous.dictationPrefix,
    agent: [...previous.agent],
  };
  const actions: WindowHotkey[] = [];
  let preventDefault = state.swallowed.includes(code);
  if (event.type === "keyup") {
    // macOS sends no release for a key let go while ⌘ is down (⌘V): with ⌘'s own release, the keys still held are
    // its modifiers alone, or a V left behind would keep the next Right Option+V from being a press.
    if (mac && (code === "metaleft" || code === "metaright")) state.held = state.held.filter((part) => MODIFIERS.has(part));
    if (state.dictation.includes(code)) {
      actions.push(state.dictationPrefix ? "dictation_prefix_up" : "dictation_up");
      state.dictation = [];
      state.dictationPrefix = false;
    }
    if (state.agent.includes(code)) {
      actions.push("agent_up");
      state.agent = [];
    }
    state.swallowed = state.swallowed.filter((part) => part !== code);
  } else {
    state.held.push(code);
    const agentBindings = mac ? bindings.agent_keys ?? [] : windowsAgentBindings(bindings.agent_keys ?? []);
    // AltGr produces a synthetic left Ctrl before Right Alt on Windows.
    if (event.altGraph && state.held.includes("altright")) {
      state.held = state.held.filter((part) => part !== "controlleft");
    }
    // Swallow Alt before the rest of a configured chord arrives, including its release, so
    // an Alt-only tap or repeat cannot activate WebView2's menu handling.
    if ((code === "altright" || code === "altleft") &&
      [...bindings.dictation_keys, ...bindings.paste_last_keys, ...agentBindings, ...(bindings.tidy_keys ?? [])].some((binding) =>
        binding.split("+").map(codeName).includes(code))) {
      if (!state.swallowed.includes(code)) state.swallowed.push(code);
      preventDefault = true;
    }
    if (!event.repeat && !previous.held.includes(code)) {
      if (code === "escape") {
        actions.push("cancel");
        // Preserve idle Escape (e.g. closing settings). Only the worker knows whether dictation
        // is active; it ignores Cancel while idle. Alt and paste keys are always suppressed.
      } else {
        const dictation = matchBinding(bindings.dictation_keys, state.held, code);
        const paste = matchBinding(bindings.paste_last_keys, state.held, code);
        const agent = matchBinding(agentBindings, state.held, code);
        const tidy = matchBinding(bindings.tidy_keys ?? [], state.held, code);
        if (dictation && state.dictation.length === 0) {
          state.dictation = dictation;
          state.dictationPrefix = dictation.every(part => MODIFIERS.has(part)) &&
            agentBindings.some(binding => {
              const parts = binding.split("+").map(codeName);
              return parts.length === dictation.length + 1 &&
                parts.some(part => !MODIFIERS.has(part)) && dictation.every(part => parts.includes(part));
            });
          actions.push(state.dictationPrefix ? "dictation_prefix_down" : "dictation_down");
        }
        if (paste) actions.push("paste_last");
        // Like paste_last, tidy is a press with no release action.
        if (tidy) actions.push("tidy");
        // Either key can go down first. The worker resolves the shared dictation prefix.
        if (agent && state.agent.length === 0) {
          state.agent = agent;
          actions.push("agent_down");
        }
        if (dictation || paste || agent || tidy) {
          state.swallowed.push(code);
          preventDefault = true;
        }
      }
    }
  }
  return { state, actions, preventDefault };
}

let recorderPaused = false;
let pauseGeneration = 0;
let voiceCapture = false;

/**
 * Where the voice is, as the app tells the window. While a recording or a dictation's transcription is under way, one Esc
 * ends it. A question being answered keeps the two presses of the shared gesture.
 */
export function followDictation(phase: string, agent: boolean): void {
  voiceCapture = phase === "listening" || (phase === "processing" && !agent);
}

/** Called before recorder IPC so capture listeners never steal the key being recorded. */
export function setWindowHotkeysPaused(paused: boolean): boolean {
  const previous = recorderPaused;
  recorderPaused = paused;
  pauseGeneration++;
  return previous;
}

/** Keep capture paused throughout recorder IPC, restoring it if the update fails. */
export async function withWindowHotkeyPause(paused: boolean, update: () => Promise<void>): Promise<void> {
  const previous = setWindowHotkeysPaused(true);
  try {
    await update();
  } catch (err) {
    setWindowHotkeysPaused(previous);
    throw err;
  }
  setWindowHotkeysPaused(paused);
}

/** Install once on the main window, before either normal pages or onboarding is mounted. */
export function installWindowHotkeys(
  bindings: () => Bindings,
  target: EventTarget = window,
  send: (kind: WindowHotkey) => Promise<unknown> = (kind) => invoke("window_hotkey", { kind }),
): () => void {
  let state = emptyHotkeyState();
  let generation = pauseGeneration;
  const forward = (action: WindowHotkey): void => {
    void send(action).catch((err) => console.warn("window hotkey could not be forwarded", err));
  };
  const handle = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    // With this window in front the global hook may not hear the keyboard (seen live), and then only this page hears
    // Esc. The press is spent here: should the session's end ever go unreported, the next Esc is the page's again.
    if (event.code === "Escape" && event.type === "keydown" && !event.repeat && voiceCapture && !recorderPaused) {
      voiceCapture = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      forward("cancel_key");
      return;
    }
    if (generation !== pauseGeneration) {
      state = emptyHotkeyState();
      generation = pauseGeneration;
    }
    const result = reduceHotkey(state, {
      code: event.code, type: event.type as KeyInput["type"], repeat: event.repeat,
      altGraph: event.getModifierState("AltGraph"),
    }, bindings(), recorderPaused);
    state = result.state;
    if (result.preventDefault && !result.actions.includes("cancel")) event.preventDefault();
    result.actions.filter(action => action !== "cancel").forEach(forward);
  };
  const blur = (): void => {
    // A hold that loses focus will not necessarily receive its DOM key-up.
    if (!recorderPaused && state.dictation.length > 0) forward(state.dictationPrefix ? "dictation_blur" : "dictation_up");
    if (!recorderPaused && state.agent.length > 0) forward("agent_up");
    state = emptyHotkeyState();
  };
  const capture = { capture: true };
  target.addEventListener("keydown", handle, capture);
  target.addEventListener("keyup", handle, capture);
  target.addEventListener("blur", blur);
  return () => {
    target.removeEventListener("keydown", handle, capture);
    target.removeEventListener("keyup", handle, capture);
    target.removeEventListener("blur", blur);
  };
}
