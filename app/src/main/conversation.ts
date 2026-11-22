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

/**
 * The stretch of a turn's messages one line draws when owner messages or a colleague's exchanges joined that turn's work
 * (`joinedWork`): from `from`, the moment the turn it follows (`after`) came, until `until`, the moment the next one did. A
 * line without `from` holds the turn's own question, one without `until` everything that ends the turn (its cards, its work,
 * its slime). An owner turn with its own answer can split its question from the rest without a time cutoff.
 */
export interface TurnPart {
  from?: number;
  until?: number;
  after?: number;
  owner?: "question" | "answer";
}

/** One line of the thread: the heading of a day, a turn (or a stretch of it), or what one colleague asked in a row. */
export type ThreadItem =
  | { kind: "day"; key: string; label: string }
  /** `together`: the earlier exchanges with the same colleague in a row, drawn in this turn's one line. */
  | { kind: "turn"; key: string; turn: AgentTurn; together?: AgentTurn[]; part?: TurnPart };

/** An exchange that is only its line: nothing waits for the owner under it. */
const bareExchange = (turn: AgentTurn): boolean => exchangeTurn(turn) && turn.status !== "confirm" &&
  !turn.permissions?.length && !turn.connectors?.length && !turn.secrets?.length && !turn.computers?.length && !turn.computer_suggestion;

/** Whether a turn is a colleague's question or hand-off to this member, not the owner's own words. */
export const exchangeTurn = (turn: AgentTurn): boolean =>
  turn.scope === "exchange" || turn.route === "exchange" || sourceOf(turn) === "member";

/**
 * Whether another member handed this turn's words to the member that answers it: a brief the member works on in its own
 * conversation (`route` "worker" or "delegate", `peer_id` the member who handed it over). Those words are that member's, never
 * the owner's: no owner bubble (otherwise Raphael's brief would stand in a member's conversation as the owner's message).
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
    turn.pairings?.length || turn.templates?.length || turn.computer_suggestion ||
    turn.status === "running" || turn.status === "confirm" || (turn.task && !stoppedQuietly(turn)) || turn.steps?.length);
}

/**
 * A task somebody stopped before it did anything: the stop says nothing (R-STOP-01), so what is left of its turn (no words, no
 * steps) is not a line of the thread; a stop after some work keeps the steps it made.
 */
const stoppedQuietly = (turn: AgentTurn): boolean => turn.task?.state === "cancelled" && !turn.steps?.length;

/** Whether `work` has shown something since the owner's message `input`: a reply or a file, or anything once it is over. */
const shownSince = (work: AgentTurn, input: AgentTurn): boolean => {
  const over = work.status !== "running" && work.status !== "confirm";
  return (work.messages ?? []).some(message => message.at_ms >= input.created_at_ms && (over || message.kind === "reply" || message.kind === "media"));
};

/** Whether a turn is at work now: running, at a card, or a background task under way or waiting (the page's `active`). */
const working = (turn: AgentTurn): boolean => turn.status === "running" || turn.status === "confirm" ||
  turn.task?.state === "running" || turn.task?.state === "queued" || turn.task?.state === "waiting";

/**
 * The turns that came in while each turn's work went on and stand inside its line, oldest first, by the id of that turn.
 *
 * Owner messages (the core's `owner_input` rows: words the work read at its next step, R-BATCH-01, R-QUEUE-08) join the
 * newest owner's work before them that has shown something since (a reply or a file, or anything once it is over). That is
 * usually the turn just before them, but the core also hands them to older work still under way, a background task, with
 * other turns in between (R-QUEUE-09). A message no work has shown anything since may still be on its way to the model, and
 * it stays below every line until then, with the slime under it.
 *
 * A colleague's exchange with this member (a question or a hand-off, answered beside the work) joins the newest of this
 * member's own work before it that is still at work, or that has shown something since it came: that work was going on when
 * the colleague wrote, so what it does from then on (its later replies, its live line, its answer) comes under the exchange,
 * never above it. Work still at work takes it even before saying anything more, unlike an owner message, because nothing
 * here waits on the work reading it: it only happened while the work ran. Work over before it came takes nothing of it.
 *
 * An owner message answered as its own turn can also come during earlier work. Once it starts, its question stands before
 * any later output of that work, and its own answer follows. A waiting bubble stays at the end of the thread.
 */
function joinedWork(oldestFirst: readonly AgentTurn[]): Map<number, AgentTurn[]> {
  const joined = new Map<number, AgentTurn[]>();
  oldestFirst.forEach((turn, index) => {
    const exchange = exchangeTurn(turn);
    const ownAnswer = turn.route !== "owner_input" && !exchange;
    if (ownAnswer && (turn.status === "queued" || !ownerTurn(turn) || turn.setup || sourceOf(turn) === "connector" ||
      !(turn.question.trim() || turn.attachments?.length))) return;
    for (let earlier = index - 1; earlier >= 0; earlier--) {
      const work = oldestFirst[earlier]!;
      if (work.route === "owner_input" || exchangeTurn(work)) continue;
      if (work.status === "queued") {
        if (ownAnswer) continue;
        return;
      }
      const joins = ownAnswer
        ? (work.member_id ?? 0) === (turn.member_id ?? 0) && work.conversation_id === turn.conversation_id &&
          (stretchShows(work, { from: turn.created_at_ms + 1 }) ||
            work.messages?.some(message => message.kind === "progress" && message.at_ms > turn.created_at_ms && message.text.trim()))
        : (exchange && working(work)) || shownSince(work, turn);
      if (joins) {
        joined.set(work.id, [...joined.get(work.id) ?? [], turn]);
        return;
      }
    }
  });
  return joined;
}

/** An event a stretch draws among its replies (timeline.ts publicEventsHTML "inline"): a job set, a new name, a computer woken. */
const inlineEvent = (text: string): boolean => {
  try { return ["job_set", "renamed", "computer_woke"].includes(JSON.parse(text)?.type); } catch { return false; }
};

/**
 * Whether a stretch of a work turn (`part`) shows anything (timeline.ts turnHTML): a reply, a file, an event line or a settled
 * question in its time, and in the turn's first stretch what opens it (the owner's words or files, a brief, a hand-off, a
 * resumed setup, a card). It may say yes for a stretch that ends up empty, never no for one that draws something.
 */
function stretchShows(turn: AgentTurn, part: TurnPart): boolean {
  const inside = (at: number): boolean => (part.from === undefined || at >= part.from) && (part.until === undefined || at < part.until);
  if (part.from === undefined && (turn.question.trim() || turn.attachments?.length || turn.handoffs?.length || turn.drafts?.length ||
    turn.permissions?.length || turn.resumed_apps?.length || turn.resumed_secrets?.length || turn.resumed_computers?.length)) return true;
  return (turn.messages ?? []).some(message => inside(message.at_ms) && message.text.trim() !== "" &&
      (message.kind === "reply" || message.kind === "media" || (message.kind === "event" && inlineEvent(message.text)))) ||
    (turn.owner_questions ?? []).some(question => question.state !== "asked" && inside(question.created_at_ms ?? -Infinity));
}

/**
 * The thread: the turns (in any order) oldest first, each day under its heading (「今天」, 「昨天」, the
 * date). A turn's key is its id, so that the page can tell the lines it drew before. What one
 * colleague asked or handed this member, several times in a row on one day, is one line.
 * A message the owner sent while a turn worked, and that the work took in, stands where it was sent: the turn's line
 * breaks there into stretches (`TurnPart`), what the work said before it above the message and what it said after,
 * the reply that answers it among them, below it (otherwise the owner's words mid-work would stand last, under the reply).
 * Each message and the stretch after it stand in the message's own place in time, so the answer to a message taken by older
 * work is never drawn above the turns that came between. A colleague's exchange that came while the work went on breaks its
 * line the same way, so the work's live line and its answer stay under the exchange line.
 */
export function threadItems(turns: readonly AgentTurn[], nowMs: number): ThreadItem[] {
  const oldestFirst = [...turns].sort((a, b) => a.created_at_ms - b.created_at_ms || a.id - b.id).filter(visibleTurn);
  const joined = joinedWork(oldestFirst);
  const workOf = new Map([...joined].flatMap(([work, inputs]) => inputs.map(input => [input.id, work] as const)));
  const byId = new Map(oldestFirst.map(turn => [turn.id, turn]));
  const items: ThreadItem[] = [];
  let previous: number | null = null;
  const dated = (turn: AgentTurn): void => {
    if (previous === null || new Date(previous).toDateString() !== new Date(turn.created_at_ms).toDateString()) {
      const label = dayLabel(turn.created_at_ms, nowMs);
      items.push({ kind: "day", key: `time:${turn.id}`, label });
    }
    previous = turn.created_at_ms;
  };
  // The stretch of the work `turn` joined that follows it: from `from` until the next turn that joined that work.
  const stretchAfter = (turn: AgentTurn, from: number | undefined): void => {
    const work = byId.get(workOf.get(turn.id) ?? -1);
    if (!work) return;
    const taken = joined.get(work.id)!;
    const until = taken[taken.indexOf(turn) + 1]?.created_at_ms;
    items.push({ kind: "turn", key: `turn:${work.id}:after:${turn.id}`, turn: work,
      part: { ...(from === undefined ? {} : { from }), ...(until === undefined ? {} : { until }), after: turn.id } });
  };
  for (const turn of oldestFirst) {
    if (turn.status === "queued") continue;
    dated(turn);
    // The same colleague again, right after its last exchange on the same day: one line 「與 X 的 4 則訊息」. A stretch of the
    // work this exchange joined that shows nothing between the two does not part them: it goes on under the one line.
    const last = items[items.length - 1];
    const quiet = last?.kind === "turn" && last.part?.until !== undefined && workOf.get(turn.id) === last.turn.id &&
      !stretchShows(last.turn, last.part) ? last : undefined;
    const line = quiet ? items[items.length - 2] : last;
    if (line?.kind === "turn" && bareExchange(turn) && bareExchange(line.turn) && (line.turn.peer_id ?? 0) === (turn.peer_id ?? 0)) {
      if (quiet) items.pop();
      items[items.length - 1] = { kind: "turn", key: `turn:${turn.id}`, turn, together: [...(line.together ?? []), line.turn] };
      stretchAfter(turn, quiet ? quiet.part?.from : turn.created_at_ms);
      continue;
    }
    const inputs = joined.get(turn.id);
    const until = inputs?.[0]?.created_at_ms;
    if (workOf.has(turn.id) && turn.route !== "owner_input" && !exchangeTurn(turn)) {
      items.push({ kind: "turn", key: `turn:${turn.id}`, turn, part: { owner: "question" } });
      stretchAfter(turn, turn.created_at_ms);
      items.push({ kind: "turn", key: `turn:${turn.id}:answer`, turn, part: { owner: "answer", until } });
    } else {
      items.push({ kind: "turn", key: `turn:${turn.id}`, turn, part: until === undefined ? undefined : { until } });
      stretchAfter(turn, turn.created_at_ms);
    }
  }
  for (const turn of oldestFirst) {
    if (turn.status !== "queued") continue;
    if (previous === null || turn.created_at_ms >= previous) dated(turn);
    items.push({ kind: "turn", key: `turn:${turn.id}`, turn });
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
