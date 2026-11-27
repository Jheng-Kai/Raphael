// The composer's field: ProseMirror shows the words as they will read (headings, lists, quotes, code, equations, toggles) and the
// element it is mounted on answers like the plain field it replaces. `value` is the Markdown, `selectionStart`, `setRangeText` and
// the rest speak in offsets of that text, and every change says `input`: so drafts, history, dictation, the @ and / menus, the
// attachments and the send all keep working on words, as before (composer-rich-markdown.ts has the map between the two).
import { chainCommands, deleteSelection, joinBackward, joinForward, lift, liftEmptyBlock, newlineInCode, selectAll, selectNodeBackward, selectNodeForward, setBlockType, splitBlock, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, undoInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { AllSelection, type Command, EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from "prosemirror-state";
import { findWrapping } from "prosemirror-transform";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import {
  fragmentToMarkdown, looksLikeMarkdown, markdownSlice, offsetOf, parseMarkdown, positionOf, serializeMarkdown, type Written,
} from "./composer-rich-markdown";
import { literalSlice, normalizePastedHTML } from "./composer-rich-paste";
import { composerMarks as M, composerNodes as N, composerSchema as S, isBlankLine } from "./composer-rich-schema";
import { composerNodeViews } from "./composer-rich-views";
import { RICH, richFieldOf, type RichChip, type RichField } from "./composer-rich-handle";
import { messageUrl } from "./markdown-text";
import "./composer-rich.css";

const SILENT = "composer-rich:silent";
const blank = (): PMNode => N.paragraph.create();

/** A document, with the empty line after a last block that lets the caret go below it. */
function documentOf(markdown: string): PMNode {
  const doc = parseMarkdown(markdown), last = doc.lastChild;
  return last && last.type !== N.paragraph ? doc.copy(doc.content.addToEnd(blank())) : doc;
}

/**
 * The empty line the field keeps open under a last block that is not a paragraph (so the caret can go below it), made inside the
 * transaction that needs it, so that undoing an input rule undoes it too; and let go of once the block before it is a paragraph again.
 */
function keepTail(tr: Transaction, before: PMNode): void {
  const after = tr.doc, last = after.lastChild;
  if (last && last.type !== N.paragraph) { tr.insert(after.content.size, blank()); return; }
  if (!tr.docChanged || after.childCount < 2 || !last || !isBlankLine(last) || after.child(after.childCount - 2).type !== N.paragraph) return;
  const held = before.childCount >= 2 && isBlankLine(before.lastChild!) && before.child(before.childCount - 2).type !== N.paragraph;
  if (!held) return;
  let tail = before.content.size - 2, touched = false;
  for (const map of tr.mapping.maps) {
    map.forEach((_from, to) => { if (to > tail) touched = true; });
    tail = map.map(tail, -1);
  }
  if (!touched) tr.delete(after.content.size - 2, after.content.size);
}

// ------------------------------------------------------------------------------------------------------------- commands

function ancestor(state: EditorState, type: PMNode["type"]): { depth: number; node: PMNode } | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type === type) return { depth, node: $from.node(depth) };
  return undefined;
}

/** A new line under the caret: in a list the next item, in code a line of it, in a toggle's title the first line under it. */
const shiftEnter: Command = (state, dispatch) => {
  const { $from } = state.selection, parent = $from.parent;
  if (parent.type.spec.code) {
    // A second newline at the end leaves the block for the line below it.
    if (state.selection.empty && $from.parentOffset === parent.content.size && parent.textContent.endsWith("\n")) {
      if (dispatch) {
        const tr = state.tr.delete($from.pos - 1, $from.pos), after = tr.mapping.map($from.after());
        const next = tr.doc.resolve(after).nodeAfter;
        if (!next) tr.insert(after, blank());
        dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
      }
      return true;
    }
    return newlineInCode(state, dispatch);
  }
  if (parent.type === N.summary) {
    const details = $from.node($from.depth - 1), at = $from.after($from.depth);
    if (dispatch) {
      let tr = state.tr;
      if (!details.attrs.open) tr = tr.setNodeMarkup($from.before($from.depth - 1), undefined, { ...details.attrs, open: true });
      if (details.childCount < 2) tr = tr.insert(at, blank());
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
    }
    return true;
  }
  if (parent.type === N.table_cell) return goToCell(1)(state, dispatch);
  const item = ancestor(state, N.list_item);
  if (item && parent.type === N.paragraph && $from.node(item.depth).firstChild === parent) {
    // An empty item, with no list inside one to leave, is lifted out of the list.
    if (splitListItem(N.list_item, item.node.attrs.checked === null ? undefined : { checked: false })(state, dispatch)) return true;
    return liftEmptyBlock(state, dispatch);
  }
  if (parent.content.size === 0 && $from.depth > 1 && liftEmptyBlock(state, dispatch)) return true;
  return splitBlock(state, dispatch);
};

/** The start of a cell's words, `step` cells on (the next or the one before) in the table. */
const goToCell = (step: 1 | -1): Command => (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type !== N.table_cell) return false;
  const table = $from.node($from.depth - 2), start = $from.start($from.depth - 2), here = $from.before();
  const cells: number[] = [];
  table.descendants((node, offset) => { if (node.type === N.table_cell) cells.push(start + offset); return node.type !== N.table_cell; });
  const next = cells[cells.indexOf(here) + step];
  if (next !== undefined && dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, next + 1, next + 1 + state.doc.nodeAt(next)!.content.size)).scrollIntoView());
  return true;
};

const tab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) { if (dispatch) dispatch(state.tr.insertText("  ").scrollIntoView()); return true; }
  const item = ancestor(state, N.list_item);
  if (item) { sinkListItem(N.list_item)(state, dispatch); return true; }
  return goToCell(1)(state, dispatch);
};

const shiftTab: Command = (state, dispatch) => {
  const item = ancestor(state, N.list_item);
  if (item) {
    // A top-level item stays where it is: leaving the list is Backspace's.
    if (state.selection.$from.node(item.depth - 2)?.type === N.list_item) liftListItem(N.list_item)(state, dispatch);
    return true;
  }
  return goToCell(-1)(state, dispatch);
};

/** A just-closed equation is a unit; Backspace right after it opens its source again, for the next `$` to close. */
const openMath: Command = (state, dispatch) => {
  const { selection } = state, before = selection.empty ? selection.$from.nodeBefore : null;
  if (!before || before.type !== N.math_inline) return false;
  if (dispatch) {
    const from = selection.from - before.nodeSize, tr = state.tr.replaceWith(from, selection.from, S.text(`$${before.attrs.latex}`));
    dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1 + String(before.attrs.latex).length)));
  }
  return true;
};

/** Backspace at the start of a block turns it back into a paragraph, one step at a time. */
const backspaceBlock: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty || selection.$from.parentOffset !== 0) return false;
  const { $from } = selection, parent = $from.parent;
  if (parent.type === N.heading || parent.type === N.code_block || parent.type === N.math_block) return setBlockType(N.paragraph)(state, dispatch);
  if (parent.type === N.table_cell) return true;
  if (parent.type === N.summary) {
    const depth = $from.depth - 1, details = $from.node(depth), at = $from.before(depth);
    if (dispatch) {
      const blocks: PMNode[] = [N.paragraph.create(null, parent.content)];
      details.forEach((child, _, index) => { if (index) blocks.push(child); });
      const tr = state.tr.replaceWith(at, at + details.nodeSize, blocks);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
    }
    return true;
  }
  const item = ancestor(state, N.list_item);
  if (item && $from.node(item.depth).firstChild === parent && liftListItem(N.list_item)(state, dispatch)) return true;
  if ($from.depth > 1 && $from.index($from.depth - 1) === 0 && $from.node($from.depth - 1).type === N.blockquote) return lift(state, dispatch);
  return false;
};

const backspace = chainCommands(undoInputRule, openMath, backspaceBlock, deleteSelection, joinBackward, selectNodeBackward);
const forwardDelete = chainCommands(deleteSelection, joinForward, selectNodeForward);

// ------------------------------------------------------------------------------------------------------------- typing

/** `**bold**`, `*italic*`, `` `code` ``... at the closing mark: the words between take the mark, and the marks themselves go. */
function markRule(pattern: RegExp, open: number, mark: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const lead = match[1]!.length, inner = match[2]!;
    const from = start + lead, innerFrom = from + open, innerTo = innerFrom + inner.length;
    const tr = state.tr.delete(innerTo, end).delete(from, innerFrom);
    return tr.addMark(from, from + inner.length, mark.create()).removeStoredMark(mark);
  });
}

// A star, a strike or a backtick opens after any letter, a Chinese one too (他說**重點**); an underscore never does inside a word.
const AFTER = String.raw`(^|[^\w*\\])`, AFTER_WORD = String.raw`(^|[^\p{L}\p{N}_\\])`;
function typingRules(): InputRule[] {
  const task = new InputRule(/^\s*(?:[-+*]\s)?\[([ xX]?)\]\s$/, (state, match, start, end) => {
    const checked = match[1]!.toLowerCase() === "x";
    let tr = state.tr.delete(start, end);
    const $start = tr.doc.resolve(start), depth = $start.depth - 1;
    if ($start.parent.type !== N.paragraph) return null;
    if (depth > 0 && $start.node(depth).type === N.list_item && $start.index(depth) === 0) return tr.setNodeMarkup($start.before(depth), undefined, { checked });
    const range = $start.blockRange(), wrapping = range && findWrapping(range, N.bullet_list);
    if (!range || !wrapping) return null;
    tr = tr.wrap(range, wrapping);
    const inside = tr.doc.resolve(tr.mapping.map(start));
    for (let d = inside.depth; d > 0; d--) if (inside.node(d).type === N.list_item) return tr.setNodeMarkup(inside.before(d), undefined, { checked });
    return null;
  });
  const toggle = new InputRule(/^\s*>>\s$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start), parent = $start.node($start.depth - 1), index = $start.index($start.depth - 1);
    const node = N.details.create({ open: true }, [N.summary.create(), blank()]);
    if ($start.parent.type !== N.paragraph || !parent.canReplaceWith(index, index + 1, N.details)) return null;
    const tr = state.tr.delete(start, end), before = tr.mapping.map($start.before());
    tr.replaceWith(before, before + tr.doc.nodeAt(before)!.nodeSize, node);
    return tr.setSelection(TextSelection.create(tr.doc, before + 2));
  });
  const rule = new InputRule(/^---$/, (state, _match, start) => {
    const $start = state.doc.resolve(start), index = $start.index($start.depth - 1), parent = $start.node($start.depth - 1);
    if ($start.parent.type !== N.paragraph || !parent.canReplaceWith(index, index + 1, N.horizontal_rule)) return null;
    const tr = state.tr, before = $start.before();
    tr.replaceWith(before, $start.after(), [N.horizontal_rule.create(), blank()]);
    return tr.setSelection(TextSelection.create(tr.doc, before + 2));
  });
  const math = new InputRule(new RegExp(String.raw`(^|[^\w$\\])\$([^\s$](?:[^$\n]*[^\s$])?)\$$`), (state, match, start, end) => {
    const from = start + match[1]!.length;
    return state.tr.replaceWith(from, end, N.math_inline.create({ latex: match[2]! }));
  });
  const link = new InputRule(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/, (state, match, start, end) => {
    const href = messageUrl(match[2]);
    if (!href) return null;
    return state.tr.replaceWith(start, end, S.text(match[1]!, [M.link.create({ href: match[2]! })])).removeStoredMark(M.link);
  });
  return [
    textblockTypeInputRule(/^(#{1,6})\s$/, N.heading, match => ({ level: match[1]!.length })),
    task, toggle,
    wrappingInputRule(/^\s*>\s$/, N.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list),
    wrappingInputRule(/^(\d{1,9})\.\s$/, N.ordered_list, match => ({ order: Number(match[1]) }), (match, node) => node.childCount + node.attrs.order === Number(match[1])),
    textblockTypeInputRule(/^```([\w#+.-]*)\s$/, N.code_block, match => ({ language: match[1]!.toLowerCase() })),
    textblockTypeInputRule(/^\$\$\s$/, N.math_block),
    rule,
    markRule(new RegExp(`${AFTER}\\*\\*([^\\s*](?:[^*\\n]*[^\\s*])?)\\*\\*$`), 2, M.strong),
    markRule(new RegExp(`${AFTER_WORD}__([^\\s_](?:[^_\\n]*[^\\s_])?)__$`, "u"), 2, M.strong),
    markRule(new RegExp(`${AFTER}\\*([^\\s*](?:[^*\\n]*[^\\s*])?)\\*$`), 1, M.em),
    markRule(new RegExp(`${AFTER_WORD}_([^\\s_](?:[^_\\n]*[^\\s_])?)_$`, "u"), 1, M.em),
    markRule(new RegExp(`${AFTER}~~([^\\s~](?:[^~\\n]*[^\\s~])?)~~$`), 2, M.strike),
    markRule(/(^|[^`\\])`([^`\n]+)`$/, 1, M.code),
    math, link,
  ];
}

// ------------------------------------------------------------------------------------------------------------- the field

/** Whether a paste is a lone address over some words: the words become its link. */
function linkOver(text: string, state: EditorState): Transaction | null {
  const { from, to, empty, $from, $to } = state.selection, address = text.trim();
  if (empty || /\s/.test(address) || !messageUrl(address) || $from.parent !== $to.parent || !$from.parent.inlineContent) return null;
  return state.tr.addMark(from, to, M.link.create({ href: address }));
}

/**
 * Makes `host` the composer's field. The element keeps its place, class and events; it answers as the textarea it replaces
 * (`value`, `selectionStart`, `setSelectionRange`, `setRangeText`, `placeholder`, `disabled`, `readOnly`), and `richFieldOf`
 * gives what a textarea cannot: where the caret stands on the screen, and the chips drawn over words.
 */
export function mountRichField(host: HTMLElement): HTMLTextAreaElement {
  let chips: readonly RichChip[] = [], cache: { doc: PMNode; written: Written } | undefined;
  let disabled = false, readOnly = false, inputType = "", placeholder = host.getAttribute("data-placeholder") ?? "";

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

  const keys = keymap({
    "Shift-Enter": shiftEnter, Tab: tab, "Shift-Tab": shiftTab, Backspace: backspace, "Mod-Backspace": backspace,
    Delete: forwardDelete, "Mod-Delete": forwardDelete, "Mod-a": selectAll,
    "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo, "Mod-i": toggleMark(M.em), "Mod-e": toggleMark(M.code), "Mod-Shift-x": toggleMark(M.strike),
  });
  const plugins = [history(), inputRules({ rules: typingRules() }), keys,
    new Plugin({ key: new PluginKey("composer-chrome"), props: { decorations } })];

  const view: EditorView = new EditorView({ mount: host }, {
    state: EditorState.create({ schema: S, doc: documentOf(""), plugins }),
    nodeViews: composerNodeViews,
    attributes: { class: "cmp-input", role: "textbox", "aria-multiline": "true", enterkeyhint: "send", autocapitalize: "off" },
    // Escape is the page's (it cancels a task, closes a menu): the editor would swallow it as it does Enter.
    handleDOMEvents: { keydown: (_view, event) => event.key === "Escape" },
    clipboardTextSerializer: slice => fragmentToMarkdown(slice.content),
    clipboardTextParser: (words, _context, plain) => plain || !looksLikeMarkdown(words) ? literalSlice(words) : markdownSlice(words),
    transformPastedHTML: normalizePastedHTML,
    handlePaste(editor, event) {
      const data = event.clipboardData;
      if (!data) return false;
      const words = data.getData("text/plain");
      // A code editor's copy is code: its lines are the words, whatever it dresses them in.
      if (data.types?.includes("vscode-editor-data") && words) { editor.dispatch(editor.state.tr.replaceSelection(literalSlice(words)).scrollIntoView()); return true; }
      const linked = linkOver(words, editor.state);
      if (linked) { editor.dispatch(linked.scrollIntoView()); return true; }
      return false;
    },
    dispatchTransaction(tr) {
      keepTail(tr, view.state.doc);
      const next = view.state.apply(tr);
      view.updateState(next);
      host.toggleAttribute("data-empty", next.doc.childCount === 1 && isBlankLine(next.doc.firstChild!));
      if (tr.docChanged && !tr.getMeta(SILENT)) { const type = inputType || "insertText"; inputType = ""; emit(type); }
    },
  });
  // The browser's own `input` comes before the editor has read what it changed: the words are announced once, after it has.
  host.addEventListener("input", event => {
    if (!event.isTrusted) return;
    inputType = (event as InputEvent).inputType || inputType;
    event.stopImmediatePropagation();
  });
  host.toggleAttribute("data-empty", true);

  /** The words replaced by `markdown`, only where they differ, with the caret at `caret` (offsets in the new words). */
  const replace = (markdown: string, caret: [number, number] | undefined, fresh: boolean): void => {
    const doc = documentOf(markdown);
    if (fresh) {
      const state = EditorState.create({ schema: S, doc, plugins: view.state.plugins, selection: Selection.atEnd(doc) });
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
    destroy() { view.destroy(); },
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
