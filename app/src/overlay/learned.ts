import { isUiLocale, setLocale, t } from "../main/i18n";

export interface LearnedNotice { words: string[]; token: string; language: string; theme?: string }
export interface LearnedActions {
  layout(token: string, width: number, height: number): Promise<unknown>;
  finish(token: string, undo: boolean): Promise<unknown>;
}

/** The pill has its own lifetime and never changes the dictation emblem or its subtitles. */
export function learnedPill(root: HTMLElement, actions: LearnedActions): { show(notice: LearnedNotice): void } {
  const text = root.querySelector<HTMLElement>(".learned-text")!;
  const undo = root.querySelector<HTMLButtonElement>(".learned-undo")!;
  let current: LearnedNotice | undefined, timer: ReturnType<typeof setTimeout> | undefined, leaving: ReturnType<typeof setTimeout> | undefined;
  let hovered = false, generation = 0;
  const close = (notice: LearnedNotice): void => {
    if (current !== notice) return;
    clearTimeout(timer);
    root.classList.add("is-leaving");
    leaving = setTimeout(() => { if (current === notice) { root.hidden = true; current = undefined; } }, 180);
  };
  const arm = (): void => {
    clearTimeout(timer);
    if (!current || hovered) return;
    const notice = current;
    timer = setTimeout(() => { close(notice); void actions.finish(notice.token, false).catch(() => {}); }, 5000);
  };
  root.addEventListener("mouseenter", () => { hovered = true; clearTimeout(timer); });
  root.addEventListener("mouseleave", () => { hovered = false; arm(); });
  undo.addEventListener("click", () => {
    if (!current || undo.disabled) return;
    const notice = current, epoch = generation;
    clearTimeout(timer); undo.disabled = true;
    void actions.finish(notice.token, true).then(() => close(notice)).catch(() => {
      if (epoch === generation) { undo.disabled = false; arm(); }
    });
  });
  return { show(notice) {
    if (!notice.words.length || !isUiLocale(notice.language)) return;
    generation++; clearTimeout(timer); clearTimeout(leaving);
    current = notice; root.hidden = false; root.classList.remove("is-leaving");
    setLocale(notice.language);
    if (notice.theme === "light" || notice.theme === "dark") document.documentElement.dataset.theme = notice.theme;
    root.querySelector<HTMLImageElement>("img")!.src = `/brand/app-emblem-${document.documentElement.dataset.theme === "dark" ? "dark" : "light"}-64.webp`;
    text.textContent = t("dictionary.learned", { p0: notice.words.join(notice.language === "en" ? ", " : "、") });
    undo.textContent = t("dictionary.undo"); undo.disabled = !notice.token;
    void Promise.resolve(document.fonts?.ready).then(() => {
      if (current !== notice) return;
      const bounds = root.getBoundingClientRect();
      return actions.layout(notice.token, Math.ceil(bounds.width), Math.ceil(bounds.height));
    }).catch(() => {});
    arm();
  } };
}
