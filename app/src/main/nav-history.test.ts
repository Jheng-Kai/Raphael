import { describe, expect, test } from "vitest";
import { NAV_LIMIT, NavHistory, Navigation, samePage, samePlace, type NavTarget, type Place } from "./nav-history";

const start: Place = { page: "automations" };
const agent: Place = { page: "agent" };
const history: Place = { page: "history" };
const dictionary: Place = { page: "dictionary" };
/** The history opened at one day, as a day of the activity grid opens it. */
const day = (date: string): Place => ({ page: "history", day: date });
/** The settings panel open over a page, at one of its tabs. */
const panel = (page: Place["page"], pane: NonNullable<Place["pane"]>): Place => ({ page, pane });

/** Pushes the places in order. */
function visited(...places: Place[]): NavHistory {
  const trail = new NavHistory();
  places.forEach((place) => trail.push(place));
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
    trail.push(agent);
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
    trail.push(history);
    expect(trail.forward()).toEqual(dictionary);
  });

  test("the same page can come again once another has come between", () => {
    const trail = visited(start, history, start);
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toEqual(start);
  });

  test("keeps the newest places and lets the oldest go", () => {
    const trail = new NavHistory(3);
    [start, agent, history, dictionary].forEach((place) => trail.push(place));
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toEqual(agent);
    expect(trail.back()).toBeNull();
  });

  test("keeps fifty places", () => {
    expect(NAV_LIMIT).toBe(50);
    const trail = new NavHistory();
    for (let n = 0; n < 80; n++) trail.push(day(`day ${n}`));
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

  test("a place is the same only with the same tab open", () => {
    expect(samePlace(panel("automations", "usage"), panel("automations", "usage"))).toBe(true);
    expect(samePlace(panel("automations", "usage"), panel("automations", "about"))).toBe(false);
    expect(samePlace(panel("automations", "usage"), start)).toBe(false);
  });

  test("the tab chosen inside the panel is the one that comes back", () => {
    const trail = visited(start, panel("automations", "general"));
    trail.replace(panel("automations", "usage"));
    expect(trail.back()).toEqual(start);
    expect(trail.forward()).toEqual(panel("automations", "usage"));
  });

  test("a panel closed with its own button leaves a page that going back would not change", () => {
    const trail = visited(history, start, panel("automations", "general"));
    trail.replace(start);
    expect(trail.back()).toEqual(history);
    expect(trail.back()).toBeNull();
  });

  test("with nothing before the page, a panel closed with its own button leaves nowhere to go", () => {
    const trail = visited(start, panel("automations", "general"));
    trail.replace(start);
    expect(trail.back()).toBeNull();
    expect(trail.forward()).toBeNull();
  });

  test("a panel closed with its own button, with the same page also ahead, leaves nowhere to go either way", () => {
    // Home, the panel over it, then Home again (the tray was asked for it with the panel open)
    const trail = visited(start, panel("automations", "general"), start);
    trail.back();
    trail.replace(start);
    expect(trail.forward()).toBeNull();
    expect(trail.back()).toBeNull();
  });

  test("opening and closing it again and again does not push the pages out of the history", () => {
    const trail = new NavHistory(3);
    trail.push(start);
    trail.push(history);
    for (let n = 0; n < 10; n++) {
      trail.push(panel("history", "general"));
      trail.replace(history);
    }
    expect(trail.back()).toEqual(start);
    expect(trail.forward()).toEqual(history);
    expect(trail.forward()).toBeNull();
  });

  test("a panel that was left open when the person moved on is there again going back", () => {
    const trail = visited(start, panel("automations", "usage"), dictionary);
    expect(trail.back()).toEqual(panel("automations", "usage"));
    expect(trail.back()).toEqual(start);
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

  test("shows all days again when the person took the day off before leaving", () => {
    const trail = visited(start, day("2026-10-14"));
    trail.replace(history);
    trail.back();
    expect(trail.forward()).toEqual(history);
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
      if (!window.at || !samePage(window.at, place)) window.loaded.push(place.page);
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
    visit(navigation, window, start); // the guide is done: Home is the first place
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

  test("back from the open settings panel closes it and does not load the page under it again", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [start, history, panel("history", "usage")].forEach((place) => visit(navigation, window, place));
    navigation.step("back");
    expect(window.shown).toEqual([history]);
    expect(window.loaded).toEqual([]);
    navigation.step("forward");
    expect(window.shown).toEqual([history, panel("history", "usage")]);
    expect(window.loaded).toEqual([]);
    navigation.step("back");
    navigation.step("back");
    expect(window.shown[3]).toEqual(start);
    expect(window.loaded).toEqual(["automations"]);
  });

  test("a tab chosen in the panel is the one it comes back at", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, start);
    visit(navigation, window, panel("automations", "general"));
    window.at = panel("automations", "usage"); // the person clicked the tab inside the panel
    visit(navigation, window, history);
    navigation.step("back");
    expect(window.shown).toEqual([panel("automations", "usage")]);
  });

  test("a panel closed with its own button does not come back, and back goes to the page before", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    [history, start, panel("automations", "general")].forEach((place) => visit(navigation, window, place));
    window.at = start; // the person pressed the panel's close button, which does not take a step
    navigation.step("back");
    expect(window.shown).toEqual([history]);
    navigation.step("forward");
    navigation.step("forward");
    expect(window.shown).toEqual([history, start]);
  });

  test("a panel closed with its own button leaves nothing behind when the person goes on", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, start);
    visit(navigation, window, panel("automations", "general"));
    window.at = start;
    visit(navigation, window, history);
    navigation.step("back");
    expect(window.shown).toEqual([start]);
    navigation.step("back");
    expect(window.shown).toEqual([start]);
  });

  test("the history opened at a day comes back at that day", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, start);
    visit(navigation, window, day("2026-10-14"));
    navigation.step("back");
    navigation.step("forward");
    expect(window.shown).toEqual([start, day("2026-10-14")]);
    expect(window.loaded).toEqual(["automations", "history"]);
  });

  test("a day taken off before leaving is left off when it comes back", () => {
    const window = fakeWindow();
    const navigation = new Navigation(window);
    visit(navigation, window, start);
    visit(navigation, window, day("2026-10-14"));
    window.at = history; // the person pressed the chip's button
    visit(navigation, window, dictionary);
    navigation.step("back");
    expect(window.shown).toEqual([history]);
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
