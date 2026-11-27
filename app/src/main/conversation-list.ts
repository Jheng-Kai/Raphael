// Each member has one conversation, Raphael included: its quick questions (Alt+Space) are turns of it. What the pages
// share about conversations is here: which one opens, when it changed and how long ago.
import { t } from "./i18n";
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
