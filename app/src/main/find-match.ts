// Finding a thing by its name forgives the way people type (owner, 2026-11-08: 「選字的部分要再寬容一點，就是如果打錯字，或者是
// 有一點排列問題的話…讓我們更快速地找到 connectors 或者是任何東西」). One matcher serves every place that finds a thing by name:
// the @ and / menus, the store and the connected apps, members, models, languages, time zones and commands.
//
// A query word finds a name, best first, when it is the name, starts it or one of its words, is inside it, is inside it
// once spaces and marks are dropped (「googlecal」), has three letters or more in order within one word (「gml」), or is one typo
// away from a word of it or that word's start (from four letters; two typos from seven): a wrong, missing or extra letter, or two
// letters swapped (「gamil」 finds Gmail). Numbers and words shorter than four letters must be typed right, and Chinese or
// Japanese needs three characters before one may be wrong, so short queries never fill a list with near misses.

/** Lower case, the same width, no accents: 「Ｇｍａｉｌ」, 「gmail」 and 「Gmáil」 are one name. */
export const foldName = (text: string): string =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").normalize("NFKC").toLocaleLowerCase();

const WORD = /[\p{L}\p{N}]+/gu;
const words = (text: string): string[] => text.match(WORD) ?? [];
const compact = (text: string): string => words(text).join("");
const LATIN = /^[\p{Script=Latin}\p{N}]+$/u;

/** Optimal string alignment distance, stopping once it passes `limit`: a swap of two neighbours is one edit. */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, row[j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    rows.push(row);
  }
  return rows[a.length]![b.length]!;
}

/** The typos a query word may carry: none for numbers and short words, one from four letters (three characters of
 * Chinese or Japanese), two from seven letters. */
function typosAllowed(word: string): number {
  if (/^\p{N}+$/u.test(word)) return 0;
  const length = [...word].length;
  if (!LATIN.test(word)) return length >= 3 ? 1 : 0;
  return length >= 7 ? 2 : length >= 4 ? 1 : 0;
}

/** Whether `needle`, three letters or more, is in `hay` with its letters in order and the same first letter (「gml」 in 「gmail」). */
function inOrder(needle: string, hay: string): boolean {
  if ([...needle].length < 3 || needle[0] !== hay[0]) return false;
  let at = 0;
  for (const letter of hay) if (letter === needle[at] && ++at === needle.length) return true;
  return false;
}

/** A name made ready once for many queries: folded, its words, and its letters run together. */
export interface PreparedName { hay: string; parts: string[]; tight: string }
export const prepareName = (name: string): PreparedName => {
  const hay = foldName(name);
  const parts = words(hay);
  return { hay, parts, tight: parts.join("") };
};

/** How well one folded query word names a prepared text: 0 best, Infinity when it does not. */
function wordScore(needle: string, { hay, parts, tight: hayTight }: PreparedName): number {
  if (hay === needle) return 0;
  if (hay.startsWith(needle) || parts.some((part) => part.startsWith(needle))) return 1;
  if (hay.includes(needle)) return 2;
  const tight = compact(needle);
  if (tight && hayTight.includes(tight)) return 3;
  if (parts.some((part) => inOrder(needle, part))) return 4;
  const allowed = typosAllowed(needle);
  if (!allowed) return Infinity;
  let best = Infinity;
  for (const part of LATIN.test(needle) ? parts : [hay, ...parts]) {
    // The whole word, or its start as long as the query (a word still being typed), or a stretch of the same length in
    // writing without spaces.
    const length = [...needle].length;
    const pieces = LATIN.test(needle)
      ? [part, part.slice(0, length), part.slice(0, length + 1)]
      : Array.from({ length: Math.max(1, [...part].length - length + 1) }, (_, at) => [...part].slice(at, at + length).join(""));
    for (const piece of pieces) {
      if (!piece) continue;
      const d = distance(needle, piece, allowed);
      if (d <= allowed) best = Math.min(best, 4 + d);
    }
  }
  return best;
}

/**
 * How well `query` names a thing known by `names` (its name, id and other names): 0 for an exact name, larger for looser
 * matches, Infinity when it does not. Every word of the query has to be found; the thing scores by its weakest word.
 */
export const nameScore = (names: readonly string[], query: string): number => preparedScore(names.filter(Boolean).map(prepareName), query);

/** `nameScore` for names prepared once (`prepareName`), for long lists searched at every key. */
export function preparedScore(names: readonly PreparedName[], query: string): number {
  const whole = foldName(query).trim();
  const wanted = words(whole);
  if (!wanted.length) return 0;
  if (names.some((name) => name.hay === whole)) return 0;
  let worst = 0;
  for (const word of wanted) {
    let best = Infinity;
    for (const name of names) best = Math.min(best, wordScore(word, name));
    if (best === Infinity) return Infinity;
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Whether `query` finds a thing known by `names`; a blank query finds everything. */
export const findsName = (names: readonly string[], query: string): boolean => nameScore(names, query) < Infinity;
