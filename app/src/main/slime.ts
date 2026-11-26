/**
 * The members' mascots: one low dome with two white eyes, drawn in code. A character is that same slime in a colour
 * of its own with one or two small cues. Loop motion is
 * CSS keyed on `data-state` (slime.css); finite handovers use explicit keyframes from JS pose/timing state.
 * Nothing in script runs per animation frame: it only changes state and admits deferred strips, and turns resting eyes
 * toward the pointer once for each frame the pointer moved in.
 * Raphael is the first blue slime (`blue-plain`, members.ts `faceHTML`); the primary member wears a gold crown (crown.ts).
 * A member's `avatar` is `slime:<character>` or `slime:color:<color>`; one without a picture gets a colour from its id.
 */
import "./slime.css";
import { t } from "./i18n";
import { motionStrips } from "./slime-cels";
import { celsOf, eyePath, loopState, LOOPS, sample, easing } from "./slime-motion";
import { crownedId } from "./crown";
import { currentSlimeId } from "./slime-ids";

export type SlimeState = "idle" | "thinking" | "working" | "searching" | "computer" | "waiting" | "blocked" | "done" | "error" | "sleeping" | "arriving";
type Hat = "witch" | "santa";

/** Raphael's colour: the first blue slime's, its face (the `blue-plain` character below). */
export const RAPHAEL_COLOR = "#3DB5FF";

/** The plain slimes' colours, with clear, saturated swatches. */
const COLORS = {
  sky: "#1EA7FD", lavender: "#905AFB", coral: "#FC2C3E", tangerine: "#F9670E", ochre: "#F69412",
  leaf: "#14C370", teal: "#13B8A3", ocean: "#1884FC", orchid: "#FB3499", charcoal: "#777777",
  ruby: "#BD1741", peach: "#FFA265", gold: "#DCC515", lime: "#9BCB16", emerald: "#087F58",
  cyan: "#04C9DE", cobalt: "#3942CE", violet: "#B13EE3", raspberry: "#AF228D", rose: "#FA80AB",
} as const;
export type SlimeColor = keyof typeof COLORS;


/**
 * The shape picker puts eleven colours under the slimes (R-SLIME-PICK-01), six in the first row and five in the second,
 * and each colour holds the characters of about its hue, four across: as many as there are, nothing counts them. There is
 * no plain slime in it: a member that wears a plain one keeps it, drawn as before, and its picker opens on the colour
 * nearest its own.
 */
const GROUPS = {
  black: { name: "slime.family.black", swatch: "#6B6977" }, brown: { name: "slime.family.brown", swatch: "#A0704A" },
  red: { name: "slime.family.red", swatch: "#F23B4F" }, orange: { name: "slime.family.orange", swatch: "#F97316" },
  yellow: { name: "slime.family.yellow", swatch: "#F5B02E" }, green: { name: "slime.family.green", swatch: "#14C370" },
  teal: { name: "slime.family.teal", swatch: "#18BFAE" }, blue: { name: "slime.family.blue", swatch: "#2391FA" },
  purple: { name: "slime.family.purple", swatch: "#A77BFA" }, pink: { name: "slime.family.pink", swatch: "#F55FB0" },
  gray: { name: "slime.family.gray", swatch: "#8E8E93" },
} as const;
type ColourGroup = keyof typeof GROUPS;

/** The picker's colour nearest a body colour, by its lightness and hue, for a face the picker does not offer. */
function nearestGroup(hex: string): ColourGroup {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
  const high = Math.max(r, g, b), low = Math.min(r, g, b), light = (high + low) / 2, span = high - low;
  const saturation = span === 0 ? 0 : span / (1 - Math.abs(2 * light - 1));
  if (light < 0.22) return "black";
  if (saturation < 0.18 || light > 0.86) return "gray";
  const turn = ((span === 0 ? 0 : high === r ? ((g - b) / span) % 6 : high === g ? (b - r) / span + 2 : (r - g) / span + 4) * 60 + 360) % 360;
  if (turn >= 12 && turn < 40) return light < 0.45 ? "brown" : "orange";
  return turn < 12 || turn >= 345 ? "red" : turn < 65 ? "yellow" : turn < 155 ? "green" : turn < 195 ? "teal" : turn < 250 ? "blue" : turn < 290 ? "purple" : "pink";
}

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
const BAT_WINGS = "M 26 48 L 6 26 L 8 60 L 18 54 L 22 70 L 32 56 Z M 74 48 L 94 26 L 92 60 L 82 54 L 78 70 L 68 56 Z";
const SOFT_WINGS = "M 26 50 Q 4 46 4 28 Q 14 33 18 27 Q 19 38 30 44 Z M 74 50 Q 96 46 96 28 Q 86 33 82 27 Q 81 38 70 44 Z";
const HEADBAND = "M 23 41 Q 50 28 77 41 L 78 46 Q 50 33 22 46 Z";
const HOOD = "M 20 46 Q 24 18 50 16 Q 76 18 80 46 Q 74 30 50 28 Q 26 30 20 46 Z";
const HELMET = "M 22 42 Q 26 22 50 22 Q 74 22 78 42 Q 50 34 22 42 Z";
const MAID_BAND = "M 28 36 Q 30 30 34 32 Q 36 27 40 30 Q 44 25 47 29 Q 50 25 53 29 Q 56 25 60 30 Q 64 27 66 32 Q 70 30 72 36 Q 50 30 28 36 Z";
const GEM = "M 50 64 L 55 70 L 50 77 L 45 70 Z";
const STAR = "M 0 -6 L 1.8 -1.9 L 6 -1.9 L 2.6 0.9 L 3.8 5 L 0 2.6 L -3.8 5 L -2.6 0.9 L -6 -1.9 L -1.8 -1.9 Z";
const star = (x: number, y: number, color: string, size = 1): string => `<path d="${STAR}" fill="${color}" transform="translate(${x} ${y}) scale(${size})"/>`;
const dots = (spots: readonly (readonly [number, number, number])[]): string => spots.map(([x, y, r]) => `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`).join(" ");
const BLUSH = `<ellipse cx="28" cy="64" rx="5" ry="3" fill="#F59AB4" opacity="0.75"/><ellipse cx="72" cy="64" rx="5" ry="3" fill="#F59AB4" opacity="0.75"/>`;
const BEARD = "M 29 66 Q 40 70 50 65 Q 60 70 71 66 Q 68 79 59 81 L 50 86 L 41 81 Q 32 79 29 66 Z";
/** A white mask over the face with ink scrolls round the eyes, a smile and a red seal, 85% as wide as the body's face: the live eyes do not show through it (`masked`). */
const SPIRIT_MASK = `<g transform="translate(50 0) scale(0.85 1) translate(-50 0)">` +
  fill("M19 51 C19 36 32 28 50 29 C69 28 81 37 81 51 C81 66 65 79 52 82 Q50 83 48 82 C33 78 19 65 19 51Z", "#F8F3E9") +
  fill("M28 34 Q31 37 37 41 Q43 46 39 49 Q31 51 35 55 Q37 59 39 61 Q32 58 31 54 Q29 50 35 48 Q40 47 37 44 Q31 39 28 34Z M72 34 Q69 37 63 41 Q57 46 61 49 Q69 51 65 55 Q63 59 61 61 Q68 58 69 54 Q71 50 65 48 Q60 47 63 44 Q69 39 72 34Z M21 60 Q29 57 35 62 Q50 74 65 62 Q71 57 79 60 Q73 60 70 63 Q73 66 70 71 Q71 66 67 64 Q51 77 34 65 Q30 65 29 71 Q27 66 30 62 Q27 60 21 61Z", "#635866") +
  fill("M46.8 56 A3.2 3.2 0 1 0 53.2 56 A3.2 3.2 0 1 0 46.8 56Z", "#C84247") + "</g>";
/** A scarf round the lower right, its end hanging. */
const SCARF_END = "M 58 72 Q 72 75 83 66 Q 86 72 79 76 Q 86 78 89 85 Q 79 85 72 79 Q 65 79 58 76 Z";
/**
 * A ponytail tied at the back of the head: it swings up and out over one side of the dome and hangs down beside it, a
 * lighter strand along it, and the band that ties it shows where it leaves the head.
 */
const TAIL = {
  right: "M 63 31 Q 70 17 82 16 Q 93 17 95 30 Q 96 42 90 53 Q 92 40 86 32 Q 80 26 72 30 Q 68 32 66 35 Z",
  left: "M 37 31 Q 30 17 18 16 Q 7 17 5 30 Q 4 42 10 53 Q 8 40 14 32 Q 20 26 28 30 Q 32 32 34 35 Z",
} as const;
const TAIL_SHINE = { right: "M 70 24 Q 80 19 88 24 Q 80 21 71 26 Z", left: "M 30 24 Q 20 19 12 24 Q 20 21 29 26 Z" } as const;
const TAIL_TIE = { right: [65, 32], left: [35, 32] } as const;
/** The ponytail behind the slime, on `side`: its hair, then its shine. */
const ponytail = (side: "left" | "right", hair: string, shine: string): string =>
  loose(fill(TAIL[side], hair) + fill(TAIL_SHINE[side], shine), TAIL_TIE[side][0], TAIL_TIE[side][1], 0.6);
/** The band that ties it, worn over the head's outline. */
const tailTie = (side: "left" | "right", color: string): string => `<circle cx="${TAIL_TIE[side][0]}" cy="${TAIL_TIE[side][1]}" r="3.2" fill="${color}"/>`;
/** A small black ribbon tied at the chest, under the face. */
const CHEST_RIBBON = "M 50 75 L 42 70 L 42 80 Z M 50 75 L 58 70 L 58 80 Z";
/** The eye a half mask leaves bare, painted where the live right eye stands at rest (they are hidden under any mask). */
const BARE_RIGHT_EYE = `<rect x="53.3" y="43.6" width="7.5" height="9.2" rx="3.75" fill="#FFFFFF"/>`;

type Face = { group: ColourGroup; color: string; back?: string; marks?: string; masked?: boolean };

/**
 * Each character: its colour, and on the same body what tells them: horns, a hat or an accessory, as many marks as that
 * takes, none over the eyes. Hair is never drawn over the body: only a ponytail, a bun, a tuft or strands beside the dome. The interface gives them no names. The
 * keys are stable so existing members keep their face; the first set leads each colour in its own order, and a new
 * character is one more entry under its colour (nothing counts them).
 */
const CHARACTERS = {
  "blue-plain": { group: "blue", color: RAPHAEL_COLOR },
  "horn-lavender": { group: "purple", color: COLORS.lavender, marks: loose(fill(ONE_HORN, "#363140"), 49, 34) },
  "streaks-charcoal": { group: "gray", color: COLORS.charcoal,
    marks: `<path d="${COLLAR} M 48 73 L 52 73 L 53 77 L 51 83 L 49 83 L 47 77 Z" fill="#FFF6E9" fill-rule="evenodd"/>` +
      fill("M 60 31 L 64 32 L 69 42 L 65 40 Z", "#EE5A64") + fill("M 67 34 L 71 36 L 75 45 L 71 43 Z", "#F5CE55"),
  },
  "horns-red": { group: "red", color: "#F23B3B", marks: loose(fill(TWO_HORNS, "#2B2430"), 50, 34, 0.4) },
  "small-horns-pink": { group: "pink", color: "#FF8FC4", marks: loose(fill(SMALL_HORNS, "#FBEFE3"), 50, 33, 0.4) },
  "horn-sash-blue": { group: "blue", color: "#3A62C8", marks: loose(fill(ONE_HORN, "#1B2238"), 49, 34) + fill(SASH, "#F2F2F5") },
  "mustache-gray": { group: "gray", color: "#8E949C",
    back: loose(fill("M 72 42 L 87 22 L 90 25 L 76 45 Z", "#3A3440") + fill("M 70 40 L 78 46 L 76 48 L 68 42 Z", "#C9A44A"), 79, 36, 0.3),
    marks: loose(fill("M 43 31 Q 41 20 50 17 Q 59 20 57 31 Z", "#F4F4F4") + fill("M 43 29 H 57 V 32 H 43 Z", "#6A4A8A"), 50, 30, 0.5) +
      loose(fill("M 50 66 C 44 63 35 64 29 72 C 37 73 45 72 50 69 Z M 50 66 C 56 63 65 64 71 72 C 63 73 55 72 50 69 Z", "#FFFFFF"), 50, 67, 0.7),
  },
  "goggles-green": { group: "green", color: "#4CC85A",
    marks: fill("M 28 37 Q 50 26 72 37 L 72 40 Q 50 30 28 40 Z", "#3A3A44") +
      `<circle cx="39" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/><circle cx="61" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/>` +
      fill(SCARF_END, "#F2C14E"),
  },
  "cap-green": { group: "green", color: COLORS.leaf, marks: fill("M 22 42 C 30 27 68 25 78 42 Q 50 31 22 42 Z", "#A8342F") + fill("M 66 36 L 84 40 L 82 43 L 66 40 Z", "#7E2420") },
  "bowtie-green": { group: "green", color: "#2FA24F", marks: loose(fill(BOW, "#1E1E24") + `<circle cx="50" cy="72" r="3" fill="#D6A14A"/>`, 50, 72, 0.8) },
  "tuft-pink": { group: "pink", color: "#FF7AA6", marks: loose(`<path d="M 50 30 C 47 21 53 13 61 15 C 55 17 52 23 54 30 Z" fill="var(--slime-color)"/>`, 52, 30) },
  "horns-blue": { group: "blue", color: "#3463D6", marks: loose(fill(TWO_HORNS, "#C9D2E3"), 50, 34, 0.4) },
  "wolf-star": { group: "blue", color: "#6C7A9E",
    back: loose(`<path d="M 19 42 Q 15 25 20 14 Q 32 19 38 32 Z M 62 32 Q 69 19 80 14 Q 85 26 81 42 Z" fill="var(--slime-color)"/>`, 50, 38, 0.3),
    marks: fill("M 50 30 L 52 35 L 57 35 L 53 38 L 55 43 L 50 40 L 45 43 L 47 38 L 43 35 L 48 35 Z", "#F2C14E"),
  },
  "frill-periwinkle": { group: "purple", color: "#8A82D6", marks: fill("M 18 78 Q 24 70 30 78 Q 36 70 42 78 Q 48 70 54 78 Q 60 70 66 78 Q 72 70 78 78 L 76 84 Q 50 90 22 84 Z", "#F2EBDD") },
  "tusks-tan": { group: "brown", color: "#C98A45",
    marks: fill(HELMET, "#6B5B4B") + fill("M 47 22 H 53 V 34 H 47 Z", "#4E4237") +
      fill("M 35 80 C 33 73 34 68 38 64 C 40 69 42 74 43 81 Z M 65 80 C 67 73 66 68 62 64 C 60 69 58 74 57 81 Z", "#FBF3DC"),
  },
  "sprout-mint": { group: "teal", color: "#1FC29A",
    marks: loose(fill("M 48 32 L 48 19 Q 49 17 51 19 L 52 32 Z", "#2E7D4F") + fill("M 50 24 C 35 25 29 18 29 12 C 41 10 49 14 50 24 Z M 50 24 C 51 11 61 8 71 10 C 70 20 61 25 50 24 Z", "#8FD18A"), 50, 30),
  },
  "headband-brown": { group: "brown", color: "#8E7254",
    marks: fill("M 23 39 Q 50 26 77 39 L 80 45 Q 50 31 20 45 Z", "#EFEFEF") + fill("M 76 40 L 88 36 L 86 44 Z", "#EFEFEF") +
      fill("M 66 70 H 80 V 77 H 66 Z", "#5A5560") + fill("M 72 77 H 75 V 86 H 72 Z", "#9A6A40"),
  },
  "mask-cornflower": { group: "blue", color: "#6A86CC", marks: `<ellipse cx="50" cy="35" rx="15" ry="6" fill="#F4F4F7"/>` + `<path d="M 39 35 Q 44 31 50 35 T 61 35" fill="none" stroke="#C94250" stroke-width="2.5" stroke-linecap="round"/>` },
  "collar-indigo": { group: "blue", color: "#5A63A3", marks: fill(COLLAR, "#F4F4F7") + fill("M 48 72 H 52 V 84 H 48 Z", "#D6A14A") },
  "sash-crimson": { group: "red", color: "#E0304B", marks: fill(SASH, "#2A1A1E") + fill("M 45 77 H 55 V 85 H 45 Z", "#D6A14A") + fill("M 47.5 79 H 52.5 V 83 H 47.5 Z", "#2A1A1E") },
  "bowtie-pearl": { group: "gray", color: "#DADDE2", marks: loose(fill(BOW, "#C2344E") + `<circle cx="50" cy="72" r="3" fill="#FFFFFF"/>`, 50, 72, 0.8) },
  "bowtie-purple": { group: "purple", color: "#C27BE6",
    back: ponytail("left", "#5A2E7A", "#7E4AA6") + ponytail("right", "#5A2E7A", "#7E4AA6"),
    marks: tailTie("left", "#2A1A2E") + tailTie("right", "#2A1A2E") + loose(fill(BOW, "#2A1A2E"), 50, 72, 0.8),
  },
  "necktie-amber": { group: "yellow", color: "#F5B417",
    marks: loose(fill("M 46 30 Q 42 20 48 14 Q 48 22 52 24 Q 55 18 61 17 Q 56 23 56 30 Z", "#FFE07A"), 50, 28, 0.4) + loose(fill("M 50 66 L 45 71 L 48 85 H 52 L 55 71 Z", "#B3262E"), 50, 66, 0.7),
  },
  "wings-yellow": { group: "yellow", color: "#FFC83D", back: loose(`<path d="M 16 54 C 2 48 -2 28 6 16 C 16 20 24 34 27 44 Z M 84 54 C 98 48 102 28 94 16 C 84 20 76 34 73 44 Z" fill="#F6C7DC"/>`, 50, 44, 0.3) },

  // Black
  panda: { group: "black", color: "#4E4658",
    back: ponytail("right", "#17151C", "#3A3542"),
    marks: tailTie("right", "#F28C38") + fill(SCARF_END, "#CFE3EA") + fill("M 66 76 Q 74 77 80 72 L 81 74 Q 75 79 67 78 Z", "#A3C6D3") +
      loose(fill("M 30 36 Q 36 30 30 22 Q 29 28 25 27 Q 25 21 20 18 Q 16 26 20 33 Q 24 38 30 36 Z", "#F28C38") + fill("M 28 34 Q 30 30 27 26 Q 25 30 22 28 Q 21 33 24 35 Z", "#FFD36B"), 26, 34, 0.5),
  },
  penguin: { group: "black", color: "#2A3046",
    back: ponytail("left", "#0E1017", "#2C3348") +
      loose(fill("M 70 46 L 85 10 L 92 13 L 77 49 Z", "#DCE2EA") + fill("M 86 12 L 90 14 L 77 46 L 75 45 Z", "#FFFFFF") + fill("M 67 34 L 89 43 L 87 48 L 65 39 Z", "#D6A14A"), 80, 38, 0.3),
    marks: tailTie("left", "#E9EDF4") + fill("M 40 68 L 50 74 L 60 68 L 58 76 L 50 80 L 42 76 Z", "#E9EDF4"),
  },
  "ribbon-bell": { group: "black", color: "#2F3756", marks: loose(fill("M 31 34 L 21 27 L 22 41 Z M 31 34 L 41 27 L 40 41 Z", "#F6F4F8") + `<circle cx="31" cy="34" r="3" fill="#F2B6C8"/>`, 31, 34, 0.5) + BLUSH },
  "knight-helm": { group: "black", color: "#3C4456",
    marks: fill("M 12 68 Q 15 57 28 59 L 33 66 L 29 75 Q 19 76 13 72 Z M 67 66 L 72 59 Q 85 57 88 68 L 87 72 Q 81 76 71 75 Z", "#D9DEE7") +
      fill("M 15 64 Q 19 60 27 61 L 28 63 Q 21 63 16 67 Z M 85 64 Q 81 60 73 61 L 72 63 Q 79 63 84 67 Z", "#FFFFFF") +
      fill("M 48 64 H 52 V 68 H 56 V 72 H 52 V 81 H 48 V 72 H 44 V 68 H 48 Z", "#6FA8DC"),
  },
  "sage-scroll": { group: "black", color: "#4E4757",
    marks: loose(fill("M 44 30 Q 40 20 46 13 Q 46 21 50 23 Q 53 15 61 13 Q 55 21 57 30 Z", "#141218"), 50, 28, 0.5) +
      fill("M 34 66 L 50 74 L 66 66 L 64 72 L 50 80 L 36 72 Z", "#F2F0F4") + fill(dots([[50, 79, 1.8], [50, 84, 1.6]]), "#D6A14A"),
  },
  "demon-tail": { group: "black", color: "#20262E",
    marks: loose(fill("M 41 31 Q 37 19 30 14 L 32 12 Q 40 17 44 30 Z M 59 31 Q 63 19 70 14 L 68 12 Q 60 17 56 30 Z", "#3FC3B0") + fill(dots([[31, 13, 2], [69, 13, 2]]), "#9AF0E2"), 50, 30, 0.5) +
      fill("M 13 67 Q 19 56 32 60 L 30 73 Q 20 75 13 71 Z M 87 67 Q 81 56 68 60 L 70 73 Q 80 75 87 71 Z", "#2F8F86") +
      fill("M 40 66 L 50 73 L 60 66 L 57 79 L 50 83 L 43 79 Z", "#3FC3B0"),
  },
  "butler-silver": { group: "black", color: "#2D3242",
    marks: SPIRIT_MASK + fill(SCARF_END, "#BFE0EC") + fill("M 66 76 Q 74 77 80 72 L 81 74 Q 75 79 67 78 Z", "#93C3D6"),
    masked: true,
  },
  "oni-indigo": { group: "black", color: "#3A3844",
    back: loose(fill("M 26 50 Q 6 48 2 30 Q 10 33 14 28 Q 16 35 22 34 Q 22 40 30 44 Z M 74 50 Q 94 48 98 30 Q 90 33 86 28 Q 84 35 78 34 Q 78 40 70 44 Z", "#F4F2EC") +
      fill("M 25 48 Q 13 46 8 38 Q 14 40 18 37 Q 20 43 28 45 Z M 75 48 Q 87 46 92 38 Q 86 40 82 37 Q 80 43 72 45 Z", "#C9C6D6"), 50, 44, 0.3),
  },

  // Brown
  "bear-ears": { group: "brown", color: "#9A6B48",
    marks: fill(BEARD, "#4A3A30") + fill("M 22 66 L 29 64 L 31 86 L 24 86 Z M 78 66 L 71 64 L 69 86 L 76 86 Z", "#6B4A32") + fill(dots([[27, 72, 1.6], [73, 72, 1.6]]), "#D6A14A"),
  },
  "beast-mane": { group: "brown", color: "#A8743A",
    back: fill("M 14 62 L 6 48 L 16 40 L 12 26 L 28 28 L 34 14 L 50 22 L 66 14 L 72 28 L 88 26 L 84 40 L 94 48 L 86 62 Z", "#F0B24C") +
      fill("M 20 58 L 14 47 L 22 41 L 19 31 L 31 32 L 37 21 L 50 27 L 63 21 L 69 32 L 81 31 L 78 41 L 86 47 L 80 58 Z", "#D18A2A"),
    marks: fill(dots([[30, 30, 4], [70, 30, 4]]), "#8A5A28"),
  },
  "dog-ears": { group: "brown", color: "#8C6A55",
    back: loose(`<path d="M 20 44 Q 16 26 22 16 Q 32 22 38 34 Z M 62 34 Q 68 22 78 16 Q 84 26 80 44 Z" fill="var(--slime-color)"/>` + fill("M 23 38 Q 21 28 24 22 Q 30 26 33 34 Z M 67 34 Q 70 26 76 22 Q 79 28 77 38 Z", "#E8C9B8"), 50, 38, 0.3),
    marks: fill("M 18 52 L 26 56 L 24 58 L 16 54 Z M 18 58 L 26 61 L 24 63 L 16 60 Z", "#5A4234"),
  },
  "golem-stone": { group: "brown", color: "#7E6650",
    marks: fill(HELMET, "#8F9AA6") + fill("M 47 22 H 53 V 34 H 47 Z", "#6C7682") +
      `<circle cx="22" cy="73" r="10" fill="#6C7682"/><circle cx="22" cy="73" r="7.5" fill="#9AA4AE"/><circle cx="22" cy="73" r="2.6" fill="#D6A14A"/>`,
  },
  detective: { group: "brown", color: "#A07A58",
    marks: fill(HEADBAND, "#3F6E5A") + fill("M 22 42 L 10 37 L 12 46 Z M 22 44 L 12 50 L 19 52 Z", "#3F6E5A") +
      fill("M 70 78 L 85 66 L 87 68 L 73 81 Z", "#DCE2EA") + fill("M 66 76 L 72 82 L 70 84 L 64 78 Z", "#5A3E2A"),
  },
  mushroom: { group: "brown", color: "#B07A54",
    marks: loose(fill("M 34 31 Q 36 19 50 18 Q 64 19 66 31 Q 50 27 34 31 Z", "#7A4A2E") + fill("M 34 29 Q 50 25 66 29 L 66 31 Q 50 27 34 31 Z", "#D6A14A"), 50, 28, 0.4) +
      loose(fill("M 50 66 C 45 62 36 62 31 68 C 37 66 44 68 50 70 Z M 50 66 C 55 62 64 62 69 68 C 63 66 56 68 50 70 Z", "#5A3A2C"), 50, 67, 0.7) +
      `<circle cx="72" cy="77" r="5" fill="#E8C14E"/><circle cx="72" cy="77" r="2.4" fill="#C9A23A"/>`,
  },

  // Red
  "demon-wings": { group: "red", color: "#C42A3E",
    back: loose(fill(BAT_WINGS, "#2A1D25") + fill("M 25 48 L 12 32 L 14 54 L 21 50 Z M 75 48 L 88 32 L 86 54 L 79 50 Z", "#4A2A36"), 50, 46, 0.3),
  },
  "kijin-ivory": { group: "red", color: "#B8404A", marks: loose(fill("M 46 32 C 46 24 48 18 51 13 C 53 18 55 24 55 32 Q 50 34 46 32 Z", "#F3E4CC"), 50, 32, 0.4) + fill(HEADBAND, "#3A2A30") },
  "phoenix-feather": { group: "red", color: "#D2452E", marks: loose(fill("M 30 37 Q 22 30 26 22 Q 30 18 34 22 Q 30 24 32 30 L 37 34 Z M 70 37 Q 78 30 74 22 Q 70 18 66 22 Q 70 24 68 30 L 63 34 Z", "#F2C65A"), 50, 34, 0.4) },
  "autumn-leaf": { group: "red", color: "#CC3F52",
    back: loose(fill("M 26 46 Q 12 40 7 28 Q 15 32 18 29 Q 19 37 29 42 Z M 74 46 Q 88 40 93 28 Q 85 32 82 29 Q 81 37 71 42 Z", "#2B2730"), 50, 42, 0.3),
    marks: loose(fill("M 68 30 L 70 24 L 72 29 L 77 26 L 75 31 L 80 33 L 74 34 L 75 38 L 70 35 L 66 38 L 67 34 L 61 33 L 66 31 L 64 26 Z", "#F6A13A"), 70, 34, 0.5),
  },
  fire: { group: "red", color: "#E2532C",
    back: loose(fill("M 28 44 Q 16 28 30 14 Q 30 26 40 28 Q 38 12 50 2 Q 56 18 60 24 Q 66 14 72 18 Q 82 30 72 44 Z", "#FFB84A") +
      fill("M 34 40 Q 28 30 36 22 Q 37 30 43 31 Q 43 20 50 13 Q 54 24 58 28 Q 62 22 66 25 Q 70 33 66 40 Z", "#FFE29A"), 50, 36, 0.3),
    marks: fill(dots([[24, 66, 1.6], [78, 62, 1.4], [70, 78, 1.4]]), "#FFD36B"),
  },
  "oni-red": { group: "red", color: "#D04A3E", back: loose(fill("M 72 36 Q 86 30 90 42 Q 92 52 84 60 Q 84 49 77 44 Z", "#4A2E36"), 76, 38, 0.6), marks: loose(fill(SMALL_HORNS, "#3A2A30"), 50, 33, 0.4) },

  // Orange
  astronaut: { group: "orange", color: "#E99335",
    back: ponytail("right", "#F5D06A", "#FFF0B8"),
    marks: tailTie("right", "#241C1C") + loose(fill(BOW, "#241C1C") + `<circle cx="50" cy="72" r="3" fill="#F6E3B0"/>`, 50, 72, 0.8),
  },
  "fox-ears": { group: "orange", color: "#E9883A",
    back: loose(fill("M 19 42 L 9 8 L 41 28 Z M 59 28 L 91 8 L 81 42 Z", "var(--slime-color)") + fill("M 20 32 L 18 19 L 33 29 Z M 67 29 L 82 19 L 80 32 Z", "#FFE7C9"), 50, 33, 0.3) +
      loose(fill("M 82 66 Q 100 60 98 42 Q 93 55 84 58 Z M 86 76 Q 102 74 100 58 Q 95 70 86 70 Z", "var(--slime-color)") + fill("M 94 48 Q 98 44 98 42 Q 99 48 96 52 Z M 98 62 Q 101 60 100 58 Q 101 64 99 67 Z", "#FFF3E2"), 88, 66, 0.6),
  },
  "alchemist-flask": { group: "orange", color: "#D98A4A",
    marks: fill("M 14 66 L 30 62 L 34 86 L 22 86 Z M 86 66 L 70 62 L 66 86 L 78 86 Z", "#F4F4F4") +
      fill("M 44 63 H 56 V 68 L 66 80 Q 66 85 60 85 H 40 Q 34 85 34 80 L 44 68 Z", "#CDEFE0") + fill("M 37 77 H 63 L 65 81 Q 64 84 60 84 H 40 Q 36 84 35 81 Z", "#4FB58C"),
  },
  "chef-hat": { group: "orange", color: "#E39A5A",
    marks: loose(fill("M 30 33 V 24 C 16 20 28 6 37 13 C 40 4 58 4 61 13 C 72 6 84 20 70 24 V 33 Q 50 30 30 33 Z", "#FFF6EA") + fill("M 30 30 Q 50 27 70 30 V 33 Q 50 30 30 33 Z", "#E8DCCB"), 50, 31, 0.4) +
      fill(SCARF_END, "#C8343F"),
  },
  "cat-ears": { group: "orange", color: "#D9822E",
    back: loose(fill("M 20 40 A 9 9 0 1 1 36 32 Z M 64 32 A 9 9 0 1 1 80 40 Z", "#3A2E2A") + fill("M 24 36 A 5 5 0 1 1 32 32 Z M 68 32 A 5 5 0 1 1 76 36 Z", "#F2B36A"), 50, 34, 0.3),
    marks: fill(dots([[22, 66, 2.6], [28, 74, 2], [78, 66, 2.6], [72, 74, 2], [34, 80, 1.8], [66, 80, 1.8]]), "#7A4A22"),
  },
  earth: { group: "orange", color: "#F0A04A",
    back: loose(fill("M 22 40 A 9 9 0 1 1 37 33 Z M 63 33 A 9 9 0 1 1 78 40 Z", "var(--slime-color)") + fill("M 25 36 A 5 5 0 1 1 33 33 Z M 67 33 A 5 5 0 1 1 75 36 Z", "#FFF1E0"), 50, 34, 0.3),
    marks: fill("M 12 62 L 24 60 L 14 66 Z M 10 70 L 22 70 L 12 75 Z M 88 62 L 76 60 L 86 66 Z M 90 70 L 78 70 L 88 75 Z", "#3A2A24"),
  },
  "dragon-ember": { group: "orange", color: "#E7792E",
    marks: loose(fill("M 36 31 Q 34 22 40 16 Q 42 24 46 24 Q 46 14 54 10 Q 54 20 58 22 Q 62 14 70 14 Q 64 22 64 31 Z", "#A8441E"), 50, 28, 0.4) +
      fill("M 70 60 L 78 58 L 77 60 L 71 62 Z M 71 64 L 79 62 L 78 64 L 72 66 Z", "#A8441E"),
  },
  medic: { group: "orange", color: "#EE9A4E",
    marks: fill(HEADBAND, "#C8343F") + fill("M 22 42 L 11 37 L 13 46 Z M 22 44 L 13 51 L 19 53 Z", "#C8343F") +
      fill("M 68 80 L 84 62 L 87 64 L 71 82 Z", "#C99A63") + fill("M 66 76 L 74 82 L 72 84 L 64 78 Z", "#7A4A2A"),
  },

  // Yellow
  thunder: { group: "yellow", color: "#E6B42E", marks: loose(fill(TWO_HORNS, "#4A3A2A"), 50, 34, 0.4) + fill("M 46 63 H 55 L 52 69 H 60 L 46 83 L 49 74 H 41 Z", "#FFF6D0") },
  paladin: { group: "yellow", color: "#EFC85A",
    back: ponytail("right", "#FFF0B8", "#FFFFFF"),
    marks: tailTie("right", "#3A5FA8") + fill(COLLAR, "#FBF7EC") + fill("M 50 69 L 54 73 L 50 77 L 46 73 Z", "#3A5FA8"),
  },
  bee: { group: "yellow", color: "#E8B82A",
    back: loose(fill("M 31 34 C 10 6 0 30 22 45 Z M 69 34 C 90 6 100 30 78 45 Z", "#DDF0F2"), 50, 37, 0.4),
    marks: loose(fill("M 42 30 Q 38 20 32 16 L 34 15 Q 41 19 45 29 Z M 58 30 Q 62 20 68 16 L 66 15 Q 59 19 55 29 Z", "#3A2E24") + fill(dots([[33, 15, 2.2], [67, 15, 2.2]]), "#3A2E24"), 50, 30, 0.5) +
      fill("M 12 70 Q 50 77 88 70 L 89 75 Q 50 83 11 75 Z", "#3A2E24"),
  },
  lemon: { group: "yellow", color: "#D9B43A",
    marks: loose(fill("M 52 30 Q 44 20 52 15 Q 60 12 63 19 Q 59 17 56 19 Q 52 22 57 28 Z", "#5E9A4A") + `<circle cx="59" cy="16.5" r="0.9" fill="#1E2A18"/>`, 55, 28, 0.4) +
      fill("M 18 60 L 24 58 L 25 63 L 19 65 Z M 20 67 L 26 65 L 27 70 L 21 72 Z M 82 60 L 76 58 L 75 63 L 81 65 Z M 80 67 L 74 65 L 73 70 L 79 72 Z", "#9AB04A"),
  },
  "archer-feather": { group: "yellow", color: "#EBD36A",
    back: fill("M 16 54 L 1 40 L 19 46 Z M 84 54 L 99 40 L 81 46 Z", "var(--slime-color)"),
    marks: fill("M 50 29 L 53 33 L 50 37 L 47 33 Z", "#3F9A6A"),
  },
  parcel: { group: "yellow", color: "#D9A84A",
    marks: loose(fill("M 46 30 Q 42 20 48 14 Q 48 22 52 24 Q 55 18 61 17 Q 56 23 56 30 Z", "#8A5A2A"), 50, 28, 0.4) +
      fill("M 63 61 L 74 57 L 76 63 L 65 67 Z", "#FFE3C4") + fill(dots([[68, 62, 0.9], [71, 61, 0.9]]), "#D9A27A"),
  },

  // Green
  "fairy-wings": { group: "green", color: "#3EA36A",
    marks: loose(fill("M 34 32 Q 28 20 36 16 Q 40 24 38 32 Z M 50 28 Q 46 14 52 10 Q 58 16 54 28 Z M 66 32 Q 72 20 64 16 Q 60 24 62 32 Z", "#A6E28A"), 50, 28, 0.4) +
      fill("M 14 66 Q 20 60 24 66 Q 28 72 34 70 Q 28 76 22 72 Q 18 70 14 72 Z", "#2E7D4F") + `<circle cx="78" cy="70" r="3" fill="#FFFFFF"/><circle cx="78" cy="70" r="1.4" fill="#F5C842"/>`,
  },
  "ranger-hood": { group: "green", color: "#4FAF4A",
    marks: fill("M 24 40 Q 30 26 50 25 Q 70 26 76 40 Q 50 32 24 40 Z", "#2D4F8E") + fill("M 75 38 L 86 34 L 84 42 Z", "#2D4F8E") +
      fill("M 70 84 L 80 52 L 82 53 L 73 85 Z", "#8A6A44") + fill("M 78 54 L 81 44 L 85 55 Z", "#DCE2EA"),
  },
  gardener: { group: "green", color: "#3C9E5A", marks: loose(fill(MAID_BAND, "#FFFFFF"), 50, 32, 0.4) + fill(CHEST_RIBBON, "#1E1E24") + `<circle cx="50" cy="75" r="2.4" fill="#1E1E24"/>` },
  frog: { group: "green", color: "#5DA34A", marks: loose(fill(SMALL_HORNS, "#2B3344"), 50, 33, 0.4) + fill(dots([[36, 72, 2.6], [43, 75, 2.6], [50, 76, 2.6], [57, 75, 2.6], [64, 72, 2.6]]), "#E9D7A8") },
  rainbow: { group: "green", color: "#57A84E",
    marks: loose(fill("M 31 38 Q 22 20 8 22 Q 18 27 23 40 Z", "#6B3FA0") + fill("M 69 38 Q 78 20 92 22 Q 82 27 77 40 Z", "#F5C842") +
      fill("M 25 42 Q 50 30 75 42 L 75 46 Q 50 34 25 46 Z", "#6B3FA0") + fill(dots([[8, 22, 3.2], [92, 22, 3.2]]), "#F5C842"), 50, 36, 0.4),
  },

  // Teal
  "dragon-ice": { group: "teal", color: "#7CCFE0",
    marks: loose(fill("M 32 35 L 35 24 L 42 30 L 50 17 L 58 30 L 65 24 L 68 35 Z", "#EFFBFF"), 50, 32, 0.3) +
      fill("M 76 74 L 77 71 L 78 74 L 81 75 L 78 76 L 77 79 L 76 76 L 73 75 Z M 22 78 L 23 76 L 24 78 L 26 79 L 24 80 L 23 82 L 22 80 L 20 79 Z", "#FFFFFF"),
  },
  cloud: { group: "teal", color: "#3BB3A2",
    back: loose(fill(SOFT_WINGS, "#F4F7F6"), 50, 46, 0.3),
    marks: loose(`<path d="M 37 17 A 13 4 0 1 0 63 17 A 13 4 0 1 0 37 17 Z M 40 17 A 10 2 0 1 0 60 17 A 10 2 0 1 0 40 17 Z" fill="#FFE69A" fill-rule="evenodd"/>`, 50, 22, 0.6),
  },
  water: { group: "teal", color: "#2C9BB0", marks: loose(fill(MAID_BAND, "#FFFFFF"), 50, 32, 0.4) + fill(CHEST_RIBBON, "#1E1E24") + `<circle cx="50" cy="75" r="2.4" fill="#1E1E24"/>` },
  mechanic: { group: "teal", color: "#2FA39A",
    marks: loose(fill(SMALL_HORNS, "#E8DFC8"), 50, 33, 0.4) +
      fill("M 20 62 L 27 60 L 26 67 L 19 68 Z M 80 62 L 73 60 L 74 67 L 81 68 Z M 23 70 L 29 69 L 28 74 L 22 75 Z M 77 70 L 71 69 L 72 74 L 78 75 Z", "#1E6E6A"),
  },
  sailor: { group: "teal", color: "#3AA8B8",
    marks: fill("M 28 38 Q 30 24 50 24 Q 70 24 72 38 Q 50 33 28 38 Z M 66 36 L 87 38 L 85 42 L 66 40 Z", "#2F4A8A") + `<circle cx="50" cy="29" r="2.4" fill="#F2C14E"/>` +
      fill(SCARF_END, "#F2F2F5"),
  },
  wind: { group: "teal", color: "#2BB59A",
    marks: loose(fill("M 30 34 Q 18 28 22 20 Q 32 22 34 32 Z", "#A8E49A") + fill("M 35 33 Q 40 24 46 28 Q 42 30 38 35 Z", "#D6F2C8"), 31, 33, 0.5) +
      fill("M 76 62 Q 86 58 88 66 Q 84 64 80 66 Q 86 70 84 78 Q 80 72 74 72 Z", "#A8E49A"),
  },
  octopus: { group: "teal", color: "#2E8FA0",
    marks: loose(fill("M 40 30 Q 50 6 66 26 Q 56 24 52 30 Z", "#1E5A6E"), 52, 29, 0.4) + fill("M 10 66 L 2 58 L 6 72 Z M 90 66 L 98 58 L 94 72 Z", "#1E5A6E") +
      fill(dots([[24, 70, 2], [30, 77, 1.6], [76, 70, 2], [70, 77, 1.6]]), "#7FC8D6"),
  },

  // Blue
  "wizard-cap": { group: "blue", color: "#4A6CD6",
    marks: fill(HOOD, "#2C3E7A") + `<circle cx="50" cy="68" r="3.2" fill="#D6A14A"/>` + fill("M 72 84 L 82 62 L 84 63 L 74 85 Z", "#8A6A44") + star(83, 60, "#FFE35A", 0.9),
  },
  "knight-plume": { group: "blue", color: "#3E6FB8",
    marks: fill(HELMET, "#C9D2DE") + loose(fill("M 46 24 Q 40 8 56 4 Q 54 14 54 24 Z", "#E84B4B"), 50, 24, 0.6) +
      fill("M 12 68 Q 15 57 28 59 L 33 66 L 29 75 Q 19 76 13 72 Z M 67 66 L 72 59 Q 85 57 88 68 L 87 72 Q 81 76 71 75 Z", "#C9D2DE"),
  },

  // Purple
  candle: { group: "purple", color: "#8B6BB0",
    marks: loose(fill("M 38 32 L 40 12 Q 50 4 60 12 L 62 32 Q 50 29 38 32 Z", "#F1EBDD") + fill("M 48 13 H 52 V 17 H 56 V 21 H 52 V 27 H 48 V 21 H 44 V 17 H 48 Z", "#D6A14A"), 50, 30, 0.4),
  },
  "witch-moon": { group: "purple", color: "#7E5AA8",
    marks: loose(fill("M 19 34 L 32 8 L 59 10 L 43 18 L 61 32 L 77 35 Q 50 41 19 34 Z", "#2E2848") + fill("M 22 33 Q 50 38 74 34 L 75 36 Q 50 40 21 35 Z", "#D6A14A") +
      fill("M 40 22 Q 36 26 40 30 Q 33 29 34 24 Q 35 20 40 22 Z", "#FFE35A"), 48, 34, 0.5),
  },
  "mage-star": { group: "purple", color: "#9A6FC0", marks: star(71, 64, "#FFD24A", 0.9) + `<circle cx="50" cy="61" r="3.5" fill="#E0485A"/>` },
  "maid-apron": { group: "purple", color: "#6E4E8E", marks: fill("M 14 70 Q 18 52 30 56 L 36 66 Z M 86 70 Q 82 52 70 56 L 64 66 Z", "#2A1E36") + fill(GEM, "#C8364E") },
  snow: { group: "purple", color: "#A070C8", marks: loose(fill(SMALL_HORNS, "#2E2240"), 50, 33, 0.4) + fill("M 50 70 L 54 75 L 50 81 L 46 75 Z", "#5A2E7A") },

  // Pink
  "fairy-flower": { group: "pink", color: "#E07BB0",
    back: loose(fill(SOFT_WINGS, "#FCE8F1") + fill("M 25 48 Q 13 46 9 38 Q 15 40 18 37 Q 20 43 28 45 Z M 75 48 Q 87 46 91 38 Q 85 40 82 37 Q 80 43 72 45 Z", "#F2C2D8"), 50, 46, 0.3),
    marks: loose(fill("M 48 30 Q 44 16 52 10 Q 54 20 56 30 Z", "#FFFFFF"), 52, 29, 0.5),
  },
  "rabbit-ears": { group: "pink", color: "#F28DB8",
    marks: loose(fill("M 50 30 L 36 20 L 36 36 Z M 50 30 L 64 20 L 64 36 Z", "#E2416E") + `<circle cx="50" cy="30" r="3.4" fill="#B82E57"/>`, 50, 30, 0.5) +
      `<circle cx="74" cy="72" r="6" fill="#B8865A"/><circle cx="70" cy="66" r="2.6" fill="#B8865A"/><circle cx="78" cy="66" r="2.6" fill="#B8865A"/><circle cx="74" cy="73" r="2.4" fill="#E8C9A8"/>`,
  },
  axolotl: { group: "pink", color: "#F29AC2", marks: fill("M 64 59 Q 67 63 66 66 Q 64 68 62 66 Q 61 63 64 59 Z", "#4A7BD6") + star(32, 63, "#FFFFFF", 0.6) },
  strawberry: { group: "pink", color: "#EC86A8",
    back: loose(`<circle cx="31" cy="31" r="7.5" fill="#F7D58C"/><circle cx="69" cy="31" r="7.5" fill="#F7D58C"/>`, 50, 32, 0.4),
    marks: loose(fill("M 31 38 L 26 35 L 26 41 Z M 31 38 L 36 35 L 36 41 Z M 69 38 L 64 35 L 64 41 Z M 69 38 L 74 35 L 74 41 Z", "#D6335E"), 50, 38, 0.5),
  },
  "cherry-blossom": { group: "pink", color: "#F57FB0", back: ponytail("right", "#FF5C9A", "#FFA6C8"), marks: tailTie("right", "#FFFFFF") + loose(star(32, 33, "#FFE35A", 1.1), 32, 33, 0.5) },
  artist: { group: "pink", color: "#E89AB2",
    marks: loose(fill(dots([[31, 30, 3.2], [36, 33, 3.2], [34, 38, 3.2], [28, 38, 3.2], [26, 33, 3.2]]), "#FFFFFF") + `<circle cx="31" cy="34.5" r="2.2" fill="#F5C842"/>`, 31, 34, 0.5),
  },

  // Gray
  "dragon-storm": { group: "gray", color: "#D9D5E3",
    back: loose(fill(BAT_WINGS, "#3A2E46") + fill("M 25 48 L 12 32 L 14 54 L 21 50 Z M 75 48 L 88 32 L 86 54 L 79 50 Z", "#5A4A6E"), 50, 46, 0.3),
    marks: loose(fill("M 32 32 L 23 26 L 24 37 Z M 32 32 L 41 26 L 40 37 Z", "#2A2236") + `<circle cx="32" cy="32" r="2.6" fill="#C8364E"/>`, 32, 32, 0.5) +
      fill(dots([[71, 74, 3.4], [75.5, 71.5, 3], [76, 77, 3], [67, 77.5, 3]]), "#B8243C") + `<circle cx="71.5" cy="74.5" r="2.4" fill="#E04A60"/>` + fill("M 64 80 Q 60 84 57 83 Q 61 80 64 79 Z", "#3B6B3E"),
  },
  "music-note": { group: "gray", color: "#A3A6AE",
    marks: loose(fill("M 38 30 L 40 16 H 60 L 62 30 Z", "#2E2A30") + fill("M 32 30 H 68 V 33 H 32 Z M 40 25 H 60 V 27 H 40 Z", "#7A3038"), 50, 30, 0.5) +
      loose(fill(BOW, "#A63A44") + `<circle cx="50" cy="72" r="2.6" fill="#7E2A33"/>`, 50, 72, 0.8),
  },
  "beast-fangs": { group: "gray", color: "#8C8F96",
    marks: fill("M 24 40 Q 50 30 76 40 L 76 44 Q 50 34 24 44 Z", "#D6A14A") + fill("M 50 33 L 53 36.5 L 50 40 L 47 36.5 Z", "#3A7BD5") +
      fill("M 26 64 Q 38 70 50 64 Q 62 70 74 64 Q 72 78 62 81 L 56 84 L 50 87 L 44 84 L 38 81 Q 28 78 26 64 Z", "#E6E1DA") + fill(dots([[44, 82, 1.8], [56, 82, 1.8]]), "#D6A14A"),
  },
  turtle: { group: "gray", color: "#B4B8C0", marks: fill("M 50 33 C 34 33 22 39 22 52 C 22 65 34 74 50 76 Z", "#F4F1EA") + fill("M 32 51 Q 38 45 46 50 Q 39 54 32 51 Z", "#24222A") + BARE_RIGHT_EYE, masked: true },
  pumpkin: { group: "gray", color: "#9EA3B0",
    marks: fill(HOOD, "#F4F1E7") + fill("M 20 46 Q 26 30 50 28 Q 74 30 80 46 Q 74 33 50 31 Q 26 33 20 46 Z", "#D6A14A") +
      fill("M 48 64 H 52 V 68 H 56 V 72 H 52 V 80 H 48 V 72 H 44 V 68 H 48 Z", "#D6A14A"),
  },
} as const satisfies Record<string, Face>;
export type SlimeCharacter = keyof typeof CHARACTERS;

// ---------- the crown of the primary member ----------

/**
 * One gold shape, no gem and no shine, drawn once on a slime. Its points are worked out into the drawing's own units
 * (crownMark below) and written as plain coordinates: the crown carries no `transform` of its own, since an engine that
 * reads a nested transform about the wrong origin set the crown down far from the head, beside the body.
 */
const CROWN_GOLD = "#F6C141";
/** The crown as drawn upright with its base's middle at (50, 30): the outline, with the points at its tips. */
const CROWN_OUTLINE = [[37, 32.4], [36.2, 18], [43.6, 23.8], [50, 14.2], [56.4, 23.8], [63.8, 18], [63, 32.4]] as const;
const CROWN_BASE_CONTROL = [50, 28] as const;
const CROWN_TIPS = [[36.2, 17.2, 2.4], [50, 13.2, 2.6], [63.8, 17.2, 2.4]] as const;
type CrownSpot = readonly [x: number, y: number, turn: number, size: number];
/**
 * Stuck on the outline from outside, not worn: its base sits square to the edge line without sinking into the body, on the upper right where the dome slopes 30 degrees. Each spot is a point of the outline
 * moved 0.7 out along its normal.
 */
const CROWN_EDGE: CrownSpot = [71.6, 33.7, 30, 0.62];
/**
 * A character whose own marks are there gets a spot of its own: two horns hold it upright between them, the cornflower mask and the green goggles push it down the edge, the charcoal streaks to the left, and the star
 * wolf's ears and the yellow wings to the top. One horn in the middle leaves the edge free.
 */
const CROWN_SPOTS: Partial<Record<SlimeCharacter, CrownSpot>> = {
  "horns-red": [50, 27.8, 0, 0.55], "horns-blue": [50, 27.8, 0, 0.55], "small-horns-pink": [50, 27.9, 0, 0.5],
  "mask-cornflower": [79.5, 40.1, 46, 0.6], "goggles-green": [81.7, 42.6, 50, 0.58], "streaks-charcoal": [28.4, 32.9, -32, 0.6],
  "wolf-star": [50, 27.6, 4, 0.6], "wings-yellow": [57, 28.2, 12, 0.62],
  thunder: [50, 27.8, 0, 0.55], "phoenix-feather": [50, 27.8, 0, 0.55], "oni-red": [50, 27.9, 0, 0.5], frog: [50, 27.9, 0, 0.5],
  "dog-ears": [50, 27.6, 0, 0.55], "fox-ears": [50, 27.6, 0, 0.55], "cat-ears": [50, 27.6, 0, 0.55], strawberry: [50, 27.6, 0, 0.55],
  "golem-stone": [81.7, 42.6, 50, 0.55], "knight-plume": [81.7, 42.6, 50, 0.55], "wizard-cap": [81.7, 42.6, 50, 0.55],
  pumpkin: [81.7, 42.6, 50, 0.55], "chef-hat": [81.7, 42.6, 50, 0.55], "witch-moon": [81.7, 42.6, 50, 0.55],
  candle: [81.7, 42.6, 50, 0.55], sailor: [81.7, 42.6, 50, 0.55], "butler-silver": [81.7, 42.6, 50, 0.55],
  "ranger-hood": [81.7, 42.6, 50, 0.55], "dragon-ember": [81.7, 42.6, 50, 0.55], "fairy-wings": [81.7, 42.6, 50, 0.55],
  "autumn-leaf": [28.4, 32.9, -32, 0.6], "cherry-blossom": [28.4, 32.9, -32, 0.6],
};
/** Where the crown of `slime` stands on its drawing. */
export const crownSpotOf = (slime: Slime): CrownSpot => ("character" in slime && CROWN_SPOTS[slime.character]) || CROWN_EDGE;
const unit = (value: number): string => String(+value.toFixed(2));
/**
 * The crown, placed on its spot in the drawing's units. It swings a moment after the body about its base like horns do
 * (`loose`), and it is not part of the dark rim: gold stands out from any page on its own, and a second copy of it
 * behind the first showed as a second crown wherever the two were not drawn alike.
 */
function crownMark(slime: Slime): string {
  const [x, y, turn, size] = crownSpotOf(slime);
  const cos = Math.cos(turn * Math.PI / 180) * size, sin = Math.sin(turn * Math.PI / 180) * size;
  const at = (px: number, py: number): [number, number] => [x + cos * (px - 50) - sin * (py - 30), y + sin * (px - 50) + cos * (py - 30)];
  const point = (px: number, py: number): string => at(px, py).map(unit).join(" ");
  const outline = CROWN_OUTLINE.map(([px, py], index) => `${index ? "L" : "M"} ${point(px, py)}`).join(" ");
  const shape = `<path d="${outline} Q ${point(...CROWN_BASE_CONTROL)} ${point(...CROWN_OUTLINE[0])} Z" fill="${CROWN_GOLD}" stroke="${CROWN_GOLD}" stroke-width="${unit(1.8 * size)}" stroke-linejoin="round"/>`;
  const tips = CROWN_TIPS.map(([px, py, r]) => { const [cx, cy] = at(px, py); return `<circle cx="${unit(cx)}" cy="${unit(cy)}" r="${unit(r * size)}" fill="${CROWN_GOLD}"/>`; }).join("");
  return loose(`<g class="slime-crown">${shape}${tips}</g>`, x, y, 0.6);
}

const CHARACTER_IDS = Object.keys(CHARACTERS) as SlimeCharacter[];
const COLOR_IDS = Object.keys(COLORS) as SlimeColor[];
const isCharacter = (id: string): id is SlimeCharacter => id in CHARACTERS;
const isColor = (id: string): id is SlimeColor => id in COLORS;

/** The colours a member with no choice of its own is given. */
const DEFAULT_COLORS = COLOR_IDS.filter(color => color !== "charcoal");

/** What earlier builds stored: colours of the first set, and costumes since made characters or gone. */
const OLD_COLORS: Record<string, SlimeColor> = { azure: "sky", mint: "teal", sunny: "ochre", coral: "coral", rose: "orchid", lilac: "lavender", slate: "charcoal", fox: "tangerine", sprout: "leaf", crown: "ochre" };

/** Who a slime is: a character, or a plain slime of a colour. */
export type Slime = { character: SlimeCharacter } | { color: SlimeColor };

export function parseSlime(avatar: string | null | undefined): Slime | null {
  if (!avatar?.startsWith("slime:")) return null;
  const [first = "", second] = avatar.slice(6).split(":");
  // A face stored under an old id is the same face under its new one (slime-ids.ts).
  const character = isCharacter(first) ? first : currentSlimeId(first);
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

// The eyes carry the character at 40 px, so they are drawn larger than the sheets, about their own middle; a hat clears them.
// A strip's eyes wear the same face from slime.css (.slime-loop-eyes), as a move and a scale.
const FACE_SCALE = "translate(49.5 48) scale(1.25) translate(-49.5 -48)";

const HAT_LIFT = -4;
const drawings = new Map<string, { back: string; worn: string }>();
const drawingIds = new Map<string, string>();

function strips(state: SlimeState, drawing: {back: string; worn: string}): [string,string] {
  return loopState(state) ? motionStrips(state,BODY,eyePath(state),drawing.back,drawing.worn) : ['',''];
}

/**
 * `moving` is the one switch of motion.
 * A slime drawn without it is a picture: the resting pose of its drawing (idle, or sleeping for a member that has been
 * silent for a day) with no strips, no clock, no motion variables and no state a handover could change, so it costs the
 * page nothing: nothing observes it and no event reaches it. Only the member list's rows and the conversation's thinking
 * line pass `moving`.
 */
export interface SlimeDrawing { now?: Date; state?: SlimeState; delay?: number; tempo?: number; since?: number; member?: number; crown?: boolean; moving?: boolean }

/** The shared vector surface; `slimeFaceHTML` supplies the member's fixed avatar box. */
export function slimeSVG(slime: Slime, { now = new Date(), state = "idle", delay = 0, tempo = 1, since, member, crown = false, moving = false }: SlimeDrawing = {}): string {
  hearThePointer();
  const look: Pick<Face, "color" | "back" | "marks" | "masked"> = "character" in slime ? CHARACTERS[slime.character] : { color: COLORS[slime.color] };
  // The primary member wears the crown in any season: a plain slime's hat gives way to it.
  const hat = "character" in slime || crown ? null : seasonalHat(now);
  const dressed = (look.marks ?? "") + (hat ? loose(`<g transform="translate(0 ${HAT_LIFT})">${HATS[hat]}</g>`, 50, 30, 0.6) : "");
  const worn = dressed + (crown ? crownMark(slime) : "");
  const maskAttribute = (look.masked ? ' data-slime-mask=""' : "") + (isDark(look.color) ? ' data-slime-dark=""' : "");
  // A dark slime stands on a light silhouette of itself (its body, hair, horns, wings and hat) one stroke wider all round, drawn
  // first and shown only in the dark theme (slime.css `.slime-rim`): the rim is its whole outline, and no filter is needed.
  // A brighter slime that wears something dark (black horns, dark wings, a dark band) gets the same rim round what it wears
  // alone: behind the body, only what stands out of it shows the line.
  const darkBody = isDark(look.color), darkWear = !darkBody && wearsDark(`${look.back ?? ''}${dressed}`);
  // The crown is left out of it: it is the marker of the chief and is drawn once.
  const rim = darkBody ? `<g class="slime-rim">${look.back ?? ''}${correction(`<path d="${BODY}"/>`)}${dressed}</g>`
    : darkWear ? `<g class="slime-rim">${look.back ?? ''}${dressed}</g>` : '';
  // The rim is in the resting picture only: in the strips of a moving slime it would be drawn again in every cel (R-PERF-01),
  // so there a dark body keeps a stroke of its own instead (slime.css `.slime-cel-body`).
  const back = rim + (look.back ?? '');
  const key = `${look.back ?? ''}|${worn}`;
  let drawingId = drawingIds.get(key);
  if (!drawingId) { drawingId=String(drawings.size);drawingIds.set(key,drawingId);drawings.set(drawingId,{back:look.back ?? '',worn}); }
  // The picture of a slime keeps only the pose a state gives without moving: asleep, or at rest.
  if (!moving) state = state === "sleeping" ? "sleeping" : "idle";
  const [bodyStrip,eyeStrip] = moving ? strips(state,drawings.get(drawingId)!) : ['',''];
  // Each member glances to its own side at rest; neighbours in a list look different ways.
  const aside = member !== undefined && Math.abs(member) % 2 === 1 ? 3 : -3;
  const body = `<g class="slime-press"><g class="slime-settle"><g class="slime-counterturn"><g class="slime-motion">` +
    (back ? `<g class="slime-back">${back}</g>` : "") + correction(`<path d="${BODY}" fill="var(--slime-color)" class="slime-body"/>`) + `<g class="slime-marks">${worn}</g>` +
    `<g class="slime-face" transform="${FACE_SCALE}"><g class="slime-follow"><g class="slime-look"><g class="slime-counterturn"><g class="slime-gaze" fill="none" stroke="#fff" stroke-linecap="round"><path class="slime-eyes" d="${eyePath(state)}"/></g></g></g></g></g>` +
    `</g></g></g></g>`;
  // A picture has no clock, no member to hand over to and no motion variables; `data-slime-still` names whose it is for patchHTML.
  if (!moving) return `<span class="slime-surface"${maskAttribute} data-slime-still="${member ?? ''}" data-slime-drawing="${drawingId}" data-slime-reuse="${drawingId}:${look.color}:still:${member ?? ''}" data-state="${state}" aria-hidden="true" style="--slime-color:${look.color}"><svg class="slime" viewBox="4 11 92 92" data-state="${state}" aria-hidden="true" focusable="false" style="--slime-color:${look.color};--slime-aside:${aside}px">${body}</svg></span>`;
  return `<span class="slime-surface"${maskAttribute} data-slime-drawing="${drawingId}" data-slime-reuse="${drawingId}:${look.color}:${tempo}:${member ?? ''}" data-state="${state}" aria-hidden="true" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo}">${bodyStrip}<svg class="slime" viewBox="4 11 92 92" data-slime-mounted="${performance.now()}" data-state="${state}"${member === undefined ? "" : ` data-slime-member="${member}"`} aria-hidden="true" focusable="false" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo};--slime-aside:${aside}px${since === undefined ? "" : `;--slime-since:${since}ms`}">` +
    body + `</svg>${eyeStrip}</span>`;
}

// ---------- under the pointer ----------

let hearing = false;

/** Whether a body colour is dark enough to sink into the dark theme's page (relative luminance under 0.1). */
export function isDark(hex: string): boolean {
  const channel = (at: number): number => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return /^#[0-9a-f]{6}$/i.test(hex) && 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) < 0.1;
}

/** Whether drawn marks hold a dark colour that would sink into the dark theme's page. */
const wearsDark = (marks: string): boolean => [...marks.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].some(([, hex]) => isDark(hex!));

/** How far a resting slime's eyes go toward the pointer, in the drawing's units (the glance aside is 3). */
export const GAZE_REACH = { x: 3.5, y: 3 } as const;

/**
 * Where a slime's eyes look for a pointer at (`dx`, `dy`) from its middle, on a slime `size` wide: toward it, reaching
 * as far as they go once the pointer is `reach` slimes away (two by default; half a slime for a face whose own button the
 * pointer is on, so it follows the pointer across that button).
 */
export function gazeToward(dx: number, dy: number, size: number, reach = 2): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || size <= 0) return { x: 0, y: 0 };
  const strength = Math.min(1, distance / (size * reach));
  const round = (value: number): number => Math.round(value * 10) / 10 || 0;
  return { x: round((dx / distance) * GAZE_REACH.x * strength), y: round((dy / distance) * GAZE_REACH.y * strength) };
}

/** Where a face looks only while the pointer is on its own button: the member list (its rows and pinned tiles) and the slime pickers. */
const HOVER_PLACES = ".mb-item, .mb-pinned, .mb-slime-characters";

let pointer: { x: number; y: number; target: Element | null } | null = null;
let gazeFrame = 0;

/**
 * The resting faces on screen look at the pointer (slime.css `[data-slime-gazing]`). Anywhere in the window a face follows
 * it; in the member list and a picker a face follows it only while the pointer is on that face's own button (its row, its
 * tile, its choice), so the owner sees which one is under it, and is as before once the pointer leaves. The script runs
 * only when the pointer moves, at most once a frame; when it leaves the window or a touch takes over, every face glances
 * aside again.
 */
function gaze(): void {
  gazeFrame = 0;
  for (const surface of document.querySelectorAll<HTMLElement>(".slime-surface:not([data-offscreen])")) {
    const area = surface.closest(HOVER_PLACES) ? surface.closest<HTMLElement>("button") ?? surface : null;
    const looking = pointer !== null && (!area || (pointer.target !== null && area.contains(pointer.target)));
    const box = looking ? surface.getBoundingClientRect() : null;
    if (!pointer || !box || box.width === 0) {
      if (surface.dataset.slimeGazing === undefined) continue;
      delete surface.dataset.slimeGazing;
      surface.style.removeProperty("--slime-gaze-x");
      surface.style.removeProperty("--slime-gaze-y");
      continue;
    }
    const eyes = gazeToward(pointer.x - (box.left + box.width / 2), pointer.y - (box.top + box.height / 2), box.width, area ? 0.5 : 2);
    surface.style.setProperty("--slime-gaze-x", `${eyes.x}px`);
    surface.style.setProperty("--slime-gaze-y", `${eyes.y}px`);
    surface.dataset.slimeGazing = "";
  }
}

function lookAgain(next: { x: number; y: number; target: Element | null } | null): void {
  // No pointer before and none now: every face already glances aside.
  if (next === null && pointer === null) return;
  pointer = next;
  if (!gazeFrame) gazeFrame = requestAnimationFrame(gaze);
}

/**
 * Under the pointer a slime does not wiggle any more: a resting face follows the pointer with its eyes, in the member list
 * and a picker only while the pointer is on its own button, and glances aside when there is no pointer (slime.css). Here
 * the following, and the end of a handover.
 */
function hearThePointer(): void {
  if (hearing || typeof document === "undefined") return;
  hearing = true;
  document.addEventListener("pointermove", event => {
    lookAgain(event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY, target: event.target instanceof Element ? event.target : null });
  }, { passive: true });
  document.addEventListener("pointerout", event => { if (!event.relatedTarget) lookAgain(null); });
  window.addEventListener("blur", () => lookAgain(null));
  document.addEventListener("animationend", event => {
    if (event.animationName === 'slime-idle-hide') {
      const svg=(event.target as Element).closest<SVGElement>('svg.slime');
      if(!svg)return;
      const clock=clockOf(svg);
      // The vector keeps its moving pose until the strips it makes way for are in and shown (mountSlice ends the moment then).
      if(!clock.mounting && !clock.pending)endTransition(svg);
    }
  });
}

/** The vector stops standing in for the strips: its animations and their delays go, and the strips (shown by then) are what is seen. */
function endTransition(svg: SVGElement): void {
  delete svg.dataset.transitioning;
  for (const part of svg.querySelectorAll<SVGElement>('[style]')) part.style.removeProperty('animation-delay');
}

type Bridge = { values: number[]; started: number; duration: number; animations: Animation[] };
const settling = new WeakMap<SVGElement, Bridge>();
interface SlimeClock {
  state: SlimeState; mounted: number; delay: number; tempo: number; since: number;
  sampled: boolean; transitionUntil: number;
  reveal?: Animation;
  surface: HTMLElement; drawingKey: string; drawing?: { back: string; worn: string }; pending: boolean;
  /** The strips being put in, a slice a frame; a newer state or a redraw drops them. */
  mounting?: Mounting;
  settle: SVGElement; look: SVGElement; motion: SVGElement; gaze: SVGElement; eyes: SVGElement;
  marks: { part: SVGElement; bridge: SVGElement; give: number }[];
}
const clocks = new WeakMap<SVGElement, SlimeClock>();
/** Hydrate once at mount; subsequent handovers only consult the JS clock and cached parts. */
function clockOf(svg: SVGElement): SlimeClock {
  let clock = clocks.get(svg);
  // A clock belongs to the drawing it was made for: one carried into another face is made again (ui.ts patchHTML).
  if (clock && clock.surface === svg.parentElement && clock.drawingKey === (clock.surface.dataset.slimeDrawing ?? '')) return clock;
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
    eyes: svg.querySelector<SVGElement>('.slime-eyes')!,
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

/** The header's status light follows what members are doing (status-light.ts): a change is told once, after it is made. */
const tellActivity = (): void => { if (typeof window !== "undefined") window.dispatchEvent(new Event("slime-activity")); };
/** What each member is doing now, as the core last said: live states only, none for a member at rest. */
export const liveStates = (): ReadonlyMap<number, SlimeState> => activity;

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
    // Small avatars display sampled poses (about 24 a second), with independently timed eyes and props.
    const cels = celsOf(state, kind);
    const sampled = clock.sampled && now >= clock.transitionUntil ? Math.floor(((phase % 1) + 1) % 1 * cels) / cels : phase;
    pose = sample(`slime-${state}-${kind === 'eyes' ? 'gaze' : kind}`, sampled, kind === 'eyes' ? loop.gaze : loop.ease);
    if (state === 'blocked' && kind === 'eyes') pose.translate = [0, -6];
    // The deflate of slime.css (`slime-error-body`: scale 1 to 1.08 .62 over 1.6s, ease-out): a slime that has only just failed is still whole.
    if (state === 'error' && kind === 'body') { const deflated = easing('ease-out', Math.min(1, Math.max(0, (elapsed - clock.since) / 1600))); pose.scale = [1 + .08 * deflated, 1 - .38 * deflated]; }
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
  clock.mounting = undefined;
  if (clock.state !== state) {
    svg.dataset.state = svg.dataset.moved = state;
    surface.dataset.state = state;
    // The new state's eyes are the drawing's own as well: WebKit has no CSS `d`, so it changes them here, at once.
    clock.eyes.setAttribute('d', eyePath(state));
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
    mountStrips(svg, clock, template, state);
  }
}

/**
 * A strip is some thousands of nodes (a slime that thinks or searches: about 4,000), and styling them in one go held the
 * window for 100 ms and more at every change of state. They go in a slice
 * of about this many nodes a frame, out of sight (`data-slime-loading`), and show together when the last one is in.
 */
const SLICE_NODES = 200;
interface Mounting { svg: SVGElement; clock: SlimeClock; state: SlimeState; parts: { root: Element; target: Element; cells: ChildNode[]; per: number; at: number }[]; part: number }
const mounts: Mounting[] = [];

function mountStrips(svg: SVGElement, clock: SlimeClock, template: HTMLTemplateElement, state: SlimeState): void {
  const parts = [...template.content.children].map(strip => {
    // The strip's wrappers, empty: its cells are cloned in below, a slice at a time.
    const source = strip.querySelector('svg')!;
    const root = strip.cloneNode(false) as Element;
    let from: Element = strip, target = root;
    while (from !== source) {
      const next = [...from.children].find(child => child === source || child.contains(source))!;
      const copy = next.cloneNode(false) as Element;
      target.append(copy); target = copy; from = next;
    }
    root.setAttribute('data-slime-loading', '');
    const cells = [...source.childNodes];
    return { root, target, cells, per: 1 + ((cells[0] as Element | undefined)?.querySelectorAll?.('*').length ?? 0), at: 0 };
  });
  const job: Mounting = { svg, clock, state, parts, part: 0 };
  clock.mounting = job;
  if (parts[0]) svg.before(parts[0].root);
  if (parts[1]) svg.after(parts[1].root);
  mountSlice(job);
  if (clock.mounting === job) mounts.push(job);
}

/** Puts in the next slice of a mount; the last one shows the strips and starts their clocks. */
function mountSlice(job: Mounting): void {
  let room = SLICE_NODES;
  while (room > 0 && job.part < job.parts.length) {
    const part = job.parts[job.part]!;
    const take = Math.min(part.cells.length - part.at, Math.max(1, Math.floor(room / part.per)));
    if (take > 0) part.target.append(...part.cells.slice(part.at, part.at + take).map(cell => cell.cloneNode(true)));
    part.at += take; room -= take * part.per;
    if (part.at >= part.cells.length) job.part++;
  }
  if (job.part < job.parts.length) return;
  const { svg, clock, state } = job;
  clock.mounting = undefined;
  for (const part of job.parts) part.root.removeAttribute('data-slime-loading');
  const surface = clock.surface;
  // Motion retains the original phase. Each admitted surface reveals on its own
  // frame's finite bridge instead of rasterizing an entire presence burst at once.
  const elapsed = Math.max(0, performance.now() - clock.mounted);
  // animation-delay does not inherit into hundreds of static cel paths.
  const delay = clock.delay - elapsed;
  for (const part of surface.querySelectorAll<HTMLElement>('.slime-cels, .slime-eye-cels, .slime-blink-cels')) part.style.animationDelay = `${delay}ms`;
  const lag = state === 'thinking' ? 140 : state === 'searching' ? 120 : 0;
  for (const part of surface.querySelectorAll<HTMLElement>('.slime-prop-cels')) part.style.animationDelay = `${delay + lag}ms`;
  if (svg.dataset.transitioning) {
    // A change of state: the vector has stood in since the change, on the clock these strips now join (the delay above), and its
    // moment (320ms, or 1.6s for an error) ends by itself. The strips are shown when it does, however many frames they took to
    // mount: their show animation is given the time already gone, so that a mount which outlived the moment shows them at once.
    for (const part of job.parts) (part.root as HTMLElement).style.animationDelay = `${-elapsed}ms`;
    if (!clock.reveal) endTransition(svg);
  } else holdVector(svg, clock, state === 'error' ? 1600 : 320);
}

/** The next slice of the mount under way, if any: a frame does one slice, or admits one more face, never both. */
function continueMount(): boolean {
  while (mounts.length) {
    const job = mounts[0]!;
    if (job.clock.mounting !== job || !job.svg.isConnected) { mounts.shift(); continue; }
    mountSlice(job);
    if (job.clock.mounting !== job) mounts.shift();
    return true;
  }
  return false;
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
    clock.reveal = undefined;
    if (!clock.mounting && !clock.pending) endTransition(svg);
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
    if (!continueMount()) for (const svg of pendingStrips) {
      pendingStrips.delete(svg);
      const clock = clockOf(svg);
      if (!svg.isConnected || !clock.pending || document.visibilityState === 'hidden' || svg.closest('[data-offscreen], [hidden], details:not([open])')) continue;
      enter(svg, clock.state);
      break;
    }
    if (pendingStrips.size || mounts.length) scheduleStrips();
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

/**
 * The list the core just read says what each member is doing, for a window that opened late. A moment plays out first.
 * A face already on screen is handed over to it here, with the bridge every change of state has, so that the redraw
 * which follows finds it as it should be and keeps it (patchHTML) instead of drawing a new one in its place.
 */
export function followSlimeRoster(members: readonly { id: number; activity?: string; activity_label?: string; waiting?: boolean }[]): void {
  for (const { id, activity: state, activity_label: label, waiting } of members) {
    if (label !== undefined && label !== (labels.get(id) ?? "")) setLabel(id, label);
    if (fleeting.has(id)) continue;
    if (state && LIVE_STATES.includes(state)) {
      if (activity.get(id) !== state) began.set(id, performance.now());
      activity.set(id, state as SlimeState);
    } else activity.delete(id);
    paint(id, waiting ? "blocked" : activity.get(id) ?? resting.get(id) ?? "idle");
  }
  tellActivity();
}

/** The words for what a member is doing, on every face of it already drawn: a face is not drawn again for them. */
function setLabel(id: number, label: string): void {
  labels.set(id, label);
  for (const face of document.querySelectorAll<HTMLElement>(`[data-presence-member="${id}"]`)) {
    if (label) { if (face.dataset.tooltip !== label) face.dataset.tooltip = label; }
    else face.removeAttribute("data-tooltip");
  }
}

/** What the core says a member is doing; `idle` hands it back to what its row says. A moment like `done` passes by itself. */
export function setSlimeState(id: number, state: SlimeState, label?: string): void {
  if (label !== undefined) setLabel(id, label);
  if (activity.get(id) === state) return;
  // The core says `idle` right after `done`: the moment plays out, and then the row has its say anyway.
  if (state === "idle" && fleeting.has(id)) return;
  const was = fleeting.get(id);
  if (was !== undefined) { clearTimeout(was); fleeting.delete(id); }
  began.set(id, performance.now());
  if (state === "idle") activity.delete(id); else activity.set(id, state);
  paint(id, state === "idle" ? resting.get(id) ?? "idle" : state);
  tellActivity();
  const lasts = FLEETING_MS[state];
  if (lasts === undefined) return;
  fleeting.set(id, setTimeout(() => {
    fleeting.delete(id);
    activity.delete(id);
    paint(id, resting.get(id) ?? "idle");
    tellActivity();
  }, lasts));
}

/** A small stable spread that follows the clock, so a list does not move in step and a redraw does not make it jump. */
const delayOf = (seed: number, now: number): number => -Math.round(now + (Math.abs(seed) % 7) * 777);
/** Each member keeps its own pace, a few hundredths either way, so that a list never falls into step for long. */
const tempoOf = (seed: number): number => Number((0.94 + (Math.abs(seed * 37) % 13) * 0.01).toFixed(2));

/**
 * The slime a member shows: its own choice, or a colour from its id. A picture unless `moving` (the member list's rows and
 * the conversation's thinking line): then it follows what the member is doing.
 */
export function slimeFaceHTML(member: SlimeFacts & { avatar?: string | null }, size: number, cls = "", moving = false): string {
  const slime = parseSlime(member.avatar) ?? { color: defaultColor(member.id) };
  const rest = restingState(member, Date.now());
  resting.set(member.id, rest);
  const label = labels.get(member.id) ?? "";
  const frame = `<span class="av mb-av mb-av-slime${cls ? ` ${cls}` : ""}" data-presence-member="${member.id}"${label ? ` data-tooltip="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"` : ""} style="--av:${Math.round(size)}px" aria-hidden="true">`;
  // A picture shows no activity: whatever the member is doing, its drawing does not change, so a redraw that carries
  // a new state touches nothing.
  if (!moving) return frame + slimeSVG(slime, { state: rest, member: member.id, crown: member.id === crownedId() }) + `</span>`;
  const state = member.waiting ? "blocked" : activity.get(member.id) ?? rest, now = performance.now(), start = began.get(member.id);
  return frame +
    slimeSVG(slime, { state, member: member.id, crown: member.id === crownedId(), delay: delayOf(member.id, now), tempo: tempoOf(member.id), since: start === undefined ? undefined : -Math.round(now - start), moving: true }) + `</span>`;
}

// ---------- the picture menu ----------

/** Bareheaded in any season, so that a slime shows what it is. */
const OFF_SEASON = new Date(2000, 5, 1);

const IN_MENU = ' role="menuitem" tabindex="-1"';

/** The characters under `group` (every one the picker offers without it), each as a button; `item` makes them a menu's items. */
export function slimeCharactersHTML(avatar: string | null | undefined, esc: (text: string) => string, item = "", group?: SlimeGroup): string {
  const current = parseSlime(avatar), who = current && "character" in current ? current.character : null;
  // A slime has no name: it is told by its look, and only a screen reader hears its colour and its place under it.
  const places = new Map<SlimeGroup, number>();
  return CHARACTER_IDS.filter(id => group === undefined || CHARACTERS[id].group === group).map(id => {
    const own = CHARACTERS[id].group, place = (places.get(own) ?? 0) + 1;
    places.set(own, place);
    const label = esc(t("slime.place", { p0: slimeGroupName(own), p1: place }));
    return `<button type="button"${item} class="mb-preset mb-preset-slime" data-slime-character="${id}" aria-pressed="${id === who}" aria-label="${label}">${slimeSVG({ character: id }, { now: OFF_SEASON })}</button>`;
  }).join("");
}

/**
 * The face a new member starts from in the maker, the `count`-th: a character the picker offers, a colour further on for
 * each member already there, so the team does not start alike.
 */
export function newMemberSlime(count: number): string {
  const group = SLIME_GROUPS[Math.abs(count) % SLIME_GROUPS.length]!;
  const ids = CHARACTER_IDS.filter(id => CHARACTERS[id].group === group);
  return `slime:${ids[Math.floor(Math.abs(count) / SLIME_GROUPS.length) % ids.length]}`;
}

/** The colours of the picker, in the order of its swatches: six in the first row, five in the second. */
export const SLIME_GROUPS = Object.keys(GROUPS) as ColourGroup[];
export type SlimeGroup = ColourGroup;
/** The words of a colour's swatch (it carries no words of its own). */
export const slimeGroupName = (group: SlimeGroup): string => t(GROUPS[group].name);
/** The colour of a swatch. */
export const slimeGroupSwatch = (group: SlimeGroup): string => GROUPS[group].swatch;

/** The colour that holds a face: where the picker opens. A face the picker does not offer opens on the colour nearest its own. */
export function slimeGroupOf(avatar: string | null | undefined): SlimeGroup {
  const slime = parseSlime(avatar);
  if (slime === null) return SLIME_GROUPS[0];
  if ("color" in slime) return nearestGroup(COLORS[slime.color]);
  return CHARACTERS[slime.character].group;
}

/**
 * The picker's slimes: one panel for each colour, its eight characters, none with a heading (its swatch says it). They are
 * all drawn and stand on one another in one cell, so a press on a swatch moves nothing; the one that is open is
 * `data-active`, and the others are `inert` (the keys and the pointer pass them by). `open` is the colour that shows first.
 */
export function slimePickerHTML(avatar: string | null | undefined, esc: (text: string) => string, open: SlimeGroup = slimeGroupOf(avatar)): string {
  return SLIME_GROUPS.map(group => {
    const grid = `<div class="mb-presets mb-slime-characters">${slimeCharactersHTML(avatar, esc, IN_MENU, group)}</div>`;
    const on = group === open;
    return `<div class="mb-slime-group" id="slime-panel-${group}" data-slime-group="${group}" role="tabpanel" aria-labelledby="slime-tab-${group}"${on ? " data-active" : " inert"}>${grid}</div>`;
  }).join("");
}

/** A press in that menu: the avatar it makes, with the menu showing it where it stands, or null when the press was on neither. */
export function pickSlime(button: HTMLElement): string | null {
  const { slimeCharacter, slimeColor } = button.dataset;
  if (!slimeCharacter && !slimeColor) return null;
  const menu = button.closest(".menu") ?? document;
  for (const other of menu.querySelectorAll<HTMLElement>("[data-slime-character], [data-slime-color]")) other.setAttribute("aria-pressed", String(other === button));
  return slimeCharacter ? `slime:${slimeCharacter}` : `slime:color:${slimeColor}`;
}
