/// <reference lib="es2022.intl" />
// Only explicitly delivered dictation seeds learning. Ordinary typing, restored messages and
// clipboard pastes do not. Dictation evidence stays in memory for at most 60 seconds.
import * as api from "./api";
export interface Correction { before: string; after: string }

/** Transport dictation evidence to the pure native term rule; the core persists accepted pairs. */
export function composerCorrections(before: string, after: string): Correction[] {
  return before && before !== after && before.length <= 20_000 && after.length <= 20_000
    ? [{ before, after }] : [];
}

export class ComposerLearning {
  private baseline?: DictationBaseline;
  private timer?: ReturnType<typeof setTimeout>;
  seed(text: string, dictated = text): void {
    const start = text.lastIndexOf(dictated);
    this.clear();
    if (!dictated || start < 0 || text.length > 20_000) return;
    this.restore({ text: dictated, prefix: text.slice(0, start), suffix: text.slice(start + dictated.length), at: Date.now() });
  }
  snapshot(): DictationBaseline | undefined { return this.baseline; }
  restore(baseline?: DictationBaseline): void {
    if (baseline && this.baseline === baseline) return;
    this.clear();
    if (!baseline?.text || baseline.text.length + baseline.prefix.length + baseline.suffix.length > 20_000
      || baseline.at > Date.now() || Date.now() - baseline.at >= 60_000) return;
    this.baseline = baseline;
    this.timer = setTimeout(() => {
      // Retry drafts can hold this object too. Erase their evidence at the same deadline.
      baseline.text = baseline.prefix = baseline.suffix = "";
      baseline.edits?.splice(0);
      if (this.baseline === baseline) { this.baseline = undefined; this.timer = undefined; }
    }, 60_000 - (Date.now() - baseline.at));
  }
  clear(): void {
    clearTimeout(this.timer);
    if (this.baseline) { this.baseline.text = this.baseline.prefix = this.baseline.suffix = ""; this.baseline.edits?.splice(0); }
    this.baseline = undefined; this.timer = undefined;
  }
  observe(text: string): void {
    const baseline = this.baseline;
    if (!baseline) return;
    if (!text.startsWith(baseline.prefix) || !text.endsWith(baseline.suffix) || text.length > 20_000) { this.clear(); return; }
    const after = text.slice(baseline.prefix.length, text.length - baseline.suffix.length);
    const edits = baseline.edits ??= [], before = edits[edits.length - 1]?.after ?? baseline.text;
    if (before === after) return;
    if (edits.length >= 128 || edits.reduce((size, edit) => size + edit.before.length + edit.after.length, 0) + before.length + after.length > 256_000) { this.clear(); return; }
    edits.push({ before, after });
  }
  take(text: string): Correction[] {
    this.observe(text);
    const baseline = this.baseline;
    // Keep the deadline's erasure alive for any pending-send retry snapshot.
    this.baseline = undefined; this.timer = undefined;
    if (!baseline || Date.now() - baseline.at >= 60_000 || !text.startsWith(baseline.prefix) || !text.endsWith(baseline.suffix)) return [];
    return baseline.edits?.length ? [...baseline.edits] : [];
  }
}

/** How long a pasted dictation is waited for in the field after the shell says it was pasted. */
export const PASTE_WAIT_MS = 3_000;

export function bindComposerLearning(input: HTMLTextAreaElement): ComposerLearning {
  const learning = new ComposerLearning();
  // The shell says a dictation was pasted once its paste keys went out; the field may show the text a
  // moment later. The dictation is held that moment and seeds the draft once the field shows it.
  let awaited: { text: string; until: number } | undefined;
  const seedWhenShown = () => {
    if (!awaited) return;
    if (Date.now() > awaited.until) awaited = undefined;
    else if (input.value.includes(awaited.text)) { learning.seed(input.value, awaited.text); awaited = undefined; }
  };
  input.addEventListener("input", () => { seedWhenShown(); learning.observe(input.value); });
  input.addEventListener("dictation-pasted", event => {
    const text: unknown = (event as CustomEvent).detail;
    if (typeof text !== "string" || !text) return;
    awaited = { text, until: Date.now() + PASTE_WAIT_MS };
    seedWhenShown();
  });
  return learning;
}

export interface DictationBaseline { text: string; prefix: string; suffix: string; at: number; edits?: Correction[] }

export async function learnComposerCorrections(corrections: Correction[]): Promise<void> {
  if (!corrections.length) return;
  try {
    await api.core("dictionary.correct", { edits: corrections });
  } catch { /* Learning never blocks delivery; a failed RPC must not claim a word was added. */ }
}
