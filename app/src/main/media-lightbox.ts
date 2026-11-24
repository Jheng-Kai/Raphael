// A picture of a conversation, large, over the page; and the app's own full screen of a video (media-player.ts).
import { isTopLayer, registerDismissal } from "./dismissals";
import { t } from "./i18n";
import { copyButton, esc, headerCloseButton, iconButton } from "./ui";
import { copyStoredPicture } from "./picture-message";

let closing: (() => void) | null = null;
export const closeMediaLightbox = (): void => { closing?.(); };

/**
 * The lightbox: `body` as large as the window allows, its × inside it on the photo scrim, closed by the ×, Escape or a press
 * outside, the focus back on `origin`. `onClose` runs once as it closes. Returns the card.
 */
export function openLightbox(origin: HTMLElement, label: string, body: string, options: { cls?: string; onClose?: () => void; reopen?: () => void } = {}): HTMLElement {
  closing?.();
  const scrim = document.createElement("div");
  scrim.className = "mb-scrim media-lightbox";
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");
  scrim.setAttribute("aria-label", label || t("agent.viewImage"));
  scrim.innerHTML = `<div class="lb-card${options.cls ? ` ${options.cls}` : ""}">${body}${headerCloseButton(t("common.close"), ' data-lb="close"', "lb-close")}</div>`;
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
  stopOutside = registerDismissal(card, close, undefined, undefined, {
    restore: () => options.reopen ?? (options.onClose ? undefined : () => { if (origin.isConnected) openLightbox(origin, label, body, options); }),
  });
  scrim.querySelector<HTMLElement>('[data-lb="close"]')?.focus();
  return card;
}

/** Only the picture, as large as the window allows, with its close button inside it. */
export function openMediaLightbox(button: HTMLElement, src: string): void {
  const title = button.dataset.title ?? "";
  // A picture with a stored file can be copied from here, as from its message's menu.
  const id = button.dataset.attachment ?? button.querySelector<HTMLElement>("[data-attachment]")?.dataset.attachment ?? "";
  const copy = id ? iconButton("copy", t("chat.copyImage"), ' data-lb="copy"', "lb-copy") : "";
  const card = openLightbox(button, title, `<img class="lb-img" src="${esc(src)}" alt="${esc(title)}">${copy}`);
  card.querySelector<HTMLElement>('[data-lb="copy"]')?.addEventListener("click", event => {
    const name = button.querySelector("img")?.getAttribute("alt") || title || undefined;
    void copyButton(event.currentTarget as HTMLElement, () => copyStoredPicture(id, name));
  });
}
