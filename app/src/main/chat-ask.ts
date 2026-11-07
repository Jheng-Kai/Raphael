// A button on a panel that is done in the conversation (owner, 2026-11-07): setting up a bot, sharing a member as a
// template, changing its skills, memory or voice. The press sends the owner's words into the member's own
// conversation with an intent beside them; the member explains what it needs there and shows a card for anything only
// the owner can give. Nothing is typed into the panel.
//
// While the member works on it the button is busy: drawn with a spinner and pressed again it sends nothing, so the
// owner's words never go twice (owner, 2026-11-07). It is free again once the member stops (its activity is idle, done
// or an error), or after PENDING_MAX_MS if no word of that ever comes.

import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { toaster } from "./ui";

const WORDS: Record<api.AskIntent, MessageKey> = {
  "setup-telegram": "chat.ask.setupTelegram",
  "setup-slack": "chat.ask.setupSlack",
  "setup-discord": "chat.ask.setupDiscord",
  "share-template": "chat.ask.share",
  settings: "chat.ask.settings",
};

/** The longest a press keeps its button busy without word from the member. */
export const PENDING_MAX_MS = 3 * 60_000;
/** The member activities that mean it has stopped (`MemberActivity`). */
const STOPPED = new Set(["idle", "done", "error"]);

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const keyOf = (memberId: number, intent: api.AskIntent): string => `${memberId}:${intent}`;
const changed = (): void => { for (const listener of listeners) listener(); };
function clear(key: string): void {
  const timer = pending.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  pending.delete(key);
  changed();
}

/** The owner's words for `intent`, in the window's language. */
export const askWords = (intent: api.AskIntent): string => (t as unknown as (key: MessageKey) => string)(WORDS[intent]);

/** Whether `memberId` is still working on a press of `intent`. */
export const askPending = (memberId: number, intent: api.AskIntent): boolean => pending.has(keyOf(memberId, intent));

/** Called whenever a press starts or ends; returns the way to stop listening. */
export function onAskPending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A member's activity changed: once it has stopped, its presses are free again. */
export function settleAsks(memberId: number, state: string): void {
  if (!STOPPED.has(state)) return;
  for (const key of [...pending.keys()]) if (key.startsWith(`${memberId}:`)) clear(key);
}

/** Sends the words and the intent to `memberId`'s conversation, once; a refusal (a turn already running) is told. */
export function askInChat(memberId: number, intent: api.AskIntent): void {
  const key = keyOf(memberId, intent);
  if (pending.has(key)) return;
  pending.set(key, setTimeout(() => clear(key), PENDING_MAX_MS));
  changed();
  void Promise.resolve()
    .then(() => api.agentAskText(askWords(intent), [], memberId, { intent }))
    .catch((error) => { clear(key); toaster.info(describeError(error)); });
}

/** For tests: forget every press. */
export function resetAsks(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}
