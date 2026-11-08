// The window's language, chosen from a short list that searches itself once there are many (owner, 2026-11-08: 「可能會有
// 很多語言，應該可以加入搜尋語言」). Each language says its own name in its own script; its English name helps the search.
import { t } from "./i18n";
import { closeMenu, esc, ico, openPopover } from "./ui";

export interface LanguageChoice { value: string; label: string; english?: string }

/** More than this many languages and the list gets a search field. */
const SEARCH_FROM = 8;

const fold = (text: string): string => text.normalize("NFKC").toLocaleLowerCase();

/** The quiet button that opens the picker: a globe, the language's own name and a chevron. */
export function languageButtonHTML(languages: readonly LanguageChoice[], current: string, attrs: string): string {
  const shown = languages.find(language => language.value === current) ?? languages[0];
  return `<button type="button" class="btn lang-btn" aria-haspopup="menu" aria-expanded="false"${attrs} aria-label="${esc(`${t("settings.059")}: ${shown?.label ?? ""}`)}">` +
    `${ico("globe")}<span>${esc(shown?.label ?? "")}</span>${ico("down")}</button>`;
}

export function openLanguagePicker(anchor: HTMLElement, languages: readonly LanguageChoice[], current: string, onPick: (value: string) => void): void {
  const searchable = languages.length > SEARCH_FROM;
  const rows = (query: string): string => {
    const wanted = fold(query.trim());
    const found = languages.filter(language => !wanted || fold(`${language.label} ${language.english ?? ""} ${language.value}`).includes(wanted));
    return found.length
      ? found.map(language => `<button type="button" class="menu-choice" role="menuitemradio" tabindex="-1" data-lang="${esc(language.value)}" aria-checked="${language.value === current}">` +
        `<span class="mt">${esc(language.label)}</span>${language.english && language.english !== language.label ? `<small class="msource">${esc(language.english)}</small>` : ""}</button>`).join("")
      : `<p class="lang-none">${esc(t("lang.none"))}</p>`;
  };
  const search = searchable
    ? `<label class="lang-search">${ico("search")}<input type="search" data-lang-search autocomplete="off" spellcheck="false" placeholder="${esc(t("lang.search"))}" aria-label="${esc(t("lang.search"))}"></label>`
    : "";
  const panel = openPopover(anchor, `${search}<div class="lang-list" role="group" aria-label="${esc(t("settings.059"))}">${rows("")}</div>`,
    { className: "menu lang-menu", role: "menu", label: t("settings.059") });
  const input = panel.querySelector<HTMLInputElement>("[data-lang-search]");
  input?.addEventListener("input", () => { panel.querySelector(".lang-list")!.innerHTML = rows(input.value); });
  input?.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const first = panel.querySelector<HTMLElement>("[data-lang]");
    if (first) { event.preventDefault(); first.click(); }
  });
  panel.addEventListener("click", event => {
    const choice = (event.target as Element).closest<HTMLElement>("[data-lang]");
    if (!choice) return;
    closeMenu();
    if (choice.dataset.lang !== current) onPick(choice.dataset.lang!);
  });
  (input ?? panel.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel).focus({ preventScroll: true });
}
