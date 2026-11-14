import { t } from "./i18n";
import { quotedPicture } from "./picture-message";
import type { MessageQuote } from "./types";
import { esc, ico } from "./ui";

export const QUOTE_MAX_CHARS = 20_000;

/**
 * The same bounded visual excerpt in a sent bubble and in its editable draft. A quoted picture (its words are only the link
 * to its stored file, pictureQuote) shows its thumbnail and the word for a picture, never the link (R-UI-156).
 */
export function quoteHTML(quote: MessageQuote, jump = false): string {
  const tag = jump ? 'button type="button" data-act="jump-quote"' : "span";
  const picture = quotedPicture(quote.text);
  const shown = picture ? `<img class="quote-thumb" data-attachment="${esc(picture.id)}" alt=""><span class="quote-text">${esc(t("chat.image"))}</span>` : `<span class="quote-text">${esc(quote.text)}</span>`;
  return `<${tag} class="message-quote${picture ? " has-picture" : ""}"><span class="quote-author">${esc(quote.author)}</span>${shown}</${jump ? "button" : "span"}>`;
}

/** A selection can quote exactly one message; toolbar/composer selections are never eligible. */
export function selectionQuote(options: {
  host: HTMLElement; thread: HTMLElement; active: () => boolean;
  author: (message: HTMLElement) => string; onQuote: (quote: MessageQuote) => void;
}): () => void {
  const { host, thread } = options;
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "btn quote-pill";
  pill.hidden = true;
  host.append(pill);
  let selected: MessageQuote | null = null;
  const hide = (): void => { pill.hidden = true; selected = null; };
  const messageOf = (node: Node | null): HTMLElement | null =>
    (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(".bubble, .message-text") ?? null;
  const update = (): void => {
    // Typing changes a field's selection every key. It cannot quote a message, and querying it can force layout.
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || (focused as HTMLElement | null)?.isContentEditable) { hide(); return; }
    const selection = document.getSelection();
    if (!options.active() || !selection || selection.isCollapsed || selection.rangeCount !== 1) { hide(); return; }
    const message = messageOf(selection.anchorNode);
    if (!message || !thread.contains(message) || messageOf(selection.focusNode) !== message) { hide(); return; }
    const text = selection.toString().trim();
    if (!text || text.length > QUOTE_MAX_CHARS) { hide(); return; }
    const range = selection.getRangeAt(0), rects = Array.from(range.getClientRects());
    const end = rects[rects.length - 1];
    if (!end) { hide(); return; }
    selected = { text, author: options.author(message) };
    pill.innerHTML = ico("copy") + `<span>${esc(t("chat.quote"))}</span>`;
    pill.hidden = false;
    const size = pill.getBoundingClientRect();
    const top = Math.min(...rects.map(rect => rect.top)) - Math.max(size.height, 32) - 8;
    if (top < 4 || end.top >= window.innerHeight) { hide(); return; }
    pill.style.top = `${top}px`;
    pill.style.left = `${Math.max(8, Math.min(window.innerWidth - Math.max(size.width, 74) - 8, end.right - Math.max(size.width, 74)))}px`;
  };
  pill.addEventListener("pointerdown", event => event.preventDefault());
  pill.addEventListener("click", () => {
    if (selected) options.onQuote(selected);
    hide();
  });
  document.addEventListener("selectionchange", update);
  thread.addEventListener("pointerup", update);
  thread.addEventListener("keyup", update);
  host.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
  document.addEventListener("pointerdown", event => { if (!pill.contains(event.target as Node)) hide(); });
  return hide;
}
