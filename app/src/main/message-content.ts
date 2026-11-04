// One typed reply parser for history, streaming, search and copy. Only generated tags enter HTML.
import { highlightHTML } from "./conversation";
import { getLocale, t } from "./i18n";
import { mentionsHTML, type MentionTarget } from "./mention-text";
import { esc, ico, iconBtn } from "./ui";
import { answerFormHTML } from "./message-forms";
import { answerFormText, isAnswerFormKind, parseAnswerForm } from "../shared/answer-forms";
import { publicEventText } from "./public-event";
import { composioText } from "./composio-result";

// A file of the team folder is one press from opening; any other path is words the owner can use.
const TEAM_FILE = /^\/home\/cua\/team\/[^\s<>"'`]+$/;
function pathHTML(path: string, query: string): string {
  if (!TEAM_FILE.test(path)) return `<code>${highlightHTML(path, query)}</code>`;
  return `<button type="button" class="btn team-file" data-act="team-file-open" data-path="${esc(path)}" title="${esc(t("agent.openFile"))}">${ico("file")}<span>${highlightHTML(path.slice(path.lastIndexOf("/") + 1), query)}</span></button>`;
}

export function messageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function urlLabel(url: string): string {
  const parsed = new URL(url);
  // A path in another script reads as the words it is, not as its percent codes.
  let path = parsed.pathname;
  try { path = decodeURI(path); } catch { /* A broken code stays as it came. */ }
  return parsed.host + (path === "/" ? "" : path);
}

export function shortUrl(url: string): string {
  const label = urlLabel(url);
  return label.length > 32 ? label.slice(0, 31) + "…" : label;
}

export function bareUrl(text: string): string {
  let raw = /^https?:\/\/[^\s<>"'`《》「」『』【】（）。，、！？；：…]+/i.exec(text)?.[0] ?? "";
  raw = raw.replace(/[.,;:!?*_]+$/, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    while (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) raw = raw.slice(0, -1);
  }
  return raw;
}

function inline(text: string, query: string, markdown: boolean, urls: Set<string>, depth = 0, mentions: readonly MentionTarget[] = []): string {
  let out = "", at = 0, plain = "";
  const flush = (): void => { out += mentions.length ? mentionsHTML(plain, mentions, words => highlightHTML(words, query)) : highlightHTML(plain, query); plain = ""; };
  const link = (raw: string, label?: string): string | null => {
    const url = messageUrl(raw);
    if (!url) return null;
    urls.add(url);
    return `<a class="message-link" href="${esc(url)}" data-act="open-url" data-url="${esc(url)}" rel="noreferrer noopener">${highlightHTML(label ?? shortUrl(url), query)}</a>`;
  };
  while (at < text.length) {
    if (markdown && text.startsWith("\\![", at)) {
      const end = text.indexOf(")", at + 3);
      plain += text.slice(at + 1, end < 0 ? text.length : end + 1); at = end < 0 ? text.length : end + 1; continue;
    }
    if (markdown && text[at] === "\\" && at + 1 < text.length) { plain += text[at + 1]; at += 2; continue; }
    if (markdown && text[at] === "`") {
      const marker = /^`+/.exec(text.slice(at))![0];
      const end = text.indexOf(marker, at + marker.length);
      if (end > at + marker.length) { flush(); out += pathHTML(text.slice(at + marker.length, end), query); at = end + marker.length; continue; }
    }
    // An unfinished image must never become an automatic link preview while streaming.
    if (markdown && text.startsWith("![", at)) {
      const end = text.indexOf(")", at + 2);
      plain += text.slice(at, end < 0 ? text.length : end + 1); at = end < 0 ? text.length : end + 1; continue;
    }
    if (markdown && text[at] === "[") {
      const middle = text.indexOf("](", at + 1);
      if (middle !== -1) {
        let end = middle + 2, level = 1;
        for (; end < text.length && level; end++) { if (text[end] === "(") level++; if (text[end] === ")") level--; }
        if (!level) {
          const target = text.slice(middle + 2, end - 1);
          const html = link(target, text.slice(at + 1, middle));
          if (html) { flush(); out += html; at = end; continue; }
          // A file on a computer has no address to open: its path is what the owner can use, not the markdown around it.
          if (/^(?:\/|[A-Za-z]:[\\/])/.test(target)) { flush(); out += pathHTML(target, query); at = end; continue; }
        }
      }
    }
    const raw = /^https?:\/\//i.test(text.slice(at, at + 8)) ? bareUrl(text.slice(at)) : "";
    if (raw) {
      const html = link(raw);
      if (html) { flush(); out += html; at += raw.length; continue; }
    }
    if (markdown && depth < 8 && /[*_~]/.test(text[at])) {
      const marker = text[at + 1] === text[at] ? text.slice(at, at + 2) : text[at];
      if (marker === "~") { plain += text[at++]; continue; }
      const end = text.indexOf(marker, at + marker.length);
      if (end > at + marker.length) {
        flush(); const tag = marker === "~~" ? "del" : marker.length === 2 ? "strong" : "em";
        out += `<${tag}>${inline(text.slice(at + marker.length, end), query, true, urls, depth + 1, mentions)}</${tag}>`;
        at = end + marker.length; continue;
      }
    }
    plain += text[at++];
  }
  flush(); return out;
}

export type MessageBlock =
  | { type: "text"; source: string }
  | { type: "table"; source: string; headers: string[]; align: ("left" | "center" | "right")[]; rows: string[][] }
  | { type: "code" | "diagram"; source: string; language: string; complete: boolean }
  | { type: "image"; source: string; alt: string; url: string };

/** Split only structural pipes; code spans and escaped pipes belong to the cell. */
export function tableCells(line: string): string[] {
  const cells: string[] = []; let cell = "", ticks = 0;
  const value = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && value[i + 1] === "|") { cell += "|"; i++; continue; }
    if (value[i] === "`") {
      const run = /^`+/.exec(value.slice(i))![0];
      ticks = ticks === run.length ? 0 : ticks || run.length;
      cell += run; i += run.length - 1; continue;
    }
    if (value[i] === "|" && !ticks) { cells.push(cell.trim()); cell = ""; }
    else cell += value[i];
  }
  cells.push(cell.trim()); return cells;
}

export function parseMessageBlocks(text: string, streaming = false): MessageBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MessageBlock[] = [], pending: string[] = [];
  const flush = (): void => { const source = pending.join("\n").trim(); if (source) blocks.push({ type: "text", source }); pending.length = 0; };
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/.exec(lines[i]);
    if (fence) {
      flush(); const source: string[] = [];
      const end = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++i < lines.length && !end.test(lines[i])) source.push(lines[i]);
      const language = fence[2].toLowerCase();
      blocks.push({ type: language === "mermaid" ? "diagram" : "code", source: source.join("\n"), language, complete: i < lines.length }); continue;
    }
    const separators = i + 1 < lines.length ? tableCells(lines[i + 1]) : [];
    const headers = tableCells(lines[i]);
    if (lines[i].includes("|") && headers.length === separators.length && separators.every(cell => /^:?-+:?$/.test(cell))) {
      const start = i, rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = tableCells(lines[i]); rows.push(headers.map((_, index) => cells[index] ?? "")); i++;
      }
      const source = lines.slice(start, i).join("\n");
      // A cut row is provisional until its newline or the final stored reply arrives.
      if (streaming && i === lines.length && !text.endsWith("\n")) pending.push(source);
      else { flush(); blocks.push({ type: "table", source, headers, rows, align: separators.map(cell => cell.endsWith(":") ? cell.startsWith(":") ? "center" : "right" : "left") }); }
      i--; continue;
    }
    const images = /!\[([^\]]*)\]\(/g;
    let at = 0;
    let image: RegExpExecArray | null;
    while ((image = images.exec(lines[i]))) {
      let ticks = 0;
      for (const run of lines[i].slice(0, image.index).matchAll(/(?<!\\)`+/g)) ticks = ticks === run[0].length ? 0 : ticks || run[0].length;
      if (ticks || lines[i][image.index - 1] === "\\") continue;
      const start = images.lastIndex;
      let end = start, level = 1;
      for (; end < lines[i].length && level; end++) { if (lines[i][end] === "(") level++; if (lines[i][end] === ")") level--; }
      if (level) continue;
      const url = messageUrl(lines[i].slice(start, end - 1)); if (!url) continue;
      pending.push(lines[i].slice(at, image.index)); flush();
      blocks.push({ type: "image", source: lines[i].slice(image.index, end), alt: image[1], url }); at = end; images.lastIndex = end;
    }
    pending.push(lines[i].slice(at));
  }
  flush(); return blocks;
}

function textHTML(text: string, query: string, urls: Set<string>, depth = 0): string {
  const lines = text.split("\n");
  let out = "", paragraph: string[] = [];
  const lists: { tag: string; indent: number }[] = [];
  const flush = (): void => { if (paragraph.length) out += `<p>${paragraph.join("<br>")}</p>`; paragraph = []; };
  const closeList = (): void => { while (lists.length) out += `</li></${lists.pop()!.tag}>`; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const item = /^(\s*)(?:([-+*])|([0-9]+)[.)])\s+(.+)$/.exec(line);
    if (item) {
      flush(); const tag = item[2] ? "ul" : "ol", indent = item[1].length;
      while (lists.length && (lists[lists.length - 1].indent > indent || (lists[lists.length - 1].indent === indent && lists[lists.length - 1].tag !== tag))) out += `</li></${lists.pop()!.tag}>`;
      if (!lists.length || lists[lists.length - 1].indent < indent) { lists.push({ tag, indent }); out += `<${tag}${item[3] ? ` start="${Number(item[3])}"` : ""}>`; }
      else out += "</li>";
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item[4]);
      out += `<li${task ? ' class="message-task"' : ""}>${task ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""} aria-label="${esc(task[2])}">` : ""}${inline(task ? task[2] : item[4], query, true, urls)}`;
    } else {
      closeList();
      const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
      if (heading) { flush(); out += `<h${heading[1].length}>${inline(heading[2], query, true, urls)}</h${heading[1].length}>`; }
      else if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out += "<hr>"; }
      else if (depth < 8 && /^\s*>/.test(line)) {
        flush(); const quote: string[] = [line.replace(/^\s*> ?/, "")];
        while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) quote.push(lines[++i].replace(/^\s*> ?/, ""));
        out += `<blockquote>${textHTML(quote.join("\n"), query, urls, depth + 1)}</blockquote>`;
      }
      else if (!line.trim()) flush();
      else paragraph.push(inline(line, query, true, urls));
    }
  }
  flush(); closeList(); return out;
}

function blockHTML(block: MessageBlock, query: string, urls: Set<string>, streaming = false): string {
  if (block.type === "text") return textHTML(block.source, query, urls);
  if (block.type === "table") {
    const cells = (row: string[], tag: string): string => row.map((cell, i) => `<${tag} class="align-${block.align[i]}">${inline(cell, query, true, urls)}</${tag}>`).join("");
    return `<section class="rich-block message-table" data-source="${esc(block.source)}"><header class="rich-head"><span>${esc(t("chat.table"))}</span>${iconBtn("copy", t("chat.copyTable"), ' data-rich-act="copy-table"')}</header><div class="rich-scroll" tabindex="0" role="region" aria-label="${esc(t("chat.table"))}"><table${block.headers.length > 6 ? ` style="min-width:${block.headers.length * 96}px"` : ""}><thead><tr>${cells(block.headers, "th")}</tr></thead><tbody>${block.rows.map(row => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table></div></section>`;
  }
  if (block.type === "image") return `<section class="rich-block message-image" data-image-url="${esc(block.url)}"><header class="rich-head"><span>${esc(block.alt || t("chat.image"))}</span><span>${esc(new URL(block.url).host)}</span></header><div class="rich-image-body"><button type="button" class="btn sm" data-rich-act="load-image">${esc(t("chat.loadImage"))}</button></div></section>`;
  const diagram = block.type === "diagram";
  // A form still arriving is half a JSON document: the owner sees that a card is coming, not its source.
  if (!diagram && !block.complete && streaming && isAnswerFormKind(block.language)) return `<section class="rich-block answer-form-pending" role="status"><header class="rich-head"><span>${esc(t("chat.formPending"))}</span></header></section>`;
  if (!diagram && block.complete) {
    const form = parseAnswerForm(block.language, block.source);
    if (form) return answerFormHTML(form, block.source);
  }
  const showSource = diagram && !!query && block.source.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  return `<section class="rich-block message-code${diagram ? " message-diagram" : ""}" data-source="${esc(block.source)}" data-language="${esc(block.language)}" data-complete="${block.complete}" data-query="${esc(query)}"><header class="rich-head"><span class="rich-language">${esc(diagram ? t("chat.diagram") : block.language || t("chat.code"))}</span><div>${iconBtn("copy", t(diagram ? "chat.copySource" : "chat.copyCode"), ' data-rich-act="copy-source" data-act="copy-code"')}${diagram ? iconBtn("steps", t("chat.viewSource"), ` data-rich-act="view-source" aria-expanded="${showSource}"`) + iconBtn("external", t("chat.expandBlock"), ' data-rich-act="expand" hidden') : ""}</div></header><div class="diagram-view"${diagram ? "" : " hidden"}></div><pre><code>${highlightHTML(block.source, query)}</code></pre>${diagram ? `<p class="rich-note">${esc(t(block.complete ? "chat.diagramFallback" : "chat.diagramStreaming"))}</p>` : ""}</section>`;
}

/** `mentions` are the addresses of the owner's words, drawn as chips (a reply's `@` is just text). */
export const messageHTML = (text: string, query = "", markdown = false, mentions: readonly MentionTarget[] = []): string => markdown
  ? parseMessageBlocks(composioText(text)).map(block => blockHTML(block, query, new Set())).join("") : inline(text, query, false, new Set(), 0, mentions);

/** A thread is drawn again on every change, and a reply that has finished reads the same each time. */
const finished = new Map<string, string>();
function remembered(key: string, make: () => string): string {
  const known = finished.get(key);
  if (known !== undefined) return known;
  const made = make();
  if (finished.size >= 500) finished.delete(finished.keys().next().value!);
  finished.set(key, made);
  return made;
}

/** Rich cards are siblings of text bubbles, including in authored multi-message replies. */
export function replyContentHTML(text: string, query = "", streaming = false, renderText?: (source: string) => string): string {
  text = composioText(text);
  const draw = (): string => parseMessageBlocks(text, streaming).map(block => block.type === "text"
    ? `<div class="ans"><div class="message-text">${renderText ? renderText(block.source) : textHTML(block.source, query, new Set())}</div></div>` : blockHTML(block, query, new Set(), streaming)).join("");
  // A forecast card marks today, so a kept reply lasts the day.
  return streaming || renderText ? draw() : remembered(`reply\0${new Date().toDateString()}\0${getLocale()}\0${query}\0${text}`, draw);
}
export function messageUrls(text: string): string[] {
  const urls = new Set<string>(); parseMessageBlocks(text).forEach(block => { if (block.type === "text" || block.type === "table") blockHTML(block, "", urls); }); return [...urls];
}
/** The addresses of finished words, one per line, for the cards under a reply. */
export const rememberedUrls = (text: string): string[] => {
  const known = remembered(`urls\0${text}`, () => messageUrls(text).join("\n"));
  return known ? known.split("\n") : [];
};

/** Copy rendered Markdown as text, preserving full addresses even when their labels are short. */
export function messagePlainText(text: string, markdown = false): string {
  text = publicEventText(text);
  if (!markdown) return text;
  return parseMessageBlocks(text).map(block => {
    if (block.type === "text") return plainTextBlock(block.source);
    if (block.type === "code" && block.complete) {
      const form = parseAnswerForm(block.language, block.source);
      if (form) return answerFormText(form);
    }
    return block.source;
  }).join("\n");
}

function plainTextBlock(source: string): string {
  const el = document.createElement("div"); el.innerHTML = textHTML(source, "", new Set());
  el.querySelectorAll("button").forEach(button => button.remove());
  for (const link of el.querySelectorAll<HTMLAnchorElement>("a")) {
    const url = link.dataset.url!;
    link.textContent = link.textContent === shortUrl(url) ? url : `${link.textContent} (${url})`;
  }
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "INPUT") return node.hasAttribute("checked") ? "[x] " : "[ ] ";
    const content = [...node.childNodes].map(read).join("");
    if (node.tagName === "LI") {
      const parent = node.parentElement;
      const number = parent?.tagName === "OL" ? Number(parent.getAttribute("start") || 1) + [...parent.children].indexOf(node) : null;
      return `${number === null ? "-" : `${number}.`} ${content}\n`;
    }
    if (/^(UL|OL)$/.test(node.tagName) && node.parentElement?.tagName === "LI") return "\n" + content;
    return /^(P|LI|PRE|H[1-6]|BLOCKQUOTE)$/.test(node.tagName) ? content + "\n" : content;
  };
  return read(el).trimEnd();
}

export function tablePlainText(source: string): string {
  const block = parseMessageBlocks(source).find(block => block.type === "table");
  if (!block || block.type !== "table") return source;
  return [block.headers, ...block.rows].map(row => row.map(cell => messagePlainText(cell, true).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}
