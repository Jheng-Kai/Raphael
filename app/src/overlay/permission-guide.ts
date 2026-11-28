import { ICON } from "../main/icon-set";
import { isUiLocale, setLocale, t } from "../main/i18n";

/** What the native window sends the card: the app's name as System Settings lists it, the owner's language and theme. */
export interface GuideShown {
  revision: number;
  name: string;
  language: string;
  theme?: string;
}
/** The app tile's place in the card, in CSS pixels (points) from the card's top left. */
export interface GuideTile { x: number; y: number; width: number; height: number }
export interface GuideActions {
  layout(revision: number, width: number, height: number, tile: GuideTile): Promise<unknown>;
  close(revision: number): Promise<unknown>;
}

const icon = (name: keyof typeof ICON): string => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/**
 * The card under System Settings while the owner gives Raphael a permission (R-PRIV-AX-02). It says to drag the app
 * into the list and turn its switch on, and reports where its tile is: the native window drags the app from there.
 */
export function permissionGuide(root: HTMLElement, actions: GuideActions) {
  const text = root.querySelector<HTMLElement>(".guide-text")!;
  const name = root.querySelector<HTMLElement>(".guide-name")!;
  const tile = root.querySelector<HTMLElement>(".guide-tile")!;
  const close = root.querySelector<HTMLButtonElement>(".guide-close")!;
  root.querySelector<HTMLElement>(".guide-arrow")!.innerHTML = icon("arrowUp");
  close.innerHTML = icon("x");
  let current: GuideShown | undefined;

  close.addEventListener("click", () => {
    if (!current || close.disabled) return;
    const shown = current;
    close.disabled = true;
    void actions.close(shown.revision).catch(error => {
      if (current === shown) close.disabled = false;
      console.warn("the permission guide could not close", error);
    });
  });

  return {
    show(shown: GuideShown): boolean {
      if (current && shown.revision <= current.revision) return false;
      current = shown;
      setLocale(isUiLocale(shown.language) ? shown.language : "zh-TW");
      if (shown.theme === "light" || shown.theme === "dark") document.documentElement.dataset.theme = shown.theme;
      text.textContent = t("permissionGuide.drag", { p0: shown.name });
      name.textContent = shown.name;
      close.setAttribute("aria-label", t("common.close"));
      close.title = t("common.close");
      close.disabled = false;
      root.hidden = false;
      void Promise.resolve(document.fonts?.ready).then(() => {
        if (current !== shown) return;
        const card = root.getBoundingClientRect();
        const place = tile.getBoundingClientRect();
        return actions.layout(shown.revision, Math.ceil(card.right), Math.ceil(card.bottom), {
          x: place.left, y: place.top, width: place.width, height: place.height,
        });
      }).catch(error => console.warn("the permission guide could not be measured", error));
      return true;
    },
  };
}
