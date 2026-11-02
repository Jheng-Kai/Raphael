const channels = (hex: string): number[] => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
const hexOf = (rgb: number[]): string => `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`;
const linear = (value: number): number => value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
const onWhite = (rgb: number[]): number => 1.05 / (0.2126 * linear(rgb[0]!) + 0.7152 * linear(rgb[1]!) + 0.0722 * linear(rgb[2]!) + 0.05);

/**
 * The owner's bubble in a member's conversation, so the member shows at a glance. A colour that nearly
 * carries light words darkens only as far as it must; a lighter one stays itself and takes dark words.
 */
export function ownerBubble(color: string): { fill: string; words: "light" | "dark" } {
  let rgb = channels(color);
  if (onWhite(rgb) < 3) return { fill: hexOf(rgb), words: "dark" };
  while (onWhite(rgb) < 4.5) rgb = rgb.map(value => Math.round(value * 0.97));
  return { fill: hexOf(rgb), words: "light" };
}
