/**
 * The members' mascots: one low dome with two white eyes, drawn in code. A character is that same slime in a colour
 * of its own with one or two marks of who it is, so Shion is lavender with a horn and nothing more. What it is doing
 * is data too: all motion is CSS keyed on `data-state` (slime.css), and nothing runs per frame: script only says when
 * a state changes and where the slime stood at that moment.
 * Raphael keeps his own emblem and never comes here (members.ts `faceHTML`).
 * A member's `avatar` is `slime:<character>` or `slime:color:<color>`; one without a picture gets a colour from its id.
 */
import "./slime.css";
import { t } from "./i18n";

export type SlimeState = "idle" | "thinking" | "working" | "searching" | "computer" | "waiting" | "blocked" | "done" | "error" | "sleeping" | "arriving";
type Hat = "witch" | "santa";

const COLORS = {
  sky: "#2A83D5", lavender: "#9270CB", coral: "#D4556D", tangerine: "#B96A27", ochre: "#A17B13",
  leaf: "#4C8A43", teal: "#15897E", ocean: "#4167BB", orchid: "#B25C9B", charcoal: "#5A5E6B",
} as const;
export type SlimeColor = keyof typeof COLORS;

const BODY = "M 8 70 C 8 51 24 28 48 28 C 73 27 91 49 92 69 C 94 81 77 86 50 86 C 24 86 7 82 8 70 Z";

const fill = (path: string, color: string): string => `<path d="${path}" fill="${color}"/>`;
const correction = (drawing: string, x = 50, y = 86): string => `<g class="slime-correction" style="--slime-origin-x:${x}px;--slime-origin-y:${y}px"><g class="slime-counterturn">${drawing}</g></g>`;

/** A mark that hangs off the body follows it a moment late, about the point it is fixed at; `give` is how far it swings. Printed marks stay on the skin. */
const loose = (marks: string, x: number, y: number, give = 1): string =>
  correction(`<g class="slime-mark" style="--mark-x:${x}px;--mark-y:${y}px;--mark-give:${give}">${marks}</g>`, x, y);

// The marks several characters share.
const ONE_HORN = "M 44 34 C 45 25 49 16 53 12 L 54 33 Q 50 37 44 34 Z";
const TWO_HORNS = "M 32 36 C 30 28 30 20 34 14 C 37 20 40 27 41 33 Q 36 33 32 36 Z M 68 36 C 70 28 70 20 66 14 C 63 20 60 27 59 33 Q 64 33 68 36 Z";
const SMALL_HORNS = "M 35 34 C 34 28 35 23 38 19 C 40 23 42 27 42 31 Q 38 31 35 34 Z M 65 34 C 66 28 65 23 62 19 C 60 23 58 27 58 31 Q 62 31 65 34 Z";
const BOW = "M 50 72 L 38 66 V 78 Z M 50 72 L 62 66 V 78 Z";
const COLLAR = "M 31 64 L 50 75 L 69 64 L 62 83 L 38 83 Z";
const SASH = "M 11 68 Q 50 82 89 68 L 91 75 Q 50 91 9 75 Z";

/** Each character: its colour, and the marks on the same body. A mark is never hair unless it is all there is to tell them by. */
const CHARACTERS = {
  rimuru: { name: "slime.rimuru", color: "#5AB4E8" },
  shion: { name: "slime.shion", color: COLORS.lavender, marks: loose(fill(ONE_HORN, "#363140"), 49, 34) },
  diablo: { name: "slime.diablo", color: COLORS.charcoal,
    marks: `<path d="${COLLAR} M 48 73 L 52 73 L 53 77 L 51 83 L 49 83 L 47 77 Z" fill="#FFF6E9" fill-rule="evenodd"/>` +
      fill("M 60 31 L 64 32 L 69 42 L 65 40 Z", "#EE5A64") + fill("M 67 34 L 71 36 L 75 45 L 71 43 Z", "#F5CE55"),
  },
  benimaru: { name: "slime.benimaru", color: "#C8413F", marks: loose(fill(TWO_HORNS, "#2B2430"), 50, 34, 0.4) },
  shuna: { name: "slime.shuna", color: "#E58CB4", marks: loose(fill(SMALL_HORNS, "#FBEFE3"), 50, 33, 0.4) },
  souei: { name: "slime.souei", color: "#2F4A80", marks: loose(fill(ONE_HORN, "#1B2238"), 49, 34) + fill(SASH, "#F2F2F5") },
  hakurou: { name: "slime.hakurou", color: "#8E949C", marks: loose(fill("M 50 66 C 44 63 35 64 29 72 C 37 73 45 72 50 69 Z M 50 66 C 56 63 65 64 71 72 C 63 73 55 72 50 69 Z", "#FFFFFF"), 50, 67, 0.7) },
  gobta: { name: "slime.gobta", color: "#6BAA4C",
    marks: fill("M 28 37 Q 50 26 72 37 L 72 40 Q 50 30 28 40 Z", "#3A3A44") +
      `<circle cx="39" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/><circle cx="61" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/>`,
  },
  rigur: { name: "slime.rigur", color: COLORS.leaf, marks: fill("M 22 42 C 30 27 68 25 78 42 Q 50 31 22 42 Z", "#A8342F") },
  rigurd: { name: "slime.rigurd", color: "#3D7440", marks: loose(fill(BOW, "#1E1E24") + `<circle cx="50" cy="72" r="3" fill="#D6A14A"/>`, 50, 72, 0.8) },
  milim: { name: "slime.milim", color: "#F07F9C", marks: loose(`<path d="M 50 30 C 47 21 53 13 61 15 C 55 17 52 23 54 30 Z" fill="var(--slime-color)"/>`, 52, 30) },
  veldora: { name: "slime.veldora", color: "#2C4A8C", marks: loose(fill(TWO_HORNS, "#C9D2E3"), 50, 34, 0.4) },
  ranga: { name: "slime.ranga", color: "#56607A",
    back: loose(`<path d="M 19 42 Q 15 25 20 14 Q 32 19 38 32 Z M 62 32 Q 69 19 80 14 Q 85 26 81 42 Z" fill="var(--slime-color)"/>`, 50, 38, 0.3),
    marks: fill("M 50 30 L 52 35 L 57 35 L 53 38 L 55 43 L 50 40 L 45 43 L 47 38 L 43 35 L 48 35 Z", "#F2C14E"),
  },
  gabiru: { name: "slime.gabiru", color: "#6E6A93", marks: fill("M 18 78 Q 24 70 30 78 Q 36 70 42 78 Q 48 70 54 78 Q 60 70 66 78 Q 72 70 78 78 L 76 84 Q 50 90 22 84 Z", "#F2EBDD") },
  geld: { name: "slime.geld", color: "#A57C4E", marks: fill("M 35 80 C 33 73 34 68 38 64 C 40 69 42 74 43 81 Z M 65 80 C 67 73 66 68 62 64 C 60 69 58 74 57 81 Z", "#FBF3DC") },
  treyni: { name: "slime.treyni", color: "#3FA287",
    marks: loose(fill("M 48 32 L 48 19 Q 49 17 51 19 L 52 32 Z", "#2E7D4F") + fill("M 50 24 C 35 25 29 18 29 12 C 41 10 49 14 50 24 Z M 50 24 C 51 11 61 8 71 10 C 70 20 61 25 50 24 Z", "#8FD18A"), 50, 30),
  },
  kurobe: { name: "slime.kurobe", color: "#6A5A4A", marks: fill("M 23 39 Q 50 26 77 39 L 80 45 Q 50 31 20 45 Z", "#EFEFEF") },
  shizu: { name: "slime.shizu", color: "#5C6B8E", marks: `<ellipse cx="50" cy="35" rx="15" ry="6" fill="#F4F4F7"/>` + `<path d="M 39 35 Q 44 31 50 35 T 61 35" fill="none" stroke="#C94250" stroke-width="2.5" stroke-linecap="round"/>` },
  hinata: { name: "slime.hinata", color: "#454A66", marks: fill(COLLAR, "#F4F4F7") + fill("M 48 72 H 52 V 84 H 48 Z", "#D6A14A") },
  guy: { name: "slime.guy", color: "#A8283B", marks: fill(SASH, "#2A1A1E") },
  testarossa: { name: "slime.testarossa", color: "#D5D9D6", marks: loose(fill(BOW, "#3FBF94") + `<circle cx="50" cy="72" r="3" fill="#FFFFFF"/>`, 50, 72, 0.8) },
  ultima: { name: "slime.ultima", color: "#A86FB8", marks: loose(fill(BOW, "#2A1A2E"), 50, 72, 0.8) },
  carrera: { name: "slime.carrera", color: "#C9A227", marks: loose(fill("M 50 66 L 45 71 L 48 85 H 52 L 55 71 Z", "#B3262E"), 50, 66, 0.7) },
  ramiris: { name: "slime.ramiris", color: "#E0B23C", back: loose(`<path d="M 16 54 C 2 48 -2 28 6 16 C 16 20 24 34 27 44 Z M 84 54 C 98 48 102 28 94 16 C 84 20 76 34 73 44 Z" fill="#F6C7DC"/>`, 50, 44, 0.3) },
} as const satisfies Record<string, { name: string; color: string; back?: string; marks?: string }>;
export type SlimeCharacter = keyof typeof CHARACTERS;

const CHARACTER_IDS = Object.keys(CHARACTERS) as SlimeCharacter[];
const COLOR_IDS = Object.keys(COLORS) as SlimeColor[];
const isCharacter = (id: string): id is SlimeCharacter => id in CHARACTERS;
const isColor = (id: string): id is SlimeColor => id in COLORS;

/** The colours a member with no choice of its own is given. */
const DEFAULT_COLORS = COLOR_IDS.filter(color => color !== "charcoal");

/** What earlier builds stored: colours of the first set, and costumes since made characters or gone. */
const OLD_COLORS: Record<string, SlimeColor> = { azure: "sky", mint: "teal", sunny: "ochre", coral: "coral", rose: "orchid", lilac: "lavender", slate: "charcoal", fox: "tangerine", sprout: "leaf", crown: "ochre" };
const OLD_CHARACTERS: Record<string, SlimeCharacter> = { oni: "shion", demon: "diablo" };

/** Who a slime is: a character, or a plain slime of a colour. */
export type Slime = { character: SlimeCharacter } | { color: SlimeColor };

export function parseSlime(avatar: string | null | undefined): Slime | null {
  if (!avatar?.startsWith("slime:")) return null;
  const [first = "", second] = avatar.slice(6).split(":");
  const character = OLD_CHARACTERS[first] ?? first;
  if (isCharacter(character)) return { character };
  // `<shape>:<color>` was the build before characters: the colour survives the shape.
  if (second !== undefined) return isColor(second) ? { color: second } : null;
  return first in OLD_COLORS ? { color: OLD_COLORS[first]! } : null;
}

export const isSlimeAvatar = (avatar: string | null | undefined): boolean => parseSlime(avatar) !== null;
const defaultColor = (id: number): SlimeColor => DEFAULT_COLORS[Math.abs(id) % DEFAULT_COLORS.length]!;
/** What a member without a choice of its own shows, which the picture menu starts from. */
export const defaultSlimeAvatar = (id: number): string => `slime:color:${defaultColor(id)}`;
/** The colour of a member's slime, for what stands for that member elsewhere: its chips on the calendar. */
export function slimeColorOf(member: { id: number; avatar?: string | null }): string {
  const slime = parseSlime(member.avatar) ?? { color: defaultColor(member.id) };
  return "character" in slime ? CHARACTERS[slime.character].color : COLORS[slime.color];
}

/** The hat of the season, on a plain slime: a character is recognised by its head. */
export function seasonalHat(now: Date = new Date()): Hat | null {
  const month = now.getMonth() + 1, day = now.getDate();
  if ((month === 10 && day >= 24) || (month === 11 && day === 1)) return "witch";
  if (month === 12 && day >= 18 && day <= 26) return "santa";
  return null;
}

const HATS: Record<Hat, string> = {
  witch: fill("M 31 30 L 47 4 Q 54 2 64 10 L 56 11 L 69 30 C 84 30 88 35 80 38 Q 50 43 20 38 C 12 35 17 31 31 30 Z", "#554177") + fill("M 34 25 Q 50 29 65 25 L 69 30 Q 50 34 31 30 Z", "#D6A14A"),
  santa: fill("M 27 32 C 31 15 42 7 53 9 C 66 10 69 20 78 23 L 76 30 Q 64 29 56 22 L 66 34 Z", "#C94250") +
    fill("M 25 30 Q 47 26 67 31 Q 71 35 67 39 Q 47 35 25 39 Q 21 35 25 30 Z M 84 27 A 6 6 0 1 1 72 27 A 6 6 0 1 1 84 27 Z", "#FFF5E7"),
};

// The eyes at rest, one path; slime.css bends it into every other state.
const EYES = "M 42.5 44.5 Q 43 48 43.5 51.5 M 55.5 44.5 Q 56 48 56.5 51.5";

// The eyes carry the character at 40 px, so they are drawn larger than the sheets, about their own middle; a hat clears them.
const FACE_SCALE = "translate(49.5 48) scale(1.25) translate(-49.5 -48)";

const IDLE_BODY = [[1, 1, 0], [0.995, 1.01, 0], [0.99, 1.02, 0], [0.985, 1.028, 0], [1, 1, 0.04], [1, 1, -0.025], [1, 1, 0.01]] as const;
const IDLE_EYES = [[3, -3, 1], [0, 0, 0.55], [0, 0, 0.3], [-3, 0, 1], [3, -1, 1], [0, -3, 1], [0, 0, 1.06]] as const;

// Three whole boxes leave room for every pose and keep the raster bounds on physical pixels, including odd avatar sizes.
const IDLE_FRAME = 276;
const idleStrip = (kind: string, cells: string): string => `<span class="slime-idle slime-idle-${kind}"><span class="slime-cels"><svg width="1932" height="276" viewBox="-88 -81 1932 276">${cells}</svg></span></span>`;
/** The strip paints over the drawing, so what is worn on the body has to be in every pose of it. */
const idleBodyStrip = (back = "", worn = ""): string => idleStrip("body", IDLE_BODY.map(([sx, sy, lean], index) => {
  const pose = `matrix(${sx},0,${lean},${sy},0,0)`;
  return `<g transform="translate(${index * IDLE_FRAME} 0)">${back}<g data-idle-pose="${pose}" transform="translate(50 86) ${pose} translate(-50 -86)"><path class="slime-cel-body" d="${BODY}" fill="var(--slime-color)"/>${worn}</g></g>`;
}).join(""));
const IDLE_EYE_STRIP = idleStrip("eyes", IDLE_EYES.map(([x, y, sy], index) => {
  const pose = `translate(${x}px,${y}px) scale(1,${sy})`;
  return `<g transform="translate(${index * IDLE_FRAME} 0)"><g class="slime-face" transform="${FACE_SCALE}"><g data-idle-pose="${pose}" transform="translate(${x} ${y}) translate(50 50) scale(1 ${sy}) translate(-50 -50)"><path class="slime-cel-eye" d="${EYES}" fill="none" stroke="#fff" stroke-linecap="round"/></g></g></g>`;
}).join(""));
const HAT_LIFT = -4;

const DROP = "M 0 -7 C -3 -3 -5 -1 -5 2 C -5 9 5 9 5 2 C 5 -1 3 -3 0 -7 Z";
const DROPLETS = `<g fill="var(--slime-color)">${["thought", "left", "right", "sweat", "drip"].map(kind => `<path class="slime-drop slime-${kind}" d="${DROP}"/>`).join("")}</g><circle class="slime-bubble" cx="0" cy="0" r="5.5" fill="var(--slime-color)"/>`;

export interface SlimeDrawing { now?: Date; state?: SlimeState; delay?: number; tempo?: number; since?: number; member?: number }

/** The shared vector surface; `slimeFaceHTML` supplies the member's fixed avatar box. */
export function slimeSVG(slime: Slime, { now = new Date(), state = "idle", delay = 0, tempo = 1, since, member }: SlimeDrawing = {}): string {
  hearThePointer();
  const look: { color: string; back?: string; marks?: string } = "character" in slime ? CHARACTERS[slime.character] : { color: COLORS[slime.color] };
  const hat = "character" in slime ? null : seasonalHat(now);
  const worn = (look.marks ?? "") + (hat ? loose(`<g transform="translate(0 ${HAT_LIFT})">${HATS[hat]}</g>`, 50, 30, 0.6) : "");
  const idleBody = idleBodyStrip(look.back, worn);
  return `<span class="slime-surface" data-state="${state}" aria-hidden="true" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo}">${idleBody}<svg class="slime" viewBox="4 11 92 92" data-state="${state}"${member === undefined ? "" : ` data-slime-member="${member}"`} aria-hidden="true" focusable="false" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo}${since === undefined ? "" : `;--slime-since:${since}ms`}">` +
    `<g class="slime-press"><g class="slime-settle"><g class="slime-counterturn"><g class="slime-motion">` +
    (look.back ? `<g class="slime-back">${look.back}</g>` : "") + correction(`<path d="${BODY}" fill="var(--slime-color)" class="slime-body"/>`) + `<g class="slime-marks">${worn}</g>` +
    `<g class="slime-face" transform="${FACE_SCALE}"><g class="slime-look"><g class="slime-counterturn"><g class="slime-gaze" fill="none" stroke="#fff" stroke-linecap="round"><path class="slime-eyes" d="${EYES}"/></g></g></g></g>` +
    `</g></g></g></g>${DROPLETS}</svg>${IDLE_EYE_STRIP}</span>`;
}

// ---------- under the pointer ----------

let hearing = false;

/** A slime under the pointer wiggles, and finishes after the pointer has gone, so that a sweep down the list runs through it like a wave. */
function hearThePointer(): void {
  if (hearing || typeof document === "undefined") return;
  hearing = true;
  document.addEventListener("pointerover", event => {
    const target = event.target as Element;
    const host = target.closest?.(".mb-row, .mb-avbtn, .mb-preset") ?? target.closest?.(".mb-av-slime");
    if (!host || host.contains(event.relatedTarget as Node | null)) return;
    for (const svg of host.querySelectorAll("svg.slime")) svg.classList.add("is-delighted");
  });
  document.addEventListener("animationend", event => {
    if (event.animationName === "slime-delight") (event.target as Element).closest(".slime-surface")?.querySelector("svg.slime")?.classList.remove("is-delighted");
  });
}

const settling = new WeakMap<SVGElement, EventListener>();

// ---------- what each member is doing ----------

const activity = new Map<number, SlimeState>();
const labels = new Map<number, string>();
const resting = new Map<number, SlimeState>();
const fleeting = new Map<number, ReturnType<typeof setTimeout>>();
/** When each member's state began, so that a redraw in the middle of a moment carries on instead of starting it again. */
const began = new Map<number, number>();

/** Long enough without a word and it dozes off. */
const SLEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const FLEETING_MS: Partial<Record<SlimeState, number>> = { done: 2000, arriving: 1200 };

/** The states the core tells (`member.activity`). */
const LIVE_STATES: readonly string[] = ["thinking", "working", "searching", "computer", "waiting", "blocked", "done", "error"];

interface SlimeFacts { id: number; waiting?: boolean; last_at?: number | null }

/** What a member's own row says, for when it is doing nothing: an answer it waits for, or sleep after a long silence. */
function restingState(member: SlimeFacts, now: number): SlimeState {
  if (member.waiting) return "blocked";
  const last = member.last_at ?? NaN;
  return Number.isFinite(last) && now - last > SLEEP_AFTER_MS ? "sleeping" : "idle";
}

type PoseProperty = "translate" | "rotate" | "scale" | "transform";
const WHOLE_POSE: readonly PoseProperty[] = ["translate", "rotate", "scale", "transform"];

/** Where a part stands right now, whichever of its properties have put it there. */
function poseOf(part: Element, properties: readonly PoseProperty[] = WHOLE_POSE): DOMMatrix {
  const style = getComputedStyle(part);
  return new DOMMatrix(properties.map(name => {
    const value = style[name];
    return !value || value === "none" ? "" : name === "transform" ? value : `${name}(${value.split(" ").join(",")}) `;
  }).join(""));
}

function idlePose(svg: SVGElement, kind: string): DOMMatrix {
  const surface = svg.parentElement!;
  const strip = surface.querySelector(`.slime-idle-${kind} .slime-cels`)!;
  if (getComputedStyle(strip.parentElement!).display === "none") return new DOMMatrix();
  const frame = Math.round(-poseOf(strip).e / (surface.clientWidth * 3));
  const cell = strip.querySelectorAll<SVGElement>("[data-idle-pose]")[frame];
  return new DOMMatrix(cell?.dataset.idlePose);
}

/** Starts a part from a pose; its transition in slime.css brings it home. */
function startFrom(part: SVGElement, pose: DOMMatrix): void {
  const previous = settling.get(part);
  if (previous) part.removeEventListener("transitionend", previous);
  settling.delete(part);
  if (pose.isIdentity) { part.classList.remove("slime-in-between"); return; }
  // Two rotations around a signed scale preserve shear too, without a cached CSS matrix raster.
  const e = (pose.a + pose.d) / 2, f = (pose.a - pose.d) / 2, g = (pose.b + pose.c) / 2, h = (pose.b - pose.c) / 2;
  const q = Math.hypot(e, h), r = Math.hypot(f, g), first = Math.atan2(g, f), second = Math.atan2(h, e);
  const values = { "--slime-dx": `${pose.e}px`, "--slime-dy": `${pose.f}px`, "--slime-angle": `${(first + second) / 2}rad`, "--slime-wide": String(q + r), "--slime-high": String(q - r) };
  const counter = part.firstElementChild as SVGElement;
  part.classList.add("slime-in-between");
  part.style.transition = counter.style.transition = "none";
  for (const [name, value] of Object.entries(values)) part.style.setProperty(name, value);
  counter.style.setProperty("--slime-counterangle", `${(second - first) / 2}rad`);
  void getComputedStyle(part).translate;
  void getComputedStyle(counter).rotate;
  part.style.transition = counter.style.transition = "";
  for (const name of Object.keys(values)) part.style.removeProperty(name);
  counter.style.removeProperty("--slime-counterangle");
  const finished: EventListener = event => {
    if (event.target !== part || !((event as TransitionEvent).propertyName in values)) return;
    part.classList.remove("slime-in-between");
    part.removeEventListener("transitionend", finished);
    settling.delete(part);
  };
  part.addEventListener("transitionend", finished);
  settling.set(part, finished);
}

/** A new state takes over from where the slime stands, however far through the old one it was, so nothing jumps. */
export function handOver(svg: SVGElement, state: SlimeState): void {
  if (svg.dataset.state === state) return;
  const one = (selector: string): SVGElement => svg.querySelector<SVGElement>(selector)!;
  const settle = one(".slime-settle"), motion = one(".slime-motion"), look = one(".slime-look"), gaze = one(".slime-gaze");
  const own = [...svg.querySelectorAll<SVGElement>(".slime-body, .slime-mark")];
  const bridge = (part: SVGElement): SVGElement => part.closest<SVGElement>(".slime-correction")!;
  const bridged = (part: SVGElement): DOMMatrix => poseOf(part).multiply(poseOf(part.firstElementChild!));
  const loop: readonly PoseProperty[] = ["translate", "rotate", "scale"];
  const wasIdle = svg.dataset.state === "idle";
  const body = bridged(settle).multiply(poseOf(motion)), eyes = bridged(look).multiply(poseOf(gaze, loop)).multiply(wasIdle ? idlePose(svg, "eyes") : new DOMMatrix());
  const each = own.map(part => bridged(bridge(part)).multiply(poseOf(part)).multiply(wasIdle && part.classList.contains("slime-body") ? idlePose(svg, "body") : new DOMMatrix()));
  svg.dataset.state = svg.dataset.moved = state;
  svg.parentElement!.dataset.state = state;
  svg.style.setProperty("--slime-since", "0ms");
  startFrom(settle, body.multiply(poseOf(motion).inverse()));
  startFrom(look, eyes.multiply(poseOf(gaze, loop).inverse()));
  own.forEach((part, index) => startFrom(bridge(part), each[index]!.multiply(poseOf(part, loop).inverse())));
}

export function presenceAttrs(id: number): string {
  const label = labels.get(id) ?? "";
  return ` data-presence-member="${id}"${label ? ` data-tooltip="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"` : ""}`;
}

const paint = (id: number, state: SlimeState): void => {
  for (const svg of document.querySelectorAll<SVGElement>(`svg.slime[data-slime-member="${id}"]`)) handOver(svg, state);
};

/** The list the core just read says what each member is doing, for a window that opened late. A moment plays out first. */
export function followSlimeRoster(members: readonly { id: number; activity?: string; activity_label?: string }[]): void {
  for (const { id, activity: state, activity_label: label } of members) {
    if (label !== undefined) labels.set(id, label);
    if (fleeting.has(id)) continue;
    if (state && LIVE_STATES.includes(state)) {
      if (activity.get(id) !== state) began.set(id, performance.now());
      activity.set(id, state as SlimeState);
    } else activity.delete(id);
  }
}

/** What the core says a member is doing; `idle` hands it back to what its row says. A moment like `done` passes by itself. */
export function setSlimeState(id: number, state: SlimeState, label?: string): void {
  if (label !== undefined) {
    labels.set(id, label);
    for (const face of document.querySelectorAll<HTMLElement>(`[data-presence-member="${id}"]`)) {
      if (label) { if (face.dataset.tooltip !== label) face.dataset.tooltip = label; }
      else face.removeAttribute("data-tooltip");
    }
  }
  if (activity.get(id) === state) return;
  // The core says `idle` right after `done`: the moment plays out, and then the row has its say anyway.
  if (state === "idle" && fleeting.has(id)) return;
  const was = fleeting.get(id);
  if (was !== undefined) { clearTimeout(was); fleeting.delete(id); }
  began.set(id, performance.now());
  if (state === "idle") activity.delete(id); else activity.set(id, state);
  paint(id, state === "idle" ? resting.get(id) ?? "idle" : state);
  const lasts = FLEETING_MS[state];
  if (lasts === undefined) return;
  fleeting.set(id, setTimeout(() => {
    fleeting.delete(id);
    activity.delete(id);
    paint(id, resting.get(id) ?? "idle");
  }, lasts));
}

/** A small stable spread that follows the clock, so a list does not move in step and a redraw does not make it jump. */
const delayOf = (seed: number, now: number): number => -Math.round(now + (Math.abs(seed) % 7) * 777);
/** Each member keeps its own pace, a few hundredths either way, so that a list never falls into step for long. */
const tempoOf = (seed: number): number => Number((0.94 + (Math.abs(seed * 37) % 13) * 0.01).toFixed(2));

/** The slime a member shows: its own choice, or a colour from its id. */
export function slimeFaceHTML(member: SlimeFacts & { avatar?: string | null }, size: number, cls = ""): string {
  const slime = parseSlime(member.avatar) ?? { color: defaultColor(member.id) };
  const rest = restingState(member, Date.now());
  resting.set(member.id, rest);
  const state = member.waiting ? "blocked" : activity.get(member.id) ?? rest, now = performance.now(), start = began.get(member.id);
  const label = labels.get(member.id) ?? "";
  return `<span class="av mb-av mb-av-slime${cls ? ` ${cls}` : ""}" data-presence-member="${member.id}"${label ? ` data-tooltip="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"` : ""} style="--av:${Math.round(size)}px" aria-hidden="true">` +
    slimeSVG(slime, { state, member: member.id, delay: delayOf(member.id, now), tempo: tempoOf(member.id), since: start === undefined ? undefined : -Math.round(now - start) }) + `</span>`;
}

// ---------- the picture menu ----------

/** Bareheaded in any season, so that a slime shows what it is. */
const OFF_SEASON = new Date(2000, 5, 1);

export const SLIME_CHARACTER_COUNT = CHARACTER_IDS.length;
export const SLIME_COLOR_COUNT = COLOR_IDS.length;

const IN_MENU = ' role="menuitem" tabindex="-1"';

/** Every character, each as a button; `item` makes them a menu's items. */
export function slimeCharactersHTML(avatar: string | null | undefined, esc: (text: string) => string, item = ""): string {
  const current = parseSlime(avatar), who = current && "character" in current ? current.character : null;
  return CHARACTER_IDS.map(id => {
    const name = esc(t(CHARACTERS[id].name));
    return `<button type="button"${item} class="mb-preset mb-preset-slime" data-slime-character="${id}" aria-pressed="${id === who}" aria-label="${name}" title="${name}">${slimeSVG({ character: id }, { now: OFF_SEASON })}</button>`;
  }).join("");
}

/** Every colour of a plain slime, each as a button. */
export function slimeColorsHTML(avatar: string | null | undefined, esc: (text: string) => string, item = ""): string {
  const current = parseSlime(avatar), color = current && "color" in current ? current.color : null;
  return COLOR_IDS.map((id, index) =>
    `<button type="button"${item} class="mb-slime-color" data-slime-color="${id}" aria-pressed="${id === color}" aria-label="${esc(t("members.slimeColor", { p0: index + 1 }))}" style="--slime-color:${COLORS[id]}"></button>`).join("");
}

/** The slimes of the picture menu: who, then a plain slime of a colour. */
export function slimePickerHTML(avatar: string | null | undefined, esc: (text: string) => string): string {
  return `<div class="mb-presets mb-slime-characters" role="group">${slimeCharactersHTML(avatar, esc, IN_MENU)}</div>` +
    `<div class="mb-slime-colors" role="group">${slimeColorsHTML(avatar, esc, IN_MENU)}</div>`;
}

/** A press in that menu: the avatar it makes, with the menu showing it where it stands, or null when the press was on neither. */
export function pickSlime(button: HTMLElement): string | null {
  const { slimeCharacter, slimeColor } = button.dataset;
  if (!slimeCharacter && !slimeColor) return null;
  const menu = button.closest(".menu") ?? document;
  for (const other of menu.querySelectorAll<HTMLElement>("[data-slime-character], [data-slime-color]")) other.setAttribute("aria-pressed", String(other === button));
  return slimeCharacter ? `slime:${slimeCharacter}` : `slime:color:${slimeColor}`;
}
