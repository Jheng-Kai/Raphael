import type { ThreadLine } from "./thread-diff";
import { esc } from "./ui";
import { TRANSCRIPT_WINDOW } from "./transcript-window";
import { t } from "./i18n";

export function unreadLine(boundary: number): ThreadLine {
  return { key: `unread:${boundary}`, html: `<li class="thread-new" role="separator" aria-label="${esc(t("chat.newMessages"))}"><span>${esc(t("chat.newMessages"))}</span></li>` };
}

/** Keep a short unread run at the bottom; start a longer one at its first line. True when it starts at the line. */
export function openUnread(scroller: HTMLElement): boolean {
  const line = scroller.querySelector<HTMLElement>(".thread-new");
  const top = line ? line.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : 0;
  const atLine = !!line && scroller.scrollHeight - top > scroller.clientHeight;
  scroller.scrollTop = atLine ? Math.max(0, top - 24) : scroller.scrollHeight;
  return atLine;
}

/**
 * Whether the first unseen turn (at `index` of `total`, oldest first) is already inside the newest window. Then the
 * window is left as it is: it mounts the newest turn, and `openUnread` alone decides between the line and the bottom
 * by the viewport. A window centred on the line would cut the tail off whenever 14 or more turns follow it, and a
 * short run would open above the newest turn with the latest button showing (R-UI-96; the owner, 2026-11-11:
 * a conversation opens at its newest message).
 */
export function unreadInTail(index: number, total: number): boolean {
  return total - index <= TRANSCRIPT_WINDOW.initial;
}
