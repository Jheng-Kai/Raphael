// The composer's document model (ProseMirror): what the owner can write and see in the field. Every node has one Markdown
// spelling (composer-rich-markdown.ts), the one the members' replies are written in and the message renderer draws, so what is
// sent is the same text a reply would be. A line is a paragraph: Shift+Enter starts the next one, an empty paragraph is a blank
// line, which keeps every plain word exactly as it was typed.
import { Fragment, Schema, type DOMOutputSpec, type Mark, type MarkSpec, type MarkType, type Node as PMNode, type NodeSpec, type NodeType } from "prosemirror-model";
import { messageUrl } from "./markdown-text";

/** How a table column is aligned in its Markdown separator row. */
export type CellAlign = "left" | "center" | "right" | null;

const alignOf = (dom: HTMLElement): CellAlign => {
  const named = /\balign-(left|center|right)\b/.exec(dom.className)?.[1] ?? dom.getAttribute("align") ?? dom.style.textAlign;
  return named === "left" || named === "center" || named === "right" ? named : null;
};

const heading = (level: number): NonNullable<NodeSpec["parseDOM"]>[number] => ({ tag: `h${level}`, attrs: { level } });

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block", parseDOM: [{ tag: "p" }], toDOM: (): DOMOutputSpec => ["p", 0] },
  heading: {
    attrs: { level: { default: 1 } }, content: "inline*", group: "block", defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map(heading),
    toDOM: (node): DOMOutputSpec => [`h${node.attrs.level}`, 0],
  },
  blockquote: { content: "block+", group: "block", defining: true, parseDOM: [{ tag: "blockquote" }], toDOM: (): DOMOutputSpec => ["blockquote", 0] },
  code_block: {
    attrs: { language: { default: "" } }, content: "text*", marks: "", group: "block", code: true, defining: true,
    parseDOM: [{
      tag: "pre", preserveWhitespace: "full",
      getAttrs: dom => ({ language: /\blanguage-([\w+#.-]+)/.exec((dom as HTMLElement).querySelector("code")?.className ?? (dom as HTMLElement).className)?.[1] ?? (dom as HTMLElement).getAttribute("data-language") ?? "" }),
    }],
    toDOM: (node): DOMOutputSpec => ["pre", { "data-language": node.attrs.language || null }, ["code", 0]],
  },
  // A display equation: its LaTeX source is the text, drawn as the equation under it (composer-rich-views.ts).
  math_block: {
    content: "text*", marks: "", group: "block", code: true, defining: true, isolating: true,
    parseDOM: [{ tag: "div[data-math-block]", preserveWhitespace: "full", getContent: (dom, schema) => {
      const latex = (dom as HTMLElement).getAttribute("data-math-block") ?? "";
      return latex ? Fragment.from(schema.text(latex)) : Fragment.empty;
    } }],
    toDOM: (): DOMOutputSpec => ["div", { "data-math-source": "" }, 0],
  },
  horizontal_rule: { group: "block", parseDOM: [{ tag: "hr" }], toDOM: (): DOMOutputSpec => ["hr"] },
  bullet_list: { content: "list_item+", group: "block", parseDOM: [{ tag: "ul" }], toDOM: (): DOMOutputSpec => ["ul", 0] },
  ordered_list: {
    attrs: { order: { default: 1 } }, content: "list_item+", group: "block",
    parseDOM: [{ tag: "ol", getAttrs: dom => ({ order: Math.max(0, Math.floor(Number((dom as HTMLElement).getAttribute("start"))) || 1) }) }],
    toDOM: (node): DOMOutputSpec => node.attrs.order === 1 ? ["ol", 0] : ["ol", { start: node.attrs.order }, 0],
  },
  // `checked` is null for a plain item and a boolean for a task (`- [ ]`, `- [x]`): the same list, one kind of item.
  list_item: {
    attrs: { checked: { default: null } }, content: "paragraph block*", defining: true,
    parseDOM: [{ tag: "li", getAttrs: dom => {
      const task = (dom as HTMLElement).getAttribute("data-task");
      return { checked: task === "true" ? true : task === "false" ? false : null };
    } }],
    toDOM: (node): DOMOutputSpec => ["li", node.attrs.checked === null ? {} : { "data-task": String(node.attrs.checked) }, 0],
  },
  // A toggle: a line that opens and closes what is under it. Markdown spells it `<details>` with a `<summary>`.
  details: {
    attrs: { open: { default: true } }, content: "summary block*", group: "block", defining: true,
    parseDOM: [{ tag: "details", getAttrs: dom => ({ open: (dom as HTMLElement).hasAttribute("open") }) }],
    toDOM: (node): DOMOutputSpec => ["details", node.attrs.open ? { open: "" } : {}, 0],
  },
  summary: { content: "inline*", defining: true, isolating: true, parseDOM: [{ tag: "summary" }], toDOM: (): DOMOutputSpec => ["summary", 0] },
  table: { content: "table_row+", group: "block", isolating: true, parseDOM: [{ tag: "table" }], toDOM: (): DOMOutputSpec => ["table", ["tbody", 0]] },
  table_row: { content: "table_cell+", parseDOM: [{ tag: "tr" }], toDOM: (): DOMOutputSpec => ["tr", 0] },
  table_cell: {
    attrs: { align: { default: null } }, content: "inline*", isolating: true,
    parseDOM: [{ tag: "td", getAttrs: dom => ({ align: alignOf(dom as HTMLElement) }) }, { tag: "th", getAttrs: dom => ({ align: alignOf(dom as HTMLElement) }) }],
    toDOM: (node): DOMOutputSpec => ["td", node.attrs.align ? { align: node.attrs.align } : {}, 0],
  },
  text: { group: "inline" },
  hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: (): DOMOutputSpec => ["br"] },
  // An inline equation is one unit: Backspace right after it puts its `$…$` source back to edit.
  math_inline: {
    attrs: { latex: { default: "" } }, inline: true, group: "inline", atom: true, selectable: true,
    parseDOM: [{ tag: "span[data-math-inline]", getAttrs: dom => ({ latex: (dom as HTMLElement).getAttribute("data-math-inline") ?? "" }) }],
    toDOM: (node): DOMOutputSpec => ["span", { "data-math-inline": node.attrs.latex, class: "math-inline" }, `$${node.attrs.latex}$`],
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: {} }, inclusive: false,
    parseDOM: [{ tag: "a[href]", getAttrs: dom => { const href = messageUrl((dom as HTMLElement).getAttribute("href")); return href ? { href } : false; } }],
    toDOM: (mark): DOMOutputSpec => ["a", { href: mark.attrs.href, class: "composer-link", rel: "noreferrer noopener" }, 0],
  },
  strong: {
    parseDOM: [
      { tag: "strong" },
      // Google Docs wraps a whole copy in <b style="font-weight:normal">: that is no emphasis.
      { tag: "b", getAttrs: dom => (dom as HTMLElement).style.fontWeight !== "normal" && null },
      { style: "font-weight=400", clearMark: mark => mark.type.name === "strong" },
      { style: "font-weight", getAttrs: value => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null },
    ],
    toDOM: (): DOMOutputSpec => ["strong", 0],
  },
  em: {
    parseDOM: [{ tag: "i", getAttrs: dom => (dom as HTMLElement).style.fontStyle !== "normal" && null }, { tag: "em" },
      { style: "font-style=normal", clearMark: mark => mark.type.name === "em" }, { style: "font-style=italic" }],
    toDOM: (): DOMOutputSpec => ["em", 0],
  },
  strike: {
    parseDOM: [{ tag: "del" }, { tag: "s" }, { tag: "strike" }, { style: "text-decoration", consuming: false, getAttrs: value => /line-through/.test(value as string) ? null : false }],
    toDOM: (): DOMOutputSpec => ["del", 0],
  },
  code: { parseDOM: [{ tag: "code" }], toDOM: (): DOMOutputSpec => ["code", 0] },
};

export const composerSchema = new Schema({ nodes, marks });
export const composerNodes = composerSchema.nodes as Record<keyof typeof nodes, NodeType>;
export const composerMarks = composerSchema.marks as Record<keyof typeof marks, MarkType>;

/** Whether a node is an empty paragraph: a blank line. */
export const isBlankLine = (node: PMNode): boolean => node.type === composerNodes.paragraph && node.content.size === 0;
/** A link mark whose words are its own address: written as the bare address, as people write one. */
export const isBareLink = (mark: Mark, text: string): boolean => mark.type === composerMarks.link && mark.attrs.href === text;
