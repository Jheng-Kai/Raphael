// A picture of a conversation, large, over the page.
import { isTopLayer, registerDismissal } from "./dismissals";
import { t } from "./i18n";
import { esc, iconButton } from "./ui";

let closing: (() => void) | null = null;
export const closeMediaLightbox = (): void => { closing?.(); };

export function openMediaLightbox(button: HTMLElement, src: string): void {
  const title = button.dataset.title ?? "";
  closing?.();
  const scrim = document.createElement("div");
  scrim.className = "mb-scrim media-lightbox";
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  scrim.setAttribute("aria-label", title || t("agent.viewImage"));
  scrim.innerHTML =
    `<div class="lb-card">` +
    `<div class="lb-head"><span class="lb-title">${esc(title)}</span>${iconButton("x", t("common.close"), ' data-lb="close"')}</div>` +
    `<img class="lb-img" src="${esc(src)}" alt="${esc(title)}">` +
    `</div>`;
  let stopOutside = (): void => {};
  const close = (): void => {
    stopOutside();
    closing = null;
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
    button.focus({ preventScroll: true });
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (!isTopLayer(scrim.querySelector(".lb-card"))) return;
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
  stopOutside = registerDismissal(scrim.querySelector<HTMLElement>(".lb-card")!, close);
  scrim.querySelector<HTMLElement>('[data-lb="close"]')?.focus();
}
