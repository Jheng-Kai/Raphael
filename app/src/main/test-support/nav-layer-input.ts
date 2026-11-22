import { hasOpenLayer, stepOpenLayer } from "../dismissals";
import type { NavStep } from "../nav-history";
import { installNavInput } from "../nav-input";

export const navInputs = ["mouse", "keyboard"] as const;
export type Input = typeof navInputs[number];

export function sendNavInput(input: Input, direction: NavStep): void {
  const target = document.activeElement?.isConnected ? document.activeElement : document.body;
  if (input === "mouse") {
    const button = direction === "back" ? 3 : 4;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "auxclick"]) {
      target.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
    }
  } else {
    const arrow = direction === "back" ? "ArrowLeft" : "ArrowRight";
    for (const [type, code] of [["keydown", "AltLeft"], ["keydown", arrow], ["keyup", arrow], ["keyup", "AltLeft"]]) {
      target.dispatchEvent(new KeyboardEvent(type, { code, key: code === "AltLeft" ? "Alt" : code, altKey: type === "keydown" || code === arrow, bubbles: true, cancelable: true }));
    }
  }
}

/** Drive the installed listeners with the current focus and a real, non-empty page history. */
export function pressLayer(input: Input, direction: NavStep = "back"): void {
  let handled = false;
  const stop = installNavInput(window, step => { handled = stepOpenLayer(step); }, hasOpenLayer);
  try {
    sendNavInput(input, direction);
    if (!handled) throw new Error("No layer took the navigation press");
  } finally { stop(); }
}
