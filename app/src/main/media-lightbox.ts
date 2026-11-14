// A picture of a conversation, large, over the page; and the app's own full screen of a video (media-player.ts).
import { isTopLayer, registerDismissal } from "./dismissals";
import { t } from "./i18n";
import { esc, iconButton } from "./ui";

let closing: (() => void) | null = null;
export const closeMediaLightbox = (): void => { closing?.(); };

/**
 * The lightbox: `body` as large as the window allows, its × inside it on the photo scrim, closed by the ×, Escape or a press
 * outside, the focus back on `origin`. `onClose` runs once as it closes. Returns the card.
 */
export function openLightbox(origin: HTMLElement, label: string, body: string, options: { cls?: string; onClose?: () => void } = {}): HTMLElement {
  closing?.();
  const scrim = document.createElement("div");
  scrim.className = "mb-scrim media-lightbox";
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  scrim.setAttribute("aria-label", label || t("agent.viewImage"));
  scrim.innerHTML = `<div class="lb-card${options.cls ? ` ${options.cls}` : ""}">${body}${iconButton("x", t("common.close"), ' data-lb="close"', "lb-close")}</div>`;
  const card = scrim.querySelector<HTMLElement>(".lb-card")!;
  let stopOutside = (): void => {};
  const close = (): void => {
    stopOutside();
    closing = null;
    options.onClose?.();
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
    origin.focus({ preventScroll: true });
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (!isTopLayer(card)) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      close();
    }
  };
  scrim.addEventListener("click", (ev) => {
    if ((ev.target as Element).closest('[data-lb="close"]')) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(scrim);
  closing = close;
  stopOutside = registerDismissal(card, close);
  scrim.querySelector<HTMLElement>('[data-lb="close"]')?.focus();
  return card;
}

/** Only the picture, as large as the window allows, with its close button inside it. */
export function openMediaLightbox(button: HTMLElement, src: string): void {
  const title = button.dataset.title ?? "";
  openLightbox(button, title, `<img class="lb-img" src="${esc(src)}" alt="${esc(title)}">`);
}
