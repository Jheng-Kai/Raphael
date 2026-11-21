// The languages a person speaks, and how each is written. One dropdown in the settings opens one
// picker for both: each language is one row, one button, checked on or off, and a language with several
// written variants (中文: 台灣、香港、簡體…) always carries a dropdown on its row naming the one in use, or
// the one it would start with, drawn as the settings rows' own (its value and a chevron, no box); it opens the
// variants in a submenu beside the picker, so the list never grows or jumps.
// The persisted core setting remains an ordered list of variant ids, one variant per selected language
// (one to five).
import { t } from "./i18n";
import { CHECK, esc, ico } from "./ui";

export interface LanguageVariant {
  id: string;
  name: string;
  /** Guidance about a variant's spelling or vocabulary; may be empty. */
  note?: string;
}

export interface LanguageGroup {
  id: string;
  name: string;
  variants: LanguageVariant[];
}

/** The same as the core's default. */
export const DEFAULT_LANGUAGES = ["zh-TW"];

/**
 * The dictation language that goes with each interface language (R-DEFAULT-03): the language someone chose in the first-run
 * guide is the one they speak until they say otherwise, not a fixed 繁體中文. The speech list has no variant of Russian or
 * Turkish; speech is still understood in them (it is detected, the list only chooses how it is written), so they take English.
 */
const DICTATION_FOR_INTERFACE: Record<string, string> = {
  "zh-TW": "zh-TW", "zh-CN": "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT",
  "pt-BR": "pt-BR", vi: "vi-VN", th: "th-TH", id: "id-ID",
};
export const dictationLanguagesFor = (interfaceLanguage: string): string[] => [DICTATION_FOR_INTERFACE[interfaceLanguage] ?? "en-US"];
export const MAX_LANGUAGES = 5;
export const AUTO_DETECT_HINT = () => t("languages.001");

const VARIANT_NAMES: Record<string, "language.zh-TW" | "language.zh-HK" | "language.zh-CN" | "language.yue-HK"> = {
  "zh-TW": "language.zh-TW", "zh-HK": "language.zh-HK", "zh-CN": "language.zh-CN", "yue-HK": "language.yue-HK",
};
const VARIANT_NOTES: Record<string, "language.note.zh-TW" | "language.note.zh-HK" | "language.note.zh-CN" | "language.note.yue-HK"> = {
  "zh-TW": "language.note.zh-TW", "zh-HK": "language.note.zh-HK", "zh-CN": "language.note.zh-CN", "yue-HK": "language.note.yue-HK",
};
const groupName = (g: LanguageGroup): string => g.id === "zh" ? t("language.zh") : g.name;
const variantName = (v: LanguageVariant): string => VARIANT_NAMES[v.id] ? t(VARIANT_NAMES[v.id]) : v.name;
// A language's own name ("English", "日本語") carries its lang, so that it is read in that language; a name the window
// translates (Chinese and its forms) is in the window's language and carries none.
const groupLang = (g: LanguageGroup): string => g.id === "zh" ? "" : ` lang="${esc(g.id)}"`;
const variantLang = (v: LanguageVariant): string => VARIANT_NAMES[v.id] ? "" : ` lang="${esc(v.id)}"`;
const variantNote = (v: LanguageVariant): string => VARIANT_NOTES[v.id] ? t(VARIANT_NOTES[v.id]) : v.note ?? "";

/** The language group containing a persisted variant id. */
export function groupOf(groups: LanguageGroup[], id: string): LanguageGroup | undefined {
  return groups.find((g) => g.variants.some((v) => v.id === id));
}

/** Selected language groups in the persisted priority order, without changing their variants. */
export function selectedLanguageGroups(groups: LanguageGroup[], selected: string[]): LanguageGroup[] {
  const chosen: LanguageGroup[] = [];
  for (const id of selected) {
    const group = groupOf(groups, id);
    if (group && !chosen.some((g) => g.id === group.id)) chosen.push(group);
  }
  return chosen;
}

/** Unknown ids remain readable while the core list is unavailable. */
export function languageName(groups: LanguageGroup[], id: string): string {
  const variant = groupOf(groups, id)?.variants.find((v) => v.id === id);
  return variant ? variantName(variant) : id;
}

export type LanguageChange = { ok: true; languages: string[] } | { ok: false; reason: string };

/** Adding a language uses its first variant; removing it leaves all other variants untouched. */
export function toggleTranscriptionLanguage(groups: LanguageGroup[], selected: string[], groupId: string): LanguageChange {
  const group = groups.find((g) => g.id === groupId);
  if (!group?.variants.length) return { ok: false, reason: t("languages.unavailable") };
  const remaining = selected.filter((id) => !group.variants.some((v) => v.id === id));
  if (remaining.length !== selected.length) {
    return remaining.length
      ? { ok: true, languages: remaining }
      : { ok: false, reason: t("languages.002") };
  }
  if (selected.length >= MAX_LANGUAGES) return { ok: false, reason: t("languages.003", { p0: MAX_LANGUAGES }) };
  return { ok: true, languages: [...selected, group.variants[0].id] };
}

/** A variant replaces the variant of its selected language, or chooses its language with that variant (up to five). */
export function chooseLanguageVariant(groups: LanguageGroup[], selected: string[], id: string): LanguageChange {
  const group = groupOf(groups, id);
  if (!group) return { ok: false, reason: t("languages.unavailable") };
  const current = selected.find((value) => group.variants.some((v) => v.id === value));
  if (!current) {
    if (selected.length >= MAX_LANGUAGES) return { ok: false, reason: t("languages.003", { p0: MAX_LANGUAGES }) };
    return { ok: true, languages: [...selected, id] };
  }
  return { ok: true, languages: selected.map((value) => value === current ? id : value) };
}

/** The setting as the page uses it: a list of variant ids, never empty. */
export function normalizeLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_LANGUAGES];
  const ids = value.filter((x): x is string => typeof x === "string" && x.length > 0);
  return ids.length ? ids : [...DEFAULT_LANGUAGES];
}

/**
 * What the dropdown of the language row says: each chosen language in the saved order, by the name
 * of its variant when it has several (繁體中文（台灣）), else by its own (日本語). An id the list does not
 * know (it could not be read) is shown as it is.
 */
export function languageSummary(groups: LanguageGroup[], selected: string[]): string {
  return selected
    .map((id) => {
      const group = groupOf(groups, id);
      if (!group) return id;
      return group.variants.length > 1 ? languageName(groups, id) : groupName(group);
    })
    .join(t("languages.join"));
}

/**
 * The control of the language row. It looks and acts like the other dropdowns, but opens a dialog
 * rather than a menu: the picker holds two kinds of choice. `attrs` names it for the page.
 */
export function languageSelectHTML(groups: LanguageGroup[], selected: string[], attrs = ""): string {
  const summary = languageSummary(groups, selected);
  return `<button type="button" class="sel lang-sel" aria-haspopup="dialog" aria-expanded="false" ` +
    `aria-label="${esc(t("transcription.label", { p0: summary }))}" title="${esc(summary)}"${attrs}>` +
    `<span>${esc(summary)}</span>${ico("down")}</button>`;
}

/** The variant of `group` that `selected` holds, if any. */
function chosenVariant(group: LanguageGroup, selected: string[]): LanguageVariant | undefined {
  return group.variants.find((v) => selected.includes(v.id));
}

/**
 * The dropdown on a row of a language with several variants, always shown: the variant in use, or the one choosing the
 * language starts with, opening the others beside the picker. It is the settings rows' `.sel`, its value and a chevron with no
 * box, whose words brighten under the pointer (settings-polish.css). Its accessible name says whose form it is in one
 * translated string; it has no tooltip, which would only repeat the form it shows.
 */
function variantDropdownHTML(group: LanguageGroup, selected: string[]): string {
  const current = chosenVariant(group, selected) ?? group.variants[0];
  const name = variantName(current);
  const label = t("languages.variantsOf", { p0: groupName(group), p1: name });
  return `<button type="button" class="sel lang-variant-sel" data-variant-menu="${esc(group.id)}" aria-haspopup="menu" aria-expanded="false" ` +
    `aria-label="${esc(label)}"><span${variantLang(current)}>${esc(name)}</span>${ico("down")}</button>`;
}

/**
 * The submenu of a chosen language's variants, opened from the dropdown of its row: one choice each, the one in use
 * checked, with how it is written under its name.
 */
export function variantMenuHTML(groups: LanguageGroup[], selected: string[], groupId: string): string {
  const group = groups.find((g) => g.id === groupId);
  if (!group) return "";
  return group.variants.map((variant) => {
    const guidance = variantNote(variant);
    const on = selected.includes(variant.id);
    return `<button type="button" role="menuitemradio" tabindex="-1" class="lang-variant" data-variant="${esc(variant.id)}" aria-checked="${on}">` +
      `<span class="ck">${on ? CHECK : ""}</span><span class="mtd"><span class="mt"${variantLang(variant)}>${esc(variantName(variant))}</span>` +
      (guidance ? `<span class="mdesc">${esc(guidance)}</span>` : "") + `</span></button>`;
  }).join("");
}

/**
 * The picker: every language on one row, checked when it is chosen (up to five, at least one). The row is one button; a
 * language with several variants carries a dropdown on it, chosen or not, naming the variant in use or the one it would
 * start with (R-UI-165).
 */
export function languagePanelHTML(groups: LanguageGroup[] | null, selected: string[]): string {
  const head = `<div class="lang-head"><span class="lang-title">${esc(t("transcription.title"))}</span>` +
    t("languages.007", { p0: selected.length, p1: MAX_LANGUAGES });
  if (!groups?.length) return head + t("languages.008");
  const chosen = selectedLanguageGroups(groups, selected);
  const items = groups.filter((g) => g.variants.length).map((group) => {
    const on = chosen.some((g) => g.id === group.id);
    const blocked = !on && selected.length >= MAX_LANGUAGES;
    const several = group.variants.length > 1;
    return `<div class="lang-row${several ? " has-variants" : ""}"><button type="button" class="lang-item lang-language" data-language="${esc(group.id)}" aria-pressed="${on}"${blocked ? ' aria-disabled="true"' : ""}>` +
      `<span class="ck">${on ? CHECK : ""}</span><span class="mt"${groupLang(group)}>${esc(groupName(group))}</span>` +
      `</button>` +
      (several ? variantDropdownHTML(group, selected) : "") + `</div>`;
  }).join("");
  return head + `<div class="lang-list">${items}</div><p class="lang-foot">${esc(AUTO_DETECT_HINT())}</p>`;
}
