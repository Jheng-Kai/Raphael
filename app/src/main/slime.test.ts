// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { faceHTML } from "./members";
import { GAZE_ROWS, PROP_ROWS, celCount } from "./slime-motion";
import { crownedId, crownPrimary } from "./crown";
import { catalogs } from "./i18n";
import { defaultSlimeAvatar, followSlimeRoster, handOver, isSlimeAvatar, parseSlime, pickSlime, seasonalHat, setSlimeState, slimeCharactersHTML, slimeColorOf, slimeFaceHTML, slimePickerHTML, slimeSVG, type SlimeState } from "./slime";
import type { SlimeCharacter, SlimeColor } from "./slime";

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
// Motion tests draw the moving kind of slime; the still kind is tested on its own (owner, 2026-11-11).
const plain = { now: new Date(2026, 5, 1), moving: true }, witch = { now: new Date(2026, 9, 31) };
const same = (text: string): string => text;

const catalogPicker = document.createElement("div");
catalogPicker.className = "menu";
catalogPicker.innerHTML = slimePickerHTML(null, same);
const catalogButtons = [...catalogPicker.querySelectorAll<HTMLElement>("[data-slime-character]")];
const catalogIds = catalogButtons.map(button => button.dataset.slimeCharacter as SlimeCharacter);
const originalIds = ["rimuru", "shion", "diablo", "benimaru", "shuna", "souei", "hakurou", "gobta", "rigur", "rigurd", "milim", "veldora", "ranga", "gabiru", "geld", "treyni", "kurobe", "shizu", "hinata", "guy", "testarossa", "ultima", "carrera", "ramiris"];
const catalogStates: SlimeState[] = ["idle", "thinking", "working", "searching", "computer", "waiting", "blocked", "done", "error", "sleeping", "arriving"];
const groupIds = ["characters", "animals", "jobs", "nature", "seasonal", "objects", "colors"] as const;
const colorButtons = [...catalogPicker.querySelectorAll<HTMLElement>("[data-slime-color]")];
const colorIds = colorButtons.map(button => button.dataset.slimeColor as SlimeColor);

test("every character belongs to one labeled group, in the owner's order without reordering its slimes", () => {
  const groups = [...catalogPicker.querySelectorAll<HTMLElement>("[data-slime-group]")];
  expect(groups.map(group => group.dataset.slimeGroup)).toEqual(groupIds);
  expect(groups.map(group => group.querySelectorAll('[role="menuitem"]').length)).toEqual([50, 12, 8, 8, 6, 4, colorIds.length]);
  const ungrouped = document.createElement("div");
  ungrouped.innerHTML = slimeCharactersHTML(null, same);
  expect(catalogIds).toEqual([...ungrouped.querySelectorAll<HTMLElement>("[data-slime-character]")].map(button => button.dataset.slimeCharacter));
  expect(catalogButtons.every(button => groupIds.slice(0, -1).includes(button.closest<HTMLElement>("[data-slime-group]")!.dataset.slimeGroup as typeof groupIds[number]))).toBe(true);
  for (const [index, group] of groups.entries()) {
    // A tab names it (owner, 2026-11-11), so there is no heading inside.
    expect(group.getAttribute("role")).toBe("tabpanel");
    expect(group.getAttribute("aria-labelledby")).toBe(`slime-tab-${groupIds[index]!}`);
    expect(group.querySelector("h1, h2, h3, h4")).toBeNull();
    for (const [locale, messages] of Object.entries(catalogs)) {
      const label = messages[`slime.group.${groupIds[index]!}`];
      expect(label.trim(), `${locale}:${groupIds[index]}`).not.toBe("");
      expect(label).not.toMatch(/\uFFFD|\?{2,}|^slime\./);
    }
  }
  expect(pickSlime(groups[0]!)).toBeNull();
});

test.each(colorIds)("plain colour %s has a localized name and round-trips through selection and saved avatars", id => {
  const button = colorButtons.find(button => button.dataset.slimeColor === id)!;
  for (const [locale, messages] of Object.entries(catalogs)) {
    const label = messages[`slime.color.${id}`];
    expect(label.trim(), `${locale}:${id}`).not.toBe("");
    expect(label).not.toMatch(/\uFFFD|\?{2,}|^slime\./);
  }
  expect(button.getAttribute("aria-label")).toContain(button.title);
  expect(button.closest<HTMLElement>("[data-slime-group]")!.dataset.slimeGroup).toBe("colors");
  expect(parseSlime(`slime:color:${id}`)).toEqual({ color: id });
  expect(pickSlime(button)).toBe(`slime:color:${id}`);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(catalogPicker.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  const selected = document.createElement("div");
  selected.innerHTML = slimePickerHTML(`slime:color:${id}`, same);
  expect(selected.querySelector<HTMLElement>('[aria-pressed="true"]')!.dataset.slimeColor).toBe(id);
});

test("the expanded palette preserves the original colours, remains distinct and joins the default rotation except grey", () => {
  const original = ["sky", "lavender", "coral", "tangerine", "ochre", "leaf", "teal", "ocean", "orchid", "charcoal"];
  expect(colorIds.slice(0, original.length)).toEqual(original);
  expect(colorIds.length).toBeGreaterThanOrEqual(20);
  expect(new Set(colorIds).size).toBe(colorIds.length);
  const colors = colorIds.map(id => slimeColorOf({ id: 1, avatar: `slime:color:${id}` }));
  expect(colors.slice(0, original.length)).toEqual(["#1EA7FD", "#905AFB", "#FC2C3E", "#F9670E", "#F69412", "#14C370", "#13B8A3", "#1884FC", "#FB3499", "#777777"]);
  expect(new Set(colors).size).toBe(colorIds.length);
  for (const color of colors.slice(original.length)) {
    const channels = color.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
    expect(Math.max(...channels) - Math.min(...channels), color).toBeGreaterThanOrEqual(60);
    expect(Math.max(...channels), color).toBeGreaterThanOrEqual(120);
    expect(Math.min(...channels), color).toBeLessThanOrEqual(180);
  }
  const expected = colorIds.filter(id => id !== "charcoal").map(id => `slime:color:${id}`);
  expect(Array.from({ length: expected.length }, (_, id) => defaultSlimeAvatar(id))).toEqual(expected);
  expect(Array.from({ length: expected.length }, (_, id) => defaultSlimeAvatar(-id))).toEqual(expected);
  expect(new Set(colors.map((_, id) => slimeColorOf({ id })))).toEqual(new Set(colors.filter((_, index) => colorIds[index] !== "charcoal")));
});

test.each(Object.entries({ azure: "sky", mint: "teal", sunny: "ochre", coral: "coral", rose: "orchid", lilac: "lavender", slate: "charcoal", fox: "tangerine", sprout: "leaf", crown: "ochre" }))("legacy colour alias %s keeps its original meaning", (alias, color) => {
  expect(parseSlime(`slime:${alias}`)).toEqual({ color });
});

test("the expanded catalog preserves the original choices and adds at least sixty descriptive looks", () => {
  expect(catalogIds.slice(0, originalIds.length)).toEqual(originalIds);
  expect(catalogIds.length).toBeGreaterThanOrEqual(originalIds.length + 60);
  expect(new Set(catalogIds).size).toBe(catalogIds.length);
  for (const id of catalogIds.slice(originalIds.length)) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
});

test.each(catalogIds)("every picker choice has localized labels and a persistent round trip: %s", id => {
  const button = catalogButtons.find(button => button.dataset.slimeCharacter === id)!;
  for (const [locale, messages] of Object.entries(catalogs)) {
    const label = messages[`slime.${id}`];
    expect(label, `${locale}:slime.${id}`).toBeTypeOf("string");
    expect(label.trim(), `${locale}:slime.${id}`).not.toBe("");
    expect(label, `${locale}:slime.${id}`).not.toMatch(/\uFFFD|\?{2,}|^slime\./);
  }
  const saved = pickSlime(button);
  expect(saved).toBe(`slime:${id}`);
  expect(parseSlime(saved)).toEqual({ character: id });
  expect(isSlimeAvatar(saved)).toBe(true);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(catalogPicker.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  for (const size of [20, 96]) expect(slimeFaceHTML({ id: 20000, avatar: saved }, size)).toContain(`--av:${size}px`);
});

test.each(catalogIds)("%s retains valid shared geometry in every state, with a crown and seasonal dates", id => {
  for (const state of catalogStates) {
    const markup = slimeSVG({ character: id }, { ...plain, state });
    expect(markup, `${id}:${state}`).not.toMatch(/NaN|Infinity|undefined|\bd="\s*"/);
    expect(markup, `${id}:${state}`).toContain('class="slime-body"');
    expect(markup, `${id}:${state}`).toContain('class="slime-eyes"');
    expect(markup, `${id}:${state}`).toContain('d="M 8 70 C 8 51 24 28 48 28');
  }
  const host = document.createElement("div");
  host.innerHTML = slimeSVG({ character: id }, plain);
  const marks = host.querySelector("svg.slime .slime-marks")!.innerHTML;
  for (const now of [witch.now, new Date(2026, 11, 24)]) {
    host.innerHTML = slimeSVG({ character: id }, { now });
    expect(host.querySelector("svg.slime .slime-marks")!.innerHTML).toBe(marks);
    const crowned = slimeSVG({ character: id }, { now, crown: true, state: "working" });
    expect(crowned).toContain('fill="#F6C141"');
    expect(crowned).not.toMatch(/NaN|Infinity|\bd="\s*"/);
  }
}, 30000);

test("no two characters share both their colour and their complete costume", () => {
  const signatures = new Map<string, string>();
  for (const id of catalogIds) {
    const host = document.createElement("div");
    host.innerHTML = slimeSVG({ character: id }, plain);
    const svg = host.querySelector<SVGElement>("svg.slime")!;
    const signature = [svg.style.getPropertyValue("--slime-color"), svg.querySelector(".slime-back")?.innerHTML ?? "", svg.querySelector(".slime-marks")!.innerHTML].join("|");
    expect(signatures.get(signature), id).toBeUndefined();
    signatures.set(signature, id);
    if (!originalIds.includes(id)) {
      for (const mark of svg.querySelectorAll(".slime-marks, .slime-back")) {
        expect(mark.querySelector("text, image, linearGradient, radialGradient, [stroke]")).toBeNull();
      }
      expect(svg.querySelector(".slime-marks path, .slime-back path"), id).not.toBeNull();
    }
  }
});

test("the primary member's slime wears the gold crown on its edge, in place of a season's hat; nobody else's does", () => {
  crownPrimary({ members: [{ id: 3 }, { id: 4 }], team_context: { primary_id: 3 } });
  const crowned = slimeFaceHTML({ id: 3, avatar: "slime:color:teal" }, 40), other = slimeFaceHTML({ id: 4, avatar: "slime:color:teal" }, 40);
  expect(crowned).toContain('fill="#F6C141"');
  expect(crowned).toContain("rotate(30)");
  expect(other).not.toContain("#F6C141");
  // two horns hold it upright between them
  expect(slimeSVG({ character: "benimaru" }, { ...plain, crown: true })).toContain("translate(50 27.8) rotate(0)");
  // a plain slime gives its hat up for the crown
  expect(slimeSVG({ color: "teal" }, { ...witch, crown: true })).not.toContain("#554177");
  // a primary the roster does not have is Raphael's again
  crownPrimary({ members: [{ id: 4 }], team_context: { primary_id: 9 } });
  expect(crownedId()).toBe(0);
  expect(faceHTML({ id: 0, name: "Raphael" }, 40)).toContain("#F6C141");
});

test('sampled eyes share pixel fitting instead of fitting every hidden pose separately', () => {
  const host = document.createElement('div');
  host.innerHTML = slimeSVG({character:'shion'}, {...plain, state:'thinking'});
  const eyes = host.querySelector('.slime-loop-eyes')!;
  expect(eyes.querySelectorAll('.slime-cel-eye')).toHaveLength(celCount('thinking') * GAZE_ROWS * 4);
  expect(eyes.querySelectorAll('.slime-face')).toHaveLength(0);
});

test.each(['thinking','working','searching','computer','waiting','blocked','error'] as const)('R-PERF-01: %s carries only its current cels and keeps character marks in every body cel', state => {
  const host = document.createElement('div');
  host.innerHTML = slimeSVG({ character: 'shion' }, { ...plain, state });
  expect(host.querySelector('.slime-idle')).toBeNull();
  const bodies = host.querySelectorAll('.slime-loop-body .slime-cel-body');
  expect(bodies).toHaveLength(celCount(state) * (['thinking','searching'].includes(state) ? PROP_ROWS : 1));
  for (const body of bodies) expect(body.parentElement!.innerHTML).toContain('#363140');
  expect(host.querySelector('.slime-loop-eyes .slime-cel-eye')).not.toBeNull();
});

test('working uses only its twelve body poses without a Cartesian DOM expansion', () => {
  const host=document.createElement('div');
  host.innerHTML=slimeSVG({character:'shion'},{...plain,state:'working'});
  expect(host.querySelectorAll('*').length).toBeLessThan(800);
});

test.each(['thinking','searching'] as const)('%s does not repeat a plain body for nonexistent independent marks', state => {
  const host = document.createElement('div');
  host.innerHTML = slimeSVG({color:'lavender'},{...plain,state});
  expect(host.querySelectorAll('.slime-cel-body')).toHaveLength(celCount(state));
  expect(host.querySelector('.slime-prop-cels')).toBeNull();
  expect(host.querySelectorAll('.slime-cel-eye')).toHaveLength(celCount(state) * GAZE_ROWS * 4);
});

test('thinking cels avoid transient transform wrappers that inflate collection work', () => {
  const host=document.createElement('div');
  host.innerHTML=slimeSVG({character:'shion'},{...plain,state:'thinking'});
  expect(host.querySelectorAll('*').length).toBeLessThan(3600);
  expect(host.querySelector('.slime-loop .slime-correction, .slime-loop .slime-counterturn')).toBeNull();
});

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

test.each(["offscreen", "hidden", "collapsed", "unchanged"])("%s slimes receive state without transform reads", mode => {
  const panel = document.createElement(mode === "collapsed" ? "details" : "div");
  panel.innerHTML = slimeSVG({ character: "shion" }, { ...plain, state: "idle" });
  if (mode === "offscreen") panel.setAttribute("data-offscreen", "");
  if (mode === "hidden") panel.hidden = true;
  document.body.append(panel);
  const styled = vi.spyOn(globalThis, "getComputedStyle");
  try {
    handOver(panel.querySelector<SVGElement>("svg.slime")!, mode === "unchanged" ? "idle" : "working");
    expect(styled).not.toHaveBeenCalled();
    expect(stateIn(panel)).toBe(mode === "unchanged" ? "idle" : "working");
  } finally { styled.mockRestore(); }
});

test("a member without a picture is a slime, its chosen one or a colour from its id; Raphael is the first blue one", () => {
  const face = (member: Parameters<typeof faceHTML>[0]): HTMLElement => {
    const el = document.createElement("div"); el.innerHTML = faceHTML(member, 40); return el;
  };
  expect(face({ id: 3, name: "Ada" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  expect(slimeFaceHTML({ id: 3 }, 40)).toContain('style="--av:40px"');
  expect(face({ id: 3, name: "Ada", avatar: "slime:diablo" }).innerHTML).toContain("#EE5A64");
  expect(face({ id: 3, name: "Ada", avatar: "slime:unknown" }).querySelector(".mb-av-slime")).not.toBeNull();
  expect(face({ id: 3, name: "Ada", avatar: "preset:old", avatar_url: "data:image/png;base64,AAAA" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  // Since 2026-11-07 (owner) Raphael is the very first slime, the cute blue one; his emblem shows only in voice.
  expect(face({ id: 0, name: "Raphael" }).querySelector(".mb-av-slime svg.slime")?.outerHTML).toContain("#3DB5FF");
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
  expect(shion).toContain("--slime-color:#905AFB");
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
    const el = document.createElement("div"); el.innerHTML = slimeFaceHTML(member, 40, "", true); return stateIn(el);
  };
  expect(drawn({ id: 11, last_at: now - 1000 })).toBe("idle");
  expect(drawn({ id: 11 })).toBe("idle");
  expect(drawn({ id: 11, last_at: now - 3 * 24 * 60 * 60 * 1000 })).toBe("sleeping");
  expect(drawn({ id: 11, waiting: true, last_at: now - 3 * 24 * 60 * 60 * 1000 })).toBe("blocked");
});

test("a window that opens late learns from the list what a member is doing, and a later word wins", () => {
  const drawn = (): string | undefined => {
    const el = document.createElement("div"); el.innerHTML = slimeFaceHTML({ id: 12 }, 40, "", true); return stateIn(el);
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
  document.body.innerHTML = slimeFaceHTML({ id: 13 }, 40, "", true);
  setSlimeState(13, "done");
  setSlimeState(13, "idle");
  followSlimeRoster([{ id: 13, activity: "idle" }]);
  expect(stateIn(document.body)).toBe("done");
  vi.advanceTimersByTime(2000);
  expect(stateIn(document.body)).toBe("idle");
});

test("what the core says moves every face of that member and no other, and a redraw keeps it", () => {
  document.body.innerHTML = slimeFaceHTML({ id: 21 }, 40, "", true) + slimeFaceHTML({ id: 21 }, 96, "", true) + slimeFaceHTML({ id: 22 }, 40, "", true);
  setSlimeState(21, "working");
  const states = (): (string | undefined)[] => [...document.querySelectorAll<SVGElement>("svg.slime")].map(svg => svg.dataset.state);
  expect(states()).toEqual(["working", "working", "idle"]);
  document.body.innerHTML = slimeFaceHTML({ id: 21 }, 40, "", true);
  expect(states()).toEqual(["working"]);
  setSlimeState(21, "idle");
  expect(states()).toEqual(["idle"]);
});

test("a finish is a moment, then the member goes back to what its row says", () => {
  vi.useFakeTimers();
  document.body.innerHTML = slimeFaceHTML({ id: 31, waiting: true }, 40, "", true);
  setSlimeState(31, "done");
  expect(stateIn(document.body)).toBe("done");
  vi.advanceTimersByTime(1999);
  expect(stateIn(document.body)).toBe("done");
  vi.advanceTimersByTime(1);
  expect(stateIn(document.body)).toBe("blocked");
});

test("a new turn cuts a finish short and is not undone by its timer", () => {
  vi.useFakeTimers();
  document.body.innerHTML = slimeFaceHTML({ id: 41 }, 40, "", true);
  setSlimeState(41, "done");
  vi.advanceTimersByTime(500);
  setSlimeState(41, "thinking");
  vi.advanceTimersByTime(5000);
  expect(stateIn(document.body)).toBe("thinking");
  setSlimeState(41, "idle");
});

test("a long list does not move in step, and a redraw keeps its place in the motion", () => {
  const delay = (id: number): number => Number(/--slime-delay:(-?\d+)ms/.exec(slimeFaceHTML({ id }, 40, "", true))![1]);
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
  // A strip slides once across all its cels while steps() lands on whole frames, so any cel count stays on the compositor.
  for (const name of ['slime-loop-x', 'slime-loop-y']) {
    const body = composited.find(frame => frame.name === name)!.body;
    expect([...body.matchAll(/(\d+%|from|to)\s*\{/g)].map(match => match[1])).toEqual(['from', 'to']);
    expect(body).toMatch(/translate[XY]\(-100%\)/);
  }
  expect(css).toMatch(/\.slime-loop \.slime-cels \{[^}]*steps\(var\(--loop-cels\), end\)/);
  // A blink lands on whole rows of the eye strip, whatever its number of rows: fixed fractions of an older strip threw
  // the eyes up and down when the gazes changed (owner, 2026-11-08).
  const blink = composited.find(frame => frame.name === 'slime-loop-blink')!.body;
  const moves = [...blink.matchAll(/translateY\(([^;}]+)\)\s*;?\s*\}/g)].map(match => match[1]!.trim());
  expect(moves.filter(move => move !== '0%')).toEqual([1, 2, 3].map(rows => `calc(-${rows * 100}% / var(--loop-rows))`));
  expect(css).toMatch(/\.slime-eye-cels \{[^}]*steps\(var\(--loop-gaze\), end\)/);
  expect(css).toMatch(/\.slime-prop-cels \{[^}]*steps\(var\(--loop-prop-rows\), end\)/);
  expect(css).not.toMatch(/will-change|filter:/);
  expect(css).not.toMatch(/\.slime-in-between[^{]*\{[^}]*\btransform:/);
});

test("a slime's box is a whole number of pixels, whatever the window works out", () => {
  expect(css).toMatch(/\.av\.mb-av\.mb-av-slime \{[^}]*width: round\(var\(--av\), 1px\);[^}]*height: round\(var\(--av\), 1px\);/);
});

test("each moving state retains its body performance while idle and sleeping have no loop", () => {
  for (const state of ["thinking", "working", "searching", "computer", "waiting", "done", "error", "arriving"]) {
    expect(css, state).toContain(`.slime[data-state="${state}"] .slime-motion { animation: slime-${state}-`);
  }
  expect(css).not.toMatch(/(?:\.slime|\.slime-surface)\[data-state="(?:idle|sleeping)"\][^{]*\{[^}]*animation:/);
});

test.each([18, 22, 28, 40, 72, 96, 120])("sleeping at %ipx retains one still vector with closed eyes and no bubble", size => {
  const host = document.createElement("div");
  host.innerHTML = slimeFaceHTML({ id: 71, avatar: "slime:shion", last_at: Date.now() - 3 * 24 * 60 * 60 * 1000 }, size);
  expect(stateIn(host)).toBe("sleeping");
  expect(host.querySelectorAll(".slime-body")).toHaveLength(1);
  expect(host.querySelector(".slime-marks .slime-mark")).not.toBeNull();
  expect(host.querySelector(".slime-loop, .slime-idle, .slime-bubble, .slime-drop")).toBeNull();
  expect(css).toContain('.slime[data-state="sleeping"] { --eye-y: 50px; --eye-w: 3.5; --eyes: path("M 38.51 50.31');
  expect(css).not.toContain("slime-sleeping-body");
});

test("under reduced motion nothing moves and each liquid state retains its pose", () => {
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
  document.body.innerHTML = slimeFaceHTML({ id: 51 }, 40, "", true);
  const svg = document.querySelector<SVGElement>("svg.slime")!;
  expect(svg.dataset.moved).toBeUndefined();
  setSlimeState(51, "done");
  expect(svg.dataset.state).toBe("done");
  expect(svg.dataset.moved).toBe("done");
  expect(svg.style.getPropertyValue("--slime-since")).toBe("0ms");
  vi.advanceTimersByTime(700);
  document.body.innerHTML = slimeFaceHTML({ id: 51 }, 40, "", true);
  expect(/--slime-since:(-?\d+)ms/.exec(document.body.innerHTML)![1]).toBe("-700");
  expect(document.querySelector<SVGElement>("svg.slime")!.dataset.moved).toBeUndefined();
  vi.advanceTimersByTime(1300);
});

test("telling a slime what it is already doing changes nothing", () => {
  document.body.innerHTML = slimeFaceHTML({ id: 52 }, 40, "", true);
  const svg = document.querySelector<SVGElement>("svg.slime")!;
  setSlimeState(52, "idle");
  expect(svg.dataset.moved).toBeUndefined();
  setSlimeState(52, "working");
  setSlimeState(52, "working");
  expect(svg.dataset.moved).toBe("working");
  setSlimeState(52, "idle");
});

test("a list keeps different paces, and each member keeps its own", () => {
  const tempo = (id: number): number => Number(/--slime-tempo:([\d.]+)/.exec(slimeFaceHTML({ id }, 40, "", true))![1]);
  const tempos = Array.from({ length: 12 }, (_, id) => tempo(id));
  expect(new Set(tempos).size).toBeGreaterThanOrEqual(8);
  for (const value of tempos) { expect(value).toBeGreaterThanOrEqual(0.94); expect(value).toBeLessThanOrEqual(1.06); }
  expect(tempo(5)).toBe(tempo(5));
});

test("hover never wiggles a slime: a resting one glances to its own side and looks back while the pointer is on it", () => {
  document.body.innerHTML = `<button class="mb-row">${slimeFaceHTML({ id: 62 }, 40, "", true)}${slimeFaceHTML({ id: 63 }, 40, "", true)}</button>`;
  const row = document.querySelector(".mb-row")!, [even, odd] = [...row.querySelectorAll<SVGElement>("svg.slime")];
  expect(even!.style.getPropertyValue("--slime-aside")).toBe("-3px");
  expect(odd!.style.getPropertyValue("--slime-aside")).toBe("3px");
  row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  expect(even!.classList.contains("is-delighted")).toBe(false);
  expect(css).not.toContain("slime-delight");
  expect(css).toContain('.slime[data-state="idle"] .slime-follow { translate: var(--slime-aside, -3px) -0.5px;');
  expect(css).toContain(':is(.mb-row, .mb-avbtn, .mb-preset, .mb-av-slime, .slime-surface):hover .slime[data-state="idle"] .slime-follow { translate: 0 0; }');
});

test("idle press uses a finite squash and release on its resting vector", () => {
  const host = document.createElement("div");
  host.innerHTML = slimeSVG({ character: "shion" }, plain);
  expect(host.querySelector("svg.slime")?.getAttribute("data-state")).toBe("idle");
  expect(host.querySelector(".slime-loop, .slime-idle")).toBeNull();
  expect(css).toContain(':is(.mb-row, .mb-avbtn, .mb-preset, .mb-av-slime):active .slime-surface:not([data-slime-still]) { scale: 1.12 0.84; transition: scale 90ms cubic-bezier(0.2, 0.8, 0.3, 1); }');
  expect(css).not.toMatch(/--slime-(?:touch|squish)/);
  expect(css).toContain("transition: scale 480ms");
});

test("every liquid state keeps the body, eyes and costume instead of substituting a symbol", () => {
  for (const state of ["thinking", "working", "blocked", "error", "sleeping", "done"] as SlimeState[]) {
    const drawing = document.createElement("div");
    drawing.innerHTML = slimeSVG({ character: "shion" }, { ...plain, state });
    expect(drawing.querySelector(".slime-body")).not.toBeNull();
    expect(drawing.querySelector(".slime-mark")).not.toBeNull();
    expect(drawing.querySelector(".slime-drop")).toBeNull();
    expect(drawing.querySelector(".slime-bubble, .slime-cel-prop")).toBeNull();
    expect(drawing.querySelector(".slime-dots, .slime-blocked, .slime-ribbons, .slime-z")).toBeNull();
  }
  expect(css).not.toMatch(/slime-dot-pulse|slime-attention|slime-ribbon-orbit|slime-z|visibility: hidden;[^}]*slime-press/);
});

test("no state has detached droplet or bubble styles, keyframes or cel props", () => {
  expect(css).not.toMatch(/slime-(?:drop|bubble|sweat|drip)\b|--slime-liquid-alpha/);
  expect(keyframes.map(({ name }) => name)).not.toContain("slime-sleeping-body");
  for (const state of ["idle", "thinking", "working", "searching", "computer", "waiting", "blocked", "done", "error", "sleeping", "arriving"] as SlimeState[]) {
    const host = document.createElement("div");
    host.innerHTML = slimeSVG({ character: "shion" }, { ...plain, state });
    expect(host.querySelector(".slime-drop, .slime-bubble, .slime-cel-prop"), state).toBeNull();
  }
});

test("a slime far out of sight takes its new state without reading its pose", () => {
  document.body.innerHTML = `<div class="slime-surface" data-offscreen>${slimeFaceHTML({ id: 21 }, 40, "", true)}</div><div>${slimeFaceHTML({ id: 21 }, 40, "", true)}</div>`;
  const [far, near] = document.querySelectorAll<SVGElement>('svg.slime[data-slime-member="21"]');
  const styled = vi.spyOn(window, "getComputedStyle");
  try {
    setSlimeState(21, "thinking");
    const readFar = styled.mock.calls.filter(([element]) => far!.contains(element as Node) || element === far).length;
    const readNear = styled.mock.calls.filter(([element]) => near!.contains(element as Node) || element === near).length;
    expect([far!.dataset.state, near!.dataset.state]).toEqual(["thinking", "thinking"]);
    expect(readFar).toBe(0);
    expect(readNear).toBe(0);
    expect(far!.dataset.transitioning).toBeUndefined();
  } finally { styled.mockRestore(); setSlimeState(21, "idle"); }
});


test("visible changes and interrupted handovers never read computed styles", async () => {
  const animated = vi.spyOn(Element.prototype, "animate");
  document.body.innerHTML = slimeFaceHTML({ id: 81 }, 40, "", true) + slimeFaceHTML({ id: 81, avatar: "slime:shion" }, 40, "", true);
  const svgs = [...document.querySelectorAll<SVGElement>('svg.slime[data-slime-member="81"]')];
  const read = window.getComputedStyle.bind(window), states: string[][] = [];
  const styled = vi.spyOn(window, "getComputedStyle").mockImplementation((...args) => {
    states.push(svgs.map(svg => svg.dataset.state!));
    return read(...args);
  });
  try {
    setSlimeState(81, "working");
    setSlimeState(81, "searching");
    setSlimeState(81, "done");
    const transforms = animated.mock.calls.flatMap(([frames]) => Array.isArray(frames) ? frames : []).filter(frame => 'translate' in frame);
    expect(transforms.length).toBeGreaterThan(0);
    expect(transforms.every(frame => !Object.keys(frame).some(key => key.startsWith('--')))).toBe(true);
    expect(states).toEqual([]);
    expect(svgs.every(svg => svg.dataset.state === "done")).toBe(true);
    setSlimeState(81, "working");
    await vi.waitFor(() => expect(svgs.every(svg => svg.parentElement!.querySelector(".slime-loop-body"))).toBe(true));
  } finally { styled.mockRestore(); setSlimeState(81, "idle"); }
});

test("a simultaneous presence burst mounts at most one visible strip per frame", () => {
  const frames: FrameRequestCallback[] = [];
  const created = vi.spyOn(document, 'createElement');
  let time = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  const animated = vi.spyOn(Element.prototype, 'animate');
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  document.body.innerHTML = [91,92,93].map(id => slimeFaceHTML({id},40,"",true)).join('');
  for (const id of [91,92,93]) setSlimeState(id,'working');
  expect(document.querySelectorAll('.slime-loop-body')).toHaveLength(0);
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, {subtree:true, attributes:true, attributeFilter:['data-state','data-moved']});
  for (let count = 1; count <= 3; count++) {
    time += 16; frames.shift()!(time);
    expect(document.querySelectorAll('.slime-loop-body')).toHaveLength(count);
    const svg = document.querySelector<SVGElement>(`svg.slime[data-slime-member="${90+count}"]`)!;
    const strip = svg.parentElement!.querySelector<HTMLElement>('.slime-loop-body')!;
    expect(Number.parseFloat(strip.querySelector<HTMLElement>('.slime-cels')!.style.animationDelay)).toBe(Number.parseFloat(svg.style.getPropertyValue('--slime-delay')) - count*16);
    expect(animated.mock.calls.filter(([frames]) => Array.isArray(frames) && frames[0]?.visibility === 'visible')).toHaveLength(3+count);
    expect(observer.takeRecords()).toHaveLength(0);
  }
  expect(created.mock.calls.filter(([tag]) => tag === 'template').length).toBeLessThanOrEqual(1);
  const bodies = [...document.querySelectorAll('.slime-loop-body')];
  expect(new Set(bodies).size).toBe(3);
  bodies[0]!.remove();
  expect(bodies[1]!.isConnected && bodies[2]!.isConnected).toBe(true);
  observer.disconnect();
  for (const id of [91,92,93]) setSlimeState(id,'idle');
});


// ---------- a slime moves in two places only (owner, 2026-11-11) ----------

test("a slime is a picture unless it moves: whatever its member does, it keeps its resting pose and no clock", () => {
  followSlimeRoster([{ id: 301, activity: "working" }]);
  const picture = slimeFaceHTML({ id: 301, avatar: "slime:shion" }, 40), moving = slimeFaceHTML({ id: 301, avatar: "slime:shion" }, 40, "", true);
  expect(picture).toContain('data-state="idle"');
  expect(moving).toContain('data-state="working"');
  // No strips, no motion variables, no member to hand over to, nothing for the page to watch.
  for (const marker of ["slime-loop", "data-slime-member", "data-slime-mounted", "--slime-delay", "--slime-tempo", "--slime-since"]) expect(picture, marker).not.toContain(marker);
  expect(picture).toContain("data-slime-still");
  expect(picture).toContain("slime-marks");
  setSlimeState(301, "searching");
  const host = document.createElement("div");
  host.innerHTML = picture + moving;
  expect([...host.querySelectorAll<SVGElement>("svg.slime")].map(svg => svg.dataset.state)).toEqual(["idle", "working"]);
  setSlimeState(301, "thinking");
  expect([...host.querySelectorAll<SVGElement>("svg.slime")].map(svg => svg.dataset.state)).toEqual(["idle", "working"]);
});

test("a picture keeps the states that are poses without motion, asleep and at rest, and a wait for the owner is only a slime at rest", () => {
  const state = (member: Parameters<typeof slimeFaceHTML>[0]): string | undefined => {
    const el = document.createElement("div"); el.innerHTML = slimeFaceHTML(member, 40); return stateIn(el);
  };
  expect(state({ id: 302 })).toBe("idle");
  expect(state({ id: 302, waiting: true })).toBe("idle");
  expect(state({ id: 302, last_at: Date.now() - 3 * 24 * 60 * 60 * 1000 })).toBe("sleeping");
  for (const wanted of ["thinking", "working", "blocked", "done", "error", "arriving"] as const)
    expect(slimeSVG({ color: "sky" }, { state: wanted })).toContain('data-state="idle"');
});

test("faceHTML moves only when asked, for Raphael and for a member alike", () => {
  for (const member of [{ id: 0, name: "Raphael" }, { id: 303, name: "Ada", avatar: "slime:souei" }]) {
    expect(faceHTML(member, 40), String(member.id)).toContain("data-slime-still");
    expect(faceHTML(member, 40, { moving: true }), String(member.id)).not.toContain("data-slime-still");
    expect(faceHTML(member, 40, { moving: true }), String(member.id)).toContain(`data-slime-member="${member.id}"`);
  }
});

test("the pictures of the picker, the maker and the stores never move", () => {
  const picker = document.createElement("div");
  picker.innerHTML = slimePickerHTML(null, same);
  const surfaces = [...picker.querySelectorAll(".slime-surface")];
  expect(surfaces.length).toBeGreaterThan(50);
  expect(surfaces.every(surface => surface.hasAttribute("data-slime-still"))).toBe(true);
});

test("slime.css holds a picture still against every rule that could move it", () => {
  expect(css).toContain(".slime-surface[data-slime-still], .slime-surface[data-slime-still] * { animation: none !important; transition: none !important; }");
  // No press squish and no look back under the pointer for a picture.
  expect(css).toContain(":active .slime-surface:not([data-slime-still]) {");
});

test("a roster read hands a face on screen over before the redraw, so the redraw keeps it", () => {
  document.body.innerHTML = slimeFaceHTML({ id: 311 }, 40, "", true);
  expect(stateIn(document.body)).toBe("idle");
  followSlimeRoster([{ id: 311, activity: "working" }]);
  expect(stateIn(document.body)).toBe("working");
  // A redraw of what the roster says then finds the face as it should be: nothing is left to replace.
  const drawn = document.createElement("div"); drawn.innerHTML = slimeFaceHTML({ id: 311 }, 40, "", true);
  expect(stateIn(drawn)).toBe(stateIn(document.body));
  followSlimeRoster([{ id: 311, activity: "idle" }]);
  expect(stateIn(document.body)).toBe("idle");
  followSlimeRoster([{ id: 311, activity: "thinking", waiting: true }]);
  expect(stateIn(document.body)).toBe("blocked");
  // Telling it the same again changes nothing.
  const svg = document.body.querySelector("svg.slime")!;
  const seen: string[] = [];
  new MutationObserver(records => records.forEach(record => seen.push(record.attributeName ?? ""))).observe(svg, { attributes: true, subtree: true, childList: true });
  followSlimeRoster([{ id: 311, activity: "thinking", waiting: true }]);
  return Promise.resolve().then(() => expect(seen).toEqual([]));
});
