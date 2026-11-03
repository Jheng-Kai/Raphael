// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { faceHTML } from "./members";
import { followSlimeRoster, isSlimeAvatar, parseSlime, pickSlime, seasonalHat, setSlimeState, slimeFaceHTML, slimePickerHTML, slimeSVG, type SlimeState } from "./slime";

const css = readFileSync(resolve(__dirname, "slime.css"), "utf8");
const keyframes = css.split("@keyframes ").slice(1).map(chunk => {
  let depth = 0, end = 0;
  for (; end < chunk.length; end++) {
    if (chunk[end] === "{") depth++;
    else if (chunk[end] === "}" && --depth === 0) break;
  }
  return { name: chunk.slice(0, chunk.indexOf(" ")), body: chunk.slice(0, end) };
});

const stateIn = (el: Element): string | undefined => el.querySelector<SVGElement>("svg.slime")?.dataset.state;
const plain = { now: new Date(2026, 5, 1) }, witch = { now: new Date(2026, 9, 31) };
const same = (text: string): string => text;

test.each(['thinking','working','searching','computer','waiting','blocked','sleeping','error'] as const)('R-PERF-01: %s carries only its current cels and keeps character marks in every body cel', state => {
  const host = document.createElement('div');
  host.innerHTML = slimeSVG({ character: 'shion' }, { ...plain, state });
  expect(host.querySelector('.slime-idle')).toBeNull();
  const bodies = host.querySelectorAll('.slime-loop-body .slime-cel-body');
  expect(bodies).toHaveLength(['thinking','searching'].includes(state)?12*12:12);
  for (const body of bodies) expect(body.parentElement!.innerHTML).toContain('#363140');
  expect(host.querySelector('.slime-loop-eyes .slime-cel-eye')).not.toBeNull();
});

test('working uses only its twelve body poses without a Cartesian DOM expansion', () => {
  const host=document.createElement('div');
  host.innerHTML=slimeSVG({character:'shion'},{...plain,state:'working'});
  expect(host.querySelectorAll('*').length).toBeLessThan(800);
});

test('thinking cels avoid transient transform wrappers that inflate collection work', () => {
  const host=document.createElement('div');
  host.innerHTML=slimeSVG({character:'shion'},{...plain,state:'thinking'});
  expect(host.querySelectorAll('*').length).toBeLessThan(2000);
  expect(host.querySelector('.slime-loop .slime-correction, .slime-loop .slime-counterturn')).toBeNull();
});

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

test("a member without a picture is a slime, its chosen one or a colour from its id; Raphael is not", () => {
  const face = (member: Parameters<typeof faceHTML>[0]): HTMLElement => {
    const el = document.createElement("div"); el.innerHTML = faceHTML(member, 40); return el;
  };
  expect(face({ id: 3, name: "Ada" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  expect(slimeFaceHTML({ id: 3 }, 40)).toContain('style="--av:40px"');
  expect(face({ id: 3, name: "Ada", avatar: "slime:diablo" }).innerHTML).toContain("#EE5A64");
  expect(face({ id: 3, name: "Ada", avatar: "slime:unknown" }).querySelector(".mb-av-slime")).not.toBeNull();
  expect(face({ id: 3, name: "Ada", avatar: "preset:old", avatar_url: "data:image/png;base64,AAAA" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  expect(face({ id: 0, name: "Raphael" }).querySelector(".mb-av-slime")).toBeNull();
});

test("every character is the one slime: the same body, and only its marks differ", () => {
  const picker = document.createElement("div");
  picker.innerHTML = slimePickerHTML(null, same);
  const drawn = [...picker.querySelectorAll("svg.slime")];
  expect(drawn.length).toBeGreaterThanOrEqual(20);
  const bodies = new Set(drawn.map(svg => /<path d="(M 8 70 [^"]+)" fill="var\(--slime-color\)"/.exec(svg.outerHTML)?.[1]));
  expect(bodies.size).toBe(1);
  expect([...bodies][0]).toBeTruthy();
});

test("Shion is lavender and a horn, and no hair", () => {
  const shion = slimeSVG({ character: "shion" }, plain);
  expect(shion).toContain("--slime-color:#9270CB");
  expect(shion).toContain("#363140");
  const bare = slimeSVG({ character: "rimuru" }, plain);
  // The resting vector carries the horn once.
  expect(shion.match(/<path /g)!.length).toBe(bare.match(/<path /g)!.length + 1);
});

test("what earlier builds stored still draws", () => {
  expect(parseSlime("slime:azure")).toEqual({ color: "sky" });
  expect(parseSlime("slime:oni")).toEqual({ character: "shion" });
  expect(parseSlime("slime:demon")).toEqual({ character: "diablo" });
  expect(parseSlime("slime:fox")).toEqual({ color: "tangerine" });
  expect(parseSlime("slime:oni:coral")).toEqual({ character: "shion" });
  expect(parseSlime("slime:jelly:teal")).toEqual({ color: "teal" });
  expect(parseSlime("slime:color:leaf")).toEqual({ color: "leaf" });
  expect(parseSlime("slime:gobta")).toEqual({ character: "gobta" });
  expect(parseSlime("slime:jelly:nope")).toBeNull();
  expect(isSlimeAvatar("preset:azure")).toBe(false);
});

test("the season puts a hat on a plain slime in its week; a character keeps its head", () => {
  expect(seasonalHat(new Date(2026, 9, 23))).toBeNull();
  expect(seasonalHat(new Date(2026, 9, 31))).toBe("witch");
  expect(seasonalHat(new Date(2026, 10, 1))).toBe("witch");
  expect(seasonalHat(new Date(2026, 11, 24))).toBe("santa");
  expect(seasonalHat(new Date(2026, 5, 1))).toBeNull();
  expect(slimeSVG({ color: "sky" }, witch)).toContain("#554177");
  expect(slimeSVG({ color: "sky" }, plain)).not.toContain("#554177");
  expect(slimeSVG({ character: "shion" }, witch)).not.toContain("#554177");
});

test("one press chooses one slime, in a menu that shows it", () => {
  document.body.innerHTML = `<div class="menu">${slimePickerHTML("slime:shion", same)}</div>`;
  const pressed = (): (string | undefined)[] => [...document.querySelectorAll<HTMLElement>('[aria-pressed="true"]')].map(el => el.dataset.slimeCharacter ?? el.dataset.slimeColor);
  expect(pressed()).toEqual(["shion"]);
  expect(pickSlime(document.querySelector<HTMLElement>('[data-slime-character="shuna"]')!)).toBe("slime:shuna");
  expect(pressed()).toEqual(["shuna"]);
  expect(pickSlime(document.querySelector<HTMLElement>('[data-slime-color="teal"]')!)).toBe("slime:color:teal");
  expect(pressed()).toEqual(["teal"]);
  expect(pickSlime(document.createElement("button"))).toBeNull();
});

test("a row shows what it knows: an answer it waits for, or sleep after a long silence", () => {
  const now = Date.now();
  const drawn = (member: Parameters<typeof slimeFaceHTML>[0]): string | undefined => {
    const el = document.createElement("div"); el.innerHTML = slimeFaceHTML(member, 40); return stateIn(el);
  };
  expect(drawn({ id: 11, last_at: now - 1000 })).toBe("idle");
  expect(drawn({ id: 11 })).toBe("idle");
  expect(drawn({ id: 11, last_at: now - 3 * 24 * 60 * 60 * 1000 })).toBe("sleeping");
  expect(drawn({ id: 11, waiting: true, last_at: now - 3 * 24 * 60 * 60 * 1000 })).toBe("blocked");
});

test("a window that opens late learns from the list what a member is doing, and a later word wins", () => {
  const drawn = (): string | undefined => {
    const el = document.createElement("div"); el.innerHTML = slimeFaceHTML({ id: 12 }, 40); return stateIn(el);
  };
  followSlimeRoster([{ id: 12, activity: "searching" }]);
  expect(drawn()).toBe("searching");
  setSlimeState(12, "idle");
  expect(drawn()).toBe("idle");
  followSlimeRoster([{ id: 12, activity: "nonsense" }]);
  expect(drawn()).toBe("idle");
});

test("the core's idle right after done does not cut the moment short", () => {
  vi.useFakeTimers();
  document.body.innerHTML = slimeFaceHTML({ id: 13 }, 40);
  setSlimeState(13, "done");
  setSlimeState(13, "idle");
  followSlimeRoster([{ id: 13, activity: "idle" }]);
  expect(stateIn(document.body)).toBe("done");
  vi.advanceTimersByTime(2000);
  expect(stateIn(document.body)).toBe("idle");
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
  expect(stateIn(document.body)).toBe("blocked");
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

test("an idle slime retains its costume in one resting vector with no animation tracks", () => {
  const host = document.createElement("div");
  host.innerHTML = slimeSVG({ character: "diablo" });
  expect(host.querySelector('.slime-marks path[fill="#FFF6E9"]')).not.toBeNull();
  expect(host.querySelector(".slime-idle, .slime-loop")).toBeNull();
  host.innerHTML = slimeSVG({ character: "rigurd" });
  expect(host.querySelector('.slime-marks circle[fill="#D6A14A"]')).not.toBeNull();
  expect(css).not.toMatch(/slime-idle-(?:body|eyes|large)/);
});

test("only whole-frame cel strips use composited transforms (R-UI-63, R-PERF-01)", () => {
  expect(keyframes.length).toBeGreaterThan(20);
  const composited = keyframes.filter(({ body }) => /(^|[{;\s])transform:/.test(body));
  expect(composited.map(({ name }) => name).sort()).toEqual(["slime-loop-blink", "slime-loop-x", "slime-loop-y"].sort());
  for (const { body } of composited) for (const [, value] of body.matchAll(/transform: translateX\((-?[\d.]+)%\)/g)) {
    const frame = Number(value) * (body.includes('translateX(-4.16666667%)') ? 24 : body.includes('translateX(-8.33333333%)') ? 12 : 7) / 100;
    expect(Math.abs(frame - Math.round(frame))).toBeLessThan(0.00001);
  }
  expect(css).not.toMatch(/will-change|filter:/);
  expect(css).not.toMatch(/\.slime-in-between[^{]*\{[^}]*\btransform:/);
});

test("a slime's box is a whole number of pixels, whatever the window works out", () => {
  expect(css).toMatch(/\.av\.mb-av\.mb-av-slime \{[^}]*width: round\(var\(--av\), 1px\);[^}]*height: round\(var\(--av\), 1px\);/);
});

test("each moving state retains its body performance while idle has no loop", () => {
  for (const state of ["thinking", "working", "searching", "computer", "waiting", "done", "error", "sleeping", "arriving"]) {
    expect(css, state).toContain(`.slime[data-state="${state}"] .slime-motion { animation: slime-${state}-`);
  }
  expect(css).not.toMatch(/(?:\.slime|\.slime-surface)\[data-state="idle"\][^{]*\{[^}]*animation:/);
});

test("under reduced motion nothing moves and each liquid state retains its pose and prop", () => {
  const calm = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)![1]!;
  expect(calm).toMatch(/\.slime-surface \* \{[^}]*animation: none !important;[^}]*transition: none !important;/);
  for (const state of ["working", "thinking", "blocked", "error", "sleeping"]) {
    expect(calm, state).toContain(`[data-state="${state}"]`);
  }
  expect(calm).toContain("scale: 0.92 1.10");
  expect(calm).toContain("scale: 1.08 0.62");
});

test("what hangs off a body swings about its own pivot, and what is printed on the skin does not", () => {
  const shion = document.createElement("div"), souei = document.createElement("div"), bare = document.createElement("div");
  shion.innerHTML = slimeSVG({ character: "shion" }, plain);
  souei.innerHTML = slimeSVG({ character: "souei" }, plain);
  bare.innerHTML = slimeSVG({ color: "sky" }, plain);
  const horn = shion.querySelector<SVGElement>(".slime-mark")!;
  expect(horn.getAttribute("style")).toContain("--mark-x:49px;--mark-y:34px");
  expect(horn.innerHTML).toContain("#363140");
  expect(souei.querySelector(".slime-mark")!.innerHTML).not.toContain("#F2F2F5");
  expect(souei.innerHTML).toContain("#F2F2F5");
  expect(bare.querySelector(".slime-mark")).toBeNull();
  const hatted = document.createElement("div");
  hatted.innerHTML = slimeSVG({ color: "sky" }, witch);
  expect(hatted.querySelector(".slime-mark")!.innerHTML).toContain("#554177");
});

test("a change of state is marked, and a moment that is drawn again carries on from where it was", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  document.body.innerHTML = slimeFaceHTML({ id: 51 }, 40);
  const svg = document.querySelector<SVGElement>("svg.slime")!;
  expect(svg.dataset.moved).toBeUndefined();
  setSlimeState(51, "done");
  expect(svg.dataset.state).toBe("done");
  expect(svg.dataset.moved).toBe("done");
  expect(svg.style.getPropertyValue("--slime-since")).toBe("0ms");
  vi.advanceTimersByTime(700);
  document.body.innerHTML = slimeFaceHTML({ id: 51 }, 40);
  expect(/--slime-since:(-?\d+)ms/.exec(document.body.innerHTML)![1]).toBe("-700");
  expect(document.querySelector<SVGElement>("svg.slime")!.dataset.moved).toBeUndefined();
  vi.advanceTimersByTime(1300);
});

test("telling a slime what it is already doing changes nothing", () => {
  document.body.innerHTML = slimeFaceHTML({ id: 52 }, 40);
  const svg = document.querySelector<SVGElement>("svg.slime")!;
  setSlimeState(52, "idle");
  expect(svg.dataset.moved).toBeUndefined();
  setSlimeState(52, "working");
  setSlimeState(52, "working");
  expect(svg.dataset.moved).toBe("working");
  setSlimeState(52, "idle");
});

test("a list keeps different paces, and each member keeps its own", () => {
  const tempo = (id: number): number => Number(/--slime-tempo:([\d.]+)/.exec(slimeFaceHTML({ id }, 40))![1]);
  const tempos = Array.from({ length: 12 }, (_, id) => tempo(id));
  expect(new Set(tempos).size).toBeGreaterThanOrEqual(8);
  for (const value of tempos) { expect(value).toBeGreaterThanOrEqual(0.94); expect(value).toBeLessThanOrEqual(1.06); }
  expect(tempo(5)).toBe(tempo(5));
});

test("hover plays one finite delight on the static idle vector and then leaves it still", () => {
  document.body.innerHTML = `<button class="mb-row">${slimeFaceHTML({ id: 62 }, 40)}</button>`;
  const row = document.querySelector(".mb-row")!, svg = row.querySelector<SVGElement>("svg.slime")!, surface = svg.parentElement!;
  expect(svg.dataset.state).toBe("idle");
  expect(svg.classList.contains("is-delighted")).toBe(false);
  expect(surface.querySelector(".slime-loop, .slime-idle")).toBeNull();
  const body = svg.querySelector(".slime-body");
  expect(body).not.toBeNull();
  row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  expect(svg.classList.contains("is-delighted")).toBe(true);
  expect(svg.querySelector(".slime-body")).toBe(body);
  const css = readFileSync(resolve(__dirname, "slime.css"), "utf8");
  expect(css).toContain(".slime-surface:has(.slime.is-delighted) { animation: slime-delight 620ms linear both; }");
  expect(css).toContain(".slime.is-delighted .slime-look > .slime-counterturn { animation: slime-delight-eyes 620ms cubic-bezier(0.3, 0, 0.3, 1) both; }");
  surface.dispatchEvent(new AnimationEvent("animationend", { bubbles: true, animationName: "slime-delight" }));
  expect(svg.classList.contains("is-delighted")).toBe(false);
  expect(svg.dataset.state).toBe("idle");
  expect(svg.querySelector(".slime-body")).toBe(body);
  expect(surface.querySelector(".slime-loop, .slime-idle")).toBeNull();
});

test("idle press uses a finite squash and release on its resting vector", () => {
  const host = document.createElement("div");
  host.innerHTML = slimeSVG({ character: "shion" }, plain);
  expect(host.querySelector("svg.slime")?.getAttribute("data-state")).toBe("idle");
  expect(host.querySelector(".slime-loop, .slime-idle")).toBeNull();
  expect(css).toContain(':is(.mb-row, .mb-avbtn, .mb-preset, .mb-av-slime):active .slime-surface { --slime-squish: scale(1.12, 0.84); transition: --slime-squish 90ms cubic-bezier(0.2, 0.8, 0.3, 1); }');
  expect(css).toContain('@property --slime-squish { syntax: "<transform-list>"; inherits: false; initial-value: scale(1); }');
  expect(css).toContain("transition: --slime-squish 480ms");
});

test("the pointer wakes a working slime once on the way in", () => {
  document.body.innerHTML = `<button class="mb-row" id="row"><i id="inner"></i>${slimeFaceHTML({ id: 61 }, 40)}</button><div id="away"></div>`;
  const svg = document.querySelector<SVGElement>("svg.slime")!, row = document.getElementById("row")!, inner = document.getElementById("inner")!, away = document.getElementById("away")!;
  const over = (target: Element, from: Element | null): void => { target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: from })); };
  setSlimeState(61, "thinking");
  over(row, away);
  expect(svg.classList.contains("is-delighted")).toBe(true);
  svg.classList.remove("is-delighted");
  over(inner, row);
  expect(svg.classList.contains("is-delighted")).toBe(false);
  over(inner, away);
  expect(svg.classList.contains("is-delighted")).toBe(true);
  svg.querySelector(".slime-press")!.dispatchEvent(new AnimationEvent("animationend", { bubbles: true, animationName: "slime-other" }));
  expect(svg.classList.contains("is-delighted")).toBe(true);
  svg.querySelector(".slime-press")!.dispatchEvent(new AnimationEvent("animationend", { bubbles: true, animationName: "slime-delight" }));
  expect(svg.classList.contains("is-delighted")).toBe(false);
});

test("every liquid state keeps the body, eyes and costume instead of substituting a symbol", () => {
  for (const state of ["thinking", "working", "blocked", "error", "sleeping", "done"] as SlimeState[]) {
    const drawing = document.createElement("div");
    drawing.innerHTML = slimeSVG({ character: "shion" }, { ...plain, state });
    expect(drawing.querySelector(".slime-body")).not.toBeNull();
    expect(drawing.querySelector(".slime-mark")).not.toBeNull();
    expect(drawing.querySelector(".slime-drop")).toBeNull();
    expect(drawing.querySelector(".slime-bubble")).not.toBeNull();
    expect(drawing.querySelector(".slime-dots, .slime-blocked, .slime-ribbons, .slime-z")).toBeNull();
  }
  expect(css).not.toMatch(/slime-dot-pulse|slime-attention|slime-ribbon-orbit|slime-z|visibility: hidden;[^}]*slime-press/);
});

test("liquid effects animate only transforms and opacity, never geometry or layout", () => {
  for (const { body } of keyframes.filter(({ name }) => /bubble/.test(name))) {
    expect(body).not.toMatch(/(?:^|[;{\s])(?:d|width|height|top|left|cx|cy|r):/);
  }
});

test("liquid fades repaint SVG alpha instead of promoting the whole moving slime (R-UI-63)", () => {
  expect(css).toContain('@property --slime-liquid-alpha');
  for (const { body } of keyframes.filter(({ name }) => /bubble/.test(name))) {
    expect(body).not.toMatch(/(^|[{;\s])opacity:/);
    expect(body).toContain('--slime-liquid-alpha:');
  }
});

test("a slime far out of sight takes its new state without reading its pose", () => {
  document.body.innerHTML = `<div class="slime-surface" data-offscreen>${slimeFaceHTML({ id: 21 }, 40)}</div><div>${slimeFaceHTML({ id: 21 }, 40)}</div>`;
  const [far, near] = document.querySelectorAll<SVGElement>('svg.slime[data-slime-member="21"]');
  const styled = vi.spyOn(window, "getComputedStyle");
  try {
    setSlimeState(21, "thinking");
    const readFar = styled.mock.calls.filter(([element]) => far!.contains(element as Node) || element === far).length;
    const readNear = styled.mock.calls.filter(([element]) => near!.contains(element as Node) || element === near).length;
    expect([far!.dataset.state, near!.dataset.state]).toEqual(["thinking", "thinking"]);
    expect(readFar).toBe(0);
    expect(readNear).toBeGreaterThan(0);
    expect(far!.dataset.transitioning).toBeUndefined();
  } finally { styled.mockRestore(); setSlimeState(21, "idle"); }
});
