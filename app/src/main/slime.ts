/**
 * The members' mascots: one slime drawn in code, so colour, costume and season are data rather than
 * pictures to generate. Raphael keeps his own emblem and never comes here (members.ts `faceHTML`).
 * A member's `avatar` is `slime:<id>`; a member without a picture gets a colour from its id.
 */
import "./slime.css";

interface Palette { top: string; middle: string; bottom: string; ink: string; cheek: string }
type Costume = "oni" | "demon" | "fox" | "sprout" | "crown";
type Hat = "witch" | "santa";

const palette = (top: string, middle: string, bottom: string, ink = "#14202b", cheek = "#ff8fa3"): Palette => ({ top, middle, bottom, ink, cheek });

const SLIMES: Record<string, { palette: Palette; costume?: Costume }> = {
  azure: { palette: palette("#bfeaff", "#62bdf5", "#2f86d6") },
  mint: { palette: palette("#c9f7e3", "#6fdcae", "#2fae80") },
  sunny: { palette: palette("#fff0b8", "#ffd25e", "#f0a52c") },
  coral: { palette: palette("#ffd6cc", "#ff9b85", "#ec6a5c") },
  rose: { palette: palette("#ffd9ea", "#ff9cc6", "#e668a2") },
  lilac: { palette: palette("#e6dcff", "#b89cf5", "#8a68dc") },
  slate: { palette: palette("#e3e8ee", "#aebacb", "#7a8aa0") },
  oni: { palette: palette("#dcc6ff", "#9a6bea", "#6a3cc2", "#1d1033", "#ff7fb0"), costume: "oni" },
  demon: { palette: palette("#5a5a6e", "#2c2c3a", "#14141c", "#ff3b4e", "#8c1d2b"), costume: "demon" },
  fox: { palette: palette("#ffe2bd", "#ffae5c", "#ee7f2e"), costume: "fox" },
  sprout: { palette: palette("#e4f8b8", "#a8dd62", "#6fb437"), costume: "sprout" },
  crown: { palette: palette("#fff6d6", "#ffe08a", "#e8b540"), costume: "crown" },
};

/** The colours a member with no choice of its own is given. */
const DEFAULTS = ["azure", "mint", "sunny", "coral", "rose", "lilac", "slate"];

/** Everything the owner can choose, in the order the picker shows it. */
export const SLIME_IDS: readonly string[] = Object.keys(SLIMES);

export const isSlimeAvatar = (avatar: string | null | undefined): boolean => !!avatar?.startsWith("slime:") && avatar.slice(6) in SLIMES;

/** The hat of the season, whatever the slime's own costume: the week of Halloween and of Christmas. */
export function seasonalHat(now: Date = new Date()): Hat | null {
  const month = now.getMonth() + 1, day = now.getDate();
  if ((month === 10 && day >= 24) || (month === 11 && day === 1)) return "witch";
  if (month === 12 && day >= 18 && day <= 26) return "santa";
  return null;
}

const COSTUME: Record<Costume, string> = {
  // A single ivory horn off to one side.
  oni: `<path d="M58 34 C60 22 66 14 74 10 C73 20 72 30 68 39 Z" fill="#fbf3dc" stroke="#d9c9a0" stroke-width="1.5" stroke-linejoin="round"/>`,
  // Two dark horns and a butler's red bow.
  demon: `<path d="M32 40 C26 30 24 20 27 11 C33 17 39 25 42 33 Z M68 40 C74 30 76 20 73 11 C67 17 61 25 58 33 Z" fill="#1a1a24" stroke="#ff3b4e" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M50 84 L37 78 V90 Z M50 84 L63 78 V90 Z" fill="#c8102e"/><circle cx="50" cy="84" r="3" fill="#ff5a6b"/>`,
  // Pointed ears.
  fox: `<path d="M24 46 L20 18 L44 32 Z M76 46 L80 18 L56 32 Z" fill="#ee7f2e" stroke="#c9631c" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M26 38 L24 24 L37 32 Z M74 38 L76 24 L63 32 Z" fill="#ffe2bd"/>`,
  // A leaf on top.
  sprout: `<path d="M50 24 C50 18 50 14 50 10" fill="none" stroke="#4f8a24" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M50 12 C42 4 32 4 28 8 C32 15 42 17 50 12 Z M50 12 C58 4 68 4 72 8 C68 15 58 17 50 12 Z" fill="#7ac143" stroke="#4f8a24" stroke-width="1.5" stroke-linejoin="round"/>`,
  crown: `<path d="M32 34 L28 12 L41 23 L50 8 L59 23 L72 12 L68 34 Z" fill="#ffc933" stroke="#c98f12" stroke-width="1.5" stroke-linejoin="round"/><circle cx="50" cy="27" r="3" fill="#e8384f"/>`,
};

const HAT: Record<Hat, string> = {
  witch: `<g transform="rotate(-7 50 36)"><ellipse cx="50" cy="37" rx="31" ry="7" fill="#2a1a47"/>` +
    `<path d="M31 36 C36 22 44 9 60 2 C56 12 66 22 69 36 Z" fill="#3b2563"/>` +
    `<path d="M31.5 35 C43 39 57 39 68.5 35 L67 29 C56 33 44 33 33.5 29 Z" fill="#ff9f1c"/>` +
    `<rect x="46" y="29.5" width="8" height="8" rx="1.5" fill="none" stroke="#ffd166" stroke-width="2"/></g>`,
  santa: `<g transform="rotate(-6 50 36)"><path d="M30 37 C34 18 50 6 66 10 C74 12 80 22 82 30 L74 30 C72 26 69 23 66 22 C68 27 70 32 70 37 Z" fill="#d7263d"/>` +
    `<circle cx="79" cy="33" r="6" fill="#fff" stroke="#d3d3d8" stroke-width="1"/><rect x="26" y="32" width="48" height="10" rx="5" fill="#fff" stroke="#d3d3d8" stroke-width="1"/></g>`,
};

let drawn = 0;

/** The drawing alone; `slimeFaceHTML` wraps it the way every member's face is wrapped. */
export function slimeSVG(id: string, now: Date = new Date(), style = ""): string {
  const slime = SLIMES[id] ?? SLIMES.azure, tone = slime.palette, key = `slime-${++drawn}`;
  const hat = seasonalHat(now);
  // A hat sits where horns and ears would be; a costume's bow stays, being below the face.
  const costume = slime.costume ? (hat && slime.costume !== "demon" ? "" : slime.costume === "demon" && hat ? COSTUME.demon.slice(COSTUME.demon.indexOf("<path", 1)) : COSTUME[slime.costume]) : "";
  return `<svg class="slime" viewBox="0 0 100 100" aria-hidden="true" focusable="false"${style ? ` style="${style}"` : ""}>` +
    `<defs><linearGradient id="${key}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone.top}"/><stop offset="0.5" stop-color="${tone.middle}"/><stop offset="1" stop-color="${tone.bottom}"/></linearGradient></defs>` +
    `<g class="slime-all">` +
    (slime.costume === "fox" && !hat ? costume : "") +
    `<path d="M50 20 C58 32 86 46 90 66 C93 84 74 94 50 94 C26 94 7 84 10 66 C14 46 42 32 50 20 Z" fill="url(#${key})"/>` +
    (slime.costume === "fox" && !hat ? "" : costume) +
    `<ellipse cx="33" cy="52" rx="9" ry="5.5" fill="#fff" opacity="0.6" transform="rotate(-32 33 52)"/><circle cx="24" cy="62" r="2.4" fill="#fff" opacity="0.55"/>` +
    `<ellipse cx="27" cy="75" rx="6" ry="3.6" fill="${tone.cheek}" opacity="0.4"/><ellipse cx="73" cy="75" rx="6" ry="3.6" fill="${tone.cheek}" opacity="0.4"/>` +
    `<g class="slime-eyes"><ellipse cx="38" cy="66" rx="5.6" ry="7.6" fill="${tone.ink}"/><ellipse cx="62" cy="66" rx="5.6" ry="7.6" fill="${tone.ink}"/>` +
    `<circle cx="40" cy="62.5" r="2.1" fill="#fff"/><circle cx="64" cy="62.5" r="2.1" fill="#fff"/></g>` +
    `<path d="M45 77 Q50 81.5 55 77" fill="none" stroke="${tone.ink}" stroke-width="2.4" stroke-linecap="round"/>` +
    (hat ? HAT[hat] : "") +
    `</g></svg>`;
}

/** A small stable spread, so a list of slimes does not blink in step. */
const delayOf = (seed: number): string => `${-(Math.abs(seed) % 7) * 800}ms`;

/** The slime a member shows: its own choice, or a colour from its id. */
export function slimeFaceHTML(member: { id: number; avatar?: string | null }, size: number, cls = ""): string {
  const chosen = isSlimeAvatar(member.avatar) ? member.avatar!.slice(6) : DEFAULTS[Math.abs(member.id) % DEFAULTS.length];
  return `<span class="av mb-av mb-av-slime${cls ? ` ${cls}` : ""}" style="--av:${Math.round(size)}px" aria-hidden="true">${slimeSVG(chosen, new Date(), `--slime-delay:${delayOf(member.id)}`)}</span>`;
}

/** The buttons of the picture menu, one per slime, bareheaded so that its costume shows whatever the season. */
const OFF_SEASON = new Date(2000, 5, 1);
export const slimeChoicesHTML = (label: (index: number) => string): string =>
  SLIME_IDS.map((id, index) => `<button type="button" role="menuitem" tabindex="-1" class="mb-preset mb-preset-slime" data-preset="slime:${id}" aria-label="${label(index + 1)}">${slimeSVG(id, OFF_SEASON)}</button>`).join("");
