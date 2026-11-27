// What the owner can write and see in the composer's field, as TipTap extensions (ProseMirror underneath). The formats every
// editor shares (bold, italic, underline, strike, code, highlight, link, headings, quotes, lists, code blocks, tables, undo) are
// TipTap's own extensions, with their commands and their de-facto shortcuts; this file only bends them to the app:
//
//  - a line is a paragraph (Shift+Enter starts the next one, an empty paragraph is a blank line) and plain Enter is the page's,
//    so no extension is asked for it (composer-rich-field.ts keeps it from all of them), and no paste rule or autolink rewrites
//    words the owner typed;
//  - every node has one Markdown spelling (composer-rich-markdown.ts), the one the members' replies are written in; what Markdown
//    has no word for is spelled as the reply renderer reads it: `<u>…</u>`, `==…==`, `<details>`.
//
// A toggle, an equation and a task item are the app's own nodes. TipTap's Details keeps its words in wrappers and its
// Mathematics is one atom edited in a prompt, and a task is a list of its own, while here a toggle is its summary's line with what
// is under it, an equation is its LaTeX in the line (and drawn), and `- a` and `- [ ] b` are one list, as Markdown writes them.
import { type AnyExtension, getSchema, InputRule, Node, textblockTypeInputRule } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Heading } from "@tiptap/extension-heading";
import { Highlight } from "@tiptap/extension-highlight";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { Italic } from "@tiptap/extension-italic";
import { Link } from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Strike } from "@tiptap/extension-strike";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Text } from "@tiptap/extension-text";
import { Underline } from "@tiptap/extension-underline";
import { UndoRedo } from "@tiptap/extensions";
import { Fragment, type MarkType, type Node as PMNode, type Schema } from "prosemirror-model";
import { messageUrl } from "./markdown-text";
import { ItemView, MathBlockView, MathInlineView, SummaryView, ToggleView } from "./composer-rich-views";

/** How a table column is aligned in its Markdown separator row. */
export type CellAlign = "left" | "center" | "right" | null;

const alignOf = (dom: HTMLElement): CellAlign => {
  const named = /\balign-(left|center|right)\b/.exec(dom.className)?.[1] ?? dom.getAttribute("align") ?? dom.style.textAlign;
  return named === "left" || named === "center" || named === "right" ? named : null;
};

// ------------------------------------------------------------------------------------------------------------- typing rules

/** The words between two marks, at the closing mark: they take the mark and the marks themselves go. */
export function markRule(find: RegExp, open: number, type: () => MarkType): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const mark = type();
      const lead = match[1]!.length, inner = match[2]!;
      const from = range.from + lead, innerFrom = from + open, innerTo = innerFrom + inner.length;
      state.tr.delete(innerTo, range.to).delete(from, innerFrom).addMark(from, from + inner.length, mark.create()).removeStoredMark(mark);
    },
  });
}

// A star, a strike or a backtick opens after any letter, a Chinese one too (他說**重點**); an underscore never does inside a word.
const AFTER = String.raw`(^|[^\w*\\])`, AFTER_WORD = String.raw`(^|[^\p{L}\p{N}_\\])`;
const pair = (mark: string, edge: string, prefix = AFTER, flags = ""): RegExp =>
  new RegExp(`${prefix}${mark}([^\\s${edge}](?:[^${edge}\\n]*[^\\s${edge}])?)${mark}$`, flags);

// ------------------------------------------------------------------------------------------------------------- the formats

const BoldMark = Bold.extend({
  addInputRules() {
    return [markRule(pair(String.raw`\*\*`, "*"), 2, () => this.type), markRule(pair("__", "_", AFTER_WORD, "u"), 2, () => this.type)];
  },
});
const ItalicMark = Italic.extend({
  addInputRules() {
    return [markRule(pair(String.raw`\*`, "*"), 1, () => this.type), markRule(pair("_", "_", AFTER_WORD, "u"), 1, () => this.type)];
  },
});
const StrikeMark = Strike.extend({
  addInputRules() { return [markRule(pair("~~", "~"), 2, () => this.type)]; },
  // Mod+Shift+S is TipTap's; Mod+Shift+X is Google Docs' and Slack's.
  addKeyboardShortcuts() { return { ...this.parent?.(), "Mod-Shift-x": () => this.editor.commands.toggleStrike() }; },
});
// `<u>` is how Markdown spells an underline: the reply renderer reads it back (message-content.ts).
const UnderlineMark = Underline.extend({
  addInputRules() { return [markRule(/(^|[^\\])<u>([^<\n]+)<\/u>$/, 3, () => this.type)]; },
});
// `==words==`, as Obsidian, Typora and markdown-it's mark plugin write it.
const HighlightMark = Highlight.extend({
  addInputRules() { return [markRule(pair("==", "="), 2, () => this.type)]; },
});
// A link or a bold word may hold code in a reply, so code keeps the other marks (TipTap's code excludes them all).
const CodeMark = Code.extend({
  excludes: "code",
  addInputRules() { return [markRule(/(^|[^`\\])`([^`\n]+)`$/, 1, () => this.type)]; },
});
// An address is the words it is: nothing makes one a link while the owner types, and a pasted one over words is the field's own
// rule (composer-rich-field.ts), which reads only http and https as the reply renderer does.
const LinkMark = Link.configure({
  openOnClick: false, autolink: false, linkOnPaste: false, enableClickSelection: false, defaultProtocol: "https",
  isAllowedUri: url => !!messageUrl(url), HTMLAttributes: { class: "composer-link", rel: "noreferrer noopener", target: null },
});

// ------------------------------------------------------------------------------------------------------------- the blocks

const Item = ListItem.extend({
  // `checked` is null for a plain item and a boolean for a task (`- [ ]`, `- [x]`): the same list, one kind of item.
  addAttributes() {
    return {
      ...this.parent?.(),
      checked: {
        default: null,
        parseHTML: (element: HTMLElement) => { const task = element.getAttribute("data-task"); return task === "true" ? true : task === "false" ? false : null; },
        renderHTML: (attributes: { checked: boolean | null }) => (attributes.checked === null ? {} : { "data-task": String(attributes.checked) }),
      },
    };
  },
  addNodeView() { return ({ node, view, getPos }) => new ItemView(node, view, () => getPos()); },
});

// A plain-text numbered list is the field's own paste (composer-rich-field.ts), so TipTap's plugin for it is left out.
const NumberedList = OrderedList.extend({ addProseMirrorPlugins: () => [] });

const CodeBlockWithLanguage = CodeBlock.configure({ exitOnTripleEnter: false, exitOnArrowDown: false, exitOnArrowUp: false, defaultLanguage: null }).extend({
  // The language is named on the block's corner (composer-rich.css); a code editor's copy is the field's own paste.
  renderHTML({ node }) {
    const language = node.attrs.language as string | null;
    return ["pre", { "data-language": language || null }, ["code", language ? { class: `language-${language}` } : {}, 0]];
  },
  addInputRules() {
    return [textblockTypeInputRule({ find: /^```([\w#+.-]*)\s$/, type: this.type, getAttributes: match => ({ language: match[1]!.toLowerCase() }) })];
  },
  addProseMirrorPlugins: () => [],
});

// A divider is typed as three hyphens (composer-rich-field.ts); TipTap's own would also take `___` and `***`, which are words here.
const Divider = HorizontalRule.extend({ addInputRules: () => [] });

/** A table cell, as Markdown holds it: words, and the column's alignment. */
function cellOf<T extends typeof TableCell>(cell: T): T {
  return cell.extend({
    content: "inline*",
    addAttributes() {
      return {
        ...this.parent?.(),
        align: {
          default: null,
          parseHTML: (element: HTMLElement) => alignOf(element),
          renderHTML: (attributes: { align: CellAlign }) => (attributes.align ? { align: attributes.align } : {}),
        },
      };
    },
  }) as T;
}

/** A toggle: a line that opens and closes what is under it. Markdown spells it `<details>` with a `<summary>`. */
const Details = Node.create({
  name: "details", group: "block", content: "summary block*", defining: true,
  addAttributes() {
    return { open: { default: true, parseHTML: (element: HTMLElement) => element.hasAttribute("open"), renderHTML: (attributes: { open: boolean }) => (attributes.open ? { open: "" } : {}) } };
  },
  parseHTML() { return [{ tag: "details" }]; },
  renderHTML({ HTMLAttributes }) { return ["details", HTMLAttributes, 0]; },
  addNodeView() { return ({ node }) => new ToggleView(node); },
});
const Summary = Node.create({
  name: "summary", content: "inline*", defining: true, isolating: true,
  parseHTML() { return [{ tag: "summary" }]; },
  renderHTML() { return ["summary", 0]; },
  addNodeView() { return ({ view, getPos }) => new SummaryView(view, () => getPos()); },
});

/** An inline equation is one unit: Backspace right after it puts its `$…$` source back to edit. */
const MathInline = Node.create({
  name: "mathInline", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { latex: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-math-inline") ?? "" } }; },
  parseHTML() { return [{ tag: "span[data-math-inline]" }]; },
  renderHTML({ node }) { return ["span", { "data-math-inline": node.attrs.latex, class: "math-inline" }, `$${node.attrs.latex}$`]; },
  addNodeView() { return ({ node }) => new MathInlineView(node); },
});
/** A display equation: its LaTeX source is the text, drawn as the equation under it (composer-rich-views.ts). */
const MathBlock = Node.create({
  name: "mathBlock", group: "block", content: "text*", marks: "", code: true, defining: true, isolating: true,
  parseHTML() {
    return [{ tag: "div[data-math-block]", preserveWhitespace: "full", getContent: (dom: globalThis.Node, schema: Schema) => {
      const latex = (dom as HTMLElement).getAttribute("data-math-block") ?? "";
      return latex ? Fragment.from(schema.text(latex)) : Fragment.empty;
    } }];
  },
  renderHTML() { return ["div", { "data-math-source": "" }, 0]; },
  addNodeView() { return ({ node }) => new MathBlockView(node); },
});

/** The extensions that make the field's document: its nodes, its marks, its history. */
export function composerExtensions(): AnyExtension[] {
  return [
    Document, Paragraph, Text,
    HardBreak.configure({ keepMarks: false }),
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Blockquote, BulletList, NumberedList, Item, CodeBlockWithLanguage, Divider,
    Table.configure({ resizable: false, HTMLAttributes: {} }), TableRow, cellOf(TableHeader), cellOf(TableCell),
    Details, Summary, MathInline, MathBlock,
    LinkMark, BoldMark, ItalicMark, UnderlineMark, StrikeMark, HighlightMark, CodeMark,
    UndoRedo,
  ];
}

let standalone: Schema | undefined;
/** The schema of a field that is not on the screen (a draft's preview, a test): the same document, with no editor to hold it. */
export function standaloneSchema(): Schema {
  return standalone ??= getSchema(composerExtensions());
}

/** Whether a node is an empty paragraph: a blank line. */
export const isBlankLine = (node: PMNode): boolean => node.type.name === "paragraph" && node.content.size === 0;
