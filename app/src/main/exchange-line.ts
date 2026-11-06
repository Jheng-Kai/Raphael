// What a colleague handed a member, in that member's own chat: one centred grey line in place of the owner's words, which opens
// on what was asked; the member's thinking and answer follow as in any turn, since this is where it works. A question a
// colleague only asked is not here: it is the asker's record, 「與 X 的 2 則訊息」 (handoff-line.ts).
import { NAME, eventLineHTML } from "./event-line";
import { t } from "./i18n";
import { messageHTML } from "./message-content";
import type { TurnLook } from "./timeline";
import type { AgentTurn } from "./types";
import { esc } from "./ui";

export function receivedLineHTML(turn: AgentTurn, look: TurnLook): string {
  const peer = turn.peer_id ?? 0;
  return `<details class="handoff-event exchange-event" data-exchange="${esc(turn.id)}">` +
    `<summary>${eventLineHTML(t("exchange.from", { p0: NAME }), look.memberFace?.(peer) ?? "", look.memberName?.(peer) ?? "")}</summary>` +
    `<div class="handoff-detail exchange-detail"><div class="exchange-message"><div class="message-text">${messageHTML(turn.question.trim(), "", true)}</div></div></div>` +
    `</details>`;
}
