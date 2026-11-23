import { NAV_LIMIT, type NavStep } from "./nav-history";

export type ChatPlace =
  | { page: "member"; member: number; conversation?: number }
  | { page: "room"; room: number };

export type MainPlace = ChatPlace | { page: "dictation" } | { page: "automations" };

function samePlace(a: MainPlace, b: MainPlace): boolean {
  switch (a.page) {
    case "member": return b.page === a.page && a.member === b.member && a.conversation === b.conversation;
    case "room": return b.page === a.page && a.room === b.room;
    default: return b.page === a.page;
  }
}

export class PlaceHistory {
  private readonly places: MainPlace[] = [];
  private at = -1;

  constructor(private readonly limit = NAV_LIMIT) {}

  arrive(place: MainPlace): boolean {
    const current = this.places[this.at];
    if (current && samePlace(current, place)) return false;
    this.places.splice(this.at + 1, Infinity, { ...place });
    if (this.places.length > this.limit) this.places.shift();
    this.at = this.places.length - 1;
    return true;
  }

  currentVisit(): object | undefined { return this.places[this.at]; }

  /** A conversation ID received after first opening a member identifies that same visit. */
  resolveConversation(member: number, conversation: number): void {
    for (const place of this.places) {
      if (place.page === "member" && place.member === member && place.conversation === undefined) {
        place.conversation = conversation;
      }
    }
  }

  step(direction: NavStep, exists: (place: MainPlace) => boolean): MainPlace | undefined {
    const offset = direction === "back" ? -1 : 1;
    const current = this.places[this.at];
    for (let to = this.at + offset; to >= 0 && to < this.places.length; to += offset) {
      const place = this.places[to]!;
      if (!exists(place) || (current && samePlace(current, place))) continue;
      this.at = to;
      return { ...place };
    }
  }
}

/** A side press is spent on an open layer before the main area can move. */
export function stepPlace(direction: NavStep, history: PlaceHistory, target: {
  layer(direction: NavStep): boolean;
  leave?(): boolean;
  exists(place: MainPlace): boolean;
  show(place: MainPlace): void;
}): void {
  if (target.layer(direction) || target.leave?.()) return;
  const place = history.step(direction, target.exists);
  if (place) target.show(place);
}
