// What the helpers around the composer's field (the @ chips, the menus' anchor, the history walk) may ask of it beyond the words,
// without loading the editor: composer-rich-field.ts makes the field and puts this handle on it.
import type { Editor } from "@tiptap/core";
import type { EditorView } from "prosemirror-view";

/** A stretch of the words drawn as a chip by whoever knows what it is (mention-field.ts): an address, a skill, a mention. */
export interface RichChip {
  start: number; end: number; kind: "url" | "skill" | "mention";
  /** A mention's kind, and the mark drawn where its @ stands. */
  mention?: string; icon?: string;
}

export interface RichField {
  readonly view: EditorView;
  /** The TipTap editor that holds it, for what floats over it (composer-rich-toolbar.ts). */
  readonly editor: Editor;
  /** Where the caret would stand at an offset of the text, in the page's coordinates. */
  caretRect(offset: number): DOMRect;
  /** The chips to draw over the words; drawn again at every change of the words. */
  setChips(chips: readonly RichChip[]): void;
  destroy(): void;
}

export const RICH: unique symbol = Symbol.for("raphael.richField") as never;

/** The editor of a field made by `mountRichField`, if it is one. */
export function richFieldOf(element: Element | null | undefined): RichField | undefined {
  return (element as unknown as { [RICH]?: RichField } | null | undefined)?.[RICH];
}
