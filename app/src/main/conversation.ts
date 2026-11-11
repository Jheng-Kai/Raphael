// The conversation with Raphael as the main window shows it (`agent.history.list`): one thread of
// every turn, by voice, from a chat app or typed in the 拉斐爾 page, oldest first under the days
// they were had. The person's words are in 「…」 and Raphael's
// in 《prefix。text》. The functions that make HTML put every word that came from the core or from
// the person through `esc` first.

import { esc } from "./ui";
import { dayLabel } from "./format";
import type { AgentTurn } from "./types";
import { publicEventText } from "./public-event";

/** A question said to the emblem (the key and the overlay): the core's default source. */
export const VOICE = "voice";
/** A question typed in the composer of the 拉斐爾 page. */
export const TYPED = "app";

/** Where a turn came from: `voice`, `app` (typed in the page) or the chat app (`telegram`). */
export const sourceOf = (turn: AgentTurn): string => turn.source || VOICE;

/** One line of the thread: the heading of a day, a turn, or what one colleague asked in a row. */
export type ThreadItem =
  | { kind: "day"; key: string; label: string }
  /** `together`: the earlier exchanges with the same colleague in a row, drawn in this turn's one line. */
  | { kind: "turn"; key: string; turn: AgentTurn; together?: AgentTurn[] };

/** An exchange that is only its line: nothing waits for the owner under it. */
const bareExchange = (turn: AgentTurn): boolean => exchangeTurn(turn) && turn.status !== "confirm" &&
  !turn.permissions?.length && !turn.connectors?.length && !turn.secrets?.length && !turn.computers?.length;

/** Whether a turn is a colleague's question or hand-off to this member, not the owner's own words. */
export const exchangeTurn = (turn: AgentTurn): boolean =>
  turn.scope === "exchange" || turn.route === "exchange" || sourceOf(turn) === "member";

/**
 * Whether another member handed this turn's words to the member that answers it: a brief the member works on in its own
 * conversation (`route` "worker" or "delegate", `peer_id` the member who handed it over). Those words are that member's, never
 * the owner's: no owner bubble (owner, 2026-11-11: Raphael's brief stood in a member's conversation as the owner's message).
 */
export const delegatedTurn = (turn: AgentTurn): boolean =>
  (turn.route === "worker" || turn.route === "delegate") && turn.peer_id != null && turn.peer_id !== turn.member_id;

/** Whether the owner wrote the words of a turn: not a routine's, a colleague's or a hand-off's. */
export const ownerTurn = (turn: AgentTurn): boolean =>
  sourceOf(turn) !== "routine" && sourceOf(turn) !== "member" && turn.route !== "exchange" && !delegatedTurn(turn);

/** Empty historical records have nothing to say, including under their date heading. */
export function visibleTurn(turn: AgentTurn): boolean {
  if (turn.scope === "room" || turn.scope === "quarantine") return false;
  if (exchangeTurn(turn)) return !!(turn.question.trim() ||
    (turn.status !== "running" && turn.status !== "confirm" && (turn.detail || turn.text).trim()));
  return !!(turn.question.trim() || turn.text.trim() || turn.detail?.trim() ||
    turn.messages?.some(message => message.text.trim()) || turn.attachments?.length || turn.handoffs?.length ||
    turn.connectors?.length || turn.secrets?.length || turn.computers?.length || turn.permissions?.length || turn.drafts?.length || turn.pages?.length ||
    // A pairing code that came later is a turn with its card and no words; a template card too.
    turn.pairings?.length || turn.templates?.length ||
    turn.status === "running" || turn.status === "confirm" || turn.task || turn.steps?.length);
}

/**
 * The thread: the turns (in any order) oldest first, each day under its heading (「今天」, 「昨天」, the
 * date). A turn's key is its id, so that the page can tell the lines it drew before. What one
 * colleague asked or handed this member, several times in a row on one day, is one line.
 */
export function threadItems(turns: readonly AgentTurn[], nowMs: number): ThreadItem[] {
  const oldestFirst = [...turns].sort((a, b) => a.created_at_ms - b.created_at_ms || a.id - b.id);
  const items: ThreadItem[] = [];
  let previous: number | null = null;
  for (const turn of oldestFirst) {
    if (!visibleTurn(turn)) continue;
    if (previous === null || new Date(previous).toDateString() !== new Date(turn.created_at_ms).toDateString()) {
      const label = dayLabel(turn.created_at_ms, nowMs);
      items.push({ kind: "day", key: `time:${turn.id}`, label });
    }
    // The same colleague again, right after its last exchange on the same day: one line 「與 X 的 4 則訊息」.
    const last = items[items.length - 1];
    if (last?.kind === "turn" && bareExchange(turn) && bareExchange(last.turn) && (last.turn.peer_id ?? 0) === (turn.peer_id ?? 0)) {
      items[items.length - 1] = { kind: "turn", key: `turn:${turn.id}`, turn, together: [...(last.together ?? []), last.turn] };
      previous = turn.created_at_ms;
      continue;
    }
    items.push({ kind: "turn", key: `turn:${turn.id}`, turn });
    previous = turn.created_at_ms;
  }
  return items;
}

/** Text as the search compares it: the same width and case for every way of typing it. */
const fold = (text: string): string => text.normalize("NFKC").toLocaleLowerCase();

/** Whether a turn holds `query`: in what was asked, what was answered or its longer version. Blank matches all. */
export function turnMatches(turn: AgentTurn, query: string): boolean {
  const q = fold(query.trim());
  if (q === "") return true;
  return [turn.question, turn.text, turn.detail ?? "", ...(turn.messages ?? []).map((message) => message.kind === "event" ? publicEventText(message.text) : message.text)].some((text) => fold(text).includes(q));
}

/**
 * `text` as HTML with every place that holds `query` marked (`<mark>`). Each piece goes through
 * `esc`; the marks are the only markup. The comparison folds width and case like `turnMatches`,
 * and marks the text as it is when folding keeps its length (which it does for the scripts the
 * app is used in); otherwise nothing is marked.
 */
export function highlightHTML(text: string, query: string): string {
  text = publicEventText(text);
  const q = fold(query.trim());
  if (q === "") return esc(text);
  const folded = fold(text);
  if (folded.length !== text.length) return esc(text);
  let html = "";
  let from = 0;
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
    html += esc(text.slice(from, at)) + `<mark>${esc(text.slice(at, at + q.length))}</mark>`;
    from = at + q.length;
  }
  return html + esc(text.slice(from));
}

/** Whether a turn has more to say than its line: a longer version that is not the line again. */
export function hasDetail(turn: AgentTurn): turn is AgentTurn & { detail: string } {
  return typeof turn.detail === "string" && turn.detail.trim() !== "" && turn.detail.trim() !== turn.text.trim();
}

/** The older turns that `page` (newest first) brings, added to the ones already loaded, without a turn twice. */
export function mergeTurns(loaded: readonly AgentTurn[], page: readonly AgentTurn[]): AgentTurn[] {
  const known = new Set(loaded.map((turn) => turn.id));
  return [...loaded, ...page.filter((turn) => !known.has(turn.id))].sort((a, b) => b.id - a.id);
}

/**
 * What is loaded once the newest page (`newest`, newest first, at most `pageSize` turns) is brought
 * again. The page replaces the turns it covers, and the older ones loaded before are kept only when
 * they join it: when the page is a full one and reaches back to them (it holds a turn as old as one
 * of them). A page shorter than a page is the whole history, so nothing older is left to keep. And
 * when more turns came meanwhile than one page holds, the old ones would leave a gap that paging up
 * (from the oldest turn loaded) never fills, so the page alone is kept and paging up starts again
 * under it. `keptOlder` says whether the older ones stayed, and with them what the caller knew of
 * the turns before them.
 */
export function refreshTurns(
  loaded: readonly AgentTurn[],
  newest: readonly AgentTurn[],
  pageSize: number,
): { turns: AgentTurn[]; keptOlder: boolean } {
  const floor = oldestId(newest);
  const older = floor === undefined ? [] : loaded.filter((turn) => turn.id < floor);
  const joins = floor !== undefined && newest.length >= pageSize && loaded.some((turn) => turn.id >= floor);
  if (older.length === 0 || !joins) return { turns: mergeTurns(newest, []), keptOlder: false };
  return { turns: mergeTurns(newest, older), keptOlder: true };
}

/** The id to ask the core for the turns before, or undefined for the first page. */
export function oldestId(turns: readonly AgentTurn[]): number | undefined {
  return turns.length === 0 ? undefined : Math.min(...turns.map((turn) => turn.id));
}
