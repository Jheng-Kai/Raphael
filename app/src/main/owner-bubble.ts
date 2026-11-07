import { RAPHAEL_COLOR, slimeColorOf } from "./slime";
const channels = (hex: string): number[] => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const hexOf = (rgb: number[]): string => `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`;
const linear = (value: number): number => value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
const luminance = (rgb: number[]): number => 0.2126 * linear(rgb[0]!) + 0.7152 * linear(rgb[1]!) + 0.0722 * linear(rgb[2]!);
const contrast = (a: number[], b: number[]): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};
const WHITE = [255, 255, 255];
/** The composer's panel on the black theme (`--panel` in styles.css). */
const DARK_PANEL = [0x16, 0x16, 0x16];
const onWhite = (rgb: number[]): number => contrast(rgb, WHITE);

/** How far white words must stand off a bubble: Grok Bot's green bubble holds its white words at 3.4:1, and
 *  darkening further (to 4.5:1, until 2026-11-06) dulled every colour, which the owner saw at once. */
export const LIGHT_WORDS_RATIO = 3.4;

/**
 * The owner's bubble in a member's conversation, so the member shows at a glance. As Grok Bot's, the words are
 * white on a shade of the member's colour, darkened only as far as it must; only a slime nearly white (a silver or
 * white one, under 1.6:1) stays itself and takes dark words.
 */
export function ownerBubble(color: string): { fill: string; words: "light" | "dark" } {
  let rgb = channels(color);
  if (onWhite(rgb) < 1.6) return { fill: hexOf(rgb), words: "dark" };
  while (onWhite(rgb) < LIGHT_WORDS_RATIO) rgb = rgb.map(value => Math.round(value * 0.97));
  return { fill: hexOf(rgb), words: "light" };
}

/** A member's colour, Raphael's being his first blue slime's since 2026-11-07 (it was his gold). */
export const memberColor = (member: { id: number; avatar?: string | null }): string => member.id === 0 ? RAPHAEL_COLOR : slimeColorOf(member);

/**
 * The member's colour on the controls of its conversation (send, stop, its computer): darkened on the white
 * theme and lightened on the black one only until it stands 3:1 off the panel, the least a control needs.
 */
export function memberAccent(color: string): string {
  let light = channels(color), dark = channels(color);
  while (contrast(light, WHITE) < 3) light = light.map(value => Math.round(value * 0.97));
  while (contrast(dark, DARK_PANEL) < 3) dark = dark.map(value => Math.round(value + (255 - value) * 0.06));
  return `light-dark(${hexOf(light)}, ${hexOf(dark)})`;
}

/** A member's name in its colour, as Grok Bot names each Bot in a conversation between Bots. */
export const nameAccent = (member: { id: number; avatar?: string | null }): string => memberAccent(memberColor(member));
