// The status list at the left of a conversation's top row: one icon, and a press lists who waits for the owner, who
// works and who finished work the owner has not seen yet, each with a coloured dot. Picking one opens its conversation.
// News the owner has not opened the list for puts a small dot on the icon, the colour of its most urgent row (waiting,
// then failed, then finished); work under way adds none, and opening the list clears it until something new comes.

import { t } from "./i18n";
import type { Member } from "./types";
import { liveStates } from "./slime";
import { esc, openMenu } from "./ui";

/** The live states that are work under way; `blocked` is a member waiting for the owner. */
const WORKING = new Set(["thinking", "working", "searching", "computer", "waiting"]);

/** What a row says, in the order the list shows them: waiting for the owner (or failed), working, finished. */
export type StatusKind = "needs" | "failed" | "busy" | "done";
export type StatusLevel = "idle" | "busy" | "done" | "needs";

const ORDER: Record<StatusKind, number> = { needs: 0, failed: 1, busy: 2, done: 3 };

interface Shown { member: Member; kind: StatusKind }

export function mountStatusLight(button: HTMLElement, o: {
  roster(): readonly Member[];
  face(member: Member): string;
  open(id: number): void;
}): { draw(): void } {
  function kindOf(member: Member, state: string | undefined): StatusKind | null {
    if (member.waiting || state === "blocked") return "needs";
    if (WORKING.has(state ?? "")) return "busy";
    // Finished work the owner has not opened yet: a reply, a task or routine that ended; one that went wrong waits for them.
    if (member.unread) return member.unread_kind === "failed" ? "failed" : "done";
    return null;
  }

  function shown(): Shown[] {
    const states = liveStates();
    return o.roster()
      .map(member => ({ member, kind: kindOf(member, states.get(member.id)) }))
      .filter((entry): entry is Shown => entry.kind !== null)
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  }

  /** What the owner has seen in the list: each member and kind it showed when it was last opened (`id:kind`). */
  let seen = new Set<string>();
  const news = (people: readonly Shown[]): Shown[] => people.filter(entry => entry.kind !== "busy");
  const seenKey = (entry: Shown): string => `${entry.member.id}:${entry.kind}`;

  function draw(): void {
    const people = shown();
    // The list is sorted most urgent first, so the first unseen row gives the dot its colour.
    const dot = news(people).find(entry => !seen.has(seenKey(entry)))?.kind ?? "";
    if ((button.dataset.dot ?? "") !== dot) { if (dot) button.dataset.dot = dot; else delete button.dataset.dot; }
    const needs = people.filter(entry => entry.kind === "needs" || entry.kind === "failed");
    const busy = people.filter(entry => entry.kind === "busy");
    const done = people.filter(entry => entry.kind === "done");
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
  // Opening a conversation reads its news: that one leaves the finished group.
  window.addEventListener("conversation-opened", later);

  const GROUP = { needs: "status.groupNeeds", failed: "status.groupNeeds", busy: "status.groupBusy", done: "status.groupDone" } as const;
  button.addEventListener("click", () => {
    const people = shown();
    seen = new Set(news(people).map(seenKey));
    draw();
    openMenu(button, people.map(({ member, kind }) => ({
      value: String(member.id),
      label: member.name,
      lead: `<span class="status-row-dot" data-kind="${esc(kind)}" aria-hidden="true"></span>${o.face(member)}`,
      group: t(GROUP[kind]),
    })), "", value => o.open(Number(value)), people.length ? undefined : t("status.idle"), [], { placement: "start", selectionIndicator: false });
  });

  draw();
  return { draw: later };
}
