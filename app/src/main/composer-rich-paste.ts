// What a paste keeps. A copy from the app's own messages, a web page, Notion, Word or Google Docs carries HTML; before the
// editor reads it (its schema's parse rules, composer-rich-schema.ts), this makes it plainer where each source writes the same
// thing its own way: a code block, an address chip, a tick box, a nested list, an equation, a table cell.
import { Fragment, Slice } from "prosemirror-model";
import { composerNodes as N, composerSchema as S } from "./composer-rich-schema";

const DROPPED = "style, script, meta, link, title, svg, canvas, iframe, object, embed, img, video, audio, select, textarea, button, noscript, template, "
  + ".rich-head, .mention-ico, .link-mark, .katex-mathml";

const create = (doc: Document, tag: string, attrs: Record<string, string> = {}): HTMLElement => {
  const element = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
};

function unwrap(element: Element, between = ""): void {
  const parent = element.parentNode;
  if (!parent) return;
  if (between) element.before(element.ownerDocument.createTextNode(between));
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
}

/** A code block of the app's own messages is its source in a `data-source`, not the highlighted spans drawn from it. */
function codeBlocks(doc: Document): void {
  for (const section of doc.querySelectorAll<HTMLElement>("section.message-code, [data-source][data-language]")) {
    const pre = create(doc, "pre"), code = create(doc, "code", section.dataset.language ? { class: `language-${section.dataset.language}` } : {});
    code.textContent = section.dataset.source ?? section.querySelector("pre")?.textContent ?? "";
    pre.append(code);
    section.replaceWith(pre);
  }
  for (const section of doc.querySelectorAll("section.message-table")) {
    const table = section.querySelector("table");
    if (table) section.replaceWith(table); else section.remove();
  }
  for (const section of doc.querySelectorAll("section.rich-block")) section.remove();
}

/** An address the app draws as a chip (its site's mark and name) is the link it opens, its words the address or its own name. */
function links(doc: Document): void {
  for (const link of doc.querySelectorAll<HTMLAnchorElement>("a[data-url], a.link-chip")) {
    const url = link.dataset.url ?? link.getAttribute("href") ?? "";
    const words = link.hasAttribute("data-link-bare") ? url : link.querySelector(".link-name")?.textContent ?? link.textContent ?? url;
    link.replaceChildren(doc.createTextNode(words));
    link.setAttribute("href", url);
  }
  for (const chip of doc.querySelectorAll(".mention-chip")) chip.replaceWith(doc.createTextNode(chip.textContent ?? ""));
}

const texOf = (element: Element): string => element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? element.getAttribute("data-math") ?? "";

/** An equation, drawn by KaTeX or by the app, is its LaTeX again. */
function equations(doc: Document): void {
  for (const element of [...doc.querySelectorAll<HTMLElement>("[data-math], .katex-display, .katex")]) {
    if (!element.isConnected) continue;
    const display = element.matches(".katex-display, .message-math, [data-math-display]") || element.parentElement?.matches(".katex-display") === true;
    const latex = texOf(element).trim() || element.querySelector(".katex")?.textContent?.trim() || "";
    const holder = display ? element.closest(".katex-display") ?? element : element;
    if (!latex) { holder.remove(); continue; }
    holder.replaceWith(display ? create(doc, "div", { "data-math-block": latex }) : create(doc, "span", { "data-math-inline": latex }));
  }
}

/** A tick box is the item's own: GitHub's and the app's input, Notion's drawn box. */
function tasks(doc: Document): void {
  for (const item of doc.querySelectorAll("li")) {
    const box = item.querySelector(":scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]") as HTMLInputElement | null;
    const drawn = item.querySelector(":scope > .checkbox, :scope > div > .checkbox");
    if (box) { item.setAttribute("data-task", String(box.hasAttribute("checked") || box.checked)); box.remove(); }
    else if (drawn) { item.setAttribute("data-task", String(/checkbox-on|checked/.test(drawn.className))); drawn.remove(); }
  }
}

/** A list written inside its sibling list (Google Docs) belongs to the item before it. */
function nesting(doc: Document): void {
  for (const inner of [...doc.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol")]) {
    let previous = inner.previousElementSibling;
    if (!previous || previous.tagName !== "LI") { previous = create(doc, "li"); inner.before(previous); }
    previous.append(inner);
  }
}

/** Word's lists are paragraphs with a mark and a level, not lists. */
function wordLists(doc: Document): void {
  const isItem = (element: Element | null): element is HTMLElement => !!element && element.tagName === "P" && (/MsoListParagraph/.test(element.className) || /mso-list:\s*l\d+/i.test(element.getAttribute("style") ?? ""));
  for (const first of [...doc.body.querySelectorAll("p")]) {
    if (!first.isConnected || !isItem(first) || isItem(first.previousElementSibling)) continue;
    const run: HTMLElement[] = [];
    for (let next: Element | null = first; isItem(next); next = next.nextElementSibling) run.push(next);
    const root = create(doc, "div"), stack: { level: number; list: HTMLElement }[] = [];
    for (const paragraph of run) {
      const marker = paragraph.querySelector<HTMLElement>('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
      const ordered = /^\s*\(?\d+[.)]/.test(marker?.textContent ?? "") || /^\s*[a-z][.)]\s/i.test(marker?.textContent ?? "");
      marker?.remove();
      const level = Number(/level(\d+)/i.exec(paragraph.getAttribute("style") ?? "")?.[1] ?? 1);
      while (stack.length && stack[stack.length - 1]!.level > level) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const list = create(doc, ordered ? "ol" : "ul");
        if (top) (top.list.lastElementChild ?? top.list.appendChild(create(doc, "li"))).append(list); else root.append(list);
        top = { level, list };
        stack.push(top);
      }
      const item = create(doc, "li");
      item.append(...paragraph.childNodes);
      top.list.append(item);
    }
    first.before(...root.childNodes);
    run.forEach(paragraph => paragraph.remove());
  }
}

/** A table cell holds words, not paragraphs. */
function cells(doc: Document): void {
  for (const cell of doc.querySelectorAll("td, th")) {
    for (const block of [...cell.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, ul, ol, li")]) {
      if (block.isConnected && block.parentElement && cell.contains(block)) unwrap(block, block.previousSibling ? " " : "");
    }
  }
}

/** Paragraphs are set apart by the space between them: here an empty paragraph keeps it, as a blank line does. */
function gaps(doc: Document): void {
  for (const paragraph of [...doc.querySelectorAll("p")]) {
    if (paragraph.parentElement?.closest("li, td, th")) continue;
    if (paragraph.nextElementSibling?.tagName === "P" && paragraph.textContent?.trim()) paragraph.after(create(doc, "p"));
  }
}

/** The pasted HTML as the editor should read it. */
export function normalizePastedHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  codeBlocks(doc); links(doc); equations(doc); tasks(doc);
  for (const dropped of doc.querySelectorAll(DROPPED)) dropped.remove();
  for (const input of doc.querySelectorAll("input")) input.remove();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) (node as Comment).remove();
  nesting(doc); wordLists(doc); cells(doc); gaps(doc);
  return doc.body.innerHTML;
}

/** Words that are only words: each line a paragraph, a blank line an empty one, every space kept. */
export function literalSlice(text: string): Slice {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return new Slice(Fragment.from(lines.map(line => N.paragraph.create(null, line ? S.text(line) : null))), 1, 1);
}
