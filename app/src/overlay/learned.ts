import { isUiLocale, setLocale, t } from "../main/i18n";

export interface LearnedNotice {
  revision: number;
  words: string[];
  can_undo: boolean;
  language: string;
  theme?: string;
}
export type LearnedEvent = ({ type: "show" } & LearnedNotice) | { type: "dismiss"; revision: number };
export interface LearnedActions {
  layout(revision: number, width: number, height: number): Promise<unknown>;
  finish(revision: number): Promise<unknown>;
}

/** The native window times the notice and observes hover even over click-through text. */
export function learnedPill(root: HTMLElement, actions: LearnedActions) {
  const text = root.querySelector<HTMLElement>(".learned-text")!;
  const undo = root.querySelector<HTMLButtonElement>(".learned-undo")!;
  let current: LearnedNotice | undefined;
  let revision = 0;
  let leaving: ReturnType<typeof setTimeout> | undefined;

  undo.addEventListener("click", () => {
    if (!current || undo.disabled) return;
    const notice = current;
    undo.disabled = true;
    void actions.finish(notice.revision).catch(error => {
      if (current === notice) undo.disabled = false;
      console.warn("learned Undo failed", error);
    });
  });

  return {
    show(notice: LearnedNotice): boolean {
      if (notice.revision <= revision || !notice.words.length) return false;
      revision = notice.revision;
      clearTimeout(leaving);
      current = notice;
      root.hidden = false;
      root.classList.remove("is-leaving");
      const language = isUiLocale(notice.language) ? notice.language : "zh-TW";
      setLocale(language);
      if (notice.theme === "light" || notice.theme === "dark") document.documentElement.dataset.theme = notice.theme;
      root.querySelector<HTMLImageElement>("img")!.src = `/brand/app-emblem-${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}-64.webp`;
      text.textContent = t("dictionary.learned", { p0: notice.words.join(["zh-TW", "zh-CN", "ja"].includes(language) ? "、" : ", ") });
      undo.textContent = t("dictionary.undo");
      undo.disabled = !notice.can_undo;
      void Promise.resolve(document.fonts?.ready).then(() => {
        if (current !== notice) return;
        const bounds = root.getBoundingClientRect();
        return actions.layout(notice.revision, Math.ceil(bounds.width), Math.ceil(bounds.height));
      }).catch(error => console.warn("learned pill could not be placed", error));
      return true;
    },

    dismiss(endingRevision: number): void {
      if (current?.revision !== endingRevision) return;
      current = undefined;
      undo.disabled = true;
      root.classList.add("is-leaving");
      leaving = setTimeout(() => { root.hidden = true; }, 180);
    },
  };
}
