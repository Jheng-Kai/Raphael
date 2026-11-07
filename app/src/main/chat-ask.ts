// A button on a panel that is done in the conversation (owner, 2026-11-07): setting up a bot, sharing a member as a
// template, changing its skills, memory or voice. The press sends the owner's words into the member's own
// conversation with an intent beside them; the member explains what it needs there and shows a card for anything only
// the owner can give. Nothing is typed into the panel.

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

/** The owner's words for `intent`, in the window's language. */
export const askWords = (intent: api.AskIntent): string => (t as unknown as (key: MessageKey) => string)(WORDS[intent]);

/** Sends the words and the intent to `memberId`'s conversation; a refusal (a turn already running) is told. */
export function askInChat(memberId: number, intent: api.AskIntent): void {
  void Promise.resolve()
    .then(() => api.agentAskText(askWords(intent), [], memberId, { intent }))
    .catch((error) => toaster.info(describeError(error)));
}
