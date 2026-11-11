// What a colleague said to a member, in that member's own chat: one centred line 「與 X 的 2 則訊息」, the same line the
// asker's side shows (handoff-line.ts). It opens the two members' conversation in place of the thread (peer-chat.ts),
// never an inline box under the line: what was asked and what the member answered are read there.
import { eventPeopleHTML } from "./event-line";
import { t } from "./i18n";
import { peerCount, peerKey, peerStateWords } from "./peer-chat";
import type { TurnLook } from "./timeline";
import type { AgentTurn, HandoffView } from "./types";
import { esc } from "./ui";

/** A colleague's message to this member and the member's answer, as the hand-off record the conversation view reads. */
export function exchangeView(turn: AgentTurn): HandoffView {
  const replies = (turn.messages ?? []).filter((message) => message.kind === "reply" && message.text.trim()).map((message) => message.text.trim());
  const answer = replies.length ? replies.join("\n\n") : turn.text.trim();
  const running = turn.status === "running" || turn.status === "queued";
  const state = running ? "running" : turn.status === "confirm" ? "waiting" : answer ? "done" : "failed";
  const last = turn.messages?.length ? turn.messages[turn.messages.length - 1]!.at_ms : turn.created_at_ms;
  return {
    task_id: null, source_turn_id: turn.id, work_turn_id: turn.id, member_id: turn.member_id ?? 0, member_name: "",
    from_member_id: turn.peer_id ?? 0, stage_id: "", mode: "consult", state, reason: null,
    created_at_ms: turn.created_at_ms, ready_at_ms: turn.created_at_ms, started_at_ms: turn.created_at_ms,
    finished_at_ms: running ? null : last, dispatch_policy: "immediate", result: answer, request: turn.question.trim(), evidence: [],
  };
}

export function receivedLineHTML(turn: AgentTurn, look: TurnLook): string {
  // The same colleague several times in a row is one line with every message counted.
  const views = [...(look.exchangeTogether ?? []), turn].map(exchangeView), view = views[views.length - 1]!, peer = view.from_member_id;
  const person = { name: look.memberName?.(peer) ?? "", face: look.memberFace?.(peer) ?? "" };
  const count = peerCount(views);
  const state = view.state === "done" ? "" : peerStateWords(view);
  const keys = [...new Set(views.map(peerKey))].join(" ");
  return `<button type="button" class="btn event-open handoff-event exchange-event" data-act="peer-chat" data-exchange="${esc(turn.id)}" data-state="${esc(view.state)}" data-peer-keys="${esc(keys)}">` +
    eventPeopleHTML(t(count === 1 ? "handoff.groupOne" : "handoff.group", { p0: count, p1: "\u00000\u0000" }), [person], state) + `</button>`;
}
