import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NAV_LIMIT, NOTE_LATE_MS, NavHistory, Navigation, samePage, samePlace, type NavTarget, type Place } from "./nav-history";

const start: Place = { page: "automations" };
const agent: Place = { page: "agent" };
const history: Place = { page: "history" };
const dictionary: Place = { page: "dictionary" };
/** The history opened at one day, as a day of the activity grid opens it. */
const day = (date: string): Place => ({ page: "history", day: date });
/** The settings panel open over a page, at one of its tabs, showing `inside` in it. */
const panel = (page: Place["page"], pane: NonNullable<Place["pane"]>, inside?: string): Place => ({ page, pane, ...(inside ? { paneView: inside } : {}) });
/** A view inside the agent page: a conversation, a member's settings tab, a skill's page. */
const view = (words: string): Place => ({ page: "agent", view: words });

/** Arrives at the places in order. */
function visited(...places: Place[]): NavHistory {
  const trail = new NavHistory();
  places.forEach((place) => trail.arrive(place));
  return trail;
}

describe("the places visited", () => {
  test("with none visited there is nowhere to go", () => {
    const trail = new NavHistory();
    expect(trail.back()).toBeNull();
    expect(trail.forward()).toBeNull();
  });

  test("back and forward walk through them in the order they were visited", () => {
    const trail = visited(start, history, dictionary);
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toEqual(start);
    expect(trail.back()).toBeNull();
    expect(trail.forward()).toEqual(history);
    expect(trail.forward()).toEqual(dictionary);
    expect(trail.forward()).toBeNull();
  });

  test("a place visited after going back forgets the ones that were ahead", () => {
    const trail = visited(start, history, dictionary);
    trail.back();
    trail.back();
    trail.arrive(agent);
    expect(trail.forward()).toBeNull();
    expect(trail.back()).toEqual(start);
    expect(trail.forward()).toEqual(agent);
  });

  test("going to the place it is at adds nothing", () => {
    const trail = visited(start, start, history, history);
    expect(trail.back()).toEqual(start);
    expect(trail.back()).toBeNull();
  });

  test("going to the place it is at in the middle leaves the places ahead", () => {
    const trail = visited(start, history, dictionary);
    trail.back();
    trail.arrive(history);
    expect(trail.forward()).toEqual(dictionary);
  });

  test("the same page can come again once another has come between", () => {
    const trail = visited(start, history, start);
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toEqual(start);
  });

  test("keeps the newest places and lets the oldest go", () => {
    const trail = new NavHistory(3);
    [start, agent, history, dictionary].forEach((place) => trail.arrive(place));
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toEqual(agent);
    expect(trail.back()).toBeNull();
  });

  test("keeps fifty places", () => {
    expect(NAV_LIMIT).toBe(50);
    const trail = new NavHistory();
    for (let n = 0; n < 80; n++) trail.arrive(day(`day ${n}`));
    let steps = 0;
    while (trail.back()) steps++;
    expect(steps).toBe(49);
  });

  test("a place that was handed over is not changed by later changes to it", () => {
    const place: Place = { page: "history", day: "2026-10-14" };
    const trail = visited(start, place);
    place.day = "2026-10-15";
    trail.back();
    expect(trail.forward()).toEqual(day("2026-10-14"));
  });
});

describe("the window's own ways back", () => {
  test("an arrow that lands on the place before is that step back, so forward goes in again", () => {
    const trail = visited(view("m:3>s:skills"), view("m:3>s:skills/skill:4"));
    trail.arrive(view("m:3>s:skills"), true);
    expect(trail.forward()).toEqual(view("m:3>s:skills/skill:4"));
    expect(trail.back()).toEqual(view("m:3>s:skills"));
    expect(trail.back()).toBeNull();
  });

  test("an arrow that lands somewhere the history has not just been is a new place", () => {
    const trail = visited(view("m:3>s:tools"), view("m:3>s:skills"), view("m:3>s:skills/skill:4"));
    trail.back();
    trail.back();
    trail.arrive(view("m:3"), true);
    expect(trail.back()).toEqual(view("m:3>s:tools"));
    expect(trail.forward()).toEqual(view("m:3"));
    expect(trail.forward()).toBeNull();
  });

  test("an ordinary press that goes to the place before is a new place: back returns to where it was pressed", () => {
    // conversation 3, conversation 5, then 3 again from the sidebar
    const trail = visited(view("m:3"), view("m:5"));
    trail.arrive(view("m:3"));
    expect(trail.back()).toEqual(view("m:5"));
    expect(trail.back()).toEqual(view("m:3"));
  });

  test("opening and closing a panel again and again does not push the pages out of the history", () => {
    const trail = new NavHistory(3);
    trail.arrive(start);
    trail.arrive(history);
    for (let n = 0; n < 10; n++) {
      trail.arrive(panel("history", "general"));
      trail.arrive(history, true);
    }
    expect(trail.back()).toEqual(start);
    expect(trail.forward()).toEqual(history);
    expect(trail.forward()).toEqual(panel("history", "general"));
    expect(trail.forward()).toBeNull();
  });
});

describe("the settings panel", () => {
  test("opening it is a step: back closes it and leaves the page under it, forward opens it again", () => {
    const trail = visited(start, panel("automations", "general"));
    expect(trail.back()).toEqual({ page: "automations" });
    expect(trail.forward()).toEqual({ page: "automations", pane: "general" });
  });

  test("the page under the panel is the same page, so it is not shown again", () => {
    expect(samePage(panel("history", "usage"), history)).toBe(true);
    expect(samePage(panel("history", "usage"), panel("history", "about"))).toBe(true);
    expect(samePage(start, history)).toBe(false);
    expect(samePage(panel("automations", "usage"), panel("history", "usage"))).toBe(false);
  });

  test("a place is the same only with the same tab, and the same view in it, open", () => {
    expect(samePlace(panel("automations", "usage"), panel("automations", "usage"))).toBe(true);
    expect(samePlace(panel("automations", "usage"), panel("automations", "about"))).toBe(false);
    expect(samePlace(panel("automations", "usage"), start)).toBe(false);
    expect(samePlace(panel("agent", "tools", "search"), panel("agent", "tools"))).toBe(false);
    expect(samePlace(panel("agent", "tools", ""), panel("agent", "tools"))).toBe(true);
  });

  test("each tab chosen in the panel is a step, and back walks the tabs before it closes the panel", () => {
    const trail = visited(start, panel("automations", "general"), panel("automations", "tools"), panel("automations", "tools", "search"));
    expect(trail.back()).toEqual(panel("automations", "tools"));
    expect(trail.back()).toEqual(panel("automations", "general"));
    expect(trail.back()).toEqual(start);
  });

  test("a panel closed with its own button right after opening it is the step back to the page", () => {
    const trail = visited(history, start, panel("automations", "general"));
    trail.arrive(start, true);
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toBeNull();
  });

  test("a panel that was left open when the person moved on is there again going back", () => {
    const trail = visited(start, panel("automations", "usage"), dictionary);
    expect(trail.back()).toEqual(panel("automations", "usage"));
    expect(trail.back()).toEqual(start);
  });
});

describe("the views inside a page", () => {
  test("another view of the same page is another place, and the page itself is the same page", () => {
    expect(samePlace(view("m:3"), view("m:5"))).toBe(false);
    expect(samePage(view("m:3"), view("m:3>s:soul"))).toBe(false);
    expect(samePage({ ...view("m:3"), pane: "about" }, view("m:3"))).toBe(true);
    expect(samePlace(view(""), agent)).toBe(true);
  });

  test("a member's settings page walks back through its skill, its tabs, then to the conversation", () => {
    const trail = visited(view("m:3"), view("m:3>s:tools"), view("m:3>s:soul"), view("m:3>s:skills"), view("m:3>s:skills/skill:4"));
    expect(trail.back()).toEqual(view("m:3>s:skills"));
    expect(trail.back()).toEqual(view("m:3>s:soul"));
    expect(trail.back()).toEqual(view("m:3>s:tools"));
    expect(trail.back()).toEqual(view("m:3"));
  });
});

describe("the history opened at a day", () => {
  test("comes back at that day", () => {
    const trail = visited(start, day("2026-10-14"));
    expect(trail.back()).toEqual(start);
    expect(trail.forward()).toEqual(day("2026-10-14"));
  });

  test("is another page from the history of all days, and the panel over it keeps the day", () => {
    expect(samePage(day("2026-10-14"), history)).toBe(false);
    expect(samePage(day("2026-10-14"), day("2026-10-15"))).toBe(false);
    expect(samePage(day("2026-10-14"), { ...day("2026-10-14"), pane: "about" })).toBe(true);
  });
});

describe("a step the window could not show all of", () => {
  test("the place becomes what the window shows, and one like its neighbour is one with it", () => {
    const trail = visited(view("m:3"), view("m:9"), view("m:5"));
    trail.back(); // member 9 is gone, and the window shows member 3 instead
    trail.correct(view("m:3"));
    expect(trail.back()).toBeNull();
    expect(trail.forward()).toEqual(view("m:5"));
  });
});

/** A window that is at one place, and notes what it is asked to show and which pages it loads. */
interface FakeWindow extends NavTarget {
  at: Place | null;
  guide: boolean;
  shown: Place[];
  loaded: string[];
}

function fakeWindow(): FakeWindow {
  const window: FakeWindow = {
    at: null,
    guide: false,
    shown: [],
    loaded: [],
    inGuide: () => window.guide,
    where: () => window.at,
    // What main.ts does: a page is loaded again only when it is another one.
    show(place) {
      if (!window.at || window.at.page !== place.page) window.loaded.push(place.page);
      window.at = place;
      window.shown.push(place);
    },
  };
  return window;
}

/** The person goes to a place, as `go` in main.ts does. */
function visit(navigation: Navigation, window: FakeWindow, place: Place): void {
  navigation.visit(() => {
    window.at = place;
  });
}

describe("the window's history", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a step shows the place it lands on and records nothing", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [start, history, dictionary].forEach((place) => visit(navigation, window, place));
    navigation.step("back");
    navigation.step("back");
    navigation.step("forward");
    navigation.step("forward");
    navigation.step("forward");
    expect(window.shown).toEqual([history, start, history, dictionary]);
    expect(window.at).toEqual(dictionary);
  });

  test("a place visited after a step back forgets what was ahead", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [start, history, dictionary].forEach((place) => visit(navigation, window, place));
    navigation.step("back");
    visit(navigation, window, agent);
    navigation.step("forward");
    expect(window.shown).toEqual([history]);
    navigation.step("back");
    expect(window.shown).toEqual([history, history]);
    expect(window.at).toEqual(history);
  });

  test("going to the place the window is at records nothing", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [start, start, history, history].forEach((place) => visit(navigation, window, place));
    navigation.step("back");
    navigation.step("back");
    expect(window.shown).toEqual([start]);
  });

  test("the first-run guide is no part of the history: steps do nothing while it shows", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    window.guide = true;
    navigation.step("back");
    navigation.step("forward");
    expect(window.shown).toEqual([]);
    window.guide = false;
    visit(navigation, window, start); // the guide is done: the first place
    navigation.step("back");
    expect(window.shown).toEqual([]);
    visit(navigation, window, history);
    window.guide = true;
    navigation.step("back");
    expect(window.shown).toEqual([]);
    window.guide = false;
    navigation.step("back");
    expect(window.shown).toEqual([start]);
  });

  test("a view a press went into is noted once the page has done it, with no view having to say so", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, view("m:3>s:tools"));
    navigation.heard(false);
    window.at = view("m:3>s:soul"); // the page acts on the press after the window heard it
    vi.advanceTimersByTime(0);
    navigation.heard(false);
    window.at = view("m:3>s:skills");
    vi.advanceTimersByTime(0);
    navigation.step("back");
    expect(window.at).toEqual(view("m:3>s:soul"));
    navigation.step("back");
    expect(window.at).toEqual(view("m:3>s:tools"));
  });

  test("a view that comes in after a read is noted a moment later", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, view("m:3"));
    navigation.heard(false);
    vi.advanceTimersByTime(0);
    window.at = view("m:5"); // the member is chosen once the list is read
    vi.advanceTimersByTime(NOTE_LATE_MS);
    window.at = view("m:5>s:tools");
    navigation.step("back");
    expect(window.at).toEqual(view("m:5"));
    navigation.step("back");
    expect(window.at).toEqual(view("m:3"));
  });

  test("a view nobody noted yet is a place before a step leaves it", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, view("m:3"));
    window.at = view("m:3>s:skills/skill:4");
    navigation.step("back");
    expect(window.at).toEqual(view("m:3"));
    navigation.step("forward");
    expect(window.at).toEqual(view("m:3>s:skills/skill:4"));
  });

  test("a move made by one of the window's own ways back (go from its arrow) is the step back", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, view("m:3"));
    visit(navigation, window, view("m:3>s:tools"));
    navigation.heard(true); // the settings page's arrow, which goes to the conversation
    visit(navigation, window, view("m:3"));
    vi.advanceTimersByTime(NOTE_LATE_MS);
    navigation.step("forward");
    expect(window.at).toEqual(view("m:3>s:tools"));
    navigation.step("back");
    navigation.step("back");
    expect(window.shown).toEqual([view("m:3>s:tools"), view("m:3")]);
  });

  test("back from the open settings panel walks its tabs, closes it and does not load the page under it again", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [start, history, panel("history", "general"), panel("history", "usage")].forEach((place) => visit(navigation, window, place));
    navigation.step("back");
    expect(window.at).toEqual(panel("history", "general"));
    navigation.step("back");
    expect(window.at).toEqual(history);
    expect(window.loaded).toEqual([]);
    navigation.step("back");
    expect(window.at).toEqual(start);
    expect(window.loaded).toEqual(["automations"]);
  });

  test("a step the window could not show all of leaves the history at what it shows", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [view("m:3"), view("m:9"), view("m:5")].forEach((place) => visit(navigation, window, place));
    window.show = (place) => { window.at = place.view === "m:9" ? view("m:3") : place; window.shown.push(place); };
    navigation.step("back");
    expect(window.at).toEqual(view("m:3"));
    navigation.step("back");
    expect(window.shown).toEqual([view("m:9")]);
  });

  test("the steps' own work records nothing, even a move it makes through go", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [start, history].forEach((place) => visit(navigation, window, place));
    window.show = (place) => visit(navigation, window, place);
    navigation.step("back");
    navigation.step("forward");
    expect(window.at).toEqual(history);
    navigation.step("back");
    expect(window.at).toEqual(start);
  });

  test("keeps no more places than it is given room for", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window, 2);
    [start, history, dictionary].forEach((place) => visit(navigation, window, place));
    navigation.step("back");
    navigation.step("back");
    expect(window.shown).toEqual([history]);
  });
});
