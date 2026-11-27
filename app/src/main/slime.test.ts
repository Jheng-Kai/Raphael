// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { faceHTML } from "./members";
import { GAZE_ROWS, PROP_ROWS, celCount, eyePath, gazeRows, loopState } from "./slime-motion";
import { crownedId, crownPrimary } from "./crown";
import { catalogs, getLocale, setLocale } from "./i18n";
import { defaultSlimeAvatar, followSlimeRoster, GAZE_REACH, gazeToward, isDark, handOver, isSlimeAvatar, newMemberSlime, parseSlime, pickSlime, seasonalHat, setSlimeState, SLIME_GROUPS, slimeCharactersHTML, slimeFaceHTML, slimeGroupName, slimeGroupOf, slimeGroupSwatch, slimePickerHTML, slimeSVG, type SlimeState } from "./slime";
import type { Slime, SlimeCharacter, SlimeGroup } from "./slime";

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
// Motion tests draw the moving kind of slime; the still kind is tested on its own.
const plain = { now: new Date(2026, 5, 1), moving: true }, witch = { now: new Date(2026, 9, 31) };
const same = (text: string): string => text;

const catalogPicker = document.createElement("div");
catalogPicker.className = "menu";
catalogPicker.innerHTML = slimePickerHTML(null, same);
const catalogButtons = [...catalogPicker.querySelectorAll<HTMLElement>("[data-slime-character]")];
const catalogIds = catalogButtons.map(button => button.dataset.slimeCharacter as SlimeCharacter);
const originalIds = ["blue-plain", "horn-lavender", "streaks-charcoal", "horns-red", "small-horns-pink", "horn-sash-blue", "mustache-gray", "goggles-green", "cap-green", "bowtie-green", "tuft-pink", "horns-blue", "wolf-star", "frill-periwinkle", "tusks-tan", "sprout-mint", "headband-brown", "mask-cornflower", "collar-indigo", "sash-crimson", "bowtie-pearl", "bowtie-purple", "necktie-amber", "wings-yellow"];
// The archetypes earlier builds offered under tabs of their kinds, now each under a colour.
const archetypeIds = ["oni-red", "oni-indigo", "kijin-ivory", "demon-wings", "demon-tail", "dragon-storm", "dragon-ember", "dragon-ice", "fairy-wings", "fairy-flower", "beast-fangs", "beast-mane", "knight-helm", "knight-plume", "paladin", "ranger-hood", "archer-feather", "mage-star", "sage-scroll", "alchemist-flask", "maid-apron", "butler-silver", "witch-moon", "wizard-cap", "golem-stone", "phoenix-feather", "cat-ears", "dog-ears", "rabbit-ears", "fox-ears", "bear-ears", "panda", "frog", "axolotl", "bee", "penguin", "turtle", "octopus", "fire", "water", "earth", "wind", "snow", "thunder", "rainbow", "cloud", "cherry-blossom", "autumn-leaf", "pumpkin", "strawberry", "lemon", "mushroom", "chef-hat", "gardener", "artist", "medic", "sailor", "astronaut", "detective", "mechanic", "ribbon-bell", "parcel", "candle", "music-note"];
const catalogStates: SlimeState[] = ["idle", "thinking", "working", "searching", "computer", "waiting", "blocked", "done", "error", "sleeping", "arriving"];
const groupIds = ["black", "brown", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"] as const;
const inGroup = (group: string): string[] => [...catalogPicker.querySelectorAll<HTMLElement>(`[data-slime-group="${group}"] [data-slime-character]`)].map(button => button.dataset.slimeCharacter!);

test("the picker is eleven colours, each with characters of its own, and no plain colour (R-SLIME-PICK-01)", () => {
  const groups = [...catalogPicker.querySelectorAll<HTMLElement>("[data-slime-group]")];
  expect(groups.map(group => group.dataset.slimeGroup)).toEqual(groupIds);
  expect(SLIME_GROUPS).toEqual(groupIds);
  // Nothing counts them: a colour holds as many as are drawn for it, and none is empty.
  for (const group of groups) expect(group.querySelectorAll('[role="menuitem"]').length, group.dataset.slimeGroup).toBeGreaterThan(0);
  expect(catalogPicker.querySelector("[data-slime-color]")).toBeNull();
  // Each slime stands under its own colour, and the picker holds every character the app draws.
  for (const group of groupIds) for (const id of inGroup(group)) expect(slimeGroupOf(`slime:${id}`), id).toBe(group);
  const ungrouped = document.createElement("div");
  ungrouped.innerHTML = slimeCharactersHTML(null, same);
  expect([...catalogIds].sort()).toEqual([...ungrouped.querySelectorAll<HTMLElement>("[data-slime-character]")].map(button => button.dataset.slimeCharacter!).sort());
  for (const [index, group] of groups.entries()) {
    // A swatch names it, so there is no heading inside.
    expect(group.getAttribute("role")).toBe("tabpanel");
    expect(group.getAttribute("aria-labelledby")).toBe(`slime-tab-${groupIds[index]!}`);
    expect(group.querySelector("h1, h2, h3, h4")).toBeNull();
    expect(slimeGroupSwatch(groupIds[index]!)).toMatch(/^#[0-9A-F]{6}$/);
    for (const [locale, messages] of Object.entries(catalogs)) {
      const label = (messages as Record<string, string>)[`slime.family.${groupIds[index]!}`]!;
      expect(label.trim(), `${locale}:${groupIds[index]}`).not.toBe("");
      expect(label).not.toMatch(/�|\?{2,}|^slime\./);
    }
  }
  expect(pickSlime(groups[0]!)).toBeNull();
});

test("the picker still offers every face earlier builds offered, each once, the first set at the head of each colour in its own order", () => {
  expect(new Set(catalogIds).size).toBe(catalogIds.length);
  for (const id of [...originalIds, ...archetypeIds]) expect(catalogIds, id).toContain(id);
  for (const group of groupIds) {
    const ids = inGroup(group), firsts = originalIds.filter(id => ids.includes(id));
    expect(ids.slice(0, firsts.length), group).toEqual(firsts);
  }
});

test("a member without a face of its own still wears a plain colour, and the picker opens on the colour nearest it with nothing marked", () => {
  const plainFaces = [...new Set(Array.from({ length: 40 }, (_, id) => defaultSlimeAvatar(id)))];
  expect(plainFaces.length).toBeGreaterThanOrEqual(19);
  for (const avatar of plainFaces) {
    expect(parseSlime(avatar)).toEqual({ color: avatar.slice("slime:color:".length) });
    const host = document.createElement("div");
    host.innerHTML = slimePickerHTML(avatar, same);
    expect(host.querySelector('[aria-pressed="true"]'), avatar).toBeNull();
    expect(host.querySelector<HTMLElement>("[data-slime-group][data-active]")!.dataset.slimeGroup, avatar).toBe(slimeGroupOf(avatar));
  }
  expect(slimeGroupOf("slime:color:sky")).toBe("blue");
  expect(slimeGroupOf("slime:color:charcoal")).toBe("gray");
  expect(slimeGroupOf("preset:old")).toBe("black");
});

test.each(Object.entries({ azure: "sky", mint: "teal", sunny: "ochre", coral: "coral", rose: "orchid", lilac: "lavender", slate: "charcoal", fox: "tangerine", sprout: "leaf", crown: "ochre" }))("legacy colour alias %s keeps its original meaning", (alias, color) => {
  expect(parseSlime(`slime:${alias}`)).toEqual({ color });
});

test("a new member in the maker starts from a character, one colour further on for each member already there", () => {
  const starts = Array.from({ length: 22 }, (_, count) => newMemberSlime(count));
  expect(starts.slice(0, 11).map(avatar => slimeGroupOf(avatar))).toEqual(groupIds);
  expect(starts.every(avatar => catalogIds.includes(avatar.slice("slime:".length) as SlimeCharacter))).toBe(true);
  expect(new Set(starts).size).toBe(22);
});

test("a slime has no name: no tooltip, and a screen reader hears its colour and its place", () => {
  const previous = getLocale();
  const host = document.createElement("div");
  try {
    for (const locale of Object.keys(catalogs)) {
      setLocale(locale);
      host.innerHTML = slimePickerHTML(null, same);
      for (const group of host.querySelectorAll("[data-slime-group]")) {
        const names = [...group.querySelectorAll("[data-slime-character]")].map(button => {
          const name = button.getAttribute("aria-label") ?? "";
          expect(button.hasAttribute("title")).toBe(false);
          expect(name).toContain(slimeGroupName(group.getAttribute("data-slime-group") as SlimeGroup));
          expect(name.trim()).not.toBe("");
          expect(name).not.toMatch(/\uFFFD|\?{2,}|^slime\./);
          return name;
        });
        expect(new Set(names).size, `${locale}:${group.id}`).toBe(names.length);
      }
    }
  } finally {
    setLocale(previous);
  }
});

test.each(catalogIds)("every picker choice has a persistent round trip: %s", id => {
  const button = catalogButtons.find(button => button.dataset.slimeCharacter === id)!;
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
    for (const mark of svg.querySelectorAll(".slime-marks, .slime-back")) {
      expect(mark.querySelector("text, image, linearGradient, radialGradient")).toBeNull();
    }
    const shapes = svg.querySelectorAll(":is(.slime-marks, .slime-back) :is(path, circle, rect)");
    if (id !== "blue-plain") expect(shapes.length, id).toBeGreaterThan(0);
  }
});

/** The crown's outline as drawn, in the drawing's units: the seven corners of its base and its points, in order. */
function crownPoints(html: string): [number, number][] {
  const host = document.createElement("div");
  host.innerHTML = html;
  const shape = host.querySelector(".slime-crown path")!;
  const numbers = shape.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  // M and six L commands, then Q (control, then the point it returns to)
  return Array.from({ length: 7 }, (_, index) => [numbers[index * 2]!, numbers[index * 2 + 1]!]);
}
/** Points along the body's outline: its four cubic curves, as `slimeSVG` draws it. */
function bodyOutline(html: string): [number, number][] {
  const host = document.createElement("div");
  host.innerHTML = html;
  const n = host.querySelector(".slime-body")!.getAttribute("d")!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const points: [number, number][] = [];
  for (let at = 2; at + 5 < n.length; at += 6) {
    const [x0, y0] = at === 2 ? [n[0]!, n[1]!] : [n[at - 2]!, n[at - 1]!];
    const [x1, y1, x2, y2, x3, y3] = n.slice(at, at + 6) as [number, number, number, number, number, number];
    for (let step = 0; step <= 60; step++) {
      const u = step / 60, v = 1 - u;
      points.push([v ** 3 * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u ** 3 * x3, v ** 3 * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u ** 3 * y3]);
    }
  }
  return points;
}
const crownSample = { ...plain, crown: true };

test("the primary member's slime wears the gold crown on its edge, in place of a season's hat; nobody else's does", () => {
  crownPrimary({ members: [{ id: 3 }, { id: 4 }], team_context: { primary_id: 3 } });
  const crowned = slimeFaceHTML({ id: 3, avatar: "slime:color:teal" }, 40), other = slimeFaceHTML({ id: 4, avatar: "slime:color:teal" }, 40);
  expect(crowned).toContain('fill="#F6C141"');
  expect(other).not.toContain("#F6C141");
  // on a plain slime it is tilted down the slope of the dome's upper right; between two horns it stands upright
  const tilt = (html: string): number => { const [left, , , , , , right] = crownPoints(html); return Math.round(Math.atan2(right![1] - left![1], right![0] - left![0]) * 180 / Math.PI); };
  expect(tilt(crowned)).toBe(30);
  expect(tilt(slimeSVG({ character: "horns-red" }, { ...plain, crown: true }))).toBe(0);
  // a plain slime gives its hat up for the crown
  expect(slimeSVG({ color: "teal" }, { ...witch, crown: true })).not.toContain("#554177");
  // a primary the roster does not have is nobody: Raphael is never crowned, and the crown is gone with the chief
  crownPrimary({ members: [{ id: 4 }], team_context: { primary_id: 9 } });
  expect(crownedId()).toBeNull();
  expect(faceHTML({ id: 0, name: "Raphael" }, 40)).not.toContain("#F6C141");
  expect(faceHTML({ id: 4, name: "x", avatar: "slime:color:teal" }, 40)).not.toContain("#F6C141");
});

test("the crown is one set of plain coordinates on every character, drawn once and never again in the dark rim", () => {
  for (const id of catalogIds) {
    for (const now of [plain.now, witch.now]) {
      const crowned = slimeSVG({ character: id }, { ...crownSample, now });
      const host = document.createElement("div");
      host.innerHTML = crowned;
      const svg = host.querySelector("svg.slime")!;
      // one crown: the same gold shapes are not in the rim that stands behind dark slimes and dark marks, nor anywhere else
      expect(svg.querySelectorAll(".slime-crown"), id).toHaveLength(1);
      expect(svg.querySelectorAll('[fill="#F6C141"]'), id).toHaveLength(4);
      expect(svg.querySelector(".slime-rim .slime-crown, .slime-back .slime-crown"), id).toBeNull();
      // no transform of its own: a nested transform read about the wrong origin put it beside the body
      expect(svg.querySelector(".slime-crown")!.matches("[transform]") || svg.querySelector(".slime-crown [transform]") !== null, id).toBe(false);
      expect(svg.querySelectorAll('.slime-rim [fill="#F6C141"]'), id).toHaveLength(0);
      expect(slimeSVG({ character: id }, { ...plain, now })).not.toContain("slime-crown");
    }
  }
  // dark body (rim round the body) and a bright body that wears something dark (rim round what it wears) both have a rim
  for (const slime of [{ character: "panda" as const }, { character: "headband-brown" as const }]) {
    const host = document.createElement("div");
    host.innerHTML = slimeSVG(slime, crownSample);
    expect(host.querySelector(".slime-rim"), JSON.stringify(slime)).not.toBeNull();
    expect(host.querySelectorAll(".slime-crown")).toHaveLength(1);
  }
});

test("the crown stands on the head of every character: its base on the outline of the dome, its points up and away from it", () => {
  const kinds: Slime[] = [...catalogIds.map(character => ({ character })), { color: "sky" }, { color: "charcoal" }];
  for (const slime of kinds) {
    const html = slimeSVG(slime, crownSample), label = JSON.stringify(slime);
    const points = crownPoints(html), outline = bodyOutline(html);
    const [left, , , , , , right] = points as [number, number][];
    const middle: [number, number] = [(left![0] + right![0]) / 2, (left![1] + right![1]) / 2];
    // the base touches the outline of the body (within the width of its own stroke), neither inside it nor floating off it
    const gap = Math.min(...outline.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])));
    expect(gap, `${label} base ${middle.map(Math.round)} is ${gap.toFixed(1)} from the outline`).toBeLessThanOrEqual(3.5);
    // on the upper half of the dome, inside the drawing's box
    expect(middle[1], label).toBeLessThan(50);
    for (const [x, y] of points) {
      expect(x, label).toBeGreaterThan(4);
      expect(x, label).toBeLessThan(96);
      expect(y, label).toBeGreaterThan(11);
    }
  }
});

test('sampled eyes share pixel fitting instead of fitting every hidden pose separately', () => {
  const host = document.createElement('div');
  host.innerHTML = slimeSVG({character:'horn-lavender'}, {...plain, state:'thinking'});
  const eyes = host.querySelector('.slime-loop-eyes')!;
  expect(eyes.querySelectorAll('.slime-cel-eye')).toHaveLength(celCount('thinking') * GAZE_ROWS * 4);
  expect(eyes.querySelectorAll('.slime-face')).toHaveLength(0);
});

test.each(['thinking','working','searching','computer','waiting','blocked','error'] as const)('R-PERF-01: %s carries only its current cels and keeps character marks in every body cel', state => {
  const host = document.createElement('div');
  host.innerHTML = slimeSVG({ character: 'horn-lavender' }, { ...plain, state });
  expect(host.querySelector('.slime-idle')).toBeNull();
  const bodies = host.querySelectorAll('.slime-loop-body .slime-cel-body');
  expect(bodies).toHaveLength(celCount(state) * (['thinking','searching'].includes(state) ? PROP_ROWS : 1));
  for (const body of bodies) expect(body.parentElement!.innerHTML).toContain('#363140');
  expect(host.querySelector('.slime-loop-eyes .slime-cel-eye')).not.toBeNull();
});

test('working uses only its twelve body poses without a Cartesian DOM expansion', () => {
  const host=document.createElement('div');
  host.innerHTML=slimeSVG({character:'horn-lavender'},{...plain,state:'working'});
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
  host.innerHTML=slimeSVG({character:'horn-lavender'},{...plain,state:'thinking'});
  expect(host.querySelectorAll('*').length).toBeLessThan(3600);
  expect(host.querySelector('.slime-loop .slime-correction, .slime-loop .slime-counterturn')).toBeNull();
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

test.each(["offscreen", "hidden", "collapsed", "unchanged"])("%s slimes receive state without transform reads", mode => {
  const panel = document.createElement(mode === "collapsed" ? "details" : "div");
  panel.innerHTML = slimeSVG({ character: "horn-lavender" }, { ...plain, state: "idle" });
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
  expect(face({ id: 3, name: "Ada", avatar: "slime:streaks-charcoal" }).innerHTML).toContain("#EE5A64");
  expect(face({ id: 3, name: "Ada", avatar: "slime:unknown" }).querySelector(".mb-av-slime")).not.toBeNull();
  expect(face({ id: 3, name: "Ada", avatar: "preset:old", avatar_url: "data:image/png;base64,AAAA" }).querySelector(".mb-av-slime svg.slime")).not.toBeNull();
  // Raphael uses the first blue slime; its emblem shows only in voice.
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

test("the lavender slime keeps its one horn on the shared body", () => {
  const lavender = slimeSVG({ character: "horn-lavender" }, plain);
  expect(lavender).toContain("--slime-color:#905AFB");
  expect(lavender).toContain("#363140");
  const bare = slimeSVG({ color: "sky" }, plain);
  const host = document.createElement("div");
  host.innerHTML = lavender;
  expect(host.querySelector('.slime-marks path[fill="#363140"]')?.getAttribute("d")).toContain("M 44 34 C 45 25");
  // One path more than a plain slime, besides the dark theme's rim round the dark horn.
  const own = (html: string): number => { const box = document.createElement("div"); box.innerHTML = html; return [...box.querySelectorAll("path")].filter(path => !path.closest(".slime-rim")).length; };
  expect(own(lavender)).toBe(own(bare) + 1);
  expect(host.querySelector(".slime-rim path[fill=\"#363140\"]")).not.toBeNull();
});

test.each(["turtle", "butler-silver"] as const)("an opaque mask covers the resting and moving face of %s", character => {
  const host = document.createElement("div");
  for (const moving of [false, true]) {
    host.innerHTML = slimeSVG({ character }, { ...plain, moving, state: "working" });
    expect(host.querySelector(".slime-surface[data-slime-mask] .slime-marks path")).not.toBeNull();
    if (moving) expect(host.querySelector("[data-slime-mask] .slime-cel-eye")).not.toBeNull();
  }
});

test("what earlier builds stored still draws", () => {
  expect(parseSlime("slime:azure")).toEqual({ color: "sky" });
  expect(parseSlime("slime:oni")).toEqual({ character: "horn-lavender" });
  expect(parseSlime("slime:demon")).toEqual({ character: "streaks-charcoal" });
  expect(parseSlime("slime:fox")).toEqual({ color: "tangerine" });
  expect(parseSlime("slime:oni:coral")).toEqual({ character: "horn-lavender" });
  expect(parseSlime("slime:jelly:teal")).toEqual({ color: "teal" });
  expect(parseSlime("slime:color:leaf")).toEqual({ color: "leaf" });
  expect(parseSlime("slime:goggles-green")).toEqual({ character: "goggles-green" });
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
  expect(slimeSVG({ character: "horn-lavender" }, witch)).not.toContain("#554177");
});

test("one press chooses one slime, in a menu that shows it", () => {
  document.body.innerHTML = `<div class="menu">${slimePickerHTML("slime:horn-lavender", same)}</div>`;
  const pressed = (): (string | undefined)[] => [...document.querySelectorAll<HTMLElement>('[aria-pressed="true"]')].map(el => el.dataset.slimeCharacter ?? el.dataset.slimeColor);
  expect(pressed()).toEqual(["horn-lavender"]);
  expect(pickSlime(document.querySelector<HTMLElement>('[data-slime-character="small-horns-pink"]')!)).toBe("slime:small-horns-pink");
  expect(pressed()).toEqual(["small-horns-pink"]);
  expect(pickSlime(document.querySelector<HTMLElement>('[data-slime-character="dragon-ice"]')!)).toBe("slime:dragon-ice");
  expect(pressed()).toEqual(["dragon-ice"]);
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
  host.innerHTML = slimeSVG({ character: "streaks-charcoal" });
  expect(host.querySelector('.slime-marks path[fill="#FFF6E9"]')).not.toBeNull();
  expect(host.querySelector(".slime-idle, .slime-loop")).toBeNull();
  host.innerHTML = slimeSVG({ character: "bowtie-green" });
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
  // the eyes up and down when the gazes changed.
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

test("tan(atan2()) in slime.css divides pixels: WebKit loses the unit of an atan2() whose length is relative", () => {
  // macOS: a container unit reaching atan2() made tan() read degrees as radians, so a 22px face's unit was
  // 1.215 for 0.239 and its eyes seven times too large. The face's size comes through a registered length instead.
  expect(css).toContain('@property --slime-size { syntax: "<length>";');
  const calls = [...css.matchAll(/atan2\(/g)].map(match => {
    let depth = 0, end = match.index! + "atan2".length;
    do { const c = css[end++]; if (c === "(") depth++; else if (c === ")") depth--; } while (depth > 0 && end < css.length);
    return css.slice(match.index!, end);
  });
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call).not.toMatch(/\d(?:cq[a-z]*|r?em|ex|ch|[sld]?v[whib]|vmin|vmax)\b|\d%/);
    // A custom property in it must already be pixels: the registered length, or the unit made from it.
    for (const name of call.match(/--[\w-]+/g) ?? []) expect(["--slime-size", "--slime-drawn", "--slime-unit"]).toContain(name);
  }
  // At a page zoom WebKit hands a registered length on already zoomed: the size goes over a registered drawn size, so the two
  // keep their ratio (a zoomed size over a plain 92px made a 40px face at 130 % read as 52px).
  expect(css).toContain('@property --slime-drawn { syntax: "<length>";');
  expect(css).toContain("--slime-drawn: 92px; --slime-unit: tan(atan2(var(--slime-size), var(--slime-drawn)));");
  // Everything worked out from the unit is a plain number; a registered length would be zoomed again where it is used.
  for (const name of ["--slime-face-scale", "--slime-face-dx", "--slime-face-dy", "--slime-eye-stroke"]) expect(css, name).toContain(`@property ${name} { syntax: "<number>";`);
  expect(css).not.toMatch(/@property --slime-(?:face|eye)[\w-]* \{ syntax: "<length>"/);
});

test("each state's eyes are the drawing's own path as well, the ones slime.css gives it (WebKit has no CSS d)", () => {
  // slime.css is the one source: a state's own --eyes, else the resting one. Every rule that names states agrees with it.
  const rules = [...css.matchAll(/(\.slime(?:\[data-state="[\w-]+"\]|:is\([^)]*\))?) \{([^}]*)\}/g)]
    .flatMap(([, selector, body]) => { const path = /--eyes: path\("([^"]+)"\)/.exec(body!)?.[1]; return path ? [{ selector: selector!, path }] : []; });
  const resting = rules.find(rule => rule.selector === ".slime")!.path;
  const own = (state: string): string => rules.find(rule => rule.selector === `.slime[data-state="${state}"]`)?.path ?? resting;
  const states: SlimeState[] = ["idle", "thinking", "working", "searching", "computer", "waiting", "blocked", "done", "error", "sleeping", "arriving"];
  for (const rule of rules) for (const [, state] of rule.selector.matchAll(/data-state="([\w-]+)"/g)) expect(rule.path, rule.selector).toBe(own(state!));
  expect(new Set(states.map(own)).size).toBe(8);
  const eyesOf = (html: string): { vector: string; cels: string[] } => {
    const host = document.createElement("div"); host.innerHTML = html;
    return { vector: host.querySelector(".slime-eyes")!.getAttribute("d")!, cels: [...new Set([...host.querySelectorAll(".slime-cel-eye")].map(cel => cel.getAttribute("d")!))] };
  };
  for (const state of states) {
    expect(eyePath(state), state).toBe(own(state));
    // Drawn moving: the vector, and every cel of a strip.
    const moving = eyesOf(slimeSVG({ color: "sky" }, { ...plain, state }));
    expect(moving.vector, state).toBe(own(state));
    expect(moving.cels, state).toEqual(loopState(state) ? [own(state)] : []);
  }
  // A picture keeps the pose of its state: asleep shows closed eyes.
  expect(eyesOf(slimeSVG({ color: "sky" }, { state: "sleeping" })).vector).toBe(own("sleeping"));
  expect(eyesOf(slimeSVG({ color: "sky" }, { state: "working" })).vector).toBe(resting);
  // A face on screen that takes another state takes its eyes at once, with no restyle: the large face is its vector.
  document.body.innerHTML = slimeFaceHTML({ id: 91 }, 96, "", true);
  const svg = document.querySelector<SVGElement>("svg.slime")!, eyes = svg.querySelector(".slime-eyes")!;
  const styled = vi.spyOn(window, "getComputedStyle");
  try {
    for (const state of ["working", "computer", "waiting", "blocked", "error", "thinking", "searching", "done", "sleeping", "arriving", "idle"] as SlimeState[]) {
      handOver(svg, state);
      expect([svg.dataset.state, eyes.getAttribute("d")], state).toEqual([state, own(state)]);
    }
    expect(styled).not.toHaveBeenCalled();
  } finally { styled.mockRestore(); }
});

/** An affine matrix as SVG writes it: [a, b, c, d, e, f]. */
type Affine = [number, number, number, number, number, number];
const times = (m: Affine, n: Affine): Affine => [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]];
const move = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
/** A transform attribute of translate, rotate and scale, as one matrix. */
function affine(text: string): Affine {
  let matrix: Affine = [1, 0, 0, 1, 0, 0];
  for (const [, kind, args] of text.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    const [a = 0, b] = args!.trim().split(/[\s,]+/).map(Number);
    const turn = a * Math.PI / 180;
    matrix = times(matrix, kind === "translate" ? move(a, b ?? 0) : kind === "scale" ? [a, 0, 0, b ?? a, 0, 0] : [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), 0, 0]);
  }
  return matrix;
}
const near = (a: Affine, b: Affine): boolean => a.every((value, index) => Math.abs(value - b[index]!) < 0.01);

test("a strip's eyes are placed by transform attributes and the separate translate and scale, which WebKit does not multiply by the page zoom", () => {
  // macOS: WebKit multiplied the lengths of the eye cels' CSS transforms by the window's zoom, while the body cels' transform
  // attributes kept the drawing's units. At 110 % the eyes of cel n stood n tenths of a cel off, so a working slime's eyes
  // slid out of its body and back in every loop.
  for (const state of ["thinking", "working", "searching", "computer", "waiting", "blocked", "error"] as const) {
    const host = document.createElement("div");
    host.innerHTML = slimeSVG({ character: "horn-lavender" }, { ...plain, state });
    expect(host.innerHTML, state).not.toMatch(/style="[^"]*transform:/);
    const strip = host.querySelector(".slime-loop-eyes")!, svg = strip.querySelector("svg")!;
    const frame = Number(svg.getAttribute("viewBox")!.split(" ")[2]) / celCount(state), blinks = strip.classList.contains("has-blink") ? 4 : 1;
    const poses = [...svg.children];
    expect(poses, state).toHaveLength(celCount(state));
    poses.forEach((pose, index) => {
      expect(pose.matches("g.slime-cel-pose"), state).toBe(true);
      expect(pose.getAttribute("transform")!.startsWith(`translate(${index * frame} 0) `), state).toBe(true);
      expect(pose.children, state).toHaveLength(gazeRows(state) * blinks);
      const group = affine(pose.getAttribute("transform")!);
      [...pose.children].forEach((path, row) => {
        expect(path.matches("path.slime-cel-eye[transform]"), state).toBe(true);
        // The row's drop down the strip, carried inside the pose, lands where the strip's own drop put it before.
        const style = (path as SVGElement).style;
        const drop = move(parseFloat(style.getPropertyValue("--cel-row-x")) || 0, parseFloat(style.getPropertyValue("--cel-row-y")) || 0);
        expect(near(times(group, drop), times(move(0, row * frame), group)), `${state} cel ${index} row ${row}`).toBe(true);
      });
    });
  }
});

test("a strip's eyes wear the vector's face, as a move and a scale, and no face or eye cel takes a CSS transform", () => {
  const host = document.createElement("div");
  host.innerHTML = slimeSVG({ color: "sky" }, { ...plain, state: "working" });
  const face = host.querySelector(".slime-face")!.getAttribute("transform")!;
  const [, scale, dx, dy] = /\.slime-loop-eyes \{ --slime-face-scale: ([\d.]+); --slime-face-dx: (-?[\d.]+); --slime-face-dy: (-?[\d.]+); \}/.exec(css)!.map(Number);
  expect(near(affine(face), [scale!, 0, 0, scale!, dx!, dy!])).toBe(true);
  // A small face moves the large face's middle to a whole pixel: the middle the vector scales about.
  const [middleX, middleY] = /^translate\(([\d.]+) ([\d.]+)\)/.exec(face)!.slice(1).map(Number);
  expect(css).toMatch(new RegExp(`--slime-face-dx: calc\\(4 \\+ round\\(calc\\(${middleX! - 4} \\* var\\(--slime-unit\\)\\), 1\\) / var\\(--slime-unit\\) - ${middleX} \\* var\\(--slime-face-scale\\)\\);`));
  expect(css).toMatch(new RegExp(`--slime-face-dy: calc\\(11 \\+ round\\(calc\\(${middleY! - 11} \\* var\\(--slime-unit\\)\\), 1\\) / var\\(--slime-unit\\) - ${middleY} \\* var\\(--slime-face-scale\\)\\);`));
  expect(css).toContain(".slime-cel-eye { translate: calc((var(--cel-row-x, 0) + var(--slime-face-dx)) * 1px) calc((var(--cel-row-y, 0) + var(--slime-face-dy)) * 1px); scale: var(--slime-face-scale); }");
  expect(css).toContain(".slime-face { transform: none; translate: calc(var(--slime-face-dx) * 1px) calc(var(--slime-face-dy) * 1px); scale: var(--slime-face-scale); }");
  for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/\.slime-(?:face|cel-eye)\b/.test(selector!)) expect(body, selector).not.toMatch(/(?:^|[;\s])transform:(?!\s*none\s*;)/);
  }
});

test("each moving state retains its body performance while idle and sleeping have no loop", () => {
  for (const state of ["thinking", "working", "searching", "computer", "waiting", "done", "error", "arriving"]) {
    expect(css, state).toContain(`.slime[data-state="${state}"] .slime-motion { animation: slime-${state}-`);
  }
  expect(css).not.toMatch(/(?:\.slime|\.slime-surface)\[data-state="(?:idle|sleeping)"\][^{]*\{[^}]*animation:/);
});

test.each([18, 22, 28, 40, 72, 96, 120])("sleeping at %ipx retains one still vector with closed eyes and no bubble", size => {
  const host = document.createElement("div");
  host.innerHTML = slimeFaceHTML({ id: 71, avatar: "slime:horn-lavender", last_at: Date.now() - 3 * 24 * 60 * 60 * 1000 }, size);
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
  const lavender = document.createElement("div"), sashed = document.createElement("div"), bare = document.createElement("div");
  lavender.innerHTML = slimeSVG({ character: "horn-lavender" }, plain);
  sashed.innerHTML = slimeSVG({ character: "horn-sash-blue" }, plain);
  bare.innerHTML = slimeSVG({ color: "sky" }, plain);
  const horn = lavender.querySelector<SVGElement>(".slime-mark")!;
  expect(horn.getAttribute("style")).toContain("--mark-x:49px;--mark-y:34px");
  expect(horn.innerHTML).toContain("#363140");
  expect(sashed.querySelector(".slime-mark")!.innerHTML).not.toContain("#F2F2F5");
  expect(sashed.innerHTML).toContain("#F2F2F5");
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
  host.innerHTML = slimeSVG({ character: "horn-lavender" }, plain);
  expect(host.querySelector("svg.slime")?.getAttribute("data-state")).toBe("idle");
  expect(host.querySelector(".slime-loop, .slime-idle")).toBeNull();
  expect(css).toContain(':is(.mb-row, .mb-avbtn, .mb-preset, .mb-av-slime):active .slime-surface:not([data-slime-still]) { scale: 1.12 0.84; transition: scale 90ms cubic-bezier(0.2, 0.8, 0.3, 1); }');
  expect(css).not.toMatch(/--slime-(?:touch|squish)/);
  expect(css).toContain("transition: scale 480ms");
});

test("every liquid state keeps the body, eyes and costume instead of substituting a symbol", () => {
  for (const state of ["thinking", "working", "blocked", "error", "sleeping", "done"] as SlimeState[]) {
    const drawing = document.createElement("div");
    drawing.innerHTML = slimeSVG({ character: "horn-lavender" }, { ...plain, state });
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
    host.innerHTML = slimeSVG({ character: "horn-lavender" }, { ...plain, state });
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
  document.body.innerHTML = slimeFaceHTML({ id: 81 }, 40, "", true) + slimeFaceHTML({ id: 81, avatar: "slime:horn-lavender" }, 40, "", true);
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
    // The vector's hold is made once, at the change of state: the strips joining it later neither restart nor extend it.
    expect(animated.mock.calls.filter(([frames]) => Array.isArray(frames) && frames[0]?.visibility === 'visible')).toHaveLength(3);
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

test("a heavy state's strips go in a slice a frame, out of sight, and show together, and a newer state drops the rest", () => {
  const frames: FrameRequestCallback[] = [];
  let time = 5000;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  document.body.innerHTML = slimeFaceHTML({ id: 95, avatar: "slime:horn-lavender" }, 40, "", true);
  const svg = document.querySelector<SVGElement>('svg.slime[data-slime-member="95"]')!;
  const surface = svg.parentElement!;
  const frame = (): void => { time += 16; frames.shift()!(time); };
  const nodes = (): number => surface.querySelectorAll('.slime-loop *').length;
  setSlimeState(95, 'thinking');
  frame();
  // The strips stand, empty and hidden, in the first frame; the vector stays on show.
  const loops = [...surface.querySelectorAll('.slime-loop')];
  expect(loops).toHaveLength(2);
  expect(loops.every(loop => loop.hasAttribute('data-slime-loading'))).toBe(true);
  let last = nodes();
  expect(last).toBeGreaterThan(0);
  let slices = 1;
  while (surface.querySelector('.slime-loop[data-slime-loading]')) {
    frame(); slices++;
    expect(nodes()).toBeGreaterThan(last);
    expect(nodes() - last).toBeLessThan(700);
    last = nodes();
    expect(slices).toBeLessThan(100);
  }
  // A thinking slime with a mark is thousands of nodes: more than a handful of frames, and then both strips show at once.
  expect(slices).toBeGreaterThan(5);
  expect(last).toBeGreaterThan(2000);
  expect(surface.querySelectorAll('.slime-loop[data-slime-loading]')).toHaveLength(0);
  expect([...surface.querySelectorAll('.slime-loop')]).toEqual(loops);
  // A state that comes while the strips are going in ends that mount: nothing of it is left, and nothing goes on in it.
  setSlimeState(95, 'searching');
  frame(); frame();
  const half = [...surface.querySelectorAll('.slime-loop')];
  expect(half.every(loop => loop.hasAttribute('data-slime-loading'))).toBe(true);
  setSlimeState(95, 'working');
  expect(surface.querySelectorAll('.slime-loop')).toHaveLength(0);
  frame();
  expect(half.every(loop => !loop.isConnected)).toBe(true);
  expect(half.some(loop => loop.querySelector('.slime-cel-body, .slime-cel-eye'))).toBe(true);
  expect(surface.querySelectorAll('.slime-loop-body')).toHaveLength(1);
  expect(surface.querySelector('.slime-loop[data-slime-loading]')).toBeNull();
  setSlimeState(95, 'idle');
});


// ---------- a slime moves in two places only ----------

test("a slime is a picture unless it moves: whatever its member does, it keeps its resting pose and no clock", () => {
  followSlimeRoster([{ id: 301, activity: "working" }]);
  const picture = slimeFaceHTML({ id: 301, avatar: "slime:horn-lavender" }, 40), moving = slimeFaceHTML({ id: 301, avatar: "slime:horn-lavender" }, 40, "", true);
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
  for (const member of [{ id: 0, name: "Raphael" }, { id: 303, name: "Ada", avatar: "slime:horn-sash-blue" }]) {
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

test("the core takes every slime the picker offers: its rule for a slime's name fits each character and each colour", () => {
  // Chosen in the picker, a slime is saved by the core, which checks its name by a rule of its own (members/store.py). The
  // rule took letters alone, so every slime with a hyphen in its name, the red oni and nearly all after it, was refused
  // when chosen. Read here, the rule is held to every name the app has.
  const store = readFileSync(resolve(__dirname, "../../../core/src/raphael_core/members/store.py"), "utf8");
  const name = /^_SLIME_NAME = r"([^"]+)"$/m.exec(store)?.[1];
  const avatar = /^_AVATAR = re\.compile\(rf"([^"]+)"\)$/m.exec(store)?.[1];
  expect(name, "the core's rule for a slime's name").toBeTruthy();
  expect(avatar, "the core's rule for an avatar").toBeTruthy();
  // The Python rule as JavaScript: an f-string's doubled braces are single ones, and its one variable is the name's rule.
  const rule = new RegExp(`^(?:${avatar!.replace(/\{\{/g, "{").replace(/\}\}/g, "}").split("{_SLIME_NAME}").join(name!)})$`);
  const offered = [...catalogButtons.map(button => pickSlime(button)!), ...Array.from({ length: 40 }, (_, id) => defaultSlimeAvatar(id))];
  expect(offered).toHaveLength(catalogIds.length + 40);
  expect(offered.filter(saved => !rule.test(saved))).toEqual([]);
  // The names that were refused are among them, and what is no slime's name is still refused.
  expect(offered).toContain("slime:oni-red");
  expect(offered.filter(saved => saved.includes("-")).length).toBeGreaterThan(30);
  for (const bad of ["slime:", "slime:-red", "slime:oni-", "slime:oni--red", "slime:Oni-Red", "slime:oni red", "slime:../x", "slime:a:b:c"]) expect(rule.test(bad), bad).toBe(false);
});

test("a face's eyes turn toward the pointer and never past their reach; a face whose button the pointer is on follows it across that button", () => {
  expect(gazeToward(0, 0, 40)).toEqual({ x: 0, y: 0 });
  expect(gazeToward(-1000, 0, 40)).toEqual({ x: -GAZE_REACH.x, y: 0 });
  const below = gazeToward(300, 400, 40);
  expect(below.x).toBeGreaterThan(0);
  expect(below.y).toBeGreaterThan(0);
  expect(Math.abs(below.x)).toBeLessThanOrEqual(GAZE_REACH.x);
  expect(Math.abs(below.y)).toBeLessThanOrEqual(GAZE_REACH.y);
  // Anywhere in the window: a pointer near the slime is met nearly eye to eye.
  expect(gazeToward(4, 0, 40).x).toBeLessThan(0.5);
  // On its own button: half a slime off its middle is already the full reach.
  expect(gazeToward(20, 0, 40, 0.5)).toEqual({ x: GAZE_REACH.x, y: 0 });
});

/** Moves the pointer onto `target` at (x, y), as a mouse does, and lets the frame that answers it run. */
function pointAt(target: Element, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, pointerType: "mouse", bubbles: true }));
  vi.advanceTimersToNextFrame();
}

test("a face in the member list looks at the pointer while the pointer is on its row, and is as before once it leaves the row", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  try {
    document.body.innerHTML = `<div class="mb-item"><button class="mb-row">${slimeSVG({ character: "horns-red" }, { now: plain.now })}<span class="mb-row-main">紅</span></button></div><p id="away">外面</p>`;
    const face = document.querySelector<HTMLElement>(".slime-surface")!;
    face.getBoundingClientRect = () => ({ left: 100, top: 100, width: 40, height: 40, right: 140, bottom: 140, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    // On the row's words, to the right of the slime: the face looks right.
    pointAt(document.querySelector(".mb-row-main")!, 300, 120);
    expect(face.hasAttribute("data-slime-gazing")).toBe(true);
    expect(parseFloat(face.style.getPropertyValue("--slime-gaze-x"))).toBe(GAZE_REACH.x);
    // Off the row: the face is as before (its glance aside, its look back under the row's own hover).
    pointAt(document.querySelector("#away")!, 300, 120);
    expect(face.hasAttribute("data-slime-gazing")).toBe(false);
    expect(face.style.getPropertyValue("--slime-gaze-x")).toBe("");
  } finally {
    vi.useRealTimers();
    document.body.innerHTML = "";
  }
  const css = readFileSync(resolve(__dirname, "slime.css"), "utf8");
  expect(css).toContain('.slime-surface[data-slime-gazing] .slime[data-state="idle"] .slime-follow { translate: var(--slime-gaze-x, 0px) var(--slime-gaze-y, 0px); }');
});

test("a picker's choice looks only while the pointer is on it, and a face anywhere else follows the pointer wherever it is", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  try {
    document.body.innerHTML = `<div class="mb-slime-characters">${slimeCharactersHTML(null, same, "", "red")}</div><div id="elsewhere">${slimeSVG({ character: "horns-red" }, { now: plain.now })}</div><p id="away">外面</p>`;
    const box = () => ({ left: 100, top: 100, width: 40, height: 40, right: 140, bottom: 140, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    for (const surface of document.querySelectorAll<HTMLElement>(".slime-surface")) surface.getBoundingClientRect = box;
    const choice = document.querySelector<HTMLElement>("[data-slime-character] .slime-surface")!;
    const elsewhere = document.querySelector<HTMLElement>("#elsewhere .slime-surface")!;
    pointAt(document.querySelector("#away")!, 120, 700);
    expect(choice.hasAttribute("data-slime-gazing")).toBe(false);
    expect(elsewhere.hasAttribute("data-slime-gazing")).toBe(true);
    expect(parseFloat(elsewhere.style.getPropertyValue("--slime-gaze-y"))).toBeGreaterThan(0);
    pointAt(choice.querySelector("svg")!, 104, 120);
    expect(choice.hasAttribute("data-slime-gazing")).toBe(true);
    expect(parseFloat(choice.style.getPropertyValue("--slime-gaze-x"))).toBeLessThan(0);
    document.dispatchEvent(new PointerEvent("pointerout", { relatedTarget: null }));
    vi.advanceTimersToNextFrame();
    expect(document.querySelectorAll("[data-slime-gazing]")).toHaveLength(0);
  } finally {
    vi.useRealTimers();
    document.body.innerHTML = "";
  }
});

test("a dark slime carries the mark of the light rim the dark theme draws round it; a bright one does not", () => {
  expect(isDark("#2A3046")).toBe(true);
  expect(isDark("#3DB5FF")).toBe(false);
  expect(slimeSVG({ character: "penguin" }, { now: plain.now })).toContain("data-slime-dark");
  expect(slimeSVG({ character: "blue-plain" }, { now: plain.now })).not.toContain("data-slime-dark");
  expect(css).toMatch(/:root\[data-theme="dark"\] \.slime-rim \{ display: inline; \}/);
  // The rim is the whole outline: the silhouette carries the hair behind (a ponytail) as well as the body.
  expect(slimeSVG({ character: "penguin" }, { now: plain.now })).toMatch(/<g class="slime-rim">[\s\S]*M 37 31 Q 30 17[\s\S]*<\/g>/);
  expect(slimeSVG({ character: "blue-plain" }, { now: plain.now })).not.toContain("slime-rim");
});

test("a bright slime that wears something dark gets the rim round what it wears, not round its body", () => {
  const red = slimeSVG({ character: "horns-red" }, { now: plain.now });
  const rim = red.match(/<g class="slime-rim">([\s\S]*?)<\/g><\/g><\/g><path|<g class="slime-rim">[\s\S]*?(?=<path d="M 8 70)/)?.[0] ?? "";
  expect(red).toContain('<g class="slime-rim">');
  // The dark horns are in the rim; the body outline is not, so the red dome keeps no line of its own.
  expect(red.slice(red.indexOf('<g class="slime-rim">'), red.indexOf('class="slime-body"'))).toContain("#2B2430");
  expect(rim).not.toContain("M 8 70 C 8 51");
  expect(slimeSVG({ character: "small-horns-pink" }, { now: plain.now })).not.toContain("slime-rim");
});
