/** One dictation destination, preserving the existing history and dictionary pages. */
import { onLocaleChange, t } from "../i18n";
import { createProblemNotice } from "../problem-notice";
import type { AppContext, DictationTab, Page } from "../types";
import { esc, tabs } from "../ui";
import "../dictation-page.css";

const TAB_IDS: DictationTab[] = ["overview", "history", "dictionary"];
/**
 * 聽寫 opens on 總覽 every time it is opened again. Going back through the navigation history still lands on the tab that place was.
 */
export function createDictation(app: AppContext, pages: Record<DictationTab, Page>, chooseTab?: (tab: DictationTab) => void) {
  const el = document.createElement("div"); el.className = "page page-dictation"; el.dataset.page = "dictation"; el.hidden = true;
  const head = document.createElement("div"); head.className = "dictation-navigation";
  const content = document.createElement("div"); content.className = "dictation-content";
  const notice = createProblemNotice(app);
  content.append(notice.el); el.append(head, content);
  let selected: DictationTab = "overview", visible = false;
  function paint(): void {
    const restoreFocus = head.contains(document.activeElement);
    // The app's one tab component (ui.ts tabs()), as the panel's and 模型與用量's.
    head.innerHTML = `<div class="page-head"><h1>${esc(t("nav.dictation"))}</h1></div>` +
      `<div class="dictation-nav">${tabs(TAB_IDS.map(id => ({
        id, label: t(id === "overview" ? "dictation.overview" : id === "history" ? "main.002" : "main.003"),
        attrs: ` id="dictation-tab-${id}" data-dictation-tab="${id}" aria-controls="dictation-panel-${id}" tabindex="${id === selected ? 0 : -1}"`,
      })), selected, { label: t("nav.dictation"), kind: "nav", plain: true })}</div>`;
    for (const id of TAB_IDS) pages[id].el.hidden = id !== selected;
    if (restoreFocus) head.querySelector<HTMLElement>(`[data-dictation-tab="${selected}"]`)?.focus({ preventScroll: true });
  }
  function setTab(tab: DictationTab, activate = true): void {
    if (tab !== selected && visible) pages[selected].hide();
    const changed = tab !== selected;
    selected = tab;
    paint();
    if (changed && visible && activate) void pages[selected].show();
  }
  for (const id of TAB_IDS) {
    const panel = pages[id].el;
    panel.id = `dictation-panel-${id}`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `dictation-tab-${id}`);
    content.append(panel);
  }
  head.addEventListener("click", event => {
    const tab = (event.target as Element).closest<HTMLElement>("[data-dictation-tab]")?.dataset.dictationTab as DictationTab | undefined;
    if (tab) (chooseTab ?? setTab)(tab);
  });
  head.addEventListener("keydown", event => {
    const tab = (event.target as Element).closest<HTMLElement>("[data-dictation-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const at = TAB_IDS.indexOf(selected);
    const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (at + (event.key === "ArrowRight" ? 1 : 2)) % 3;
    head.querySelector<HTMLButtonElement>(`[data-dictation-tab="${TAB_IDS[next]}"]`)!.click();
    head.querySelector<HTMLElement>(`[data-dictation-tab="${TAB_IDS[next]}"]`)?.focus();
  });
  onLocaleChange(paint); paint();
  return {
    id: "dictation" as const, el, tab: () => selected, setTab,
    show() { visible = true; paint(); notice.show(); void pages[selected].show(); },
    // Left, the page forgets its tab: the next visit starts on 總覽 unless the navigation history names another.
    hide() { visible = false; pages[selected].hide(); notice.hide(); selected = "overview"; },
  };
}
