// The composer's field: TipTap (ProseMirror) shows the words as they will read (headings, lists, quotes, code, equations, toggles,
// every format) and the element it is mounted on answers like the plain field it replaces. `value` is the Markdown,
// `selectionStart`, `setRangeText` and the rest speak in offsets of that text, and every change says `input`: so drafts, history,
// dictation, the @ and / menus, the attachments and the send all keep working on words, as before (composer-rich-markdown.ts has the
// map between the two, composer-rich-extensions.ts the formats, composer-rich-behavior.ts the keys, composer-rich-toolbar.ts what
// floats over a selection).
import { Editor, Extension } from "@tiptap/core";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { AllSelection, EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import {
  fragmentToMarkdown, looksLikeMarkdown, markdownSlice, offsetOf, parseMarkdown, positionOf, serializeMarkdown, type Written,
} from "./composer-rich-markdown";
import { literalSlice, normalizePastedHTML } from "./composer-rich-paste";
import { composerExtensions, isBlankLine } from "./composer-rich-extensions";
import { composerBehavior } from "./composer-rich-behavior";
import { RICH, richFieldOf, type RichChip, type RichField } from "./composer-rich-handle";
import { messageUrl } from "./markdown-text";
import "./composer-rich.css";

const SILENT = "composer-rich:silent";
/** The key the page keeps for itself: the editor would swallow it as it does Enter, and the page uses it to cancel a task and close a menu. */
const PAGE_KEY = "Escape";
const blank = (schema: Schema): PMNode => schema.nodes["paragraph"]!.create();
const isParagraph = (node: PMNode): boolean => node.type.name === "paragraph";

/** A document, with the empty line after a last block that lets the caret go below it. */
function documentOf(markdown: string, schema: Schema): PMNode {
  const doc = parseMarkdown(markdown, schema), last = doc.lastChild;
  return last && !isParagraph(last) ? doc.copy(doc.content.addToEnd(blank(schema))) : doc;
}

/**
 * The empty line the field keeps open under a last block that is not a paragraph (so the caret can go below it), made inside the
 * transaction that needs it, so that undoing an input rule undoes it too; and let go of once the block before it is a paragraph again.
 */
function keepTail(tr: Transaction, before: PMNode): void {
  const after = tr.doc, last = after.lastChild;
  if (last && !isParagraph(last)) { tr.insert(after.content.size, blank(after.type.schema)); return; }
  if (!tr.docChanged || after.childCount < 2 || !last || !isBlankLine(last) || !isParagraph(after.child(after.childCount - 2))) return;
  const held = before.childCount >= 2 && isBlankLine(before.lastChild!) && !isParagraph(before.child(before.childCount - 2));
  if (!held) return;
  let tail = before.content.size - 2, touched = false;
  for (const map of tr.mapping.maps) {
    map.forEach((_from, to) => { if (to > tail) touched = true; });
    tail = map.map(tail, -1);
  }
  if (!touched) tr.delete(after.content.size - 2, after.content.size);
}

/** Whether a paste is a lone address over some words: the words become its link. */
function linkOver(text: string, state: EditorState): Transaction | null {
  const { from, to, empty, $from, $to } = state.selection, address = text.trim();
  if (empty || /\s/.test(address) || !messageUrl(address) || $from.parent !== $to.parent || !$from.parent.inlineContent) return null;
  return state.tr.addMark(from, to, state.schema.marks["link"]!.create({ href: address }));
}

/**
 * Makes `host` the composer's field. The element keeps its place, class and events; it answers as the textarea it replaces
 * (`value`, `selectionStart`, `setSelectionRange`, `setRangeText`, `placeholder`, `disabled`, `readOnly`), and `richFieldOf`
 * gives what a textarea cannot: where the caret stands on the screen, and the chips drawn over words.
 */
export function mountRichField(host: HTMLElement): HTMLTextAreaElement {
  let chips: readonly RichChip[] = [], cache: { doc: PMNode; written: Written } | undefined;
  let disabled = false, readOnly = false, inputType = "", placeholder = host.getAttribute("data-placeholder") ?? "";
  let openLink: () => boolean = () => false;
  let view!: EditorView;

  const written = (): Written => {
    const doc = view.state.doc;
    if (cache?.doc !== doc) cache = { doc, written: serializeMarkdown(doc) };
    return cache.written;
  };
  /** What the editor has read of the page so far: a change the browser made a moment ago, a composition just ended. */
  const settle = (): void => {
    try { (view as unknown as { domObserver?: { flush(): void } }).domObserver?.flush(); } catch { /* A view being replaced has nothing to read. */ }
  };
  const text = (): string => { settle(); return written().text; };
  const emit = (type: string): void => {
    host.dispatchEvent(typeof InputEvent === "function" ? new InputEvent("input", { bubbles: true, inputType: type, isComposing: view.composing }) : new Event("input", { bubbles: true }));
  };

  const decorations = (state: EditorState): DecorationSet => {
    const found: Decoration[] = [], doc = state.doc;
    if (placeholder && doc.childCount === 1 && isBlankLine(doc.firstChild!)) found.push(Decoration.node(0, doc.firstChild!.nodeSize, { class: "cmp-empty", "data-placeholder": placeholder }));
    if (chips.length) {
      const map = serializeMarkdown(doc).map;
      for (const chip of chips) {
        const from = positionOf(map, chip.start), to = positionOf(map, chip.end);
        if (to <= from) continue;
        if (chip.kind === "mention") {
          // The @ (unseen: the mark stands over it, and the words keep their metrics) and the name after it.
          found.push(Decoration.inline(from, Math.min(to, from + 1), { class: "mention-at" }, { inclusiveStart: false, inclusiveEnd: false }));
          if (to > from + 1) found.push(Decoration.inline(from + 1, to, { class: "mention-chip", "data-mention": chip.mention ?? "" }, { inclusiveStart: false, inclusiveEnd: false }));
          if (chip.icon) {
            const icon = chip.icon;
            found.push(Decoration.widget(from, () => {
              const slot = document.createElement("span");
              slot.className = "mention-slot"; slot.contentEditable = "false";
              slot.innerHTML = `<span class="mention-ico" aria-hidden="true">${icon}</span>`;
              return slot;
            }, { side: -1, ignoreSelection: true, key: `mention:${chip.mention}:${icon.length}` }));
          }
        } else found.push(Decoration.inline(from, to, { class: chip.kind === "url" ? "cmp-link" : "cmp-skill" }, { inclusiveStart: false, inclusiveEnd: false }));
      }
    }
    return DecorationSet.create(doc, found);
  };

  /** What the field draws over the words (the placeholder, the chips the page asks for), and the line it keeps open under a last block. */
  const chrome = Extension.create({
    name: "composerChrome",
    addProseMirrorPlugins() { return [new Plugin({ key: new PluginKey("composer-chrome"), props: { decorations } })]; },
    // TipTap's own dispatch follows (it applies the transaction and says what changed), with the tail kept in the same transaction.
    dispatchTransaction({ transaction, next }) { keepTail(transaction, this.editor.state.doc); next(transaction); },
  });

  const editor: Editor = new Editor({
    element: { mount: host },
    extensions: [...composerExtensions(), composerBehavior({ link: () => openLink() }), chrome],
    // Enter is the page's (it sends), and no word the owner typed is rewritten by a paste rule.
    enableCoreExtensions: { keymap: false, tabindex: false },
    enablePasteRules: false, injectCSS: false,
    editorProps: {
      attributes: { class: "cmp-input", role: "textbox", "aria-multiline": "true", enterkeyhint: "send", autocapitalize: "off" },
      // Escape is the page's (it cancels a task, closes a menu), and so is Enter, which sends: no extension is asked for either.
      handleDOMEvents: { keydown: (_view, event) => event.key === PAGE_KEY || (event.key === "Enter" && !event.shiftKey) },
      clipboardTextSerializer: slice => fragmentToMarkdown(slice.content),
      clipboardTextParser: (words, _context, plain) => plain || !looksLikeMarkdown(words) ? literalSlice(words, editor.schema) : markdownSlice(words, editor.schema),
      transformPastedHTML: normalizePastedHTML,
      handlePaste(editorView, event) {
        const data = event.clipboardData;
        if (!data) return false;
        const words = data.getData("text/plain");
        // A code editor's copy is code: its lines are the words, whatever it dresses them in.
        if (data.types?.includes("vscode-editor-data") && words) { editorView.dispatch(editorView.state.tr.replaceSelection(literalSlice(words, editor.schema)).scrollIntoView()); return true; }
        const linked = linkOver(words, editorView.state);
        if (linked) { editorView.dispatch(linked.scrollIntoView()); return true; }
        return false;
      },
    },
  });
  view = editor.view;
  // After TipTap has applied a transaction: the field says whether it is empty, and every change of the words says `input`, once.
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const doc = editor.state.doc;
    host.toggleAttribute("data-empty", doc.childCount === 1 && isBlankLine(doc.firstChild!));
    if ([transaction, ...appendedTransactions].some(tr => tr.docChanged) && !transaction.getMeta(SILENT)) { const type = inputType || "insertText"; inputType = ""; emit(type); }
  });
  const schema = editor.schema;
  // The browser's own `input` comes before the editor has read what it changed: the words are announced once, after it has.
  host.addEventListener("input", event => {
    if (!event.isTrusted) return;
    inputType = (event as InputEvent).inputType || inputType;
    event.stopImmediatePropagation();
  });
  host.toggleAttribute("data-empty", true);

  /** The words replaced by `markdown`, only where they differ, with the caret at `caret` (offsets in the new words). */
  const replace = (markdown: string, caret: [number, number] | undefined, fresh: boolean): void => {
    const doc = documentOf(markdown, schema);
    if (fresh) {
      const state = EditorState.create({ schema, doc, plugins: view.state.plugins, selection: Selection.atEnd(doc) });
      view.updateState(state);
      host.toggleAttribute("data-empty", doc.childCount === 1 && isBlankLine(doc.firstChild!));
    } else {
      const old = view.state.doc, start = old.content.findDiffStart(doc.content);
      if (start !== null && start !== undefined) {
        const ends = old.content.findDiffEnd(doc.content)!;
        let { a, b } = ends;
        const overlap = start - Math.min(a, b);
        if (overlap > 0) { a += overlap; b += overlap; }
        view.dispatch(view.state.tr.replace(start, a, doc.slice(start, b)).setMeta(SILENT, true));
      }
    }
    if (caret) {
      const map = written().map, from = positionOf(map, caret[0]), to = positionOf(map, caret[1]);
      view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(from), view.state.doc.resolve(to))).setMeta(SILENT, true));
    }
  };

  const field: RichField = {
    view,
    editor,
    caretRect(offset) {
      try {
        const at = view.coordsAtPos(positionOf(written().map, offset));
        return new DOMRect(at.left, at.top, 0, at.bottom - at.top);
      } catch { const box = host.getBoundingClientRect(); return new DOMRect(box.left, box.top, 0, 20); }
    },
    setChips(next) {
      if (next.length === chips.length && next.every((chip, i) => { const was = chips[i]!; return was.start === chip.start && was.end === chip.end && was.kind === chip.kind && was.mention === chip.mention && was.icon === chip.icon; })) return;
      chips = next;
      view.updateState(view.state);
    },
    onLink(open) { openLink = open; },
    destroy() { editor.destroy(); },
  };

  const range = (): { start: number; end: number } => {
    settle();
    const map = written().map, { from, to } = view.state.selection;
    return { start: offsetOf(map, from), end: offsetOf(map, to) };
  };
  function setSelectionRange(start: number, end: number, direction?: string): void {
    const map = written().map, size = map.size, a = positionOf(map, Math.min(Math.max(0, start), size)), b = positionOf(map, Math.min(Math.max(0, end), size));
    const doc = view.state.doc;
    let selection = TextSelection.between(doc.resolve(a), doc.resolve(b));
    if (direction === "backward") selection = TextSelection.create(doc, selection.to, selection.from);
    view.dispatch(view.state.tr.setSelection(selection).setMeta(SILENT, true));
  }
  const props: PropertyDescriptorMap = {
    [RICH]: { value: field },
    value: { configurable: true, get: text, set(words: string) { const markdown = String(words ?? ""); if (markdown !== text()) replace(markdown, undefined, true); } },
    selectionStart: { configurable: true, get: () => range().start, set(at: number) { setSelectionRange(at, Math.max(at, range().end)); } },
    selectionEnd: { configurable: true, get: () => range().end, set(at: number) { setSelectionRange(Math.min(at, range().start), at); } },
    selectionDirection: { configurable: true, get: () => view.state.selection.anchor > view.state.selection.head ? "backward" : "forward" },
    setSelectionRange: { configurable: true, writable: true, value: setSelectionRange },
    setRangeText: {
      configurable: true, writable: true, value(words: string, start?: number, end?: number, mode: "select" | "start" | "end" | "preserve" = "preserve") {
        const markdown = text(), current = range();
        const from = Math.min(Math.max(0, start ?? current.start), markdown.length), to = Math.min(Math.max(from, end ?? current.end), markdown.length);
        const next = markdown.slice(0, from) + words + markdown.slice(to);
        const caret: [number, number] = mode === "select" ? [from, from + words.length] : mode === "start" ? [from, from] : mode === "end" ? [from + words.length, from + words.length]
          : [current.start <= from ? current.start : Math.max(from, current.start + words.length - (to - from)), current.end <= from ? current.end : Math.max(from, current.end + words.length - (to - from))];
        replace(next, caret, false);
      },
    },
    select: { configurable: true, writable: true, value() { view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)).setMeta(SILENT, true)); } },
    placeholder: {
      configurable: true, get: () => placeholder,
      set(words: string) { if (words === placeholder) return; placeholder = words; host.setAttribute("data-placeholder", words); view.updateState(view.state); },
    },
    disabled: { configurable: true, get: () => disabled, set(on: boolean) { disabled = !!on; host.toggleAttribute("disabled", disabled); host.setAttribute("aria-disabled", String(disabled)); view.setProps({ editable: () => !disabled && !readOnly }); } },
    readOnly: { configurable: true, get: () => readOnly, set(on: boolean) { readOnly = !!on; host.toggleAttribute("readonly", readOnly); view.setProps({ editable: () => !disabled && !readOnly }); } },
    type: { configurable: true, value: "textarea" },
  };
  Object.defineProperties(host, props);
  return host as unknown as HTMLTextAreaElement;
}

export { richFieldOf };
export type { RichChip, RichField };
