/**
 * The members' mascots: a flat slime with two white eyes, drawn in code, so shape, colour, season and
 * what it is doing are data. All motion is CSS keyed on `data-state` (slime.css); nothing runs per frame.
 * Raphael keeps his own emblem and never comes here (members.ts `faceHTML`).
 * A member's `avatar` is `slime:<shape>:<color>`; a member without a picture gets a colour from its id.
 */
import "./slime.css";

export type SlimeState = "idle" | "thinking" | "working" | "searching" | "computer" | "waiting" | "done" | "error" | "sleeping" | "arriving";
type Body = "dome" | "drop" | "puddle" | "twin" | "jelly";
type Costume = "oni" | "demon" | "fox" | "sprout" | "crown";
type Hat = "witch" | "santa";
export type SlimeShape = Body | Costume;

const COLORS = {
  sky: "#2A83D5", lavender: "#9270CB", coral: "#D4556D", tangerine: "#B96A27", ochre: "#A17B13",
  leaf: "#4C8A43", teal: "#15897E", ocean: "#4167BB", orchid: "#B25C9B", charcoal: "#5A5E6B",
} as const;
export type SlimeColor = keyof typeof COLORS;

const DOME = "M 8 70 C 8 51 24 28 48 28 C 73 27 91 49 92 69 C 94 81 77 86 50 86 C 24 86 7 82 8 70 Z";

/** Each body, where its face sits and how far its top is from the dome's, which is where a hat goes. */
const BODIES: Record<Body, { path: string; face: readonly [number, number]; top: number }> = {
  dome: { path: DOME, face: [0, 0], top: 0 },
  drop: { path: "M 49 14 C 56 11 60 24 71 34 C 84 47 89 60 85 72 C 82 82 68 86 50 86 C 31 86 18 81 16 70 C 13 54 29 40 37 29 C 43 21 44 16 49 14 Z", face: [0, -5], top: -14 },
  puddle: { path: "M 5 75 C 6 63 18 59 27 57 C 30 47 41 43 52 46 C 63 43 75 49 79 58 C 91 59 96 66 95 75 C 94 84 74 87 49 86 C 24 88 4 84 5 75 Z", face: [0, 12], top: 17 },
  twin: { path: "M 9 69 C 7 52 15 31 31 29 C 42 27 47 34 51 38 C 57 28 65 28 72 32 C 85 39 92 56 92 70 C 93 82 75 86 50 86 C 25 86 8 82 9 69 Z", face: [0, 1], top: 2 },
  jelly: { path: "M 31 25 C 40 24 61 24 70 26 C 83 28 86 36 87 49 L 89 68 C 91 81 81 86 65 86 L 35 86 C 18 86 10 81 12 68 L 14 47 C 15 33 20 27 31 25 Z", face: [0, -1], top: -3 },
};

/** A costume sits on the dome. `back` and `front` always show; a hat takes the place of a crest. `keepsHead` wears no hat at all. */
const COSTUMES: Record<Costume, { color?: SlimeColor; back?: string; front?: string; crest?: string; crestBack?: string; keepsHead?: boolean }> = {
  // Shion: a long high ponytail and one dark horn on the forehead.
  oni: {
    color: "lavender", keepsHead: true,
    back: `<path d="M 64 31 C 65 16 72 9 81 11 C 96 14 91 36 95 53 C 99 67 97 77 85 83 C 92 66 80 61 79 45 C 79 33 74 27 64 31 Z" style="fill:color-mix(in srgb,var(--slime-color) 78%,#000)"/>`,
    front: `<path d="M 44 34 C 45 25 49 16 53 12 L 54 33 Q 50 37 44 34 Z" fill="#363140"/>`,
  },
  // Diablo: short hair of the body's own colour with a red and a yellow streak, a white shirt and a dark tie.
  demon: {
    color: "charcoal", keepsHead: true,
    back: `<path d="M 25 39 Q 25 27 35 25 L 31 21 L 45 25 L 53 20 L 57 25 L 67 24 Q 77 29 77 40 L 67 35 L 63 43 L 54 34 L 50 41 L 43 33 L 36 41 L 33 35 Z" fill="var(--slime-color)"/>`,
    front: `<path d="M 31 64 L 50 75 L 69 64 L 62 83 L 38 83 Z M 48 73 L 52 73 L 53 77 L 51 83 L 49 83 L 47 77 Z" fill="#FFF6E9" fill-rule="evenodd"/>` +
      `<path d="M 37 28 L 41 29 L 47 41 L 43 39 Z" fill="#EE5A64"/><path d="M 58 27 L 62 28 L 68 39 L 64 37 Z" fill="#F5CE55"/>`,
  },
  fox: {
    color: "tangerine",
    crestBack: `<path d="M 19 42 Q 15 25 20 14 Q 32 19 38 32 Z M 62 32 Q 69 19 80 14 Q 85 26 81 42 Z" fill="var(--slime-color)"/>`,
    crest: `<path d="M 21 28 L 22 21 L 31 29 Z M 69 29 L 78 21 L 79 28 Z" fill="#FFE8CB"/>`,
  },
  sprout: {
    crestBack: `<path d="M 48 32 L 48 19 Q 49 17 51 19 L 52 32 Z" fill="#286141"/>`,
    crest: `<path d="M 50 24 C 35 25 29 18 29 12 C 41 10 49 14 50 24 Z M 50 24 C 51 11 61 8 71 10 C 70 20 61 25 50 24 Z" fill="#509C52"/>`,
  },
  crown: { crest: `<path d="M 31 17 L 42 24 L 50 12 L 58 24 L 69 17 L 65 34 Q 50 37 35 34 Z" fill="#D39A27"/>` },
};

const HATS: Record<Hat, string> = {
  witch: `<path d="M 31 30 L 47 4 Q 54 2 64 10 L 56 11 L 69 30 C 84 30 88 35 80 38 Q 50 43 20 38 C 12 35 17 31 31 30 Z" fill="#554177"/>` +
    `<path d="M 34 25 Q 50 29 65 25 L 69 30 Q 50 34 31 30 Z" fill="#D6A14A"/>`,
  santa: `<path d="M 27 32 C 31 15 42 7 53 9 C 66 10 69 20 78 23 L 76 30 Q 64 29 56 22 L 66 34 Z" fill="#C94250"/>` +
    `<path d="M 25 30 Q 47 26 67 31 Q 71 35 67 39 Q 47 35 25 39 Q 21 35 25 30 Z M 84 27 A 6 6 0 1 1 72 27 A 6 6 0 1 1 84 27 Z" fill="#FFF5E7"/>`,
};

const SHAPES = [...Object.keys(BODIES), ...Object.keys(COSTUMES)] as SlimeShape[];
const COLOR_IDS = Object.keys(COLORS) as SlimeColor[];
const isCostume = (shape: SlimeShape): shape is Costume => shape in COSTUMES;
const bodyOf = (shape: SlimeShape): Body => (isCostume(shape) ? "dome" : shape);

/** The colours a member with no choice of its own is given. */
const DEFAULT_COLORS = COLOR_IDS.filter(color => color !== "charcoal");

/** The first mascots stored one word: a colour of the old set, or a costume. */
const OLD_COLORS: Record<string, SlimeColor> = { azure: "sky", mint: "teal", sunny: "ochre", coral: "coral", rose: "orchid", lilac: "lavender", slate: "charcoal" };

export interface Slime { shape: SlimeShape; color: SlimeColor }

const costumeColor = (shape: SlimeShape): SlimeColor | undefined => (isCostume(shape) ? COSTUMES[shape].color : undefined);

export function parseSlime(avatar: string | null | undefined): Slime | null {
  if (!avatar?.startsWith("slime:")) return null;
  const [first = "", second] = avatar.slice(6).split(":");
  if (second === undefined) {
    if (first in OLD_COLORS) return { shape: "dome", color: OLD_COLORS[first]! };
    if (SHAPES.includes(first as SlimeShape)) return { shape: first as SlimeShape, color: costumeColor(first as SlimeShape) ?? "sky" };
    return null;
  }
  return SHAPES.includes(first as SlimeShape) && second in COLORS ? { shape: first as SlimeShape, color: second as SlimeColor } : null;
}

export const isSlimeAvatar = (avatar: string | null | undefined): boolean => parseSlime(avatar) !== null;
const slimeAvatar = ({ shape, color }: Slime): string => `slime:${shape}:${color}`;
const defaultColor = (id: number): SlimeColor => DEFAULT_COLORS[Math.abs(id) % DEFAULT_COLORS.length]!;
/** What a member without a choice of its own shows, which the picture menu starts from. */
export const defaultSlimeAvatar = (id: number): string => slimeAvatar({ shape: "dome", color: defaultColor(id) });

/** The hat of the season: the week of Halloween and of Christmas. */
export function seasonalHat(now: Date = new Date()): Hat | null {
  const month = now.getMonth() + 1, day = now.getDate();
  if ((month === 10 && day >= 24) || (month === 11 && day === 1)) return "witch";
  if (month === 12 && day >= 18 && day <= 26) return "santa";
  return null;
}

// The eyes at rest; slime.css bends these same paths into every other state.
const EYE_L = "M 42.04 44.64 Q 43 48 43.96 51.36", EYE_R = "M 55.04 44.64 Q 56 48 56.96 51.36";

// The eyes carry the character at 40 px, so they are drawn larger than the sheets, about their own middle; a hat clears them.
const FACE_SCALE = "translate(49.5 48) scale(1.25) translate(-49.5 -48)";
const HAT_LIFT = -4;

const Z = `<g class="slime-z"><path d="M 81 24 H 90 L 81 33 H 90" fill="none" stroke="var(--slime-color)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;

export interface SlimeDrawing { now?: Date; state?: SlimeState; delay?: number; member?: number }

/** The drawing alone; `slimeFaceHTML` wraps it the way every member's face is wrapped. */
export function slimeSVG({ shape, color }: Slime, { now = new Date(), state = "idle", delay = 0, member }: SlimeDrawing = {}): string {
  const body = BODIES[bodyOf(shape)], costume = isCostume(shape) ? COSTUMES[shape] : null;
  const hat = costume?.keepsHead ? null : seasonalHat(now);
  return `<svg class="slime" viewBox="4 11 92 92" data-state="${state}"${member === undefined ? "" : ` data-slime-member="${member}"`} aria-hidden="true" focusable="false" style="--slime-color:${COLORS[color]};--slime-delay:${delay}ms">` +
    `<g class="slime-press"><g class="slime-motion">` +
    (costume?.back ?? "") + (hat ? "" : costume?.crestBack ?? "") +
    `<path d="${body.path}" fill="var(--slime-color)"/>` +
    (costume?.front ?? "") + (hat ? "" : costume?.crest ?? "") +
    (hat ? `<g transform="translate(0 ${body.top + HAT_LIFT})">${HATS[hat]}</g>` : "") +
    `<g transform="translate(${body.face[0]} ${body.face[1]}) ${FACE_SCALE}"><g class="slime-gaze" fill="none" stroke="#fff" stroke-linecap="round">` +
    `<g class="slime-eye slime-eye-l"><path d="${EYE_L}"/></g><g class="slime-eye slime-eye-r"><path d="${EYE_R}"/></g>` +
    `</g></g></g></g>${Z}</svg>`;
}

// ---------- what each member is doing ----------

const activity = new Map<number, SlimeState>();
const resting = new Map<number, SlimeState>();
const fleeting = new Map<number, ReturnType<typeof setTimeout>>();

/** Long enough without a word and it dozes off. */
const SLEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const FLEETING_MS: Partial<Record<SlimeState, number>> = { done: 2000, arriving: 700 };

interface SlimeFacts { id: number; waiting?: boolean; last_at?: number | null; activity?: string }

/** What a member's own row says, for when nothing live is telling: an answer it waits for, or what the core last knew. */
function restingState(member: SlimeFacts, now: number): SlimeState {
  if (member.waiting) return "waiting";
  if (member.activity && member.activity !== "idle" && (LIVE_STATES as readonly string[]).includes(member.activity)) return member.activity as SlimeState;
  const last = member.last_at ?? NaN;
  return Number.isFinite(last) && now - last > SLEEP_AFTER_MS ? "sleeping" : "idle";
}

const paint = (id: number, state: SlimeState): void => {
  for (const svg of document.querySelectorAll<SVGElement>(`svg.slime[data-slime-member="${id}"]`)) svg.dataset.state = state;
};

/** The states the core tells (`member.activity`). */
export const LIVE_STATES = ["idle", "thinking", "working", "searching", "computer", "done", "error"] as const;

/** What the core says a member is doing; `idle` hands it back to what its row says. A moment like `done` passes by itself. */
export function setSlimeState(id: number, state: SlimeState): void {
  const was = fleeting.get(id);
  if (was !== undefined) { clearTimeout(was); fleeting.delete(id); }
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

/** The slime a member shows: its own choice, or a colour from its id. */
export function slimeFaceHTML(member: SlimeFacts & { avatar?: string | null }, size: number, cls = ""): string {
  const slime = parseSlime(member.avatar) ?? { shape: "dome" as const, color: defaultColor(member.id) };
  const rest = restingState(member, Date.now());
  resting.set(member.id, rest);
  const state = activity.get(member.id) ?? rest;
  const tiny = size < 28 ? " is-tiny" : "";
  return `<span class="av mb-av mb-av-slime${tiny}${cls ? ` ${cls}` : ""}" style="--av:${Math.round(size)}px" aria-hidden="true">` +
    slimeSVG(slime, { state, member: member.id, delay: delayOf(member.id, performance.now()) }) + `</span>`;
}

// ---------- the picture menu ----------

/** Bareheaded in any season, so that a costume shows what it is. */
const OFF_SEASON = new Date(2000, 5, 1);

export const SLIME_SHAPE_COUNT = SHAPES.length;
export const SLIME_COLOR_COUNT = COLOR_IDS.length;

/** A shape shows the colour it would have if pressed: the chosen one, or a costume's own. */
const choiceColor = (shape: SlimeShape, current: Slime): SlimeColor => (shape === current.shape ? current.color : costumeColor(shape) ?? current.color);

const shapeChoice = (shape: SlimeShape, current: Slime, label: string): string =>
  `<button type="button" role="menuitem" tabindex="-1" class="mb-preset mb-preset-slime" data-slime-shape="${shape}" aria-pressed="${shape === current.shape}" aria-label="${label}">` +
  slimeSVG({ shape, color: choiceColor(shape, current) }, { now: OFF_SEASON }) + `</button>`;

const colorChoice = (color: SlimeColor, current: Slime, label: string): string =>
  `<button type="button" role="menuitem" tabindex="-1" class="mb-slime-color" data-slime-color="${color}" aria-pressed="${color === current.color}" aria-label="${label}" style="--slime-color:${COLORS[color]}"></button>`;

/** The slimes of the picture menu: the shapes, then the colours. */
export function slimePickerHTML(avatar: string | null | undefined, labels: { shape(index: number): string; color(index: number): string }): string {
  const current = parseSlime(avatar) ?? { shape: "dome" as const, color: "sky" as const };
  return `<div class="mb-presets mb-slime-shapes" role="group">${SHAPES.map((shape, index) => shapeChoice(shape, current, labels.shape(index + 1))).join("")}</div>` +
    `<div class="mb-slime-colors" role="group">${COLOR_IDS.map((color, index) => colorChoice(color, current, labels.color(index + 1))).join("")}</div>`;
}

/**
 * A press in that menu: the avatar it makes, with the menu showing it where it stands, or null when the press was
 * on neither. A costume with a colour of its own brings it; a colour then changes it.
 */
export function pickSlime(button: HTMLElement, avatar: string | null | undefined): string | null {
  const { slimeShape, slimeColor } = button.dataset;
  if (!slimeShape && !slimeColor) return null;
  const current = parseSlime(avatar) ?? { shape: "dome" as const, color: "sky" as const };
  const shape = (slimeShape as SlimeShape | undefined) ?? current.shape;
  const color = (slimeColor as SlimeColor | undefined) ?? (slimeShape ? costumeColor(shape) : undefined) ?? current.color;
  const menu = button.closest(".menu") ?? document;
  for (const other of menu.querySelectorAll<HTMLElement>("[data-slime-shape]")) {
    other.setAttribute("aria-pressed", String(other.dataset.slimeShape === shape));
    other.querySelector<SVGElement>("svg")?.style.setProperty("--slime-color", COLORS[choiceColor(other.dataset.slimeShape as SlimeShape, { shape, color })]);
  }
  for (const other of menu.querySelectorAll<HTMLElement>("[data-slime-color]")) other.setAttribute("aria-pressed", String(other.dataset.slimeColor === color));
  return slimeAvatar({ shape, color });
}
