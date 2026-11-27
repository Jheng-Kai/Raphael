// The status list at the left of a conversation's top row: one icon, and a press lists who waits for the owner, who
// finished work the owner has not seen yet and who works, each with a coloured dot. Picking one opens its conversation.
// The icon takes the colour of the most urgent news whose conversation has yet to be opened.

import { t } from "./i18n";
import type { Member } from "./types";
import { liveStates } from "./slime";
import { esc, openMenu } from "./ui";

/** The live states that are work under way; `blocked` is a member waiting for the owner. */
const WORKING = new Set(["thinking", "working", "searching", "computer", "waiting"]);

/** What a row says, in the order the list shows them: waiting for the owner (or failed), finished, working. */
export type StatusKind = "needs" | "failed" | "busy" | "done";
export type StatusLevel = "idle" | "busy" | "done" | "needs";

const ORDER: Record<StatusKind, number> = { needs: 0, failed: 1, done: 2, busy: 3 };

interface Shown {
  member: Member;
  conversation: number | null;
  kind: StatusKind;
  cards?: string[];
  finished?: "failed" | "done";
}

export function mountStatusLight(button: HTMLElement, o: {
  roster(): readonly Member[];
  face(member: Member): string;
  open(id: number, conversation: number | null): void;
}): { draw(): void; opened(id: number, conversation?: number): void } {
  const seen = new Set<string>();
  const cardKey = (row: Shown, card: string): string => JSON.stringify([row.member.id, row.conversation, card]);

  function shown(): Shown[] {
    const states = liveStates();
    const rows: Shown[] = [];
    for (const member of o.roster()) {
      const main = member.main_conversation_id ?? null, state = states.get(member.id);
      const waiting = new Map<number | null, string[]>();
      for (const card of member.waiting_cards ?? []) {
        const conversation = card.conversation_id ?? main;
        const cards = waiting.get(conversation) ?? [];
        cards.push(card.id);
        waiting.set(conversation, cards);
      }
      if (!waiting.size && (member.waiting || state === "blocked")) waiting.set(main, [""]);
      for (const [conversation, cards] of waiting) rows.push({ member, conversation, kind: "needs", cards });
      if (WORKING.has(state ?? "")) {
        if (!waiting.size) rows.push({ member, conversation: main, kind: "busy" });
        continue;
      }
      const threads = member.unread_threads ?? (member.unread ? [{ conversation_id: main, kind: member.unread_kind }] : []);
      for (const thread of threads) {
        const conversation = thread.conversation_id ?? main;
        const kind = thread.kind === "failed" ? "failed" : "done";
        const existing = rows.find(row => row.member === member && row.conversation === conversation);
        if (!existing) rows.push({ member, conversation, kind, finished: kind });
        else if (!existing.finished || kind === "failed") {
          existing.finished = kind;
          if (existing.kind === "done") existing.kind = kind;
        }
      }
    }
    return rows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  }

  function draw(): void {
    const people = shown();
    const liveCards = new Set(people.flatMap(row => row.cards?.map(card => cardKey(row, card)) ?? []));
    for (const key of seen) if (!liveCards.has(key)) seen.delete(key);
    const dot = [...liveCards].some(key => !seen.has(key)) ? "needs"
      : people.some(row => row.finished === "failed") ? "failed"
      : people.some(row => row.finished === "done") ? "done" : "";
    if ((button.dataset.dot ?? "") !== dot) { if (dot) button.dataset.dot = dot; else delete button.dataset.dot; }
    const distinct = (rows: Shown[]): Shown[] => [...new Map(rows.map(row => [row.member.id, row])).values()];
    const needs = distinct(people.filter(entry => entry.kind === "needs" || entry.kind === "failed"));
    const busy = distinct(people.filter(entry => entry.kind === "busy"));
    const done = distinct(people.filter(entry => entry.kind === "done"));
    const level: StatusLevel = needs.length ? "needs" : busy.length ? "busy" : done.length ? "done" : "idle";
    // The label says who: one name, or the first and how many more, never a word for them all.
    const say = (list: Shown[], one: "status.needsOne" | "status.busyOne" | "status.doneOne",
                 many: "status.needsMany" | "status.busyMany" | "status.doneMany"): string =>
      list.length === 1 ? t(one, { p0: list[0]!.member.name }) : t(many, { p0: list[0]!.member.name, p1: list.length - 1 });
    const label = level === "idle" ? t("status.idle") : level === "needs" ? say(needs, "status.needsOne", "status.needsMany")
      : level === "busy" ? say(busy, "status.busyOne", "status.busyMany") : say(done, "status.doneOne", "status.doneMany");
    if (button.dataset.level !== level) button.dataset.level = level;
    if (button.getAttribute("aria-label") !== label) { button.setAttribute("aria-label", label); button.title = label; }
  }

  let queued = false;
  /** The roster is read after the states it brings are told, so the list is drawn once both are in. */
  const later = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; draw(); });
  };
  window.addEventListener("slime-activity", later);

  const GROUP = { needs: "status.groupNeeds", failed: "status.groupNeeds", busy: "status.groupBusy", done: "status.groupDone" } as const;
  button.addEventListener("click", () => {
    const people = shown();
    const valueOf = ({ member, conversation }: Shown): string =>
      conversation === (member.main_conversation_id ?? null) ? String(member.id) : `${member.id}:${conversation}`;
    openMenu(button, people.map(row => ({
      value: valueOf(row),
      label: row.member.name,
      lead: `<span class="status-row-dot" data-kind="${esc(row.kind)}" aria-hidden="true"></span>${o.face(row.member)}`,
      group: t(GROUP[row.kind]),
    })), "", value => {
      const row = people.find(entry => valueOf(entry) === value);
      if (row) o.open(row.member.id, row.conversation);
    }, people.length ? undefined : t("status.idle"), [], { placement: "start", selectionIndicator: false });
  });

  draw();
  return {
    draw: later,
    opened(id, conversation) {
      for (const row of shown()) {
        if (row.member.id !== id || row.conversation !== (conversation ?? row.member.main_conversation_id ?? null)) continue;
        for (const card of row.cards ?? []) seen.add(cardKey(row, card));
      }
      later();
    },
  };
}
