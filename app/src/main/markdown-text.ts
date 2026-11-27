// The pure text rules the message renderer (message-content.ts) and the composer's Markdown (composer-rich-markdown.ts) share:
// what an address is, where it ends, where a link's destination and a table's cells are. No DOM, no app state.

export function messageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Letters of the scripts written without spaces between words. */
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
/** What starts a part of an address (a path segment, a query value, a fragment, a handle): a page or a person named in Chinese starts after one. */
const PART_START = "/=?#&@";

/**
 * Where an address that starts at the beginning of `text` ends. It stops at a space, a quote, CJK punctuation and at
 * Chinese, Japanese or Korean words that follow it directly (`https://example.com看這裡`), unless those words start a part of
 * the address of their own (`https://zh.wikipedia.org/wiki/臺北`). A full stop, comma or closing bracket that ends the
 * sentence around it is not part of it; a bracket the address opened itself is.
 */
export function bareUrl(text: string): string {
  let raw = /^https?:\/\/[^\s<>"'`\u2018-\u201f\u2026\u3000-\u303f\uff00-\uffef]+/i.exec(text)?.[0] ?? "";
  let at = 0, previous = "", inPart = false;
  for (const char of raw) {
    if (SPACELESS.test(char)) {
      if (!inPart && !PART_START.includes(previous)) { raw = raw.slice(0, at); break; }
      inPart = true;
    } else if (PART_START.includes(char)) inPart = false;
    previous = char; at += char.length;
  }
  for (let before = ""; before !== raw;) {
    before = raw;
    raw = raw.replace(/[.,;:!?*_]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) raw = raw.slice(0, -1);
    }
  }
  return raw;
}

/**
 * A markdown link's destination as CommonMark reads it: the <...> around it (how a path with spaces or backslashes is
 * written) is dropped, and so is a title after it ("...", '...' or (...)). Every model writes these forms.
 */
export function linkDestination(raw: string): string {
  const value = raw.trim();
  const angled = /^<([^<>\n]*)>(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?$/.exec(value);
  if (angled) return angled[1].trim();
  return value.replace(/\s+(?:"[^"]*"|'[^']*'|\([^()]*\))$/, "");
}

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

