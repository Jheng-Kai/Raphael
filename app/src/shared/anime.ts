// How Raphael's words are written on the desktop: the person's in 「…」, Raphael's in 《prefix。text》,
// and 《Answer. text》 when the prefix is a word in letters. The main window reads like a conversation
// with colleagues and shows them plain (`plainReplies`). Pure and browser-free, so that both pages and
// their tests can use it.

/** A prefix written in Chinese or Japanese ends with 。; one written in letters ends with ". ". */
const CJK_PREFIX = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const TRAILING_STOP = /[。.]+$/u;

/** The persona's prefixes in every language: the core's `persona.PREFIXES` (anime.test.ts keeps them one). */
export const PREFIXES = ["答", "告", "否", "了", "問", "解", "Answer", "Notice", "Negative", "Understood", "Question"] as const;
/** How the core opens one of Raphael's lines (`answers._REPLY_OPEN`): 《, a prefix, its stop. */
const OPENING = new RegExp(`^《(?:${PREFIXES.join("|")})[。.：:]\\s*`, "iu");

/**
 * The messages of one of Raphael's replies without his 《prefix。…》. The core writes a long reply as
 * several messages of one line: the first opens it with 《prefix。 and the last before the next opening
 * closes it with 》. Anything else, a 》 that ends a book's title included, is kept as it is.
 */
export function plainReplies(texts: readonly string[]): string[] {
  const plain = texts.map(replyBody);
  let open = -1;
  const close = (end: number): void => {
    if (open >= 0 && end >= open && plain[end].trimEnd().endsWith("》")) plain[end] = plain[end].trimEnd().slice(0, -1);
  };
  plain.forEach((text, index) => {
    const opening = OPENING.exec(text.trimStart());
    if (!opening) return;
    close(index - 1);
    open = index;
    plain[index] = text.trimStart().slice(opening[0].length);
  });
  close(texts.length - 1);
  return plain;
}

/** Older stored CLI envelopes still read as words; authored JSON without reply keys stays intact. */
export function replyBody(text: string): string {
  let body = text;
  for (let depth = 0; depth < 4; depth++) {
    try {
      const value = JSON.parse(body);
      if (!value || Array.isArray(value) || typeof value !== "object" || !("text" in value || "messages" in value)) return body;
      const messages = Array.isArray(value.messages) ? value.messages.filter((item: unknown) => typeof item === "string" && item.trim()) : [];
      body = messages.length ? messages.join("\n\n") : typeof value.text === "string" ? value.text : "";
    } catch { return body; }
  }
  return "";
}

/** Raphael's words: `replyLine("答", "好的")` is 《答。好的》; an English prefix reads 《Answer. Done》. */
export function replyLine(prefix: string, text: string): string {
  const head = prefix.trim().replace(TRAILING_STOP, "");
  const body = text.trim();
  if (head === "") return `《${body}》`;
  const cjk = CJK_PREFIX.test(head);
  if (body === "") return `《${head}${cjk ? "。" : "."}》`;
  return `《${head}${cjk ? "。" : ". "}${body}》`;
}

/** The person's words, as the anime quotes them. */
export const userLine = (text: string): string => `「${text.trim()}」`;
