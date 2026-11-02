// A link in the composer stands as its short name, the one a sent message shows: the words hold the name and the address waits
// here until the words leave the field. The field paints the name as a chip and treats it as one unit (mention-field.ts).
import { bareUrl, messageUrl, shortUrl } from "./message-content";

export interface LinkRange { start: number; end: number }

/** Name to address for this run of the app. A draft keeps the name, so a draft put back is still whole. */
const addresses = new Map<string, string>();

function nameOf(address: string): string {
  const base = shortUrl(messageUrl(address)!);
  for (let number = 1; ; number++) {
    const name = number === 1 ? base : `${base} (${number})`;
    const held = addresses.get(name);
    if (held === undefined || held === address) { addresses.set(name, address); return name; }
  }
}

/** The words with every link in them standing as its short name. */
export function shortenLinks(text: string): string {
  let out = "", at = 0;
  for (const match of text.matchAll(/https?:\/\//gi)) {
    if (match.index < at) continue;
    const address = bareUrl(text.slice(match.index));
    if (!messageUrl(address)) continue;
    out += text.slice(at, match.index) + nameOf(address);
    at = match.index + address.length;
  }
  return out + text.slice(at);
}

/** Where the names stand in the words. A longer name wins over one it starts with. */
export function linkRanges(text: string): LinkRange[] {
  if (!addresses.size) return [];
  const names = [...addresses.keys()].sort((a, b) => b.length - a.length), ranges: LinkRange[] = [];
  // Restored long drafts keep full URLs, which must never expand a short name inside them.
  const occupied = new Uint8Array(text.length);
  for (const match of text.matchAll(/https?:\/\//gi)) {
    occupied.fill(1, match.index, match.index + bareUrl(text.slice(match.index)).length);
  }
  for (const name of names) {
    for (let start = text.indexOf(name); start >= 0; start = text.indexOf(name, start + name.length)) {
      const end = start + name.length;
      let overlap = false;
      for (let at = start; at < end; at++) if (occupied[at]) { overlap = true; break; }
      if (!overlap) { ranges.push({ start, end }); occupied.fill(1, start, end); }
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** The words as they leave the field: every name its whole address again. */
export function wholeLinks(text: string): string {
  let out = "", at = 0;
  for (const { start, end } of linkRanges(text)) {
    out += text.slice(at, start) + addresses.get(text.slice(start, end));
    at = end;
  }
  return out + text.slice(at);
}
