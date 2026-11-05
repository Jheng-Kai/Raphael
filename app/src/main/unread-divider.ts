import type { ThreadLine } from "./thread-diff";
import { esc } from "./ui";
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
