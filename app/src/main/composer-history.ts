// ArrowUp in a composer brings back what the owner typed, newest first, across every conversation (the core keeps it: agent.history.sent);
// ArrowDown walks forward and ends on the draft they had before the first ArrowUp, so nothing typed is lost. The arrows are the field's
// own wherever they would move the caret, belong to a menu that is open, and do nothing while an input method composes.
import { textPositionRect } from "./text-position";
import { menuIsOpenFor } from "./ui";

/** The `inputType` of the `input` event a recall dispatches: the menus that follow typing leave it alone. */
export const RECALL = "historyRecall";

export function bindComposerHistory(input: HTMLTextAreaElement, sent: () => Promise<readonly string[]>): void {
  /** What was sent, newest first, read when the walk began; `at` is the one shown (-1: the draft). */
  let texts: readonly string[] = [], at = -1, draft = "", loading = false, writing = false;
  /** What the owner changed in a recalled line, kept while they walk on: the history itself is never edited. */
  const edits = new Map<number, string>();
  const reset = (): void => { at = -1; draft = ""; edits.clear(); };

  // Whatever else writes the words (a send that empties the field, another conversation, a dictation) ends the walk.
  const own = Object.getOwnPropertyDescriptor(input, "value") ?? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
  Object.defineProperty(input, "value", { configurable: true, get: () => own.get!.call(input), set: (value: string) => { own.set!.call(input, value); if (!writing) reset(); } });

  const put = (value: string): void => {
    writing = true;
    try { input.value = value; } finally { writing = false; }
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: RECALL }));
  };
  const walk = (to: number): void => {
    if (at >= 0) { if (input.value === texts[at]) edits.delete(at); else edits.set(at, input.value); }
    at = to;
    if (to < 0) { const back = draft; reset(); put(back); return; }
    put(edits.get(to) ?? texts[to]);
  };
  // On the first line the up arrow has nowhere to go in the field, on the last the down arrow has not (a long line that wraps counts by its rows).
  const rowOf = (position: number): number => Math.round(textPositionRect(input, position).top);
  const firstLine = (): boolean => !input.value.slice(0, input.selectionStart).includes("\n") && rowOf(input.selectionStart) === rowOf(0);
  const lastLine = (): boolean => !input.value.slice(input.selectionEnd).includes("\n") && rowOf(input.selectionEnd) === rowOf(input.value.length);

  input.addEventListener("keydown", event => {
    if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || input.selectionStart !== input.selectionEnd || menuIsOpenFor(input)) return;
    if (event.key === "ArrowDown") {
      if (at < 0 || !lastLine()) return;
      event.preventDefault(); walk(at - 1);
      return;
    }
    if (!firstLine()) return;
    if (at >= 0) {
      if (at + 1 >= texts.length) return;
      event.preventDefault(); walk(at + 1);
      return;
    }
    event.preventDefault();
    if (loading) return;
    loading = true;
    const before = input.value;
    void sent().then(found => {
      // Nothing to recall, or the owner typed meanwhile: the arrow did nothing.
      if (!found.length || input.value !== before) return;
      texts = found; draft = before; edits.clear();
      walk(0);
    }, () => { /* a core that cannot answer leaves the field as it is */ }).finally(() => { loading = false; });
  });
}
