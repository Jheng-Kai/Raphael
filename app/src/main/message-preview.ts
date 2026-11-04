// One preview and one in-place expand action for owner messages.
import { t } from "./i18n";
import { btn, esc } from "./ui";

export function messageExpandHTML(text: string, expanded: boolean): string {
  const likelyLong = text.length > 600 || text.split("\n").length > 8;
  return btn(esc(t(expanded ? "chat.showLess" : "chat.showAll")), "sm message-expand", ` data-act="expand-message" aria-expanded="${expanded}"${expanded || likelyLong ? "" : " hidden"}`);
}

/** A message keeps its height until it is redrawn or the width changes, so each render measures only what it drew. */
const measured = new WeakSet<HTMLElement>();
const SHORT_MESSAGE = 100;

export function measureMessagePreviews(root: HTMLElement, { all = false } = {}): void {
  for (const message of root.querySelectorAll<HTMLElement>("[data-expandable]")) {
    if (!all && measured.has(message)) continue;
    const text = message.querySelector<HTMLElement>(".message-text");
    const toggle = message.querySelector<HTMLButtonElement>('[data-act="expand-message"]');
    if (!text || !toggle) continue;
    // A short single line cannot reach the clamp at any width the thread allows, so it needs no layout.
    const words = text.textContent ?? "";
    if (words.length <= SHORT_MESSAGE && !words.includes("\n")) {
      measured.add(message);
      if (!toggle.hidden) toggle.hidden = true;
      continue;
    }
    if (text.clientHeight <= 0) continue;
    measured.add(message);
    const expanded = message.classList.contains("is-expanded");
    const clipped = !expanded && text.scrollHeight > text.clientHeight + 1;
    message.classList.toggle("is-clipped", clipped);
    toggle.hidden = !expanded && !clipped;
  }
}

/** Width and font notifications in one frame share a single full measurement. */
export function messagePreviewMeasure(root: HTMLElement): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (root.isConnected) measureMessagePreviews(root, { all: true }); });
  };
}
