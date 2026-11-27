// What the field does on top of TipTap's formats: the keys of a line-based composer (a new line, a list's next item, Tab, Backspace
// that goes back one step at a time), the typing shortcuts TipTap has no word for (a task, a toggle, a divider, an equation, a
// Markdown link), and the commands the toolbar and the shortcuts share for what is the app's own (a task, a toggle).
import { type CommandProps, Extension, InputRule, textblockTypeInputRule } from "@tiptap/core";
import { chainCommands, deleteSelection, joinBackward, joinForward, lift, liftEmptyBlock, newlineInCode, selectAll, selectNodeBackward, selectNodeForward, setBlockType, splitBlock } from "prosemirror-commands";
import type { Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { type Command, type EditorState, Selection, TextSelection } from "prosemirror-state";
import { messageUrl } from "./markdown-text";

const type = (state: EditorState, name: string) => state.schema.nodes[name]!;
const blank = (state: EditorState): PMNode => type(state, "paragraph").create();
const isCell = (node: PMNode): boolean => node.type.name === "tableCell" || node.type.name === "tableHeader";

function ancestor(state: EditorState, name: string): { depth: number; node: PMNode } | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === name) return { depth, node: $from.node(depth) };
  return undefined;
}

// ------------------------------------------------------------------------------------------------------------- commands

/** A new line under the caret: in a list the next item, in code a line of it, in a toggle's title the first line under it. */
export const shiftEnter: Command = (state, dispatch) => {
  const { $from } = state.selection, parent = $from.parent;
  if (parent.type.spec.code) {
    // A second newline at the end leaves the block for the line below it.
    if (state.selection.empty && $from.parentOffset === parent.content.size && parent.textContent.endsWith("\n")) {
      if (dispatch) {
        const tr = state.tr.delete($from.pos - 1, $from.pos), after = tr.mapping.map($from.after());
        const next = tr.doc.resolve(after).nodeAfter;
        if (!next) tr.insert(after, blank(state));
        dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
      }
      return true;
    }
    return newlineInCode(state, dispatch);
  }
  if (parent.type.name === "summary") {
    const details = $from.node($from.depth - 1), at = $from.after($from.depth);
    if (dispatch) {
      let tr = state.tr;
      if (!details.attrs.open) tr = tr.setNodeMarkup($from.before($from.depth - 1), undefined, { ...details.attrs, open: true });
      if (details.childCount < 2) tr = tr.insert(at, blank(state));
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
    }
    return true;
  }
  if (isCell(parent)) return goToCell(1)(state, dispatch);
  const item = ancestor(state, "listItem");
  if (item && parent.type.name === "paragraph" && $from.node(item.depth).firstChild === parent) {
    // An empty item, with no list inside one to leave, is lifted out of the list.
    if (splitListItem(type(state, "listItem"), item.node.attrs.checked === null ? undefined : { checked: false })(state, dispatch)) return true;
    return liftEmptyBlock(state, dispatch);
  }
  if (parent.content.size === 0 && $from.depth > 1 && liftEmptyBlock(state, dispatch)) return true;
  return splitBlock(state, dispatch);
};

/** The start of a cell's words, `step` cells on (the next or the one before) in the table. */
const goToCell = (step: 1 | -1): Command => (state, dispatch) => {
  const { $from } = state.selection;
  if (!isCell($from.parent)) return false;
  const table = $from.node($from.depth - 2), start = $from.start($from.depth - 2), here = $from.before();
  const cells: number[] = [];
  table.descendants((node, offset) => { if (isCell(node)) cells.push(start + offset); return !isCell(node); });
  const next = cells[cells.indexOf(here) + step];
  if (next !== undefined && dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, next + 1, next + 1 + state.doc.nodeAt(next)!.content.size)).scrollIntoView());
  return true;
};

/** Tab in code is two spaces, in a list it nests the item; in a table it is TipTap's (the next cell, and a new row after the last). */
export const tab: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) { if (dispatch) dispatch(state.tr.insertText("  ").scrollIntoView()); return true; }
  if (ancestor(state, "listItem")) { sinkListItem(type(state, "listItem"))(state, dispatch); return true; }
  return false;
};

export const shiftTab: Command = (state, dispatch) => {
  const item = ancestor(state, "listItem");
  if (!item) return false;
  // A top-level item stays where it is: leaving the list is Backspace's.
  if (state.selection.$from.node(item.depth - 2)?.type.name === "listItem") liftListItem(type(state, "listItem"))(state, dispatch);
  return true;
};

/** A just-closed equation is a unit; Backspace right after it opens its source again, for the next `$` to close. */
const openMath: Command = (state, dispatch) => {
  const { selection } = state, before = selection.empty ? selection.$from.nodeBefore : null;
  if (!before || before.type.name !== "mathInline") return false;
  if (dispatch) {
    const from = selection.from - before.nodeSize, tr = state.tr.replaceWith(from, selection.from, state.schema.text(`$${before.attrs.latex}`));
    dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1 + String(before.attrs.latex).length)));
  }
  return true;
};

/** Backspace at the start of a block turns it back into a paragraph, one step at a time. */
const backspaceBlock: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty || selection.$from.parentOffset !== 0) return false;
  const { $from } = selection, parent = $from.parent, name = parent.type.name;
  if (name === "heading" || name === "codeBlock" || name === "mathBlock") return setBlockType(type(state, "paragraph"))(state, dispatch);
  if (isCell(parent)) return true;
  if (name === "summary") {
    const depth = $from.depth - 1, details = $from.node(depth), at = $from.before(depth);
    if (dispatch) {
      const blocks: PMNode[] = [type(state, "paragraph").create(null, parent.content)];
      details.forEach((child, _, index) => { if (index) blocks.push(child); });
      const tr = state.tr.replaceWith(at, at + details.nodeSize, blocks);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
    }
    return true;
  }
  const item = ancestor(state, "listItem");
  if (item && $from.node(item.depth).firstChild === parent && liftListItem(type(state, "listItem"))(state, dispatch)) return true;
  if ($from.depth > 1 && $from.index($from.depth - 1) === 0 && $from.node($from.depth - 1).type.name === "blockquote") return lift(state, dispatch);
  return false;
};

/**
 * Backspace in an empty line right after a block that holds other blocks (a list, a quote, a toggle, a table) goes back to the end
 * of that block's last words. Joining would pull the line into it as a new item, the next Backspace would lift that item out again,
 * and the empty line kept under a last block (`keepTail`) came back each time: the owner pressed Backspace and nothing was ever
 * deleted. A line in the middle of the words goes away; the one under a last block stays, as `keepTail` would put it back.
 */
const backspaceIntoBlock: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty || selection.$from.parentOffset !== 0) return false;
  const { $from } = selection, parent = $from.parent;
  if (parent.type.name !== "paragraph" || parent.content.size !== 0 || $from.depth !== 1) return false;
  const index = $from.index(0);
  if (index === 0 || state.doc.child(index - 1).isTextblock) return false;
  if (dispatch) {
    const last = index === state.doc.childCount - 1;
    const tr = last ? state.tr : state.tr.delete($from.before(), $from.after());
    const back = Selection.findFrom(tr.doc.resolve($from.before()), -1, true);
    if (back) tr.setSelection(back);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** A toggle made of the line the caret is in: its words are the title, an empty line is under it. */
export const makeToggle: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code || ancestor(state, "details")) return false;
  const parent = $from.node($from.depth - 1), index = $from.index($from.depth - 1), details = type(state, "details");
  if (!parent.canReplaceWith(index, index + 1, details)) return false;
  if (dispatch) {
    const node = details.create({ open: true }, [type(state, "summary").create(null, $from.parent.content), blank(state)]);
    const before = $from.before(), tr = state.tr.replaceWith(before, $from.after(), node);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, before + 2 + $from.parentOffset)).scrollIntoView());
  }
  return true;
};

/** The list items whose first line the selection touches (the one the caret is in, or each one a selection crosses). */
function itemsTouched(state: EditorState): { pos: number; node: PMNode }[] {
  const { from, to } = state.selection, found: { pos: number; node: PMNode }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "listItem") return true;
    const head = node.firstChild!;
    if (pos + 1 + head.nodeSize >= from && pos + 1 <= to) found.push({ pos, node });
    return true;
  });
  return found;
}

/** Makes the selected items tasks (unticked), or plain items again when they all are tasks; outside a list it makes the lines a list of tasks. */
export function toggleTask({ state, tr, dispatch, commands }: CommandProps): boolean {
  let items = itemsTouched(state);
  // The list the command below makes is in the transaction this one shares; `state.tr` brings the state up to it.
  if (!items.length && commands.toggleBulletList()) { void state.tr; items = itemsTouched(state); }
  const plain = items.length > 0 && items.every(item => item.node.attrs.checked !== null);
  if (dispatch) for (const { pos, node } of items) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: plain ? null : node.attrs.checked ?? false });
  return items.length > 0;
}

// ------------------------------------------------------------------------------------------------------------- the extension

export interface BehaviorOptions {
  /** Mod+K: the editor of the address, for the words selected or the link the caret is in. */
  openLink: () => boolean;
}

/** The keys of the field and the typing shortcuts of the app's own blocks. Its priority puts them before TipTap's formats. */
export function composerBehavior(options: BehaviorOptions): Extension {
  return Extension.create({
    name: "composerBehavior",
    priority: 1000,
    addKeyboardShortcuts() {
      const run = (command: Command) => () => command(this.editor.state, tr => this.editor.view.dispatch(tr), this.editor.view);
      const backspace = chainCommands(
        () => this.editor.commands.undoInputRule(), openMath, backspaceBlock, backspaceIntoBlock, deleteSelection, joinBackward, selectNodeBackward);
      const forwardDelete = chainCommands(deleteSelection, joinForward, selectNodeForward);
      return {
        "Shift-Enter": run(shiftEnter), Tab: run(tab), "Shift-Tab": run(shiftTab),
        Backspace: run(backspace), "Mod-Backspace": run(backspace), Delete: run(forwardDelete), "Mod-Delete": run(forwardDelete), "Mod-a": run(selectAll),
        "Mod-k": () => options.openLink(),
        "Mod-Shift-9": () => this.editor.commands.toggleTask(),
      };
    },
    addCommands() {
      return {
        toggleTask: () => props => toggleTask(props),
        makeToggle: () => ({ state, dispatch }) => makeToggle(state, dispatch),
      };
    },
    addInputRules() {
      const task = new InputRule({
        find: /^\s*(?:[-+*]\s)?\[([ xX]?)\]\s$/,
        handler: ({ state, range, match }) => {
          const checked = match[1]!.toLowerCase() === "x";
          const tr = state.tr.delete(range.from, range.to);
          const $start = tr.doc.resolve(range.from), depth = $start.depth - 1;
          if ($start.parent.type.name !== "paragraph") return null;
          if (depth > 0 && $start.node(depth).type.name === "listItem" && $start.index(depth) === 0) { tr.setNodeMarkup($start.before(depth), undefined, { checked }); return undefined; }
          const bullet = state.schema.nodes["bulletList"]!, item = state.schema.nodes["listItem"]!;
          const wrapped = tr.doc.resolve(range.from).blockRange();
          if (!wrapped) return null;
          tr.wrap(wrapped, [{ type: bullet }, { type: item, attrs: { checked } }]);
          return undefined;
        },
      });
      const toggle = new InputRule({
        find: /^\s*>>\s$/,
        handler: ({ state, range }) => {
          const $start = state.doc.resolve(range.from), parent = $start.node($start.depth - 1), index = $start.index($start.depth - 1);
          const details = state.schema.nodes["details"]!;
          if ($start.parent.type.name !== "paragraph" || !parent.canReplaceWith(index, index + 1, details)) return null;
          const tr = state.tr.delete(range.from, range.to), before = tr.mapping.map($start.before());
          const node = details.create({ open: true }, [type(state, "summary").create(), blank(state)]);
          tr.replaceWith(before, before + tr.doc.nodeAt(before)!.nodeSize, node);
          tr.setSelection(TextSelection.create(tr.doc, before + 2));
          return undefined;
        },
      });
      const divider = new InputRule({
        find: /^---$/,
        handler: ({ state, range }) => {
          const $start = state.doc.resolve(range.from), index = $start.index($start.depth - 1), parent = $start.node($start.depth - 1);
          const rule = state.schema.nodes["horizontalRule"]!;
          if ($start.parent.type.name !== "paragraph" || !parent.canReplaceWith(index, index + 1, rule)) return null;
          const tr = state.tr, before = $start.before();
          tr.replaceWith(before, $start.after(), [rule.create(), blank(state)]);
          tr.setSelection(TextSelection.create(tr.doc, before + 2));
          return undefined;
        },
      });
      const math = new InputRule({
        find: new RegExp(String.raw`(^|[^\w$\\])\$([^\s$](?:[^$\n]*[^\s$])?)\$$`),
        handler: ({ state, range, match }) => {
          const from = range.from + match[1]!.length;
          state.tr.replaceWith(from, range.to, state.schema.nodes["mathInline"]!.create({ latex: match[2]! }));
        },
      });
      const link = new InputRule({
        find: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/,
        handler: ({ state, range, match }) => {
          if (!messageUrl(match[2])) return null;
          const mark = state.schema.marks["link"]!;
          state.tr.replaceWith(range.from, range.to, state.schema.text(match[1]!, [mark.create({ href: match[2]! })])).removeStoredMark(mark);
          return undefined;
        },
      });
      return [
        task, toggle,
        textblockTypeInputRule({ find: /^\$\$\s$/, type: this.editor.schema.nodes["mathBlock"]! }),
        divider, math, link,
      ];
    },
  });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    composerBehavior: {
      /** Makes the selected list items tasks, or plain items when they all are tasks. */
      toggleTask: () => ReturnType;
      /** Makes the line the caret is in the title of a toggle. */
      makeToggle: () => ReturnType;
    };
  }
}
