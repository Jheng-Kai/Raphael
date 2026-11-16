/** Words, quotes and page provenance survive restart; file bytes stay in the live composer. */
export const DRAFT_STORAGE_KEY = "raphael.composer.drafts";
export interface DraftWords<Q> { text: string; quote?: Q; pageId?: string }

function stored(): Record<string, DraftWords<unknown>> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function readDraftWords<Q>(key: string): DraftWords<Q> | undefined {
  const value = stored()[key];
  return value && typeof value.text === "string" ? { text: value.text, ...(value.quote && typeof value.quote === "object" ? { quote: value.quote as Q } : {}), ...(typeof value.pageId === "string" ? { pageId: value.pageId } : {}) } : undefined;
}

/** Told with a draft's key (`member:<id>:<conversation>`, `room:<id>`) each time its words are kept or let go. */
export const DRAFT_EVENT = "raphael:composer-draft";

export function writeDraftWords<Q>(key: string, draft?: DraftWords<Q>): void {
  try {
    const values = stored();
    if (draft && (draft.text || draft.quote)) values[key] = draft; else delete values[key];
    if (Object.keys(values).length) localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(values));
    else localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch { /* Storage never prevents typing, navigation or sending. */ }
  globalThis.dispatchEvent?.(new CustomEvent(DRAFT_EVENT, { detail: key }));
}

let read: { raw: string | null; words: Map<string, string> } = { raw: null, words: new Map() };

/**
 * The words waiting unsent in a member's composer (its main conversation's, else another of its conversations') or a
 * group's, for its sidebar row. Every row of every draw asks, so the kept drafts are parsed again only when they changed.
 */
export function unsentWords(scope: "member" | "room", id: number): string {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DRAFT_STORAGE_KEY); } catch { /* No storage: no drafts to show. */ }
  if (raw !== read.raw) {
    const words = new Map<string, string>();
    for (const [key, value] of Object.entries(stored())) if (typeof value?.text === "string" && value.text.trim()) words.set(key, value.text);
    read = { raw, words };
  }
  if (scope === "room") return read.words.get(`room:${id}`) ?? "";
  const main = read.words.get(`member:${id}:main`);
  if (main) return main;
  for (const [key, text] of read.words) if (key.startsWith(`member:${id}:`)) return text;
  return "";
}
