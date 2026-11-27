// Markdown in and out of the composer's document, in the dialect the message renderer draws (message-content.ts): a line is a
// paragraph, a blank line is an empty paragraph, and a blank line beside a block (a heading, a list, a quote...) is only the gap
// that sets it apart. So every plain word the owner types comes back exactly as typed, and what is sent is ordinary Markdown.
//
// Writing also keeps a map of where each ProseMirror position stands in the text (`OffsetMap`): the composer's helpers (the @ and
// / menus, the history walk, dictation) speak in offsets of the text, as they did for a plain field.
import { Fragment, type Mark, type Node as PMNode, Slice as PMSlice, type Slice } from "prosemirror-model";
import { composerMarks as M, composerNodes as N, composerSchema as S, isBlankLine } from "./composer-rich-schema";
import { bareUrl, linkDestination, messageUrl, tableCells } from "./markdown-text";

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

// ---------------------------------------------------------------------------------------------------------------- reading

const withMark = (marks: readonly Mark[], mark: Mark): readonly Mark[] => mark.addToSet(marks as Mark[]);

/** Where the closing `ch` run of exactly `size` characters that ends an emphasis opened before `from` stands, or -1. */
function closerOf(text: string, from: number, ch: string, size: number): number {
  for (let at = from; at < text.length; at++) {
    const c = text[at]!;
    if (c === "\\") { at++; continue; }
    if (c === "`") {
      const run = /^`+/.exec(text.slice(at))![0], end = text.indexOf(run, at + run.length);
      at = end > at ? end + run.length - 1 : at + run.length - 1;
      continue;
    }
    if (c !== ch) continue;
    let run = 1;
    while (text[at + run] === ch) run++;
    if (run === size && at > from && !SPACE.test(text[at - 1]!) && (ch !== "_" || !WORD.test(text[at + run] ?? ""))) return at;
    at += run - 1;
  }
  return -1;
}

/** Where the bracket opened at `open` closes, or -1; escapes and nested brackets are skipped. */
function closingBracket(text: string, open: number): number {
  let level = 1;
  for (let at = open + 1; at < text.length; at++) {
    if (text[at] === "\\") at++;
    else if (text[at] === "[") level++;
    else if (text[at] === "]" && --level === 0) return at;
  }
  return -1;
}

/** An inline equation `$…$` starting at `at` (Pandoc's rule: no space inside its edges, no digit straight after it), or its end. */
function mathEnd(text: string, at: number): number {
  const next = text[at + 1];
  if (!next || SPACE.test(next) || next === "$") return -1;
  for (let end = at + 1; end < text.length; end++) {
    if (text[end] === "\\") { end++; continue; }
    if (text[end] !== "$") continue;
    return end > at + 1 && !SPACE.test(text[end - 1]!) && !/\d/.test(text[end + 1] ?? "") ? end : -1;
  }
  return -1;
}

/** The address that starts at `at`: it ends at a backslash, which is an escape's and never an address's. */
function addressAt(text: string, at: number): string {
  const raw = bareUrl(text.slice(at)), cut = raw.indexOf("\\");
  return cut > 0 ? raw.slice(0, cut) : cut === 0 ? "" : raw;
}

/** One line of words as inline nodes: emphasis, strike, code, links, equations; an address stays the words it is. */
export function parseInline(text: string, marks: readonly Mark[] = [], depth = 0): PMNode[] {
  const out: PMNode[] = [];
  let plain = "", at = 0;
  const flush = (): void => { if (plain) out.push(S.text(plain, marks as Mark[])); plain = ""; };
  while (at < text.length) {
    const ch = text[at]!;
    if (ch === "\\" && PUNCTUATION.test(text[at + 1] ?? "")) { plain += text[at + 1]; at += 2; continue; }
    if (ch === "`") {
      const run = /^`+/.exec(text.slice(at))![0];
      let end = text.indexOf(run, at + run.length);
      while (end >= 0 && text[end + run.length] === "`") end = text.indexOf(run, end + run.length + 1);
      if (end > at + run.length) {
        let code = text.slice(at + run.length, end);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        flush(); out.push(S.text(code, withMark(marks, M.code!.create()) as Mark[])); at = end + run.length; continue;
      }
      plain += run; at += run.length; continue;
    }
    if (ch === "!" && text[at + 1] === "[") {
      // A picture's words stay as written: attachments are the paperclip's, not Markdown's.
      const middle = closingBracket(text, at + 1);
      if (middle > 0 && text[middle + 1] === "(") {
        let end = middle + 2, level = 1;
        for (; end < text.length && level; end++) { if (text[end] === "(") level++; if (text[end] === ")") level--; }
        if (!level) { plain += text.slice(at, end); at = end; continue; }
      }
    }
    if (ch === "[" && depth < 6) {
      const middle = closingBracket(text, at);
      if (middle > 0 && text[middle + 1] === "(") {
        let end = middle + 2, level = 1;
        for (; end < text.length && level; end++) { if (text[end] === "(") level++; if (text[end] === ")") level--; }
        const target = level ? "" : linkDestination(text.slice(middle + 2, end - 1)), url = messageUrl(target) ? target : null;
        if (url) {
          flush();
          const label = text.slice(at + 1, middle);
          if (label.trim() === "") out.push(S.text(url, withMark(marks, M["link"]!.create({ href: url })) as Mark[]));
          else out.push(...parseInline(label, withMark(marks, M["link"]!.create({ href: url })), depth + 1));
          at = end; continue;
        }
      }
    }
    if (ch === "h" && /^https?:\/\//i.test(text.slice(at, at + 8))) {
      const raw = addressAt(text, at);
      if (raw) { plain += raw; at += raw.length; continue; }
    }
    if (ch === "$" && depth < 6) {
      const end = mathEnd(text, at);
      if (end > 0) { flush(); out.push(N.math_inline!.create({ latex: text.slice(at + 1, end) }, null, marks as Mark[])); at = end + 1; continue; }
    }
    if ((ch === "*" || ch === "_") && depth < 6) {
      let run = 1;
      while (text[at + run] === ch) run++;
      const size = Math.min(run, 3), edge = text[at + run];
      const opens = run <= 3 && edge !== undefined && !SPACE.test(edge) && !(ch === "_" && at > 0 && WORD.test(text[at - 1]!));
      const end = opens ? closerOf(text, at + run, ch, size) : -1;
      if (end > 0) {
        flush();
        let inner = marks;
        if (size >= 2) inner = withMark(inner, M.strong!.create());
        if (size !== 2) inner = withMark(inner, M.em!.create());
        out.push(...parseInline(text.slice(at + run, end), inner, depth + 1));
        at = end + run; continue;
      }
      plain += text.slice(at, at + run); at += run; continue;
    }
    if (ch === "~" && text[at + 1] === "~" && depth < 6) {
      let run = 2;
      while (text[at + run] === "~") run++;
      const edge = text[at + run], end = run === 2 && edge !== undefined && !SPACE.test(edge) ? closerOf(text, at + 2, "~", 2) : -1;
      if (end > 0) { flush(); out.push(...parseInline(text.slice(at + 2, end), withMark(marks, M.strike!.create()), depth + 1)); at = end + 2; continue; }
      plain += text.slice(at, at + run); at += run; continue;
    }
    plain += ch; at++;
  }
  flush();
  return out;
}

const paragraphOf = (text: string): PMNode => N.paragraph!.create(null, parseInline(text));
const blank = (): PMNode => N.paragraph!.create();

interface ListItem { indent: number; ordered: boolean; order: number; checked: boolean | null; text: string; more: string[]; nested: ListNode[] }
interface ListNode { ordered: boolean; order: number; indent: number; items: ListItem[] }

const ITEM = /^( *)(?:([-+*])|(\d{1,9})[.)]) (.*)$/;
const FENCE = /^ *(`{3,}|~{3,}) *([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6}) (.*)$/;
const RULE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const QUOTE = /^ *>/;
const DETAILS = /^ *<details(?:\s[^>]*)?>/i;

function listNode(item: ListItem): ListNode { return { ordered: item.ordered, order: item.order, indent: item.indent, items: [item] }; }

/** The lines of one list, nested by their indent as the renderer nests them, as nodes. */
function listBlocks(lines: string[]): PMNode[] {
  const roots: ListNode[] = [], stack: ListNode[] = [];
  let last: ListItem | undefined;
  for (const line of lines) {
    const match = ITEM.exec(line);
    if (!match) { last?.more.push(line.trim()); continue; }
    const indent = match[1]!.length, ordered = !match[2];
    let body = match[4]!, checked: boolean | null = null;
    const task = /^\[([ xX])\](?: (.*))?$/.exec(body);
    if (task) { checked = task[1] !== " "; body = task[2] ?? ""; }
    const item: ListItem = { indent, ordered, order: Number(match[3] ?? 1), checked, text: body, more: [], nested: [] };
    while (stack.length && stack[stack.length - 1]!.indent > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (!top) { const list = listNode(item); roots.push(list); stack.push(list); }
    else if (top.indent === indent && top.ordered === ordered) top.items.push(item);
    else if (top.indent === indent) {
      stack.pop();
      const list = listNode(item), parent = (stack[stack.length - 1]?.items ?? [])[(stack[stack.length - 1]?.items.length ?? 1) - 1];
      if (parent) parent.nested.push(list); else roots.push(list);
      stack.push(list);
    } else { const list = listNode(item); top.items[top.items.length - 1]!.nested.push(list); stack.push(list); }
    last = item;
  }
  const build = (list: ListNode): PMNode => (list.ordered ? N.ordered_list! : N.bullet_list!).create(list.ordered ? { order: list.order } : null,
    list.items.map(item => N.list_item!.create({ checked: item.checked }, [paragraphOf(item.text), ...item.more.map(paragraphOf), ...item.nested.map(build)])));
  return roots.map(build);
}

/** Everything between `<details>` and its closing tag, from line `from`: its end and the node. */
function detailsAt(lines: string[], from: number): { end: number; node: PMNode } {
  let level = 0, end = from;
  const region: string[] = [];
  for (; end < lines.length; end++) {
    const line = lines[end]!;
    level += (line.match(/(?<!\\)<details[\s>]/gi) ?? []).length - (line.match(/(?<!\\)<\/details>/gi) ?? []).length;
    region.push(line);
    if (level <= 0) { end++; break; }
  }
  let inner = region.join("\n");
  const open = /^\s*<details(\s[^>]*)?>/i.exec(inner)!;
  inner = inner.slice(open[0].length).replace(/<\/details>\s*$/i, "");
  const summary = /^\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i.exec(inner);
  const body = summary ? inner.slice(summary[0].length) : inner;
  const blocks = trimBlanks(parseBlocks(body.replace(/^\n/, "").split("\n")));
  return {
    end,
    node: N.details!.create({ open: /\bopen\b/i.test(open[1] ?? "") },
      [N.summary!.create(null, parseInline((summary?.[1] ?? "").replace(/\s*\n\s*/g, " ").trim())), ...blocks]),
  };
}

/** The lines as blocks. A blank line is an empty paragraph, except the one beside a block, which only sets it apart. */
function parseBlocks(lines: string[]): PMNode[] {
  const out: PMNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (line === "") { out.push(blank()); i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(`^ *${fence[1]![0]}{${fence[1]!.length},} *$`), body: string[] = [];
      for (i++; i < lines.length && !close.test(lines[i]!); i++) body.push(lines[i]!);
      i++;
      const text = body.join("\n");
      out.push(N.code_block!.create({ language: fence[2]!.toLowerCase() }, text ? S.text(text) : null));
      continue;
    }
    const single = /^ *\$\$(.+)\$\$ *$/.exec(line);
    if (single && single[1]!.trim()) { out.push(N.math_block!.create(null, S.text(single[1]!.trim()))); i++; continue; }
    if (/^ *\$\$ *$/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^ *\$\$ *$/.test(lines[i]!); i++) body.push(lines[i]!);
      i++;
      const text = body.join("\n");
      out.push(N.math_block!.create(null, text ? S.text(text) : null));
      continue;
    }
    if (DETAILS.test(line)) { const found = detailsAt(lines, i); out.push(found.node); i = found.end; continue; }
    const heading = HEADING.exec(line);
    if (heading) { out.push(N.heading!.create({ level: heading[1]!.length }, parseInline(heading[2]!.replace(/(?:^| )#+ *$/, "").trimEnd()))); i++; continue; }
    if (RULE.test(line)) { out.push(N.horizontal_rule!.create()); i++; continue; }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]!); i++) body.push(lines[i]!.replace(/^ *> ?/, ""));
      out.push(N.blockquote!.create(null, parseBlocks(body)));
      continue;
    }
    if (ITEM.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && lines[i] !== ""; i++) {
        if (!ITEM.test(lines[i]!) && !/^ {2,}\S/.test(lines[i]!)) break;
        body.push(lines[i]!);
      }
      out.push(...listBlocks(body));
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length) {
      const header = tableCells(line), separators = tableCells(lines[i + 1]!);
      if (header.length === separators.length && separators.every(cell => /^:?-+:?$/.test(cell))) {
        const align = separators.map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : cell.startsWith(":") ? "left" : null);
        const rows = [header];
        for (i += 2; i < lines.length && lines[i]!.trim() && lines[i]!.includes("|"); i++) { const cells = tableCells(lines[i]!); rows.push(header.map((_, index) => cells[index] ?? "")); }
        out.push(N.table!.create(null, rows.map(cells => N.table_row!.create(null, cells.map((cell, index) => N.table_cell!.create({ align: align[index] }, parseInline(cell)))))));
        continue;
      }
    }
    out.push(paragraphOf(line)); i++;
  }
  return dropGaps(out);
}

/** The blank line beside a block (before it, after it) sets it apart and is not a line of its own; the writer puts it back. */
function dropGaps(blocks: PMNode[]): PMNode[] {
  const gap = new Set<number>();
  blocks.forEach((block, index) => {
    if (isParagraphNode(block)) return;
    if (index > 0 && isBlankLine(blocks[index - 1]!) && !gap.has(index - 1)) gap.add(index - 1);
    if (index + 1 < blocks.length && isBlankLine(blocks[index + 1]!) && !gap.has(index + 1)) gap.add(index + 1);
  });
  return blocks.filter((_, index) => !gap.has(index));
}

const trimBlanks = (blocks: PMNode[]): PMNode[] => {
  let from = 0, to = blocks.length;
  while (from < to && isBlankLine(blocks[from]!)) from++;
  while (to > from && isBlankLine(blocks[to - 1]!)) to--;
  return blocks.slice(from, to);
};

const isParagraphNode = (node: PMNode): boolean => node.type === N.paragraph;

/** The document a Markdown text is. */
export function parseMarkdown(text: string): PMNode {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks = text === "" ? [] : parseBlocks(lines);
  return N.doc!.create(null, blocks.length ? blocks : [blank()]);
}

// ---------------------------------------------------------------------------------------------------------------- writing

/** A piece of a line: `run` and `atom` stand for ProseMirror positions, `struct` is syntax with none. */
type Chunk = { kind: "struct"; t: string } | { kind: "run"; t: string; pm: number } | { kind: "atom"; t: string; pm: number } | { kind: "atom0"; t: string; pm: number };
type Line = Chunk[];

/** The text, and where each of its stretches stands in the document: pairs of (document position, offset, length). */
export interface OffsetMap { segs: readonly { pm: number; md: number; len: number }[]; size: number }
export interface Written { text: string; map: OffsetMap }

interface Tok { kind: "text" | "atom" | "break"; text: string; marks: readonly Mark[]; pm: number; raw?: boolean }
type Kind = "paragraph" | "inline";
/** `level` is how much is escaped: 0 only what must be, 1 the signs of emphasis and code, 2 every sign of Markdown. */
interface Context { level: 0 | 1 | 2; kind: Kind; cell: boolean }

const SPREAD = new Set(["strong", "em", "strike"]);
const spreads = (marks: readonly Mark[]): boolean => marks.some(mark => SPREAD.has(mark.type.name));

function tokensOf(parent: PMNode, start: number, flat: boolean): Tok[] {
  const list: Tok[] = [];
  parent.forEach((child, offset) => {
    const pm = start + offset;
    if (child.isText) {
      const text = child.text!, marks = child.marks;
      if (!spreads(marks)) { list.push({ kind: "text", text, marks, pm }); return; }
      // Emphasis hugs its words: the spaces at its edges stay outside it.
      const lead = /^\s*/.exec(text)![0].length, trail = text.trim() ? /\s*$/.exec(text)![0].length : 0;
      const plain = marks.filter(mark => !SPREAD.has(mark.type.name));
      if (!text.trim()) { list.push({ kind: "text", text, marks: plain, pm }); return; }
      if (lead) list.push({ kind: "text", text: text.slice(0, lead), marks: plain, pm });
      list.push({ kind: "text", text: text.slice(lead, text.length - trail), marks, pm: pm + lead });
      if (trail) list.push({ kind: "text", text: text.slice(text.length - trail), marks: plain, pm: pm + text.length - trail });
    } else if (child.type === N.hard_break) list.push(flat ? { kind: "text", text: " ", marks: [], pm } : { kind: "break", text: "", marks: [], pm });
    else if (child.type === N.math_inline) list.push({ kind: "atom", text: `$${child.attrs.latex}$`, marks: child.marks, pm });
  });
  // A link whose words are its own address is written as the bare address.
  for (let i = 0; i < list.length; i++) {
    const link = list[i]!.marks.find(mark => mark.type === M["link"]);
    if (!link || list[i]!.kind !== "text") continue;
    let end = i, text = "";
    while (end < list.length && list[end]!.kind === "text" && list[end]!.marks.some(mark => mark.eq(link))) text += list[end++]!.text;
    if (text !== link.attrs.href || list.slice(i, end).some(tok => tok.marks.length !== 1)) { i = end - 1; continue; }
    list.splice(i, end - i, ...list.slice(i, end).map(tok => ({ ...tok, marks: [], raw: true })));
    i = end - 1;
  }
  return list;
}

const ESCAPABLE: readonly RegExp[] = [/(?!)/, /[*_~`]/, /[*_~`$[\]<]/];
type Hazards = "paragraph" | "item" | "none";

/** Where, in the first words of a line, the one character that would make it something else stands (a heading, an item...), or -1. */
function lineStartHazard(text: string, hazards: Hazards): number {
  if (hazards === "none") return -1;
  const lead = / */.exec(text)![0].length, rest = text.slice(lead);
  if (/^\[[ xX]\]( |$)/.test(rest)) return lead;
  if (hazards === "item") return -1;
  if (lead <= 3 && /^#{1,6} /.test(rest)) return lead;
  if (/^[-+*] /.test(rest)) return lead;
  const number = /^\d{1,9}([.)]) /.exec(rest);
  if (number) return lead + number[0].length - 2;
  if (/^>/.test(rest)) return lead;
  if (/^(`{3,}|~{3,})/.test(rest)) return lead;
  if (/^\$\$/.test(rest)) return lead;
  if (/^<\/?(details|summary)\b/i.test(rest)) return lead;
  if (lead <= 3 && /^([-*_])(?: *\1){2,} *$/.test(rest)) return lead;
  return -1;
}

function textChunks(tok: Tok, context: Context, hazard: number, final: boolean): Chunk[] {
  const chunks: Chunk[] = [];
  const { text } = tok;
  let from = 0;
  const flush = (to: number): void => { if (to > from) chunks.push({ kind: "run", t: text.slice(from, to), pm: tok.pm + from }); };
  // An address is read as it stands, so nothing inside it is escaped.
  const addresses: [number, number][] = [];
  if (/https?:\/\//i.test(text)) for (const found of text.matchAll(/https?:\/\//gi)) {
    if (addresses.length && found.index! < addresses[addresses.length - 1]![1]) continue;
    const raw = addressAt(text, found.index!);
    if (raw) addresses.push([found.index!, found.index! + raw.length]);
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (context.level === 0 && addresses.some(([start, end]) => i >= start && i < end)) continue;
    const escape = i === hazard || (ch === "<" && /^<\/?(details|summary)\b/i.test(text.slice(i, i + 10)))
      || (ch === "\\" && (i === text.length - 1 ? !final : PUNCTUATION.test(text[i + 1]!)))
      || (context.level > 0 && ESCAPABLE[context.level]!.test(ch))
      || (context.cell && ch === "|");
    if (!escape) continue;
    flush(i);
    chunks.push({ kind: "atom0", t: "\\", pm: tok.pm + i });
    from = i;
  }
  flush(text.length);
  return chunks;
}

const tickRun = (text: string): number => Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));

/** The tokens of one line as chunks, with each mark's delimiters around the words it holds. */
function lineChunks(toks: Tok[], context: Context, hazards: Hazards): Line {
  const line: Line = [];
  const struct = (t: string): void => { line.push({ kind: "struct", t }); };
  let open: Mark[] = [], fence = "", pad = "";
  const opening = (mark: Mark, index: number): void => {
    switch (mark.type.name) {
      case "strong": struct("**"); break;
      case "em": struct("*"); break;
      case "strike": struct("~~"); break;
      case "link": struct("["); break;
      default: {
        let content = "";
        for (let next = index; next < toks.length && toks[next]!.marks.some(other => other.eq(mark)); next++) content += toks[next]!.text;
        fence = "`".repeat(tickRun(content) + 1);
        pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
        struct(fence + pad);
      }
    }
  };
  const closing = (mark: Mark): void => {
    switch (mark.type.name) {
      case "strong": struct("**"); break;
      case "em": struct("*"); break;
      case "strike": struct("~~"); break;
      case "link": { const href = String(mark.attrs.href); struct(`](${/[\s()]/.test(href) ? `<${href}>` : href})`); break; }
      default: struct(pad + fence);
    }
  };
  let first = true;
  toks.forEach((tok, index) => {
    const want = tok.marks;
    const gone = open.findIndex(mark => !want.some(other => other.eq(mark)));
    if (gone >= 0) {
      for (let k = open.length - 1; k >= gone; k--) closing(open[k]!);
      const survivors = open.slice(gone).filter(mark => want.some(other => other.eq(mark)));
      open = open.slice(0, gone);
      for (const mark of survivors) { opening(mark, index); open.push(mark); }
    }
    for (const mark of want) if (!open.some(other => other.eq(mark))) { opening(mark, index); open.push(mark); }
    if (tok.kind === "atom") line.push({ kind: "atom", t: tok.text, pm: tok.pm });
    else if (tok.raw || tok.marks.some(mark => mark.type === M.code)) { if (tok.text) line.push({ kind: "run", t: tok.text, pm: tok.pm }); }
    else line.push(...textChunks(tok, context, first && !tok.marks.length ? lineStartHazard(tok.text, hazards) : -1, index === toks.length - 1 && !tok.marks.length));
    first = false;
  });
  for (let k = open.length - 1; k >= 0; k--) closing(open[k]!);
  return line;
}

const textOf = (line: Line): string => line.map(chunk => chunk.t).join("");

/** The words of one text block as lines (a hard break starts the next), written so that reading them back gives the same words. */
function textblockLines(node: PMNode, start: number, kind: Kind, hazards: Hazards = "none", cell = false): Line[] {
  const toks = tokensOf(node, start, kind === "inline");
  const lines: Tok[][] = [[]], breaks: number[] = [];
  for (const tok of toks) if (tok.kind === "break") { lines.push([]); breaks.push(tok.pm); } else lines[lines.length - 1]!.push(tok);
  const build = (level: 0 | 1 | 2): Line[] => lines.map((line, index) => [
    { kind: "run" as const, t: "", pm: index === 0 ? start : breaks[index - 1]! + 1 }, ...lineChunks(line, { level, kind, cell }, hazards)]);
  let written = build(0);
  const risky = toks.some(tok => tok.kind === "atom" || (!tok.raw && (/[\\*_~`$[<!|]/.test(tok.text) || tok.marks.length)));
  // Each step escapes more, and the first that reads back as the same words is the one written.
  for (const level of [1, 2] as const) if (risky && !readsBack(written, lines, kind)) written = build(level);
  return written;
}

/** Whether the written lines read back as the words they were written from. */
function readsBack(written: Line[], lines: Tok[][], kind: Kind): boolean {
  return written.every((line, index) => {
    const text = textOf(line), original = Fragment.fromArray(tokensToNodes(lines[index]!));
    if (kind === "paragraph") {
      if (text === "") return original.childCount === 0;
      const blocks = parseBlocks([text]);
      return blocks.length === 1 && isParagraphNode(blocks[0]!) && blocks[0]!.content.eq(original);
    }
    return Fragment.fromArray(parseInline(text)).eq(original);
  });
}

function tokensToNodes(toks: Tok[]): PMNode[] {
  return toks.flatMap(tok => tok.kind === "atom" ? [N.math_inline!.create({ latex: tok.text.slice(1, -1) }, null, tok.marks as Mark[])]
    : tok.text ? [S.text(tok.text, tok.marks as Mark[])] : []);
}

const prefixed = (lines: Line[], first: string, rest: string): Line[] => lines.map((line, index) => {
  const lead = index === 0 ? first : rest;
  return lead ? [{ kind: "struct" as const, t: lead }, ...line] : line;
});
const plainLine = (t: string): Line => [{ kind: "struct", t }];

function blockLines(node: PMNode, pos: number): Line[] {
  const start = pos + 1;
  switch (node.type.name) {
    case "paragraph": return textblockLines(node, start, "paragraph", "paragraph");
    case "heading": {
      const [line] = textblockLines(node, start, "inline");
      return [[{ kind: "struct", t: "#".repeat(node.attrs.level) + " " }, ...line!]];
    }
    case "blockquote": return prefixed(blocksLines(node, start), "> ", "> ").map(line => line.length === 1 && line[0]!.t === "> " ? plainLine(">") : line);
    case "code_block": case "math_block": {
      const text = node.textContent, math = node.type === N.math_block;
      const fence = math ? "$$" : "`".repeat(Math.max(3, tickRun(text) + 1));
      const body: Line[] = [];
      let offset = 0;
      for (const piece of text.split("\n")) { body.push([{ kind: "run", t: piece, pm: start + offset }]); offset += piece.length + 1; }
      return [plainLine(fence + (math ? "" : node.attrs.language ?? "")), ...body, plainLine(fence)];
    }
    case "horizontal_rule": return [plainLine("---")];
    case "bullet_list": case "ordered_list": {
      const ordered = node.type === N.ordered_list, lines: Line[] = [];
      node.forEach((item, offset, index) => lines.push(...itemLines(item, start + offset, ordered ? `${node.attrs.order + index}. ` : "- ")));
      return lines;
    }
    case "details": {
      const summary = node.firstChild!;
      const [head] = textblockLines(summary, start + 1, "inline");
      let used = node.childCount;
      while (used > 1 && isBlankLine(node.child(used - 1))) used--;
      const body = used > 1 ? blocksLines(node, start, 1, used) : [];
      return [plainLine(node.attrs.open ? "<details open>" : "<details>"), [{ kind: "struct", t: "<summary>" }, ...head!, { kind: "struct", t: "</summary>" }],
        ...(body.length ? [[], ...body, []] : []), plainLine("</details>")];
    }
    case "table": {
      const rows: Line[] = [];
      node.forEach((row, rowOffset, rowIndex) => {
        const joined: Line = [{ kind: "struct", t: "| " }];
        row.forEach((cell, cellOffset, index) => {
          const [line] = textblockLines(cell, start + rowOffset + 1 + cellOffset + 1, "inline", "none", true);
          joined.push(...line!, { kind: "struct", t: index === row.childCount - 1 ? " |" : " | " });
        });
        rows.push(joined);
        if (rowIndex === 0) {
          const align = Array.from({ length: row.childCount }, (_, index) => row.child(index).attrs.align as string | null);
          rows.push(plainLine("| " + align.map(a => a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---").join(" | ") + " |"));
        }
      });
      return rows;
    }
    default: return [];
  }
}

function itemLines(item: PMNode, pos: number, marker: string): Line[] {
  const start = pos + 1, task = item.attrs.checked !== null;
  const lead = marker + (task ? (item.attrs.checked ? "[x] " : "[ ] ") : "");
  const indent = " ".repeat(marker.length);
  const lines: Line[] = [];
  item.forEach((child, offset, index) => {
    const childPos = start + offset;
    if (index === 0) lines.push(...prefixed(textblockLines(child, childPos + 1, "inline", task ? "none" : "item"), lead, indent));
    else if (child.type === N.paragraph) lines.push(...prefixed(textblockLines(child, childPos + 1, "inline"), indent, indent));
    else lines.push(...prefixed(blockLines(child, childPos), indent, indent));
  });
  return lines;
}

/** The blocks of `parent` from its child `from` to `to`, a blank line between those that are not both paragraphs; `start` is where its content begins. */
function blocksLines(parent: PMNode, start: number, from = 0, to = parent.childCount): Line[] {
  const lines: Line[] = [];
  let previous: PMNode | null = null;
  parent.forEach((child, offset, index) => {
    if (index < from || index >= to) return;
    // The empty paragraph that ends the document after a block is the gap the editor keeps open below it.
    if (index === parent.childCount - 1 && previous && isBlankLine(child) && !isParagraphNode(previous)) return;
    if (previous && (!isParagraphNode(previous) || !isParagraphNode(child))) lines.push([]);
    lines.push(...blockLines(child, start + offset));
    previous = child;
  });
  return lines;
}

function flatten(lines: Line[]): Written {
  let text = "";
  const segs: { pm: number; md: number; len: number }[] = [];
  lines.forEach((line, index) => {
    if (index) text += "\n";
    for (const chunk of line) {
      if (chunk.kind === "run") segs.push({ pm: chunk.pm, md: text.length, len: chunk.t.length });
      else if (chunk.kind === "atom0") segs.push({ pm: chunk.pm, md: text.length, len: 0 });
      else if (chunk.kind === "atom") { segs.push({ pm: chunk.pm, md: text.length, len: 0 }, { pm: chunk.pm + 1, md: text.length + chunk.t.length, len: 0 }); }
      text += chunk.t;
    }
  });
  return { text, map: { segs, size: text.length } };
}

/** The document as Markdown, with the map between its positions and the text's offsets. */
export function serializeMarkdown(doc: PMNode): Written {
  return flatten(blocksLines(doc, 0));
}

/** The words of any stretch of a document (a copied selection) as Markdown. */
export function fragmentToMarkdown(content: Fragment): string {
  try {
    const blocks = content.childCount && content.firstChild!.isInline ? [N.paragraph!.create(null, content)] : content.content;
    const wrapped = blocks.map(block => block.type === N.list_item ? N.bullet_list!.create(null, block) : block);
    return serializeMarkdown(N.doc!.create(null, wrapped)).text;
  } catch {
    return content.textBetween(0, content.size, "\n", "\n");
  }
}

// ---------------------------------------------------------------------------------------------------------------- offsets

/** The text offset of a document position. Where a stretch ends and the next begins (a mark's delimiter between), the first. */
export function offsetOf(map: OffsetMap, pos: number): number {
  const { segs } = map;
  if (!segs.length) return 0;
  let low = 0, high = segs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (segs[mid]!.pm + segs[mid]!.len >= pos) high = mid; else low = mid + 1;
  }
  const seg = segs[low], before = segs[low - 1];
  if (!seg) return before!.md + before!.len;
  if (seg.pm <= pos) return seg.md + (pos - seg.pm);
  return !before || seg.pm - pos <= pos - (before.pm + before.len) ? seg.md : before.md + before.len;
}

/** The document position of a text offset. */
export function positionOf(map: OffsetMap, offset: number): number {
  const { segs } = map;
  if (!segs.length) return 0;
  let low = 0, high = segs.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segs[mid]!.md <= offset) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  if (found < 0) return segs[0]!.pm;
  // Among stretches that start at the same offset the last is the one the offset enters.
  const seg = segs[found]!;
  if (offset <= seg.md + seg.len) return seg.pm + (offset - seg.md);
  const next = segs[found + 1];
  return !next || offset - (seg.md + seg.len) < next.md - offset ? seg.pm + seg.len : next.pm;
}

// ---------------------------------------------------------------------------------------------------------------- pasting

/** Whether pasted words are Markdown the owner meant: a block (heading, list, quote, code, table...) or a marked pair of words. */
export function looksLikeMarkdown(text: string): boolean {
  if (/^ {0,3}(#{1,6} |[-+*] |\d{1,9}[.)] |>|```|~~~|\$\$ *$|<details)/m.test(text)) return true;
  if (/^ {0,3}([-*_])( *\1){2,} *$/m.test(text)) return true;
  if (/^\|.*\|[ \t]*\n[ \t]*\|?[ \t]*:?-+:?[ \t]*\|/m.test(text)) return true;
  return /(\*\*|__)(?=\S)[\s\S]*?\S\1|(?<![\w*])\*(?=\S)[^*\n]+\S\*(?![\w*])|`[^`\n]+`|~~(?=\S)[\s\S]*?\S~~|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|(?<![\w$])\$(?=[^\s$])[^$\n]*[^\s$]\$(?!\d)/.test(text);
}

/** The words, one line of plain text with no Markdown marks, for a place that only previews them (the sidebar's draft line). */
export function plainWords(markdown: string): string {
  const doc = parseMarkdown(markdown), parts: string[] = [];
  doc.descendants(node => {
    if (node.isTextblock) { const text = node.textBetween(0, node.content.size, " ", " ").trim(); if (text) parts.push(text); return false; }
    return true;
  });
  return parts.join(" ");
}

/** A slice of pasted Markdown, its first and last paragraphs open so that they join the words around the caret. */
export function markdownSlice(text: string): Slice {
  const content = parseMarkdown(text.replace(/^[ 	]+$/gm, "")).content;
  return new PMSlice(content, isParagraphNode(content.firstChild!) && content.firstChild!.childCount ? 1 : 0, isParagraphNode(content.lastChild!) && content.lastChild!.childCount ? 1 : 0);
}
