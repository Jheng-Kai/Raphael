// The composer keeps its words in a plain textarea (voice, learning, drafts, send and the length limit all read `value`), so a
// chip cannot live inside it. While the words hold an address, the textarea stops painting its text and a copy of it is drawn over
// it with each address as a chip (`.cmp-mirror`, aria-hidden, never taking a click); the caret, selection and input method are the
// textarea's own. A chip is derived from the words, not stored: change a letter of it and it is plain text again, which is the
// rule the core applies. Deleting, moving over and selecting treat an address (@) as one unit. A link and a skill (/) are drawn
// the same way, in the link colour, but stay ordinary words (R-UI-168): a mistyped one is corrected a letter at a time, so
// backspace takes one letter and the caret rests anywhere in it. The words hold its whole address (composer-links.ts), and
// copying or sending gives the same text.
import { esc, patchHTML } from "./ui";
import { richFieldOf, type RichChip } from "./composer-rich-handle";
import { linkRanges, shortenLinks, wholeLinks } from "./composer-links";
import { mentionChipHTML, mentionRanges, type MentionTarget } from "./mention-text";

/** A stretch of the words drawn as a chip: an address when it has a target, otherwise a link (`url`) or a skill (`skill`). */
interface ChipRange { start: number; end: number; target?: MentionTarget; url?: true; skill?: true }

/** A skill or command called by its name, `/name`, at the start of the words or after a space, in any script (「/每日新聞摘要」 too) and with a plugin's prefix (`/field-notes:review`). A path
 * such as /usr/bin is not one: the name ends at a space or the end of the words, and holds no other slash. */
export function skillRanges(text: string): ChipRange[] {
  return [...text.matchAll(/(^|\s)(\/[\p{L}\p{N}][\p{L}\p{N}_:-]{0,63})(?=\s|$)/gu)].map(match => {
    const start = match.index! + match[1]!.length;
    return { start, end: start + match[2]!.length, skill: true as const };
  });
}

export interface MentionField { refresh(): void }

export function bindMentionField(input: HTMLTextAreaElement, targets: () => readonly MentionTarget[]): MentionField {
  // In the composer's own field (composer-rich-field.ts) the chips are drawn by the editor; a plain textarea gets the mirror.
  const rich = richFieldOf(input);
  const field = input.closest<HTMLElement>(".cmp-field"), mirror = field?.querySelector<HTMLElement>(".cmp-mirror");
  if (!rich && (!field || !mirror)) return { refresh() {} };
  let ranges: ChipRange[] = [];
  /** The chips that move, select and delete as one unit: the addresses; a link and a skill are words. */
  let units: ChipRange[] = [];
  /** The words an input method has not committed yet, drawn underlined as the field would draw them. */
  let composing: { start: number; end: number } | null = null, composed = "";

  const words = (text: string, from: number, to: number): string => {
    const start = composing ? Math.max(from, composing.start) : to, end = composing ? Math.min(to, composing.end) : from;
    return start >= end ? esc(text.slice(from, to)) : `${esc(text.slice(from, start))}<span class="cmp-composing">${esc(text.slice(start, end))}</span>${esc(text.slice(end, to))}`;
  };
  const place = (): void => {
    // A scrollbar narrows the textarea's lines; the copy has to wrap at the same letter.
    if (!ranges.length || !mirror) return;
    const bar = `${Math.max(0, input.offsetWidth - input.clientWidth)}px`;
    if (mirror.style.getPropertyValue("--cmp-bar") !== bar) mirror.style.setProperty("--cmp-bar", bar);
    mirror.scrollTop = input.scrollTop;
  };
  const size = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
  const draw = (): void => {
    const text = input.value;
    // Long restored/typed drafts use the textarea's own paint instead of a second large DOM.
    if (text.length >= 2000) { ranges = []; units = []; }
    else {
      const links: ChipRange[] = linkRanges(text).map(range => ({ ...range, url: true })), mentions = /[@＠]/u.test(text) ? mentionRanges(text, targets()) : [];
      const free = (item: ChipRange, taken: readonly ChipRange[]): boolean => !taken.some(other => other.start < item.end && item.start < other.end);
      const chips = [...links, ...mentions.filter(item => free(item, links))];
      ranges = [...chips, ...(text.includes("/") ? skillRanges(text).filter(item => free(item, chips)) : [])].sort((a, b) => a.start - b.start);
      units = ranges.filter(range => !range.url && !range.skill);
    }
    if (rich) {
      rich.setChips(ranges.map((range): RichChip => range.target
        ? { start: range.start, end: range.end, kind: "mention", mention: range.target.kind, icon: range.target.mark(14) }
        : { start: range.start, end: range.end, kind: range.url ? "url" : "skill" }));
      return;
    }
    if (!field || !mirror) return;
    if (!ranges.length) {
      if (field.classList.contains("has-mentions")) { size?.disconnect(); field.classList.remove("has-mentions"); mirror.textContent = ""; }
      return;
    }
    if (!field.classList.contains("has-mentions")) {
      field.classList.add("has-mentions");
      size?.observe(input);
    }
    let html = "", at = 0;
    for (const range of ranges) {
      const chip = text.slice(range.start, range.end);
      html += words(text, at, range.start) + (range.target ? mentionChipHTML(chip, range.target) : `<span class="mention-chip url-chip">${esc(chip)}</span>`);
      at = range.end;
    }
    // A last empty line needs something in it, as the textarea's has its caret.
    patchHTML(mirror, html + words(text, at, text.length) + "​");
    if (!size) place();
  };

  // Every write of the words redraws them, wherever it comes from: a draft put back, a send that empties the field, a paste.
  const descriptor = Object.getOwnPropertyDescriptor(input, "value") ?? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!;
  Object.defineProperty(input, "value", { configurable: true, get: () => descriptor.get!.call(input), set: (value: string) => { descriptor.set!.call(input, value.length >= 2000 ? value : shortenLinks(value)); draw(); } });
  const setRangeText = input.setRangeText as (...args: unknown[]) => void;
  input.setRangeText = (words: string, ...rest: unknown[]): void => { setRangeText.call(input, shortenLinks(words), ...rest); draw(); };
  const replaceSelection = (words: string): void => {
    // The browser's own edit keeps the undo history and says `input` to everyone listening; the editor has its own.
    if (!rich && (words ? document.execCommand?.("insertText", false, words) : document.execCommand?.("delete"))) return;
    input.setRangeText(words, input.selectionStart, input.selectionEnd, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  if (!rich) input.addEventListener("paste", event => {
    // Files are the page's own to take: it puts their words in through setRangeText.
    if (event.clipboardData?.files.length) return;
    const pasted = event.clipboardData?.getData("text/plain") ?? "", short = shortenLinks(pasted);
    if (short === pasted) return;
    event.preventDefault();
    replaceSelection(short);
  });
  const carry = (event: ClipboardEvent, cut: boolean): void => {
    const picked = input.value.slice(input.selectionStart, input.selectionEnd), whole = wholeLinks(picked);
    if (whole === picked) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", whole);
    if (cut) replaceSelection("");
  };
  if (!rich) { input.addEventListener("copy", event => carry(event, false)); input.addEventListener("cut", event => carry(event, true)); }

  input.addEventListener("compositionupdate", event => { composed = (event as CompositionEvent).data; });
  input.addEventListener("compositionend", () => { composing = null; composed = ""; draw(); });
  input.addEventListener("input", event => {
    composing = (event as InputEvent).isComposing && composed ? { start: Math.max(0, input.selectionEnd - composed.length), end: input.selectionEnd } : null;
    if ((event as InputEvent).inputType === "insertFromDrop") { const words = input.value, at = shortenLinks(words.slice(0, input.selectionEnd)).length; input.value = words; input.setSelectionRange(at, at); return; }
    draw();
  });
  input.addEventListener("scroll", place);

  const inside = (at: number): ChipRange | undefined => units.find(range => range.start < at && at < range.end);
  /** A caret or selection edge never rests inside an address: it goes to the nearer edge, a selection takes the whole chip. A link
   * and a skill are words, and the caret rests anywhere in them. */
  const snap = (): void => {
    if (composing || !units.length || document.activeElement !== input) return;
    const { selectionStart: from, selectionEnd: to, selectionDirection: direction } = input;
    const first = inside(from), last = inside(to);
    if (!first && !last) return;
    if (from === to) { const at = from - first!.start < first!.end - from ? first!.start : first!.end; input.setSelectionRange(at, at); }
    else input.setSelectionRange(first ? first.start : from, last ? last.end : to, direction);
  };
  const follow = (): void => { if (!input.isConnected) document.removeEventListener("selectionchange", follow); else snap(); };
  document.addEventListener("selectionchange", follow);

  input.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229 || !units.length || event.altKey || event.metaKey) return;
    const { selectionStart: from, selectionEnd: to } = input, collapsed = from === to;
    if ((event.key === "Backspace" || event.key === "Delete") && collapsed) {
      const range = units.find(item => (event.key === "Backspace" ? item.end : item.start) === from);
      if (!range) return;
      event.preventDefault();
      input.setSelectionRange(range.start, range.end);
      // The browser's own delete keeps the undo history and says `input` to everyone listening.
      if (rich || !document.execCommand?.("delete")) { input.setRangeText("", range.start, range.end, "end"); input.dispatchEvent(new Event("input", { bubbles: true })); }
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // The edge that moves is the one the caret is at; a chip beside it is crossed in one step.
    const forward = input.selectionDirection !== "backward", anchor = forward ? from : to, focus = forward ? to : from;
    const step = event.key === "ArrowLeft" ? -1 : 1;
    if (!event.shiftKey && !collapsed) return;
    const range = units.find(item => (step < 0 ? item.end : item.start) === focus);
    if (!range) return;
    event.preventDefault();
    const moved = step < 0 ? range.start : range.end;
    if (event.shiftKey) input.setSelectionRange(Math.min(anchor, moved), Math.max(anchor, moved), moved < anchor ? "backward" : "forward");
    else input.setSelectionRange(moved, moved);
  });

  draw();
  return { refresh: draw };
}
