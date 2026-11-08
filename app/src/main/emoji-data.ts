// Every emoji for the reaction picker (owner, 2026-11-06, after Grok Bot's), named in the app's language from
// emojibase-data. The set is a chunk of its own, read in the first idle moment after start-up (never during it) and
// again, if that has not happened yet, when the reaction pill opens.

import { getLocale, type UiLocale } from "./i18n";

export interface Emoji { char: string; name: string; words: string }
export interface EmojiSection { name: string; emoji: Emoji[] }

/**
 * Emoji newer than Emoji 15.1 (16.0 and later), which a Windows emoji font may still draw as an empty box. emoji-data.test.ts
 * keeps this list in step with the data when emojibase-data is upgraded.
 */
export const NEWER = new Set(["1FAEB", "1FAE9", "1FAEA", "1FAEF", "1FAF9", "1FAFA", "1FAC8", "1F9D1-200D-1FA70", "1FAC6", "1FACD", "1FACC", "1FABE",
  "1FADD", "1FADC", "1F6D8", "1F6D9", "1FA8B", "1FA8A", "1FA89", "1FA8E", "1FA8C", "1FA8D", "1FA8F", "1FADF", "1F1E8-1F1F6"]);

/** The group of skin tones and hair parts: pieces of other emoji, not reactions. */
const COMPONENTS = 2;

interface RawEmoji { hexcode: string; label: string; unicode: string; group?: number; order?: number; tags?: string[] }
interface RawMessages { groups: { message: string; order: number }[] }
type Source = () => Promise<[{ default: RawEmoji[] }, { default: RawMessages }]>;

const SOURCES: Partial<Record<UiLocale, Source>> = {
  "zh-TW": () => Promise.all([import("emojibase-data/zh-hant/compact.json"), import("emojibase-data/zh-hant/messages.json")]),
  en: () => Promise.all([import("emojibase-data/en/compact.json"), import("emojibase-data/en/messages.json")]),
  ja: () => Promise.all([import("emojibase-data/ja/compact.json"), import("emojibase-data/ja/messages.json")]),
  "zh-CN": () => Promise.all([import("emojibase-data/zh/compact.json"), import("emojibase-data/zh/messages.json")]),
  "ko": () => Promise.all([import("emojibase-data/ko/compact.json"), import("emojibase-data/ko/messages.json")]),
  "es": () => Promise.all([import("emojibase-data/es/compact.json"), import("emojibase-data/es/messages.json")]),
  "fr": () => Promise.all([import("emojibase-data/fr/compact.json"), import("emojibase-data/fr/messages.json")]),
  "de": () => Promise.all([import("emojibase-data/de/compact.json"), import("emojibase-data/de/messages.json")]),
  "pt-BR": () => Promise.all([import("emojibase-data/pt/compact.json"), import("emojibase-data/pt/messages.json")]),
  "it": () => Promise.all([import("emojibase-data/it/compact.json"), import("emojibase-data/it/messages.json")]),
  "ru": () => Promise.all([import("emojibase-data/ru/compact.json"), import("emojibase-data/ru/messages.json")]),
  "vi": () => Promise.all([import("emojibase-data/vi/compact.json"), import("emojibase-data/vi/messages.json")]),
  "th": () => Promise.all([import("emojibase-data/th/compact.json"), import("emojibase-data/th/messages.json")]),
};

/** The sections in Unicode's order, as a picker shows them; base emoji only (skin tones are not offered). */
export function sectionsOf(raw: readonly RawEmoji[], messages: RawMessages): EmojiSection[] {
  const sections = new Map<number, EmojiSection>();
  for (const group of [...messages.groups].sort((a, b) => a.order - b.order)) {
    if (group.order !== COMPONENTS) sections.set(group.order, { name: group.message, emoji: [] });
  }
  for (const entry of [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const section = entry.group === undefined ? undefined : sections.get(entry.group);
    if (!section || NEWER.has(entry.hexcode)) continue;
    section.emoji.push({ char: entry.unicode, name: entry.label, words: [entry.label, ...(entry.tags ?? [])].join(" ").toLocaleLowerCase() });
  }
  return [...sections.values()].filter((section) => section.emoji.length > 0);
}

const loaded = new Map<UiLocale, Promise<EmojiSection[]>>();

export function emojiSections(locale: UiLocale = getLocale()): Promise<EmojiSection[]> {
  let sections = loaded.get(locale);
  if (!sections) {
    sections = (SOURCES[locale] ?? SOURCES.en!)().then(([data, messages]) => sectionsOf(data.default, messages.default));
    // A load that failed is tried again the next time the picker opens.
    sections.catch(() => loaded.delete(locale));
    loaded.set(locale, sections);
  }
  return sections;
}

/**
 * Reads the emoji in the window's first idle moment after start-up, so the first picker opens as fast as the next
 * (measured: 300 ms with a 265 ms long task the first time, 40 ms after). Start-up itself never waits on it.
 */
export function prefetchEmojiWhenIdle(win: Window & typeof globalThis = window): void {
  const read = (): void => { void emojiSections().catch(() => {}); };
  if (typeof win.requestIdleCallback === "function") win.requestIdleCallback(read, { timeout: 15_000 });
  else win.setTimeout(read, 5_000);
}

/** The emoji whose name or keywords hold every word typed, in the picker's order. */
export function searchEmoji(sections: readonly EmojiSection[], query: string): Emoji[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return sections.flatMap((section) => section.emoji).filter((emoji) => words.every((word) => emoji.words.includes(word) || emoji.char === word));
}
