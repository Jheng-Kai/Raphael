// The status light at the left of a conversation's top row: one dot that says whether any member is working or waits for
// the owner, and a press lists them. Members waiting for the owner come first; picking one opens its conversation.

import { t } from "./i18n";
import type { Member } from "./types";
import { liveStates } from "./slime";
import { openMenu } from "./ui";

/** The live states that are work under way; `blocked` is a member waiting for the owner. */
const WORKING = new Set(["thinking", "working", "searching", "computer", "waiting"]);

export type StatusLevel = "idle" | "busy" | "needs";

interface Shown { member: Member; needs: boolean }

export function mountStatusLight(button: HTMLElement, o: {
  roster(): readonly Member[];
  face(member: Member): string;
  open(id: number): void;
}): { draw(): void } {
  function shown(): Shown[] {
    const states = liveStates();
    return o.roster()
      .map(member => ({ member, needs: member.waiting || states.get(member.id) === "blocked", busy: WORKING.has(states.get(member.id) ?? "") }))
      .filter(entry => entry.needs || entry.busy)
      .sort((a, b) => Number(b.needs) - Number(a.needs))
      .map(({ member, needs }) => ({ member, needs }));
  }

  function draw(): void {
    const people = shown();
    const level: StatusLevel = people.some(entry => entry.needs) ? "needs" : people.length ? "busy" : "idle";
    // The light says who: one name, or the first and how many more, never a word for them all.
    const named = level === "needs" ? people.filter(entry => entry.needs) : people;
    const first = named[0]?.member.name ?? "";
    const label = level === "idle" ? t("status.idle")
      : level === "needs" ? (named.length === 1 ? t("status.needsOne", { p0: first }) : t("status.needsMany", { p0: first, p1: named.length - 1 }))
      : named.length === 1 ? t("status.busyOne", { p0: first }) : t("status.busyMany", { p0: first, p1: named.length - 1 });
    if (button.dataset.level !== level) button.dataset.level = level;
    if (button.getAttribute("aria-label") !== label) { button.setAttribute("aria-label", label); button.title = label; }
  }

  let queued = false;
  /** The roster is read after the states it brings are told, so the light is drawn once both are in. */
  const later = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; draw(); });
  };
  window.addEventListener("slime-activity", later);

  button.addEventListener("click", () => {
    const people = shown();
    openMenu(button, people.map(({ member, needs }) => ({
      value: String(member.id),
      label: member.name,
      lead: o.face(member),
      group: needs ? t("status.groupNeeds") : t("status.groupBusy"),
    })), "", value => o.open(Number(value)), people.length ? undefined : t("status.idle"), [], { placement: "start", selectionIndicator: false });
  });

  draw();
  return { draw: later };
}
