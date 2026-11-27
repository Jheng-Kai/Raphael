// Each member has one conversation, Raphael included: its quick questions (Alt+Space) are turns of it. What the pages
// share about conversations is here: which one opens, when it changed, how long ago, and the one way to clear it.
import * as api from "./api";
import { t } from "./i18n";
import { confirmDelete } from "./member-dialogs";
import "./conversations.css";

export interface ConversationInfo {
  id: number;
  member_id: number;
  title: string;
  created_at_ms: number;
  updated_at_ms: number;
  is_default?: number;
}

/** The conversation a window opens: the member's one, or the newest where a database still holds more. */
export const newestConversation = (conversations: ConversationInfo[]): ConversationInfo | undefined =>
  [...conversations].sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0) || Number(!!b.is_default) - Number(!!a.is_default) || b.id - a.id)[0];
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

/**
 * Clears everything said in a conversation, after the shared red confirmation: false when the owner said no. The
 * conversation itself stays (the core keeps its identity) and every window of the member reads it again.
 */
export async function clearConversation(memberId: number, conversationId: number, name: string): Promise<boolean> {
  if (!(await confirmDelete(name, { clearHistory: true }))) return false;
  await api.core("conversations.clear", { id: conversationId });
  conversationChange(memberId);
  return true;
}
