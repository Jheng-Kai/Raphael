// What the core reads as an address (members/rooms.py `_targets`): `@Name` as a whole word, the longest name at each @,
// never inside code or a quotation. The composer and the owner's sent bubble draw exactly those as chips, so what looks
// like a mention is what the core will take for one. The words themselves are never changed.
import { esc } from "./ui";

export interface MentionTarget {
  /** What the menu writes after the @. */
  name: string;
  kind: "everyone" | "member" | "group" | "app";
  /** Other spellings the core takes for the same address. */
  aliases?: readonly string[];
  /** Its mark, `size` px square: a member's face, a service's logo, the team's grid. */
  mark(size: number): string;
}

export interface MentionRange { start: number; end: number; target: MentionTarget }

const WORD = String.raw`[\p{L}\p{N}_]`;
const QUOTED = /```[\s\S]*?```|`[^`\n]*`|^\s*>.*$|[“「][^”」]*[”」]|"[^"\n]*"/gmu;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rosters = new WeakMap<readonly MentionTarget[], { patterns: { target: MentionTarget; pattern: RegExp }[]; texts: Map<string, MentionRange[]> }>();

/** Where `text` addresses one of `targets`, in order and never overlapping. */
export function mentionRanges(text: string, targets: readonly MentionTarget[]): MentionRange[] {
  if (!/[@＠]/u.test(text) || !targets.length) return [];
  let roster = rosters.get(targets);
  if (!roster) {
    roster = { patterns: targets.flatMap(target => [target.name, ...(target.aliases ?? [])].filter(Boolean).map(name => ({
      target, pattern: new RegExp(`(?<!${WORD})[@＠]${escapeRegExp(name)}(?!${WORD})`, "giu"),
    }))), texts: new Map() };
    rosters.set(targets, roster);
  }
  const known = roster.texts.get(text);
  if (known) return known;
  const open = text.replace(QUOTED, quoted => " ".repeat(quoted.length));
  const hits: MentionRange[] = [];
  for (const { target, pattern } of roster.patterns) for (const match of open.matchAll(pattern)) hits.push({ start: match.index, end: match.index + match[0].length, target });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: MentionRange[] = [];
  let end = 0;
  for (const hit of hits) if (hit.start >= end) { kept.push(hit); end = hit.end; }
  if (text.length <= 65536) {
    if (roster.texts.size >= 512) roster.texts.delete(roster.texts.keys().next().value!);
    roster.texts.set(text, kept);
  }
  return kept;
}

/**
 * One chip: the mark stands where the @ is (the @ keeps its width, so a field that draws the chip over its own text lines up
 * with it, and a copied selection still reads `@Name`), then the name as it was typed.
 */
export const mentionChipHTML = (typed: string, target: MentionTarget, size = 14): string =>
  `<span class="mention-chip" data-mention="${target.kind}"><span class="mention-at">${esc(typed.slice(0, 1))}<span class="mention-ico" aria-hidden="true">${target.mark(size)}</span></span>${esc(typed.slice(1))}</span>`;

/** `text` with each address a chip; `plain` draws the words between them. */
export function mentionsHTML(text: string, targets: readonly MentionTarget[], plain: (words: string) => string): string {
  let out = "", at = 0;
  for (const range of mentionRanges(text, targets)) {
    out += plain(text.slice(at, range.start)) + mentionChipHTML(text.slice(range.start, range.end), range.target);
    at = range.end;
  }
  return out + plain(text.slice(at));
}
