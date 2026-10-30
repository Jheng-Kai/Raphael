// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { faceHTML } from "./members";
import { isSlimeAvatar, parseSlime, seasonalHat, setSlimeState, slimeFaceHTML, slimeSVG } from "./slime";

const SKY = { shape: "dome", color: "sky" } as const;
const stateIn = (el: Element): string | undefined => el.querySelector<SVGElement>("svg.slime")?.dataset.state;

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

test("a member without a picture is a slime, its chosen one or a colour from its id; Raphael is not", () => {
  const face = (member: Parameters<typeof faceHTML>[0]): HTMLElement => {
    const el = document.createElement("div"); el.innerHTML = faceHTML(member, 40); return el;
  };
  expect(face({ id: 3, name: "Ada" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  expect(slimeFaceHTML({ id: 3 }, 40)).toContain('style="--av:40px"');
  expect(face({ id: 3, name: "Ada", avatar: "slime:demon:charcoal" }).innerHTML).toContain("#EE5A64");
  expect(face({ id: 3, name: "Ada", avatar: "slime:unknown" }).querySelector(".mb-av-slime")).not.toBeNull();
  expect(face({ id: 3, name: "Ada", avatar_url: "data:image/png;base64,AAAA" }).querySelector(".mb-av-slime")).toBeNull();
  expect(face({ id: 0, name: "Raphael" }).querySelector(".mb-av-slime")).toBeNull();
});

test("the first mascots, stored as one word, still draw", () => {
  expect(parseSlime("slime:azure")).toEqual({ shape: "dome", color: "sky" });
  expect(parseSlime("slime:oni")).toEqual({ shape: "oni", color: "lavender" });
  expect(parseSlime("slime:crown")).toEqual({ shape: "crown", color: "sky" });
  expect(parseSlime("slime:oni:coral")).toEqual({ shape: "oni", color: "coral" });
  expect(parseSlime("slime:oni:nope")).toBeNull();
  expect(isSlimeAvatar("slime:twin:teal")).toBe(true);
  expect(isSlimeAvatar("preset:azure")).toBe(false);
});

test("the season puts a hat on a slime in its week, in place of a crest; Shion and Diablo keep their heads", () => {
  expect(seasonalHat(new Date(2026, 9, 23))).toBeNull();
  expect(seasonalHat(new Date(2026, 9, 31))).toBe("witch");
  expect(seasonalHat(new Date(2026, 10, 1))).toBe("witch");
  expect(seasonalHat(new Date(2026, 11, 24))).toBe("santa");
  expect(seasonalHat(new Date(2026, 5, 1))).toBeNull();
  const witch = { now: new Date(2026, 9, 31) }, plain = { now: new Date(2026, 5, 1) };
  expect(slimeSVG(SKY, witch)).toContain("#554177");
  expect(slimeSVG(SKY, plain)).not.toContain("#554177");
  expect(slimeSVG({ shape: "fox", color: "tangerine" }, plain)).toContain("#FFE8CB");
  expect(slimeSVG({ shape: "fox", color: "tangerine" }, witch)).not.toContain("#FFE8CB");
  expect(slimeSVG({ shape: "oni", color: "lavender" }, witch)).not.toContain("#554177");
  expect(slimeSVG({ shape: "demon", color: "charcoal" }, witch)).not.toContain("#554177");
});

test("a row shows what it knows: an answer it waits for, the core's last word, or sleep after a long silence", () => {
  const now = Date.now();
  const drawn = (member: Parameters<typeof slimeFaceHTML>[0]): string | undefined => {
    const el = document.createElement("div"); el.innerHTML = slimeFaceHTML(member, 40); return stateIn(el);
  };
  expect(drawn({ id: 11, last_at: now - 1000 })).toBe("idle");
  expect(drawn({ id: 11 })).toBe("idle");
  expect(drawn({ id: 11, last_at: now - 3 * 24 * 60 * 60 * 1000 })).toBe("sleeping");
  expect(drawn({ id: 11, waiting: true, last_at: now - 3 * 24 * 60 * 60 * 1000 })).toBe("waiting");
  expect(drawn({ id: 11, activity: "searching" })).toBe("searching");
  expect(drawn({ id: 11, activity: "nonsense" })).toBe("idle");
});

test("what the core says moves every face of that member and no other, and a redraw keeps it", () => {
  document.body.innerHTML = slimeFaceHTML({ id: 21 }, 40) + slimeFaceHTML({ id: 21 }, 96) + slimeFaceHTML({ id: 22 }, 40);
  setSlimeState(21, "working");
  const states = (): (string | undefined)[] => [...document.querySelectorAll<SVGElement>("svg.slime")].map(svg => svg.dataset.state);
  expect(states()).toEqual(["working", "working", "idle"]);
  document.body.innerHTML = slimeFaceHTML({ id: 21 }, 40);
  expect(states()).toEqual(["working"]);
  setSlimeState(21, "idle");
  expect(states()).toEqual(["idle"]);
});

test("a finish is a moment, then the member goes back to what its row says", () => {
  vi.useFakeTimers();
  document.body.innerHTML = slimeFaceHTML({ id: 31, waiting: true }, 40);
  setSlimeState(31, "done");
  expect(stateIn(document.body)).toBe("done");
  vi.advanceTimersByTime(1999);
  expect(stateIn(document.body)).toBe("done");
  vi.advanceTimersByTime(1);
  expect(stateIn(document.body)).toBe("waiting");
});

test("a new turn cuts a finish short and is not undone by its timer", () => {
  vi.useFakeTimers();
  document.body.innerHTML = slimeFaceHTML({ id: 41 }, 40);
  setSlimeState(41, "done");
  vi.advanceTimersByTime(500);
  setSlimeState(41, "thinking");
  vi.advanceTimersByTime(5000);
  expect(stateIn(document.body)).toBe("thinking");
  setSlimeState(41, "idle");
});

test("a long list does not move in step, and a redraw keeps its place in the motion", () => {
  const delay = (id: number): number => Number(/--slime-delay:(-?\d+)ms/.exec(slimeFaceHTML({ id }, 40))![1]);
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const first = delay(1), second = delay(2);
  expect(first).not.toBe(second);
  vi.spyOn(performance, "now").mockReturnValue(5000);
  expect(delay(1)).toBe(first - 4000);
  vi.restoreAllMocks();
});
