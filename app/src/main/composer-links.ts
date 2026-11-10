// A link in the composer shows its whole address in the link colour. The field paints each address as a chip
// it treats as one unit (mention-field.ts); the words already hold the address, so nothing is swapped in or out.
import { bareUrl, messageUrl } from "./message-content";

export interface LinkRange { start: number; end: number }

/** The words as the field keeps them: every link whole. */
export function shortenLinks(text: string): string {
  return text;
}

/** Where the addresses stand in the words. */
export function linkRanges(text: string): LinkRange[] {
  const ranges: LinkRange[] = [];
  for (const match of text.matchAll(/https?:\/\//gi)) {
    if (ranges.length && match.index < ranges[ranges.length - 1]!.end) continue;
    const address = bareUrl(text.slice(match.index));
    if (messageUrl(address)) ranges.push({ start: match.index, end: match.index + address.length });
  }
  return ranges;
}

/** The words as they leave the field: already whole. */
export function wholeLinks(text: string): string {
  return text;
}
