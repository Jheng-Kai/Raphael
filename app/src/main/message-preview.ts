// One preview and one in-place expand action for owner and assistant messages.
import { t } from "./i18n";
import { btn, esc } from "./ui";

export function messageExpandHTML(text: string, expanded: boolean): string {
  const likelyLong = text.length > 600 || text.split("\n").length > 8;
  return btn(esc(t(expanded ? "chat.showLess" : "chat.showAll")), "sm message-expand", ` data-act="expand-message" aria-expanded="${expanded}"${expanded || likelyLong ? "" : " hidden"}`);
}

export function measureMessagePreviews(root: HTMLElement): void {
  for (const message of root.querySelectorAll<HTMLElement>("[data-expandable]")) {
    const text = message.querySelector<HTMLElement>(".message-text");
    const toggle = message.querySelector<HTMLButtonElement>('[data-act="expand-message"]');
    if (!text || !toggle || text.clientHeight <= 0) continue;
    const expanded = message.classList.contains("is-expanded");
    const clipped = !expanded && text.scrollHeight > text.clientHeight + 1;
    message.classList.toggle("is-clipped", clipped);
    toggle.hidden = !expanded && !clipped;
  }
}
