// The way back through the main window, as in a browser: every screen the person has been on, in the
// order they went, and a step back or forward through them. A screen is any view the person goes into,
// however small: another conversation, a page opened in it, a tab of the settings or of a member's
// settings page, a skill's page, an app's page in Connect Apps (owner, 2026-11-14: 「真的是再小的進到下個畫面
// 都要可以用側鍵返回」). The mouse's side buttons and Alt+Left / Alt+Right take the steps (nav-input.ts);
// main.ts says where the window is and puts it where a step lands. Nothing here reads the page, so the
// rules can be tested without a browser.

import type { DictationTab, PageId, SettingsPane } from "./types";

/** How many places are kept; the oldest go first. */
export const NAV_LIMIT = 50;

/** How long after a press the window is looked at again, for a view that comes in after a read. */
export const NOTE_LATE_MS = 350;

/** One place of the window: a page, and what is needed to show it again the same way. */
export interface Place {
  /** The page on screen, which is the page under the settings panel while the panel is open. */
  page: Exclude<PageId, "settings">;
  /**
   * What the page shows inside it, in the page's own words (the agent page: the conversation, a page open in its place,
   * the member settings page and the view in it). Opaque here: only the page reads it.
   */
  view?: string;
  /** The tab of the settings panel, while the panel is open over the page. */
  pane?: SettingsPane;
  /** What that tab shows inside it (a sub-tab, a dialog, an app's page), in the panel's own words. */
  paneView?: string;
  /** The one day, `2026-10-14`, that the history shows; absent for all days, and on any other page. */
  day?: string;
  tab?: DictationTab;
}

const sameWords = (a: string | undefined, b: string | undefined): boolean => (a ?? "") === (b ?? "");

/** Whether the page on screen is the same, whatever is open over it. */
export const samePage = (a: Place, b: Place): boolean =>
  a.page === b.page && a.day === b.day && a.tab === b.tab && sameWords(a.view, b.view);

/** Whether the window looks the same at both: the same page, and the same tab and view open over it if any. */
export const samePlace = (a: Place, b: Place): boolean => samePage(a, b) && a.pane === b.pane && sameWords(a.paneView, b.paneView);

export type NavStep = "back" | "forward";

/**
 * The places in the order they were visited, and the one the window is at. Going to a new place
 * from the middle forgets the places that were ahead, as a browser does. Two places side by side
 * are never alike, so a step always lands somewhere that looks different.
 */
export class NavHistory {
  private places: Place[] = [];
  private at = -1;

  constructor(private readonly limit = NAV_LIMIT) {}

  /**
   * The window is at `place`. The place it is at already adds nothing. The window's own way back (an arrow, Escape,
   * a close button: `back`) that lands on the place before is that step back, as a page's back arrow is in a browser,
   * so the side button and the arrow walk the same history. Anything else is a new place.
   */
  arrive(place: Place, back = false): void {
    if (this.at >= 0 && samePlace(this.places[this.at], place)) return;
    if (back && this.at > 0 && samePlace(this.places[this.at - 1], place)) {
      this.at--;
      return;
    }
    this.places.splice(this.at + 1, this.places.length, { ...place });
    if (this.places.length > this.limit) this.places.shift();
    this.at = this.places.length - 1;
  }

  /**
   * A step was taken to the place it is at, and the window could not show it all (a member or an app that is gone): the
   * place is what the window shows instead. One that looks like a neighbour is one with it, so no step lands nowhere new.
   */
  correct(place: Place): void {
    if (this.at < 0) return;
    this.places[this.at] = { ...place };
    if (this.at > 0 && samePlace(this.places[this.at - 1], place)) {
      this.places.splice(this.at, 1);
      this.at--;
    }
    if (this.at < this.places.length - 1 && samePlace(this.places[this.at + 1], place)) this.places.splice(this.at + 1, 1);
  }

  /** The place before this one, which the window is at from now on; null when there is none. */
  back(): Place | null {
    return this.move(this.at - 1);
  }

  forward(): Place | null {
    return this.move(this.at + 1);
  }

  private move(to: number): Place | null {
    if (to < 0 || to >= this.places.length) return null;
    this.at = to;
    return { ...this.places[to] };
  }
}

/** What the history needs of the main window. */
export interface NavTarget {
  /** The first-run guide is on screen. It takes the place of every page, and is no part of the history. */
  inGuide(): boolean;
  /** Where the window is now; null before its first page. */
  where(): Place | null;
  /** Puts the window at `place`. The history has stepped to it already: this must not record it again. */
  show(place: Place): void;
}

/**
 * The history of the main window. It looks at where the window is after each thing the person does (`heard`), after a
 * move it asked for (`visit`) and before each step, so every view a press leads into is a place, with no view having to
 * report itself.
 */
export class Navigation {
  private readonly history: NavHistory;
  /** A step is putting the window somewhere: what it changes on the way is no move of the person's. */
  private restoring = false;
  /** The press being handled now is a way back (`heard`): a move it makes through `visit` is that step back. */
  private pressBack = false;

  constructor(private readonly target: NavTarget, limit = NAV_LIMIT) {
    this.history = new NavHistory(limit);
  }

  /** Records where the window is, if that is somewhere new; `back` when the window's own way back took it there. */
  note(back = false): void {
    if (this.restoring || this.target.inGuide()) return;
    const here = this.target.where();
    if (here) this.history.arrive(here, back);
  }

  /**
   * The person pressed or typed something that may take the window elsewhere (`back`: one of the window's own ways
   * back). Where it went is noted once the page has done it, and again a moment later for a view that comes in after
   * a read.
   */
  heard(back: boolean): void {
    this.pressBack = back;
    setTimeout(() => {
      this.note(back);
      this.pressBack = false;
    }, 0);
    setTimeout(() => this.note(back), NOTE_LATE_MS);
  }

  /** Runs `change`, a move to another page or tab that the person asked for, and records where it led. */
  visit(change: () => void): void {
    // A view the person went into since the last look is a place of its own, before this move leaves it.
    this.note();
    change();
    this.note(this.pressBack);
  }

  /** Takes one step. The window shows the place it lands on and nothing is recorded. */
  step(direction: NavStep): void {
    if (this.target.inGuide()) return;
    this.note();
    const place = this.history[direction]();
    if (!place) return;
    this.restoring = true;
    try {
      this.target.show(place);
    } finally {
      this.restoring = false;
    }
    const shown = this.target.where();
    if (shown && !samePlace(shown, place)) this.history.correct(shown);
  }
}
