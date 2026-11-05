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

export function writeDraftWords<Q>(key: string, draft?: DraftWords<Q>): void {
  try {
    const values = stored();
    if (draft && (draft.text || draft.quote)) values[key] = draft; else delete values[key];
    if (Object.keys(values).length) localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(values));
    else localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch { /* Storage never prevents typing, navigation or sending. */ }
}
