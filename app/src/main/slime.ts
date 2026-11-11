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
import { celsOf, loopState, LOOPS, sample, easing } from "./slime-motion";
import { crownedId } from "./crown";

export type SlimeState = "idle" | "thinking" | "working" | "searching" | "computer" | "waiting" | "blocked" | "done" | "error" | "sleeping" | "arriving";
type Hat = "witch" | "santa";

/** Raphael's colour: the first blue slime's, his face (the `rimuru` character below). */
export const RAPHAEL_COLOR = "#3DB5FF";

/** The plain slimes' colours, with clear, saturated swatches. */
const COLORS = {
  sky: "#1EA7FD", lavender: "#905AFB", coral: "#FC2C3E", tangerine: "#F9670E", ochre: "#F69412",
  leaf: "#14C370", teal: "#13B8A3", ocean: "#1884FC", orchid: "#FB3499", charcoal: "#777777",
  ruby: "#BD1741", peach: "#FFA265", gold: "#DCC515", lime: "#9BCB16", emerald: "#087F58",
  cyan: "#04C9DE", cobalt: "#3942CE", violet: "#B13EE3", raspberry: "#AF228D", rose: "#FA80AB",
} as const;
export type SlimeColor = keyof typeof COLORS;

const COLOR_NAMES = {
  sky: "slime.color.sky", lavender: "slime.color.lavender", coral: "slime.color.coral", tangerine: "slime.color.tangerine", ochre: "slime.color.ochre",
  leaf: "slime.color.leaf", teal: "slime.color.teal", ocean: "slime.color.ocean", orchid: "slime.color.orchid", charcoal: "slime.color.charcoal",
  ruby: "slime.color.ruby", peach: "slime.color.peach", gold: "slime.color.gold", lime: "slime.color.lime", emerald: "slime.color.emerald",
  cyan: "slime.color.cyan", cobalt: "slime.color.cobalt", violet: "slime.color.violet", raspberry: "slime.color.raspberry", rose: "slime.color.rose",
} as const satisfies Record<SlimeColor, string>;

/** Picker sections, in the order the owner reads them. */
const GROUP_NAMES = {
  characters: "slime.group.characters", animals: "slime.group.animals", jobs: "slime.group.jobs", nature: "slime.group.nature",
  seasonal: "slime.group.seasonal", objects: "slime.group.objects", colors: "slime.group.colors",
} as const;
type CharacterGroup = Exclude<keyof typeof GROUP_NAMES, "colors">;

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
  rimuru: { group: "characters", name: "slime.rimuru", color: RAPHAEL_COLOR },
  shion: { group: "characters", name: "slime.shion", color: COLORS.lavender, marks: loose(fill(ONE_HORN, "#363140"), 49, 34) },
  diablo: { group: "characters", name: "slime.diablo", color: COLORS.charcoal,
    marks: `<path d="${COLLAR} M 48 73 L 52 73 L 53 77 L 51 83 L 49 83 L 47 77 Z" fill="#FFF6E9" fill-rule="evenodd"/>` +
      fill("M 60 31 L 64 32 L 69 42 L 65 40 Z", "#EE5A64") + fill("M 67 34 L 71 36 L 75 45 L 71 43 Z", "#F5CE55"),
  },
  benimaru: { group: "characters", name: "slime.benimaru", color: "#F23B3B", marks: loose(fill(TWO_HORNS, "#2B2430"), 50, 34, 0.4) },
  shuna: { group: "characters", name: "slime.shuna", color: "#FF8FC4", marks: loose(fill(SMALL_HORNS, "#FBEFE3"), 50, 33, 0.4) },
  souei: { group: "characters", name: "slime.souei", color: "#3A62C8", marks: loose(fill(ONE_HORN, "#1B2238"), 49, 34) + fill(SASH, "#F2F2F5") },
  hakurou: { group: "characters", name: "slime.hakurou", color: "#8E949C", marks: loose(fill("M 50 66 C 44 63 35 64 29 72 C 37 73 45 72 50 69 Z M 50 66 C 56 63 65 64 71 72 C 63 73 55 72 50 69 Z", "#FFFFFF"), 50, 67, 0.7) },
  gobta: { group: "characters", name: "slime.gobta", color: "#4CC85A",
    marks: fill("M 28 37 Q 50 26 72 37 L 72 40 Q 50 30 28 40 Z", "#3A3A44") +
      `<circle cx="39" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/><circle cx="61" cy="33" r="5.5" fill="#D9E6EA" stroke="#3A3A44" stroke-width="2.5"/>`,
  },
  rigur: { group: "characters", name: "slime.rigur", color: COLORS.leaf, marks: fill("M 22 42 C 30 27 68 25 78 42 Q 50 31 22 42 Z", "#A8342F") },
  rigurd: { group: "characters", name: "slime.rigurd", color: "#2FA24F", marks: loose(fill(BOW, "#1E1E24") + `<circle cx="50" cy="72" r="3" fill="#D6A14A"/>`, 50, 72, 0.8) },
  milim: { group: "characters", name: "slime.milim", color: "#FF7AA6", marks: loose(`<path d="M 50 30 C 47 21 53 13 61 15 C 55 17 52 23 54 30 Z" fill="var(--slime-color)"/>`, 52, 30) },
  veldora: { group: "characters", name: "slime.veldora", color: "#3463D6", marks: loose(fill(TWO_HORNS, "#C9D2E3"), 50, 34, 0.4) },
  ranga: { group: "characters", name: "slime.ranga", color: "#6C7A9E",
    back: loose(`<path d="M 19 42 Q 15 25 20 14 Q 32 19 38 32 Z M 62 32 Q 69 19 80 14 Q 85 26 81 42 Z" fill="var(--slime-color)"/>`, 50, 38, 0.3),
    marks: fill("M 50 30 L 52 35 L 57 35 L 53 38 L 55 43 L 50 40 L 45 43 L 47 38 L 43 35 L 48 35 Z", "#F2C14E"),
  },
  gabiru: { group: "characters", name: "slime.gabiru", color: "#8A82D6", marks: fill("M 18 78 Q 24 70 30 78 Q 36 70 42 78 Q 48 70 54 78 Q 60 70 66 78 Q 72 70 78 78 L 76 84 Q 50 90 22 84 Z", "#F2EBDD") },
  geld: { group: "characters", name: "slime.geld", color: "#C98A45", marks: fill("M 35 80 C 33 73 34 68 38 64 C 40 69 42 74 43 81 Z M 65 80 C 67 73 66 68 62 64 C 60 69 58 74 57 81 Z", "#FBF3DC") },
  treyni: { group: "characters", name: "slime.treyni", color: "#1FC29A",
    marks: loose(fill("M 48 32 L 48 19 Q 49 17 51 19 L 52 32 Z", "#2E7D4F") + fill("M 50 24 C 35 25 29 18 29 12 C 41 10 49 14 50 24 Z M 50 24 C 51 11 61 8 71 10 C 70 20 61 25 50 24 Z", "#8FD18A"), 50, 30),
  },
  kurobe: { group: "characters", name: "slime.kurobe", color: "#8E7254", marks: fill("M 23 39 Q 50 26 77 39 L 80 45 Q 50 31 20 45 Z", "#EFEFEF") },
  shizu: { group: "characters", name: "slime.shizu", color: "#6A86CC", marks: `<ellipse cx="50" cy="35" rx="15" ry="6" fill="#F4F4F7"/>` + `<path d="M 39 35 Q 44 31 50 35 T 61 35" fill="none" stroke="#C94250" stroke-width="2.5" stroke-linecap="round"/>` },
  hinata: { group: "characters", name: "slime.hinata", color: "#5A63A3", marks: fill(COLLAR, "#F4F4F7") + fill("M 48 72 H 52 V 84 H 48 Z", "#D6A14A") },
  guy: { group: "characters", name: "slime.guy", color: "#E0304B", marks: fill(SASH, "#2A1A1E") },
  testarossa: { group: "characters", name: "slime.testarossa", color: "#D5D9D6", marks: loose(fill(BOW, "#3FBF94") + `<circle cx="50" cy="72" r="3" fill="#FFFFFF"/>`, 50, 72, 0.8) },
  ultima: { group: "characters", name: "slime.ultima", color: "#C27BE6", marks: loose(fill(BOW, "#2A1A2E"), 50, 72, 0.8) },
  carrera: { group: "characters", name: "slime.carrera", color: "#F5B417", marks: loose(fill("M 50 66 L 45 71 L 48 85 H 52 L 55 71 Z", "#B3262E"), 50, 66, 0.7) },
  ramiris: { group: "characters", name: "slime.ramiris", color: "#FFC83D", back: loose(`<path d="M 16 54 C 2 48 -2 28 6 16 C 16 20 24 34 27 44 Z M 84 54 C 98 48 102 28 94 16 C 84 20 76 34 73 44 Z" fill="#F6C7DC"/>`, 50, 44, 0.3) },
  // Fantasy archetypes: original silhouettes, with the shared body and face left intact.
  "oni-red": { group: "characters", name: "slime.oni-red", color: "#CF493B", marks: loose(fill("M 30 35 L 22 17 Q 36 19 40 31 Z", "#FFE2B3"), 35, 33, 0.4) + fill(COLLAR, "#662C37") },
  "oni-indigo": { group: "characters", name: "slime.oni-indigo", color: "#5256AF", marks: loose(fill("M 27 36 L 26 21 H 34 L 40 32 Z M 60 32 L 66 21 H 74 L 73 36 Z", "#ABD9DD"), 50, 34, 0.4) + fill(SASH, "#EB9D4B") },
  "kijin-ivory": { group: "characters", name: "slime.kijin-ivory", color: "#AA6470", marks: loose(fill("M 24 39 Q 12 25 23 17 Q 20 28 34 31 Z M 66 31 Q 80 28 77 17 Q 88 25 76 39 Z", "#FBE7C9"), 50, 34, 0.3) },
  "demon-wings": { group: "characters", name: "slime.demon-wings", color: "#B64563", back: loose(fill("M 24 45 L 5 23 L 7 62 L 18 55 L 22 72 L 32 56 Z M 76 45 L 95 23 L 93 62 L 82 55 L 78 72 L 68 56 Z", "#403049"), 50, 52, 0.3) },
  "demon-tail": { group: "characters", name: "slime.demon-tail", color: "#744978", back: loose(fill("M 78 75 Q 103 81 86 49 L 78 51 L 82 32 L 97 45 L 91 47 Q 113 85 80 85 Z", "#E399A1"), 83, 76, 0.5) },
  "dragon-storm": { group: "characters", name: "slime.dragon-storm", color: "#375C92", back: loose(fill("M 28 43 L 10 16 L 8 56 L 20 51 L 21 66 Z M 72 43 L 90 16 L 92 56 L 80 51 L 79 66 Z", "#9CAEBF"), 50, 45, 0.3), marks: fill("M 52 61 L 39 75 H 48 L 44 85 L 64 69 H 53 L 60 61 Z", "#F5D55C") },
  "dragon-ember": { group: "characters", name: "slime.dragon-ember", color: "#CA622E", back: loose(fill("M 27 48 L 8 34 L 17 24 L 20 11 L 38 35 Z M 73 48 L 92 34 L 83 24 L 80 11 L 62 35 Z", "#85323D"), 50, 43, 0.3), marks: fill("M 27 73 L 35 65 L 43 73 L 35 81 Z M 43 78 L 51 70 L 59 78 L 51 85 Z M 59 73 L 67 65 L 75 73 L 67 81 Z", "#FFD296") },
  "dragon-ice": { group: "characters", name: "slime.dragon-ice", color: "#288FAD", marks: loose(fill("M 30 34 L 34 13 L 44 29 L 50 5 L 57 29 L 68 15 L 70 35 Z", "#BEF1EE"), 50, 32, 0.25) + fill("M 32 70 L 42 77 L 50 70 L 58 77 L 68 70 L 64 82 H 36 Z", "#B4DCE9") },
  "fairy-wings": { group: "characters", name: "slime.fairy-wings", color: "#409B83", back: loose(fill("M 24 49 C -1 49 3 19 16 22 Q 28 25 29 43 Z M 22 50 C 2 58 8 75 23 67 L 31 53 Z M 76 49 C 101 49 97 19 84 22 Q 72 25 71 43 Z M 78 50 C 98 58 92 75 77 67 L 69 53 Z", "#C4EBDD"), 50, 48, 0.3) },
  "fairy-flower": { group: "characters", name: "slime.fairy-flower", color: "#D66C9D", marks: loose(fill("M 29 31 C 13 32 17 18 27 20 C 24 6 39 9 38 21 C 50 12 57 25 43 30 C 49 42 33 44 29 31 Z", "#FFE2A2") + `<circle cx="33" cy="27" r="5" fill="#9E547D"/>`, 34, 31, 0.5) },
  "beast-fangs": { group: "characters", name: "slime.beast-fangs", color: "#956143", marks: fill("M 22 66 Q 31 66 36 72 L 32 85 Q 26 77 22 66 Z M 78 66 Q 69 66 64 72 L 68 85 Q 74 77 78 66 Z", "#F9DFA7") },
  "beast-mane": { group: "characters", name: "slime.beast-mane", color: "#B97C2A", back: fill("M 15 70 L 7 54 L 17 44 L 12 29 L 29 29 L 36 15 L 49 23 L 64 15 L 71 29 L 88 29 L 83 44 L 93 54 L 85 70 L 69 79 H 31 Z", "#6E4534") },
  "knight-helm": { group: "characters", name: "slime.knight-helm", color: "#57728C", marks: fill("M 20 40 Q 24 13 50 13 Q 76 13 80 40 L 68 34 Q 50 25 32 34 Z M 18 43 L 28 42 L 33 62 L 24 66 Z M 82 43 L 72 42 L 67 62 L 76 66 Z", "#C5D5DA") },
  "knight-plume": { group: "characters", name: "slime.knight-plume", color: "#8A4B78", marks: loose(fill("M 27 32 Q 12 7 29 5 Q 52 6 50 30 Z", "#F1AF70"), 41, 31, 0.6) + fill("M 26 35 Q 50 20 74 35 L 73 40 Q 50 30 27 40 Z", "#D6DCE1") },
  paladin: { group: "characters", name: "slime.paladin", color: "#C38D32", back: fill("M 24 46 L 16 84 L 50 77 L 84 84 L 76 46 Z", "#3D6597"), marks: fill("M 38 64 H 62 V 75 L 50 85 L 38 75 Z", "#F7E3A9") + fill("M 47 66 H 53 V 72 H 59 V 77 H 53 V 82 H 47 V 77 H 41 V 72 H 47 Z", "#986539") },
  "ranger-hood": { group: "characters", name: "slime.ranger-hood", color: "#568B49", back: fill("M 13 64 Q 7 29 50 11 Q 93 29 87 64 L 75 51 Q 75 29 50 27 Q 25 29 25 51 Z", "#294C42"), marks: fill("M 27 70 L 50 81 L 73 70 L 66 84 H 34 Z", "#C1BE75") },
  "archer-feather": { group: "characters", name: "slime.archer-feather", color: "#818E39", marks: loose(fill("M 69 32 Q 66 10 88 6 Q 91 25 69 32 Z", "#72C7B3"), 68, 32, 0.6) + fill("M 21 36 L 40 20 L 68 26 L 79 36 Q 49 31 21 36 Z", "#CBA35F") },
  "mage-star": { group: "characters", name: "slime.mage-star", color: "#8758AD", marks: loose(fill("M 25 33 L 29 8 L 52 26 L 66 33 Z", "#3D3869"), 47, 32, 0.4) + fill("M 50 62 L 55 69 L 64 70 L 57 76 L 59 84 L 50 80 L 41 84 L 43 76 L 36 70 L 45 69 Z", "#F2D08A") },
  "sage-scroll": { group: "characters", name: "slime.sage-scroll", color: "#4A88A6", marks: fill("M 29 35 Q 38 29 45 34 L 43 39 L 29 40 Z M 55 34 Q 62 29 71 35 L 71 40 L 57 39 Z", "#E9E1C4") + loose(fill("M 25 67 Q 25 61 33 63 H 68 Q 75 63 75 69 V 77 Q 75 83 67 81 H 32 Q 25 81 25 75 Z", "#F2D5A3") + fill("M 34 65 H 40 V 79 H 34 Z M 61 65 H 67 V 79 H 61 Z", "#B88960"), 50, 71, 0.3) },
  "alchemist-flask": { group: "characters", name: "slime.alchemist-flask", color: "#397C77", marks: loose(fill("M 44 61 H 56 V 68 L 68 81 Q 67 86 61 86 H 39 Q 33 86 32 81 L 44 68 Z", "#A6DCC0") + fill("M 39 76 H 61 L 65 82 H 35 Z", "#5CAF78") + fill("M 42 59 H 58 V 64 H 42 Z", "#D8BB83"), 50, 65, 0.4) },
  "maid-apron": { group: "characters", name: "slime.maid-apron", color: "#906F9E", marks: fill("M 25 33 Q 25 23 33 27 Q 36 18 43 24 Q 50 16 57 24 Q 64 18 67 27 Q 75 23 75 33 Z M 35 65 H 65 L 71 83 Q 50 89 29 83 Z", "#F5EBDF") + loose(fill(BOW, "#4D476C"), 50, 72, 0.5) },
  "butler-silver": { group: "characters", name: "slime.butler-silver", color: "#64788E", marks: fill("M 29 62 L 48 69 L 42 80 Z M 71 62 L 52 69 L 58 80 Z", "#EDF0E7") + fill("M 47 68 H 53 L 55 74 L 52 84 H 48 L 45 74 Z", "#293743") },
  "witch-moon": { group: "characters", name: "slime.witch-moon", color: "#625397", marks: loose(fill("M 19 34 L 32 8 L 59 10 L 43 18 L 61 32 L 77 35 Q 50 41 19 34 Z", "#322D4C"), 48, 34, 0.5) + fill("M 58 63 Q 41 60 39 75 Q 41 89 58 82 Q 47 80 48 73 Q 48 66 58 63 Z", "#EECF7C") },
  "wizard-cap": { group: "characters", name: "slime.wizard-cap", color: "#424EC1", marks: loose(fill("M 30 33 L 48 4 L 68 33 Z", "#E5DBAF") + fill("M 38 22 H 58 L 62 28 H 34 Z", "#6D79B9"), 49, 33, 0.4) },
  "golem-stone": { group: "characters", name: "slime.golem-stone", color: "#727D70", back: fill("M 17 36 V 20 H 34 V 34 Z M 66 34 V 20 H 83 V 36 Z", "#A5B29B"), marks: fill("M 22 65 H 43 V 76 H 22 Z M 48 70 H 76 V 82 H 48 Z M 31 79 H 44 V 86 H 31 Z", "#4D5C51") },
  "phoenix-feather": { group: "characters", name: "slime.phoenix-feather", color: "#CF512B", back: loose(fill("M 20 68 Q -2 42 13 27 Q 11 45 29 47 L 31 66 Z M 80 68 Q 102 42 87 27 Q 89 45 71 47 L 69 66 Z", "#F6B53C"), 50, 55, 0.4), marks: loose(fill("M 31 32 Q 21 16 36 6 Q 33 21 46 28 Z", "#F9DA70"), 37, 31, 0.6) },
  // Animals retain the same two eyes; ears, gills and limbs sit behind the dome.
  "cat-ears": { group: "animals", name: "slime.cat-ears", color: "#C77A57", back: loose(fill("M 18 41 L 17 12 L 38 30 Z M 62 30 L 83 12 L 82 41 Z", "#C77A57") + fill("M 23 29 L 23 20 L 31 28 Z M 69 28 L 77 20 L 77 29 Z", "#F6B99A"), 50, 35, 0.3) },
  "dog-ears": { group: "animals", name: "slime.dog-ears", color: "#AF8555", back: loose(fill("M 28 29 Q 2 24 8 58 Q 12 74 23 59 L 34 36 Z M 72 29 Q 98 24 92 58 Q 88 74 77 59 L 66 36 Z", "#664C40"), 50, 32, 0.5) },
  "rabbit-ears": { group: "animals", name: "slime.rabbit-ears", color: "#B775A5", back: loose(fill("M 30 33 Q 14 -2 26 3 Q 39 9 40 30 Z M 60 30 Q 61 9 74 3 Q 86 -2 70 33 Z", "#E9C8CE") + fill("M 29 25 L 25 9 L 34 27 Z M 66 27 L 75 9 L 71 25 Z", "#C188A6"), 50, 30, 0.3) },
  "fox-ears": { group: "animals", name: "slime.fox-ears", color: "#DB6A29", back: loose(fill("M 19 42 L 9 8 L 41 28 Z M 59 28 L 91 8 L 81 42 Z", "#513C3A") + fill("M 20 32 L 18 19 L 33 29 Z M 67 29 L 82 19 L 80 32 Z", "#F4C69A"), 50, 33, 0.3), marks: fill("M 18 63 L 42 74 L 31 82 Z M 82 63 L 58 74 L 69 82 Z", "#FBE5C6") },
  "bear-ears": { group: "animals", name: "slime.bear-ears", color: "#8F674F", back: loose(fill("M 15 36 A 13 13 0 1 1 37 28 Z M 63 28 A 13 13 0 1 1 85 36 Z", "#8F674F"), 50, 33, 0.3), marks: fill("M 35 70 Q 50 59 65 70 L 61 81 H 39 Z", "#D6AE7F") },
  panda: { group: "animals", name: "slime.panda", color: "#3D4852", back: loose(fill("M 14 35 A 13 13 0 1 1 36 26 Z M 64 26 A 13 13 0 1 1 86 35 Z", "#DDE4DB"), 50, 33, 0.3), marks: fill("M 18 56 Q 33 60 34 75 L 23 79 Z M 82 56 Q 67 60 66 75 L 77 79 Z M 38 76 Q 50 69 62 76 L 59 84 H 41 Z", "#E7ECE1") },
  frog: { group: "animals", name: "slime.frog", color: "#5DA83A", back: fill("M 22 35 A 12 12 0 1 1 44 28 Z M 56 28 A 12 12 0 1 1 78 35 Z", "#5DA83A"), marks: fill("M 25 72 Q 50 62 75 72 L 68 83 H 32 Z", "#B7D875") },
  axolotl: { group: "animals", name: "slime.axolotl", color: "#CB7B87", back: loose(fill("M 21 44 L 7 26 L 4 34 L 14 46 L 1 44 V 53 L 14 55 L 6 65 L 11 72 L 26 58 Z M 79 44 L 93 26 L 96 34 L 86 46 L 99 44 V 53 L 86 55 L 94 65 L 89 72 L 74 58 Z", "#9D4265"), 50, 51, 0.4) },
  bee: { group: "animals", name: "slime.bee", color: "#BD8410", back: loose(fill("M 31 34 C 10 6 0 30 22 45 Z M 69 34 C 90 6 100 30 78 45 Z", "#C3E4DE"), 50, 37, 0.4), marks: fill("M 15 62 Q 50 69 85 62 L 89 69 Q 50 78 11 69 Z M 19 77 Q 50 84 81 77 L 72 85 H 28 Z", "#3A3B35") },
  penguin: { group: "animals", name: "slime.penguin", color: "#31465D", marks: fill("M 27 82 C 28 65 35 61 50 61 C 65 61 72 65 73 82 Q 50 89 27 82 Z", "#E3E5D2") + fill("M 42 58 H 58 L 50 66 Z", "#E9A83E") },
  turtle: { group: "animals", name: "slime.turtle", color: "#56816A", back: fill("M 11 65 L 2 78 L 20 82 L 31 70 Z M 89 65 L 98 78 L 80 82 L 69 70 Z", "#ABC38A"), marks: fill("M 34 64 L 50 58 L 66 64 V 77 L 50 84 L 34 77 Z", "#A3B768") + fill("M 47 61 H 53 V 82 H 47 Z M 35 69 H 65 V 75 H 35 Z", "#4C7150") },
  octopus: { group: "animals", name: "slime.octopus", color: "#D75CA5", back: loose(fill("M 20 65 Q 4 69 4 82 Q 7 91 18 82 L 22 75 L 27 80 Q 22 96 35 92 L 42 80 H 58 L 65 92 Q 78 96 73 80 L 78 75 L 82 82 Q 93 91 96 82 Q 96 69 80 65 Z", "#A84384"), 50, 75, 0.35) },
  // Work, elements, seasons, food and small everyday objects.
  "chef-hat": { group: "jobs", name: "slime.chef-hat", color: "#A95D48", marks: loose(fill("M 27 31 V 22 C 9 17 25 1 36 10 C 39 -1 59 -1 63 10 C 77 0 90 19 73 23 V 32 Z M 28 33 H 72 V 39 H 28 Z", "#F3EDDD"), 50, 34, 0.4) },
  gardener: { group: "jobs", name: "slime.gardener", color: "#599569", marks: fill("M 31 29 L 34 16 H 65 L 69 29 L 84 35 Q 50 41 16 35 Z", "#DBBB75") + fill("M 33 24 H 67 L 69 29 H 31 Z", "#8A6646") },
  artist: { group: "jobs", name: "slime.artist", color: "#B4528B", marks: loose(fill("M 20 31 C 10 12 41 11 60 15 C 82 19 78 31 65 33 Z M 41 16 L 45 7 H 52 L 50 17 Z", "#643B58"), 49, 31, 0.4) + fill("M 27 72 Q 26 61 40 64 L 66 73 Q 76 84 58 84 H 37 Z", "#E2BC77") },
  medic: { group: "jobs", name: "slime.medic", color: "#BB5870", marks: fill("M 29 22 H 71 L 76 35 H 24 Z M 45 65 H 55 V 71 H 63 V 79 H 55 V 85 H 45 V 79 H 37 V 71 H 45 Z", "#F5E8DD") },
  sailor: { group: "jobs", name: "slime.sailor", color: "#2873AD", marks: fill("M 29 28 Q 30 13 50 15 Q 70 13 71 28 Z M 23 29 H 77 V 36 H 23 Z M 26 65 L 43 78 L 50 71 L 57 78 L 74 65 L 64 84 H 36 Z", "#E0E9DF") },
  astronaut: { group: "jobs", name: "slime.astronaut", color: "#516E8A", back: fill("M 8 67 V 39 C 8 0 92 0 92 39 V 67 L 82 68 V 40 C 82 14 18 14 18 40 V 68 Z M 2 48 H 15 V 74 H 2 Z M 85 48 H 98 V 74 H 85 Z", "#DFE2D8"), marks: fill("M 37 68 H 63 V 82 H 37 Z", "#263E59") + fill("M 42 72 H 50 V 78 H 42 Z", "#79C9C0") },
  detective: { group: "jobs", name: "slime.detective", color: "#986744", marks: fill("M 30 29 L 32 17 H 47 L 55 23 H 69 L 74 31 L 87 36 H 13 Z", "#4B4140") + fill("M 29 64 L 48 73 L 39 82 Z M 71 64 L 52 73 L 61 82 Z", "#DAC39C") },
  mechanic: { group: "jobs", name: "slime.mechanic", color: "#507B76", marks: loose(fill("M 30 66 L 40 76 L 56 60 Q 52 51 62 47 L 60 56 L 66 59 L 73 52 Q 77 64 64 66 L 46 84 L 37 84 Z", "#C7D7CF"), 50, 72, 0.4) },
  fire: { group: "nature", name: "slime.fire", color: "#D85B32", back: loose(fill("M 24 48 Q 7 29 30 12 Q 27 27 40 29 L 51 0 Q 66 20 64 30 L 80 15 Q 96 38 78 52 Z", "#EEAD3B"), 50, 35, 0.3), marks: fill("M 36 82 Q 29 71 45 61 Q 43 73 54 68 Q 69 82 57 85 Z", "#F8D982") },
  water: { group: "nature", name: "slime.water", color: "#268CA5", marks: loose(fill("M 50 60 Q 29 80 42 84 Q 58 92 65 80 Q 69 73 50 60 Z", "#99E0DC"), 50, 65, 0.4) + fill("M 22 33 Q 26 22 33 20 Q 32 32 22 33 Z", "#B1E8EA") },
  earth: { group: "nature", name: "slime.earth", color: "#9A784C", marks: fill("M 18 76 L 29 63 L 39 70 L 55 59 L 73 73 L 82 81 Q 50 90 18 81 Z", "#5B6B42") + fill("M 27 65 L 29 55 L 38 63 Z M 63 66 L 67 55 L 76 68 Z", "#C5B67A") },
  wind: { group: "nature", name: "slime.wind", color: "#478E93", back: loose(fill("M 23 45 Q 0 34 9 20 Q 17 12 25 20 Q 11 17 15 27 Q 19 32 32 33 Z M 77 52 Q 100 44 94 29 Q 88 20 79 27 Q 94 25 87 36 Q 84 40 73 40 Z", "#B8E3D3"), 50, 43, 0.4), marks: fill("M 24 71 Q 48 62 72 71 L 75 76 Q 50 69 25 78 Z", "#9BCDC4") },
  snow: { group: "nature", name: "slime.snow", color: "#3F9CB6", marks: fill("M 46 61 H 54 V 68 L 61 64 L 65 71 L 58 75 L 65 79 L 61 86 L 54 82 V 88 H 46 V 82 L 39 86 L 35 79 L 42 75 L 35 71 L 39 64 L 46 68 Z", "#E2F0E5") },
  thunder: { group: "nature", name: "slime.thunder", color: "#9B8038", back: loose(fill("M 18 54 L 4 44 L 14 37 L 5 25 L 27 33 L 22 42 L 31 47 Z M 82 54 L 96 44 L 86 37 L 95 25 L 73 33 L 78 42 L 69 47 Z", "#EFD16A"), 50, 44, 0.3), marks: fill("M 49 61 L 39 75 H 49 L 44 86 L 65 70 H 54 L 60 61 Z", "#FAE8A2") },
  rainbow: { group: "nature", name: "slime.rainbow", color: "#9767A8", marks: fill("M 19 69 Q 50 57 81 69 L 82 75 Q 50 63 18 75 Z", "#F5AE75") + fill("M 18 75 Q 50 63 82 75 L 80 80 Q 50 69 20 80 Z", "#EED77D") + fill("M 20 80 Q 50 69 80 80 L 73 85 Q 50 77 27 85 Z", "#93CFB3") },
  cloud: { group: "nature", name: "slime.cloud", color: "#6885AC", marks: loose(fill("M 20 31 C 8 25 21 12 29 18 C 30 3 49 6 50 16 C 59 2 76 12 72 22 C 88 15 93 32 79 35 H 26 Z", "#D7E6E5"), 50, 32, 0.4) },
  "cherry-blossom": { group: "seasonal", name: "slime.cherry-blossom", color: "#C36891", marks: loose(fill("M 29 28 Q 12 25 19 14 Q 26 10 32 20 Q 34 4 45 12 Q 50 19 39 25 Q 55 27 46 38 Q 38 41 34 31 Q 29 46 20 37 Q 16 30 29 28 Z", "#F5CECF") + `<circle cx="32" cy="26" r="4" fill="#C89B47"/>`, 33, 30, 0.5) },
  "autumn-leaf": { group: "seasonal", name: "slime.autumn-leaf", color: "#B66D36", marks: loose(fill("M 48 84 L 46 73 L 32 72 L 36 64 L 29 58 L 43 59 L 50 46 L 56 59 L 70 55 L 65 66 L 70 73 L 55 75 L 53 85 Z", "#F1BA4F"), 50, 73, 0.5) },
  pumpkin: { group: "seasonal", name: "slime.pumpkin", color: "#D77922", marks: loose(fill("M 45 31 L 44 15 Q 50 10 57 16 L 53 31 Z", "#47694A"), 50, 30, 0.3) + fill("M 27 63 Q 23 73 31 82 H 37 Q 29 72 34 63 Z M 47 64 H 53 V 85 H 47 Z M 66 63 Q 71 72 63 82 H 69 Q 77 73 73 63 Z", "#A94C27") },
  strawberry: { group: "seasonal", name: "slime.strawberry", color: "#C54458", marks: loose(fill("M 26 30 L 35 20 L 41 26 L 50 12 L 58 26 L 68 20 L 75 31 L 57 30 L 50 37 L 43 30 Z", "#6A934A"), 50, 30, 0.3) + fill("M 27 65 L 33 63 L 31 71 Z M 47 71 L 53 69 L 51 78 Z M 67 65 L 73 63 L 71 71 Z", "#F4D58D") },
  lemon: { group: "seasonal", name: "slime.lemon", color: "#B89A28", marks: loose(fill("M 48 30 Q 44 12 64 12 Q 65 25 48 30 Z", "#5E8D4C"), 50, 30, 0.4) + fill("M 28 70 Q 50 85 72 70 L 68 79 Q 50 92 32 79 Z", "#F7DF8A") },
  mushroom: { group: "seasonal", name: "slime.mushroom", color: "#AC725E", marks: loose(fill("M 16 32 Q 21 5 50 8 Q 79 5 84 32 Q 50 42 16 32 Z", "#A9424E") + fill("M 29 25 A 5 5 0 1 1 39 25 A 5 5 0 1 1 29 25 Z M 57 19 A 6 6 0 1 1 69 19 A 6 6 0 1 1 57 19 Z", "#F4DCBB"), 50, 33, 0.4) },
  "ribbon-bell": { group: "objects", name: "slime.ribbon-bell", color: "#5F85B7", marks: loose(fill("M 50 67 L 29 61 V 78 Z M 50 67 L 71 61 V 78 Z", "#A53E68") + fill("M 43 70 Q 50 64 57 70 L 60 82 H 40 Z M 46 82 H 54 V 87 H 46 Z", "#F1C96D"), 50, 68, 0.6) },
  parcel: { group: "objects", name: "slime.parcel", color: "#8D8C59", marks: loose(fill("M 27 63 H 73 V 83 H 27 Z", "#C7985E") + fill("M 46 63 H 54 V 83 H 46 Z M 27 70 H 73 V 76 H 27 Z", "#F2D9A1"), 50, 66, 0.3) },
  candle: { group: "objects", name: "slime.candle", color: "#9272A7", marks: loose(fill("M 41 24 H 59 V 37 H 41 Z", "#E9CDB0") + fill("M 50 24 Q 34 17 51 3 Q 65 20 50 24 Z", "#F5BC54"), 50, 34, 0.4) },
  "music-note": { group: "objects", name: "slime.music-note", color: "#477C98", marks: loose(fill("M 42 60 L 67 55 V 76 Q 58 87 52 79 Q 50 71 60 71 V 64 L 49 66 V 81 Q 39 91 34 82 Q 31 74 42 75 Z", "#F4D898"), 50, 68, 0.5) },
} as const satisfies Record<string, { group: CharacterGroup; name: string; color: string; back?: string; marks?: string }>;
export type SlimeCharacter = keyof typeof CHARACTERS;

// ---------- the crown of the primary member ----------

/** One gold shape, no gem and no shine, drawn with its base's middle at (50, 30). */
const CROWN_GOLD = "#F6C141";
const CROWN = fill("M 37 32.4 L 36.2 18 L 43.6 23.8 L 50 14.2 L 56.4 23.8 L 63.8 18 L 63 32.4 Q 50 28 37 32.4 Z", CROWN_GOLD).replace("/>", ` stroke="${CROWN_GOLD}" stroke-width="1.8" stroke-linejoin="round"/>`) +
  `<circle cx="36.2" cy="17.2" r="2.4" fill="${CROWN_GOLD}"/><circle cx="50" cy="13.2" r="2.6" fill="${CROWN_GOLD}"/><circle cx="63.8" cy="17.2" r="2.4" fill="${CROWN_GOLD}"/>`;
type CrownSpot = readonly [x: number, y: number, turn: number, size: number];
/**
 * Stuck on the outline from outside, not worn: its base sits square to the edge line without sinking into the body, on the upper right where the dome slopes 30 degrees. Each spot is a point of the outline
 * moved 0.7 out along its normal.
 */
const CROWN_EDGE: CrownSpot = [71.6, 33.7, 30, 0.62];
/**
 * A character whose own marks are there gets a spot of its own: two horns hold it upright between them, Shizu's mask and Gobta's goggles push it down the edge, Diablo's streaks to the left, and the ears and
 * wings of Ranga and Ramiris to the top. One horn in the middle leaves the edge free.
 */
const CROWN_SPOTS: Partial<Record<SlimeCharacter, CrownSpot>> = {
  benimaru: [50, 27.8, 0, 0.55], veldora: [50, 27.8, 0, 0.55], shuna: [50, 27.9, 0, 0.5],
  shizu: [79.5, 40.1, 46, 0.6], gobta: [81.7, 42.6, 50, 0.58], diablo: [28.4, 32.9, -32, 0.6],
  ranga: [50, 27.6, 4, 0.6], ramiris: [57, 28.2, 12, 0.62],
  "oni-indigo": [50, 27.8, 0, 0.5], "kijin-ivory": [50, 27.8, 0, 0.5],
  "dragon-ice": [81.7, 42.6, 50, 0.55], "knight-helm": [81.7, 42.6, 50, 0.55],
  "archer-feather": [28.4, 32.9, -32, 0.6], "sage-scroll": [81.7, 42.6, 50, 0.55],
  "maid-apron": [81.7, 42.6, 50, 0.55], "witch-moon": [81.7, 42.6, 50, 0.55],
  "wizard-cap": [81.7, 42.6, 50, 0.55], "cat-ears": [50, 27.6, 0, 0.55],
  "fox-ears": [50, 27.6, 0, 0.55], "bear-ears": [50, 27.6, 0, 0.55],
  "rabbit-ears": [50, 27.6, 0, 0.55], "dog-ears": [50, 27.6, 0, 0.55],
  "dragon-storm": [50, 27.6, 0, 0.55], "demon-wings": [50, 27.6, 0, 0.55],
  thunder: [50, 27.6, 0, 0.55],
  panda: [50, 27.6, 0, 0.55], frog: [50, 27.6, 0, 0.55],
  "chef-hat": [81.7, 42.6, 50, 0.55], gardener: [81.7, 42.6, 50, 0.55],
  artist: [81.7, 42.6, 50, 0.55], medic: [81.7, 42.6, 50, 0.55],
  sailor: [81.7, 42.6, 50, 0.55], detective: [81.7, 42.6, 50, 0.55],
  fire: [81.7, 42.6, 50, 0.55], cloud: [81.7, 42.6, 50, 0.55],
  strawberry: [81.7, 42.6, 50, 0.55], mushroom: [81.7, 42.6, 50, 0.55],
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

/**
 * `moving` is the one switch of motion (owner, 2026-11-11: 「只有左邊成員列表工作中、對話框思考那一行要有動畫，其他地方放史萊姆的樣子就可以了」).
 * A slime drawn without it is a picture: the resting pose of its drawing (idle, or sleeping for a member that has been
 * silent for a day) with no strips, no clock, no motion variables and no state a handover could change, so it costs the
 * page nothing: nothing observes it and no event reaches it. Only the member list's rows and the conversation's thinking
 * line pass `moving`.
 */
export interface SlimeDrawing { now?: Date; state?: SlimeState; delay?: number; tempo?: number; since?: number; member?: number; crown?: boolean; moving?: boolean }

/** The shared vector surface; `slimeFaceHTML` supplies the member's fixed avatar box. */
export function slimeSVG(slime: Slime, { now = new Date(), state = "idle", delay = 0, tempo = 1, since, member, crown = false, moving = false }: SlimeDrawing = {}): string {
  hearThePointer();
  const look: { color: string; back?: string; marks?: string } = "character" in slime ? CHARACTERS[slime.character] : { color: COLORS[slime.color] };
  // The primary member wears the crown in any season: a plain slime's hat gives way to it.
  const hat = "character" in slime || crown ? null : seasonalHat(now);
  const worn = (look.marks ?? "") + (hat ? loose(`<g transform="translate(0 ${HAT_LIFT})">${HATS[hat]}</g>`, 50, 30, 0.6) : "") + (crown ? crownMark(slime) : "");
  const key = `${look.back ?? ''}|${worn}`;
  let drawingId = drawingIds.get(key);
  if (!drawingId) { drawingId=String(drawings.size);drawingIds.set(key,drawingId);drawings.set(drawingId,{back:look.back ?? '',worn}); }
  // The picture of a slime keeps only the pose a state gives without moving: asleep, or at rest.
  if (!moving) state = state === "sleeping" ? "sleeping" : "idle";
  const [bodyStrip,eyeStrip] = moving ? strips(state,drawings.get(drawingId)!) : ['',''];
  // Each member glances to its own side at rest; neighbours in a list look different ways.
  const aside = member !== undefined && Math.abs(member) % 2 === 1 ? 3 : -3;
  const body = `<g class="slime-press"><g class="slime-settle"><g class="slime-counterturn"><g class="slime-motion">` +
    (look.back ? `<g class="slime-back">${look.back}</g>` : "") + correction(`<path d="${BODY}" fill="var(--slime-color)" class="slime-body"/>`) + `<g class="slime-marks">${worn}</g>` +
    `<g class="slime-face" transform="${FACE_SCALE}"><g class="slime-follow"><g class="slime-look"><g class="slime-counterturn"><g class="slime-gaze" fill="none" stroke="#fff" stroke-linecap="round"><path class="slime-eyes" d="${EYES}"/></g></g></g></g></g>` +
    `</g></g></g></g>`;
  // A picture has no clock, no member to hand over to and no motion variables; `data-slime-still` names whose it is for patchHTML.
  if (!moving) return `<span class="slime-surface" data-slime-still="${member ?? ''}" data-slime-drawing="${drawingId}" data-slime-reuse="${drawingId}:${look.color}:still:${member ?? ''}" data-state="${state}" aria-hidden="true" style="--slime-color:${look.color}"><svg class="slime" viewBox="4 11 92 92" data-state="${state}" aria-hidden="true" focusable="false" style="--slime-color:${look.color};--slime-aside:${aside}px">${body}</svg></span>`;
  return `<span class="slime-surface" data-slime-drawing="${drawingId}" data-slime-reuse="${drawingId}:${look.color}:${tempo}:${member ?? ''}" data-state="${state}" aria-hidden="true" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo}">${bodyStrip}<svg class="slime" viewBox="4 11 92 92" data-slime-mounted="${performance.now()}" data-state="${state}"${member === undefined ? "" : ` data-slime-member="${member}"`} aria-hidden="true" focusable="false" style="--slime-color:${look.color};--slime-delay:${delay}ms;--slime-tempo:${tempo};--slime-aside:${aside}px${since === undefined ? "" : `;--slime-since:${since}ms`}">` +
    body + `</svg>${eyeStrip}</span>`;
}

// ---------- under the pointer ----------

let hearing = false;

/**
 * Under the pointer a slime does not wiggle any more: a resting one glances aside and looks back
 * at you while the pointer is on it or its row (slime.css). Here only the end of a handover.
 */
function hearThePointer(): void {
  if (hearing || typeof document === "undefined") return;
  hearing = true;
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
  settle: SVGElement; look: SVGElement; motion: SVGElement; gaze: SVGElement;
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
 * window for 100 ms and more at every change of state (owner, 2026-11-11: 「更新…畫面就會閃現」). They go in a slice
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

/**
 * The slime a member shows: its own choice, or a colour from its id. A picture unless `moving` (the member list's rows and
 * the conversation's thinking line): then it follows what the member is doing (owner, 2026-11-11).
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

export const SLIME_CHARACTER_COUNT = CHARACTER_IDS.length;
export const SLIME_COLOR_COUNT = COLOR_IDS.length;

const IN_MENU = ' role="menuitem" tabindex="-1"';

/** Every character, each as a button; `item` makes them a menu's items. */
export function slimeCharactersHTML(avatar: string | null | undefined, esc: (text: string) => string, item = "", group?: CharacterGroup): string {
  const current = parseSlime(avatar), who = current && "character" in current ? current.character : null;
  return CHARACTER_IDS.filter(id => group === undefined || CHARACTERS[id].group === group).map(id => {
    const name = esc(t(CHARACTERS[id].name));
    return `<button type="button"${item} class="mb-preset mb-preset-slime" data-slime-character="${id}" aria-pressed="${id === who}" aria-label="${name}" title="${name}">${slimeSVG({ character: id }, { now: OFF_SEASON })}</button>`;
  }).join("");
}

/** Every colour of a plain slime, each as a button. */
export function slimeColorsHTML(avatar: string | null | undefined, esc: (text: string) => string, item = ""): string {
  const current = parseSlime(avatar), color = current && "color" in current ? current.color : null;
  return COLOR_IDS.map(id => {
    const name = t(COLOR_NAMES[id]);
    return `<button type="button"${item} class="mb-slime-color" data-slime-color="${id}" aria-pressed="${id === color}" aria-label="${esc(t("members.slimeColor", { p0: name }))}" title="${esc(name)}" style="--slime-color:${COLORS[id]}"></button>`;
  }).join("");
}

/** The groups of the picker, in the order of its tabs. */
export const SLIME_GROUPS = Object.keys(GROUP_NAMES) as (keyof typeof GROUP_NAMES)[];
export type SlimeGroup = (typeof SLIME_GROUPS)[number];
/** The words of a group's tab. */
export const slimeGroupName = (group: SlimeGroup): string => t(GROUP_NAMES[group]);

/** The group that holds a face: where the picker opens. A face the picker does not list opens on the first group. */
export function slimeGroupOf(avatar: string | null | undefined): SlimeGroup {
  const slime = parseSlime(avatar);
  if (slime === null) return SLIME_GROUPS[0];
  return "color" in slime ? "colors" : CHARACTERS[slime.character].group;
}

/**
 * The picker's slimes: one panel for each group, none of them with a heading (its tab says it; owner, 2026-11-11:
 * 「要跟…Grokbot 他們的 UI 類似，就是上面會有一些 tab」). They are all drawn and stand on one another in one cell, so the
 * place is as big as the largest group and a press on a tab moves nothing; the one that is open is `data-active`, and
 * the others are `inert` (the keys and the pointer pass them by). `open` is the group that shows first.
 */
export function slimePickerHTML(avatar: string | null | undefined, esc: (text: string) => string, open: SlimeGroup = slimeGroupOf(avatar)): string {
  return SLIME_GROUPS.map(group => {
    const grid = group === "colors"
      ? `<div class="mb-slime-colors">${slimeColorsHTML(avatar, esc, IN_MENU)}</div>`
      : `<div class="mb-presets mb-slime-characters">${slimeCharactersHTML(avatar, esc, IN_MENU, group)}</div>`;
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
