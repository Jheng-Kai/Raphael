// Each member has one conversation (2026-11-06, like Grok Bot). Raphael alone also keeps its quick
// questions, so its details panel shows two rows: the main conversation and the quick one.
import * as api from "./api";
import { eventRead } from './event-read';
import { onLocaleChange, t } from "./i18n";
import { describeError } from "./format";
import { confirmDelete } from "./member-dialogs";
import { openActions } from "./member-column";
import { btn, closeMenu, esc, iconButton, toaster } from "./ui";
import "./conversations.css";

export interface ConversationInfo {
  id: number;
  member_id: number;
  title: string;
  created_at_ms: number;
  updated_at_ms: number;
  is_default?: number;
  kind?: "standard" | "quick";
}

export const conversationTitle = (conversation?: ConversationInfo): string => conversation?.kind === "quick" ? t("conversations.quick") : t("conversations.main");
/** The window opens the member's one conversation; Raphael's quick one only when it is named. */
export const newestConversation = (conversations: ConversationInfo[]): ConversationInfo | undefined =>
  [...conversations].sort((a, b) => Number(a.kind === "quick") - Number(b.kind === "quick") ||
    (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0) || Number(!!b.is_default) - Number(!!a.is_default) || b.id - a.id)[0];
export const conversationChange = (memberId: number): void => {
  window.dispatchEvent(new CustomEvent("conversations-changed", { detail: memberId }));
};

export function relativeTime(ms: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 1) return t("conversations.now");
  if (minutes < 60) return t("conversations.minutes", { p0: minutes });
  if (minutes < 1440) return t("conversations.hours", { p0: Math.floor(minutes / 60) });
  return t("conversations.days", { p0: Math.floor(minutes / 1440) });
}

/** Raphael's main conversation and quick questions; the open one is marked. */
export function mountConversationList(host: HTMLElement, options: { memberId: number; scope?: object; active?(): boolean; onOpen(id: number): void; current?(): number | undefined }): { refresh(): Promise<void>; destroy(): void } {
  let conversations: ConversationInfo[] = [];
  let epoch = 0, destroyed = false, dirty = false;
  host.classList.add("conversation-list");
  host.innerHTML = `<div class="conversation-rows" aria-live="polite"></div>`;
  const rows = host.querySelector<HTMLElement>(".conversation-rows")!;

  function draw(): void {
    const open = options.current?.() ?? newestConversation(conversations)?.id;
    const main = newestConversation(conversations.filter(c => c.kind !== "quick"));
    const quick = conversations.find(c => c.kind === "quick");
    rows.innerHTML = [main, quick].filter((c): c is ConversationInfo => !!c).map(c => `<div class="conversation-row">` +
      btn(`<span>${esc(conversationTitle(c))}</span><small>${esc(relativeTime(c.updated_at_ms))}</small>`, "conversation-open", ` data-conversation-open="${c.id}" aria-current="${c.id === open}"`) +
      (c.kind === "quick" ? iconButton("more", t("chat.more"), ` data-conversation-more="${c.id}" aria-haspopup="menu"`, "conversation-more") : "") + `</div>`).join("");
  }

  async function refresh(fromEvent=false): Promise<void> {
    dirty=false;
    const mine = ++epoch;
    try {
      const read=()=>api.core<{ conversations: ConversationInfo[] }>("conversations.list", { member_id: options.memberId });
      const result = await (fromEvent ? eventRead(`conversations.list:${options.memberId}`,read,options.scope ?? host) : read());
      if (!destroyed && mine === epoch) { conversations = Array.isArray(result?.conversations) ? result.conversations : []; draw(); }
    } catch (error) {
      if (!destroyed && mine === epoch) rows.textContent = describeError(error);
    }
  }

  const clicked = (event: MouseEvent): void => {
    const target = event.target as Element;
    const open = target.closest<HTMLElement>("[data-conversation-open]");
    if (open) { closeMenu(); options.onOpen(Number(open.dataset.conversationOpen)); return; }
    const more = target.closest<HTMLElement>("[data-conversation-more]");
    const quick = more && conversations.find(c => c.id === Number(more.dataset.conversationMore) && c.kind === "quick");
    if (!more || !quick) return;
    openActions(more, [{ id: "clear", label: t("conversations.clear"), icon: "trash" }], () => {
      void confirmDelete(conversationTitle(quick), { clearHistory: true }).then(async yes => {
        if (!yes) return;
        await api.core("conversations.clear", { id: quick.id });
        conversationChange(options.memberId);
        toaster.info(t("conversations.cleared", { p0: conversationTitle(quick) }));
      }).catch(error => toaster.info(describeError(error)));
    });
    document.querySelector('[data-pick="clear"]')?.classList.add("danger");
  };
  host.addEventListener("click", clicked);
  const changed = (event: Event): void => {
    // A panel no longer on the page reads nothing.
    if ((event as CustomEvent<number>).detail !== options.memberId || !host.isConnected) return;
    if(options.active?.()===false){dirty=true;return;}
    void refresh(true);
  };
  window.addEventListener("conversations-changed", changed);
  const opened = (event: Event): void => { if ((event as CustomEvent<number>).detail === options.memberId) { if(dirty && options.active?.()!==false)void refresh(true);else draw(); } };
  window.addEventListener("conversation-opened", opened);
  const stopLocale = onLocaleChange(draw);
  draw(); void refresh();
  return { refresh, destroy() { destroyed = true; epoch++; host.removeEventListener("click", clicked); stopLocale(); window.removeEventListener("conversations-changed", changed); window.removeEventListener("conversation-opened", opened); host.replaceChildren(); } };
}
