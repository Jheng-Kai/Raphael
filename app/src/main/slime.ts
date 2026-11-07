/**
 * The members' mascots: one low dome with two white eyes, drawn in code. A character is that same slime in a colour
 * of its own with one or two marks of who it is, so Shion is lavender with a horn and nothing more. Loop motion is
 * CSS keyed on `data-state` (slime.css); finite handovers use explicit keyframes from JS pose/timing state.
 * Nothing in script runs per animation frame: it only changes state and admits deferred strips.
 * Raphael is the first blue slime (`rimuru`, members.ts `faceHTML`); the primary member wears a gold crown (crown.ts).
 * A member's `avatar` is `slime:<character>` or `slime:color:<color>`; one without a picture gets a colour from its id.
 */
import "./slime.css";
import { t } from "./i18n";
import { motionStrips } from "./slime-cels";
import { loopState, LOOPS, sample, easing } from "./slime-motion";
import { crownedId } from "./crown";

export type SlimeState = "idle" | "thinking" | "working" | "searching" | "computer" | "waiting" | "blocked" | "done" | "error" | "sleeping" | "arriving";
type Hat = "witch" | "santa";

/** Raphael's colour: the first blue slime's, his face since 2026-11-07 (the `rimuru` character below). */
export const RAPHAEL_COLOR = "#3DB5FF";

/** The plain slimes' colours, as clear and saturated as Grok Bot's swatches (owner, 2026-11-06: ours read a shade too dark). */
const COLORS = {
  sky: "#1EA7FD", lavender: "#905AFB", coral: "#FC2C3E", tangerine: "#F9670E", ochre: "#F69412",
  leaf: "#14C370", teal: "#13B8A3", ocean: "#1884FC", orchid: "#FB3499", charcoal: "#777777",
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
  rimuru: { name: "slime.rimuru", color: RAPHAEL_COLOR },
  shion: { name: "slime.shion", color: COLORS.lavender, marks: loose(fill(ONE_HORN, "#363140"), 49, 34) },
  diablo: { name: "slime.diablo", color: COLORS.charcoal,
    marks: `<path d="${COLLAR} M 48 73 L 52 73 L 53 77 L 51 83 L 49 83 L 47 77 Z" fill="#FFF6E9" fill-rule="evenodd"/>` +
      fill("M 60 31 L 64 32 L 69 42 L 65 40 Z", "#EE5A64") + fill("M 67 34 L 71 36 L 75 45 L 71 43 Z", "#F5CE55"),
  },
  benimaru: { name: "slime.benimaru", color: "#F23B3B", marks: loose(fill(TWO_HORNS, "#2B2430"), 50, 34, 0.4) },
  shuna: { name: "slime.shuna", color: "#FF8FC4", marks: loose(fill(SMALL_HORNS, "#FBEFE3"), 50, 33, 0.4) },
  souei: { name: "slime.souei", color: "#3A62C8", marks: loose(fill(ONE_HORN, "#1B2238"), 49, 34) + fill(SASH, "#F2F2F5") },
  hakurou: { name: "slime.hakurou", color: "#8E949C", marks: loose(fill("M 50 66 C 44 63 35 64 29 72 C 37 73 45 72 50 69 Z M 50 66 C 56 63 65 64 71 72 C 63 73 55 72 50 69 Z", "#FFFFFF"), 50, 67, 0.7) },
  gobta: { name: "slime.gobta", color: "#4CC85A",
    marks: fill("M 28 37 Q 50 26 72 37 L 72 40 Q 50 30 28 40 Z", "#3A3A44") +
      `<circle cx="39" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/><circle cx="61" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/>`,
  },
  rigur: { name: "slime.rigur", color: COLORS.leaf, marks: fill("M 22 42 C 30 27 68 25 78 42 Q 50 31 22 42 Z", "#A8342F") },
  rigurd: { name: "slime.rigurd", color: "#2FA24F", marks: loose(fill(BOW, "#1E1E24") + `<circle cx="50" cy="72" r="3" fill="#D6A14A"/>`, 50, 72, 0.8) },
  milim: { name: "slime.milim", color: "#FF7AA6", marks: loose(`<path d="M 50 30 C 47 21 53 13 61 15 C 55 17 52 23 54 30 Z" fill="var(--slime-color)"/>`, 52, 30) },
  veldora: { name: "slime.veldora", color: "#3463D6", marks: loose(fill(TWO_HORNS, "#C9D2E3"), 50, 34, 0.4) },
  ranga: { name: "slime.ranga", color: "#6C7A9E",
    back: loose(`<path d="M 19 42 Q 15 25 20 14 Q 32 19 38 32 Z M 62 32 Q 69 19 80 14 Q 85 26 81 42 Z" fill="var(--slime-color)"/>`, 50, 38, 0.3),
    marks: fill("M 50 30 L 52 35 L 57 35 L 53 38 L 55 43 L 50 40 L 45 43 L 47 38 L 43 35 L 48 35 Z", "#F2C14E"),
  },
  gabiru: { name: "slime.gabiru", color: "#8A82D6", marks: fill("M 18 78 Q 24 70 30 78 Q 36 70 42 78 Q 48 70 54 78 Q 60 70 66 78 Q 72 70 78 78 L 76 84 Q 50 90 22 84 Z", "#F2EBDD") },
  geld: { name: "slime.geld", color: "#C98A45", marks: fill("M 35 80 C 33 73 34 68 38 64 C 40 69 42 74 43 81 Z M 65 80 C 67 73 66 68 62 64 C 60 69 58 74 57 81 Z", "#FBF3DC") },
  treyni: { name: "slime.treyni", color: "#1FC29A",
    marks: loose(fill("M 48 32 L 48 19 Q 49 17 51 19 L 52 32 Z", "#2E7D4F") + fill("M 50 24 C 35 25 29 18 29 12 C 41 10 49 14 50 24 Z M 50 24 C 51 11 61 8 71 10 C 70 20 61 25 50 24 Z", "#8FD18A"), 50, 30),
  },
  kurobe: { name: "slime.kurobe", color: "#8E7254", marks: fill("M 23 39 Q 50 26 77 39 L 80 45 Q 50 31 20 45 Z", "#EFEFEF") },
  shizu: { name: "slime.shizu", color: "#6A86CC", marks: `<ellipse cx="50" cy="35" rx="15" ry="6" fill="#F4F4F7"/>` + `<path d="M 39 35 Q 44 31 50 35 T 61 35" fill="none" stroke="#C94250" stroke-width="2.5" stroke-linecap="round"/>` },
  hinata: { name: "slime.hinata", color: "#5A63A3", marks: fill(COLLAR, "#F4F4F7") + fill("M 48 72 H 52 V 84 H 48 Z", "#D6A14A") },
  guy: { name: "slime.guy", color: "#E0304B", marks: fill(SASH, "#2A1A1E") },
  testarossa: { name: "slime.testarossa", color: "#D5D9D6", marks: loose(fill(BOW, "#3FBF94") + `<circle cx="50" cy="72" r="3" fill="#FFFFFF"/>`, 50, 72, 0.8) },
  ultima: { name: "slime.ultima", color: "#C27BE6", marks: loose(fill(BOW, "#2A1A2E"), 50, 72, 0.8) },
  carrera: { name: "slime.carrera", color: "#F5B417", marks: loose(fill("M 50 66 L 45 71 L 48 85 H 52 L 55 71 Z", "#B3262E"), 50, 66, 0.7) },
  ramiris: { name: "slime.ramiris", color: "#FFC83D", back: loose(`<path d="M 16 54 C 2 48 -2 28 6 16 C 16 20 24 34 27 44 Z M 84 54 C 98 48 102 28 94 16 C 84 20 76 34 73 44 Z" fill="#F6C7DC"/>`, 50, 44, 0.3) },
} as const satisfies Record<string, { name: string; color: string; back?: string; marks?: string }>;
export type SlimeCharacter = keyof typeof CHARACTERS;

// ---------- the crown of the primary member ----------

/** One gold shape, no gem and no shine (owner, 2026-11-07), drawn with its base's middle at (50, 30). */
const CROWN_GOLD = "#F6C141";
const CROWN = fill("M 37 32.4 L 36.2 18 L 43.6 23.8 L 50 14.2 L 56.4 23.8 L 63.8 18 L 63 32.4 Q 50 28 37 32.4 Z", CROWN_GOLD).replace("/>", ` stroke="${CROWN_GOLD}" stroke-width="1.8" stroke-linejoin="round"/>`) +
  `<circle cx="36.2" cy="17.2" r="2.4" fill="${CROWN_GOLD}"/><circle cx="50" cy="13.2" r="2.6" fill="${CROWN_GOLD}"/><circle cx="63.8" cy="17.2" r="2.4" fill="${CROWN_GOLD}"/>`;
type CrownSpot = readonly [x: number, y: number, turn: number, size: number];
/**
 * Stuck on the outline from outside, not worn: its base sits on the edge line (it never sinks into the body; owner,
 * 2026-11-07), square to it, on the upper right where the dome slopes 30 degrees. Each spot is a point of the outline
 * moved 0.7 out along its normal.
 */
const CROWN_EDGE: CrownSpot = [71.6, 33.7, 30, 0.62];
/**
 * A character whose own marks are there gets a spot of its own: two horns hold it upright between them (owner,
 * 2026-11-07), Shizu's mask and Gobta's goggles push it down the edge, Diablo's streaks to the left, and the ears and
 * wings of Ranga and Ramiris to the top. One horn in the middle leaves the edge free.
 */
const CROWN_SPOTS: Partial<Record<SlimeCharacter, CrownSpot>> = {
  benimaru: [50, 27.8, 0, 0.55], veldora: [50, 27.8, 0, 0.55], shuna: [50, 27.9, 0, 0.5],
  shizu: [79.5, 40.1, 46, 0.6], gobta: [81.7, 42.6, 50, 0.58], diablo: [28.4, 32.9, -32, 0.6],
  ranga: [50, 27.6, 4, 0.6], ramiris: [57, 28.2, 12, 0.62],
};
function crownMark(slime: Slime): string {
  const [x, y, turn, size] = ("character" in slime && CROWN_SPOTS[slime.character]) || CROWN_EDGE;
  return loose(`<g transform="translate(${x} ${y}) rotate(${turn}) scale(${size}) translate(-50 -30)">${CROWN}</g>`, x, y, 0.6);
}

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

const HAT_LIFT = -4;
const drawings = new Map<string, { back: string; worn: string }>();
const drawingIds = new Map<string, string>();

function strips(state: SlimeState, drawing: {back: string; worn: string}): [string,string] {
  return loopState(state) ? motionStrips(state,BODY,EYES,FACE_SCALE,drawing.back,drawing.worn) : ['',''];
}

export interface SlimeDrawing { now?: Date; state?: SlimeState; delay?: number; tempo?: number; since?: number; member?: number; crown?: boolean }

/** The shared vector surface; `slimeFaceHTML` supplies the member's fixed avatar box. */
export function slimeSVG(slime: Slime, { now = new Date(), state = "idle", delay = 0, tempo = 1, since, member, crown = false }: SlimeDrawing = {}): string {
  hearThePointer();
  const look: { color: string; back?: string; marks?: string } = "character" in slime ? CHARACTERS[slime.character] : { color: COLORS[slime.color] };
  // The primary member wears the crown in any season: a plain slime's hat gives way to it.
  const hat = "character" in slime || crown ? null : seasonalHat(now);
  const worn = (look.marks ?? "") + (hat ? loose(`<g transform="translate(0 ${HAT_LIFT})">${HATS[hat]}</g>`, 50, 30, 0.6) : "") + (crown ? crownMark(slime) : "");
  const key = `${look.back ?? ''}|${worn}`;
  let drawingId = drawingIds.get(key);
  if (!drawingId) { drawingId=String(drawings.size);drawingIds.set(key,drawingId);drawings.set(drawingId,{back:look.back ?? '',worn}); }
  const [bodyStrip,eyeStrip] = strips(state,drawings.get(drawingId)!);
  // Each member glances to its own side at rest; neighbours in a list look different ways.
  const aside = member !== undefined && Math.abs(member) % 2 === 1 ? 3 : -3;
  return `<span class="slime-surface" data-slime-drawing="${drawingId}" data-slime-reuse="${drawingId}:${look.color}:${tempo}:${member ?? ''}" data-state="${state}" aria-hidden="true" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo}">${bodyStrip}<svg class="slime" viewBox="4 11 92 92" data-slime-mounted="${performance.now()}" data-state="${state}"${member === undefined ? "" : ` data-slime-member="${member}"`} aria-hidden="true" focusable="false" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo};--slime-aside:${aside}px${since === undefined ? "" : `;--slime-since:${since}ms`}">` +
    `<g class="slime-press"><g class="slime-settle"><g class="slime-counterturn"><g class="slime-motion">` +
    (look.back ? `<g class="slime-back">${look.back}</g>` : "") + correction(`<path d="${BODY}" fill="var(--slime-color)" class="slime-body"/>`) + `<g class="slime-marks">${worn}</g>` +
    `<g class="slime-face" transform="${FACE_SCALE}"><g class="slime-follow"><g class="slime-look"><g class="slime-counterturn"><g class="slime-gaze" fill="none" stroke="#fff" stroke-linecap="round"><path class="slime-eyes" d="${EYES}"/></g></g></g></g></g>` +
    `</g></g></g></g></svg>${eyeStrip}</span>`;
}

// ---------- under the pointer ----------

let hearing = false;

/**
 * Under the pointer a slime does not wiggle any more (owner, 2026-11-07): a resting one glances aside and looks back
 * at you while the pointer is on it or its row, as Grok Bot's bots do (slime.css). Here only the end of a handover.
 */
function hearThePointer(): void {
  if (hearing || typeof document === "undefined") return;
  hearing = true;
  document.addEventListener("animationend", event => {
    if (event.animationName === 'slime-idle-hide') {
      const svg=(event.target as Element).closest<SVGElement>('svg.slime');
      if(!svg)return;
      delete svg.dataset.transitioning;
      for(const part of svg.querySelectorAll<SVGElement>('[style]'))part.style.removeProperty('animation-delay');
    }
  });
}

type Bridge = { values: number[]; started: number; duration: number; animations: Animation[] };
const settling = new WeakMap<SVGElement, Bridge>();
interface SlimeClock {
  state: SlimeState; mounted: number; delay: number; tempo: number; since: number;
  sampled: boolean; transitionUntil: number;
  reveal?: Animation;
  surface: HTMLElement; drawingKey: string; drawing?: { back: string; worn: string }; pending: boolean;
  settle: SVGElement; look: SVGElement; motion: SVGElement; gaze: SVGElement;
  marks: { part: SVGElement; bridge: SVGElement; give: number }[];
}
const clocks = new WeakMap<SVGElement, SlimeClock>();
/** Hydrate once at mount; subsequent handovers only consult the JS clock and cached parts. */
function clockOf(svg: SVGElement): SlimeClock {
  let clock = clocks.get(svg);
  if (clock) return clock;
  const surface = svg.parentElement!;
  const drawingKey = surface.dataset.slimeDrawing ?? '';
  const size = parseFloat(svg.closest<HTMLElement>('.mb-av-slime')?.style.getPropertyValue('--av') ?? '');
  clock = { state: svg.dataset.state as SlimeState, mounted: Number(svg.dataset.slimeMounted) || performance.now(),
    sampled: Number.isFinite(size) && size <= 72, transitionUntil: 0,
    delay: parseFloat(svg.style.getPropertyValue('--slime-delay')) || 0,
    tempo: parseFloat(svg.style.getPropertyValue('--slime-tempo')) || 1,
    since: parseFloat(svg.style.getPropertyValue('--slime-since')) || 0,
    surface, drawingKey, drawing: drawings.get(drawingKey), pending: false,
    settle: svg.querySelector<SVGElement>('.slime-settle')!, look: svg.querySelector<SVGElement>('.slime-look')!,
    motion: svg.querySelector<SVGElement>('.slime-motion')!, gaze: svg.querySelector<SVGElement>('.slime-gaze')!,
    marks: [...svg.querySelectorAll<SVGElement>('.slime-mark')].map(part => ({ part,
      bridge: part.closest<SVGElement>('.slime-correction')!, give: parseFloat(part.style.getPropertyValue('--mark-give')) || 1 })) };
  clocks.set(svg, clock);
  return clock;
}

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

/** Poses follow the same keyframes and clock as the CSS strips, without asking layout or style. */
function statePose(clock: SlimeClock, kind: 'body' | 'eyes' | 'mark', now: number, give = 1): DOMMatrix {
  const state = clock.state, elapsed = now - clock.mounted;
  let pose;
  if (loopState(state)) {
    const loop = LOOPS[state], period = (kind === 'eyes' ? loop.eyes : kind === 'mark' && state === 'thinking' ? 3.6 : loop.body) * clock.tempo * 1000;
    const lag = kind === 'mark' ? state === 'thinking' ? 140 : state === 'searching' ? 120 : 0 : 0;
    const phase = Math.max(0, elapsed - clock.delay - lag) / period;
    // Small avatars display twelve sampled poses, with independently timed eyes and props.
    const sampled = clock.sampled && now >= clock.transitionUntil ? Math.floor(((phase % 1) + 1) % 1 * 12) / 12 : phase;
    pose = sample(`slime-${state}-${kind === 'eyes' ? 'gaze' : kind}`, sampled, kind === 'eyes' ? loop.gaze : loop.ease);
    if (state === 'blocked' && kind === 'eyes') pose.translate = [0, -6];
    if (state === 'error' && kind === 'body') pose.scale = [1.08, .62];
  } else if (state === 'done' || state === 'arriving') {
    const duration = state === 'done' ? 1900 : 1200;
    const lag = kind === 'mark' ? state === 'done' ? 60 : 50 : 0;
    pose = sample(`slime-${state}-${kind}`, Math.min(.999999, Math.max(0, (elapsed - clock.since - lag) / duration)));
  } else {
    return state === 'sleeping' && kind === 'body' ? new DOMMatrix().scale(1.04, .91) : new DOMMatrix();
  }
  return new DOMMatrix().translate(pose.translate[0], pose.translate[1]).rotate(pose.rotate[0]! * give).scale(pose.scale[0], pose.scale[1]);
}
function bridgePose(part: SVGElement, now: number): DOMMatrix {
  const bridge = settling.get(part);
  if (!bridge) return new DOMMatrix();
  const amount = 1 - easing('cubic-bezier(.25,.8,.3,1)', Math.min(1, (now - bridge.started) / bridge.duration));
  const [x,y,angle,wide,high,counter] = bridge.values;
  return new DOMMatrix().translate(x! * amount, y! * amount).rotate(angle! * amount)
    .scale(1 + (wide! - 1) * amount, 1 + (high! - 1) * amount).rotate(counter! * amount);
}
/** A finite bridge uses explicit keyframes, so starting it needs no forced style flush. */
function startFrom(part: SVGElement, pose: DOMMatrix, now: number, duration = 320): void {
  for (const animation of settling.get(part)?.animations ?? []) animation.cancel();
  settling.delete(part);
  if (pose.isIdentity || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    part.classList.remove('slime-in-between'); return;
  }
  const e = (pose.a + pose.d) / 2, f = (pose.a - pose.d) / 2, g = (pose.b + pose.c) / 2, h = (pose.b - pose.c) / 2;
  const q = Math.hypot(e, h), r = Math.hypot(f, g), first = Math.atan2(g, f), second = Math.atan2(h, e);
  const values = [pose.e, pose.f, (first + second) / 2 * 180 / Math.PI, q + r, q - r, (second - first) / 2 * 180 / Math.PI];
  // Animate native transform properties rather than custom properties. The latter
  // require main-thread style resolution on every tick of a finite handover.
  const from = { translate: `${values[0]}px ${values[1]}px`, rotate: `${values[2]}deg`, scale: `${values[3]} ${values[4]}` };
  const to = { translate: '0px 0px', rotate: '0deg', scale: '1 1' };
  part.classList.add('slime-in-between');
  const options = { duration, easing: 'cubic-bezier(.25,.8,.3,1)' };
  const counter = part.firstElementChild as SVGElement;
  const animations = typeof part.animate === 'function' ? [part.animate([from,to], options),
    counter.animate([{rotate: `${values[5]}deg`},{rotate:'0deg'}], options)] : [];
  for (const animation of animations) void animation.finished.catch(() => { /* A newer state interrupts this finite bridge. */ });
  const bridge = { values, started: now, duration, animations };
  settling.set(part, bridge);
  if (animations[0]) animations[0].onfinish = () => {
    if (settling.get(part) !== bridge) return;
    settling.delete(part); part.classList.remove('slime-in-between');
  };
}

// Keep parsed geometry bounded; colour and animation phase belong to each clone.
const celTemplates = new Map<string, HTMLTemplateElement>();
const CEL_TEMPLATE_LIMIT = 16;
/** The slime takes `state` and the strips drawn for it. */
function enter(svg: SVGElement, state: SlimeState, visible = true): void {
  const clock = clockOf(svg), surface = clock.surface;
  if (clock.state !== state) {
    svg.dataset.state = svg.dataset.moved = state;
    surface.dataset.state = state;
    clock.state = state;
  }
  for (const strip of surface.querySelectorAll(':scope > .slime-loop')) strip.remove();
  clock.pending = !visible;
  if (!visible) { surface.dataset.slimePending = "true"; return; }
  delete surface.dataset.slimePending;
  const drawing = clock.drawing;
  if (drawing && loopState(state)) {
    const key = `${clock.drawingKey}:${state}`;
    let template = celTemplates.get(key);
    if (!template) {
      template = document.createElement('template');
      template.innerHTML = strips(state, drawing).join('');
      if (celTemplates.size >= CEL_TEMPLATE_LIMIT) celTemplates.delete(celTemplates.keys().next().value!);
    } else celTemplates.delete(key);
    celTemplates.set(key, template);
    const content = template.content.cloneNode(true) as DocumentFragment;
    if (content.firstElementChild) svg.before(content.firstElementChild);
    if (content.firstElementChild) svg.after(content.firstElementChild);
    // Motion retains the original phase. Each admitted surface reveals on its own
    // frame's finite bridge instead of rasterizing an entire presence burst at once.
    const elapsed = Math.max(0, performance.now() - clock.mounted);
    // animation-delay does not inherit into hundreds of static cel paths.
    const delay = clock.delay - elapsed;
    for (const part of surface.querySelectorAll<HTMLElement>('.slime-cels, .slime-eye-cels, .slime-blink-cels')) part.style.animationDelay = `${delay}ms`;
    const lag = state === 'thinking' ? 140 : state === 'searching' ? 120 : 0;
    for (const part of surface.querySelectorAll<HTMLElement>('.slime-prop-cels')) part.style.animationDelay = `${delay + lag}ms`;
    holdVector(svg, clock, state === 'error' ? 1600 : 320);
  }
}

/** Keep the vector visible until this surface's deferred strips can take over. */
function holdVector(svg: SVGElement, clock: SlimeClock, duration: number): void {
  clock.reveal?.cancel(); clock.reveal = undefined;
  if (typeof svg.animate !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  clock.transitionUntil = performance.now() + duration;
  const reveal = svg.animate([{visibility:'visible'},{visibility:'visible'}], {duration});
  clock.reveal = reveal;
  void reveal.finished.catch(() => { /* A newer state or deferred admission owns visibility. */ });
  reveal.onfinish = () => {
    if (clock.reveal !== reveal) return;
    clock.reveal = undefined; delete svg.dataset.transitioning;
    for (const part of [clock.motion,clock.gaze,...clock.marks.map(mark=>mark.part)]) part.style.removeProperty('animation-delay');
  };
}

/** Deferred cels are mounted only after the visibility observer admits this surface. */
export function showSlime(surface: Element): void {
  if (document.visibilityState === "hidden" || surface.closest("[hidden], details:not([open])")) return;
  const svg = surface.querySelector<SVGElement>("svg.slime");
  if (svg) admitStrips(svg, clockOf(svg));
}
function admitStrips(svg: SVGElement, clock: SlimeClock): void {
  if (!clock.pending) return;
  if (!loopState(clock.state)) enter(svg, clock.state);
  else { pendingStrips.add(svg); scheduleStrips(); }
}

const pendingStrips = new Set<SVGElement>();
let stripsQueued = false;
/** A presence burst must not parse every visible member's large strip in one IPC callback. */
function scheduleStrips(): void {
  if (stripsQueued) return;
  stripsQueued = true;
  requestAnimationFrame(() => {
    stripsQueued = false;
    for (const svg of pendingStrips) {
      pendingStrips.delete(svg);
      const clock = clockOf(svg);
      if (!svg.isConnected || !clock.pending || document.visibilityState === 'hidden' || svg.closest('[data-offscreen], [hidden], details:not([open])')) continue;
      enter(svg, clock.state);
      break;
    }
    if (pendingStrips.size) scheduleStrips();
  });
}

/** A new state takes over from where the slime stands, however far through the old one it was, so nothing jumps. */
export function handOver(svg: SVGElement, state: SlimeState): void {
  handOverTogether([svg], state);
}

/** Every occurrence transitions from its cached clock; there are no computed-style reads. */
function handOverTogether(svgs: SVGElement[], state: SlimeState): void {
  const now = performance.now();
  for (const svg of svgs) {
    const clock = clockOf(svg);
    if (clock.state === state) continue;
    clock.reveal?.cancel(); clock.reveal = undefined;
    if (document.visibilityState === 'hidden' || svg.closest('[data-offscreen], [hidden], details:not([open])')) {
      clock.mounted = now; clock.since = 0;
      enter(svg, state, false); delete svg.dataset.transitioning; continue;
    }
    const body = bridgePose(clock.settle, now).multiply(statePose(clock, 'body', now));
    const eyes = bridgePose(clock.look, now).multiply(statePose(clock, 'eyes', now));
    const marks = clock.marks.map(mark => bridgePose(mark.bridge, now).multiply(statePose(clock, 'mark', now, mark.give)));
    enter(svg, state, false);
    clock.mounted = now; clock.since = 0;
    clock.transitionUntil = now + (state === 'error' ? 1600 : 320);
    svg.style.setProperty('--slime-since', '0ms');
    // Explicit visibility keyframes restart without flushing a reused CSS animation name.
    // With no strip mounted the vector remains visible, even if a busy frame delays the queue.
    svg.style.animationName = 'none';
    if (loopState(state)) holdVector(svg, clock, clock.transitionUntil-now);
    const parts = [clock.motion, clock.gaze, ...clock.marks.map(mark => mark.part)];
    for (const [index, part] of parts.entries()) {
      if (loopState(state)) {
        const loop = LOOPS[state], period = (index === 1 ? loop.eyes : index > 1 && state === 'thinking' ? 3.6 : loop.body) * clock.tempo * 1000;
        const lag = index > 1 ? state === 'thinking' ? 140 : state === 'searching' ? 120 : 0 : 0;
        part.style.animationDelay = `${(clock.delay + lag) % period}ms`;
      } else part.style.removeProperty('animation-delay');
    }
    if (loopState(state)) svg.dataset.transitioning = 'true'; else delete svg.dataset.transitioning;
    startFrom(clock.settle, body.multiply(statePose(clock, 'body', now).inverse()), now);
    startFrom(clock.look, eyes.multiply(statePose(clock, 'eyes', now).inverse()), now, 200);
    clock.marks.forEach((mark,index) => startFrom(mark.bridge, marks[index]!.multiply(statePose(clock, 'mark', now, mark.give).inverse()), now));
    admitStrips(svg, clock);
  }
}

export function presenceAttrs(id: number): string {
  const label = labels.get(id) ?? "";
  return ` data-presence-member="${id}"${label ? ` data-tooltip="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"` : ""}`;
}

const paint = (id: number, state: SlimeState): void => {
  handOverTogether([...document.querySelectorAll<SVGElement>(`svg.slime[data-slime-member="${id}"]`)], state);
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
    slimeSVG(slime, { state, member: member.id, crown: member.id === crownedId(), delay: delayOf(member.id, now), tempo: tempoOf(member.id), since: start === undefined ? undefined : -Math.round(now - start) }) + `</span>`;
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
