// Keys that belong to an input method (IME): the keys pressed while Chinese or Japanese is being
// composed, and the Enter, Escape or arrow key that picks or drops a candidate.
//
// Chromium (WebView2, Windows) fires those keydowns with `isComposing` set. WebKit (WKWebView,
// macOS) fires the key that ends a composition after `compositionend`, with `isComposing` false and
// only keyCode 229 telling it apart, so a handler that checks `isComposing` alone sends a message on
// the Enter that only picked a candidate.

/** Whether a keydown belongs to an input method rather than to the page. */
export const fromIme = (event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean =>
  event.isComposing || event.keyCode === 229;

/** The keys the page's own handlers act on in a text field; letters and modifiers still pass. */
const ACTION_KEYS = new Set([
  "Enter", "Escape", "Tab", " ", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
]);

function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches("input, textarea") || target.isContentEditable);
}

/**
 * Keeps an input method's action keys in a text field from the page's own key handlers: installed
 * on the window in the capture phase before any other, so that no handler of Enter, Escape or the
 * arrows (a send, a dialog that closes, a list that moves) sees the key that picked a candidate,
 * whether it checks for composition itself or not. The key still reaches the field and its input
 * method; nothing is prevented.
 */
export function guardImeKeys(target: Window = window): () => void {
  const guard = (event: KeyboardEvent): void => {
    if (fromIme(event) && ACTION_KEYS.has(event.key) && editable(event.target)) event.stopImmediatePropagation();
  };
  target.addEventListener("keydown", guard, true);
  return () => target.removeEventListener("keydown", guard, true);
}
