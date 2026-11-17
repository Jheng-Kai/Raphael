// Where a completion menu starts in the composer. Both menus read the words before the caret, anchor the menu at the
// character that began the word under it and, when a row is picked, replace only that word: what stands before and after it stays.

/** An @ opens the address menu wherever it stands. What follows it, up to the caret, is the query. */
export const AT_TRIGGER = /[@＠]([^@＠\n]*)$/u;

/** A / opens the command and skill menu where it begins a word: at the start of the words or after a space or a line break, never
 * inside a word or an address (`a/b`, `https://x.com/y`). The query is the name typed after it, so a space or a second slash ends it. */
export const SLASH_TRIGGER = /(?<!\S)\/([^\s/]*)$/u;

export interface SlashTrigger { /** Where the / stands. */ start: number; /** The name typed after it, up to the caret. */ query: string }

export function slashTrigger(text: string, caret: number = text.length): SlashTrigger | undefined {
  const match = SLASH_TRIGGER.exec(text.slice(0, caret));
  return match ? { start: match.index, query: match[1]! } : undefined;
}
