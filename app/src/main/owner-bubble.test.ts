// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { esc } from "./ui";
import { memberAccent, ownerBubble } from "./owner-bubble";
import { slimeCharactersHTML, slimeColorOf, slimeColorsHTML } from "./slime";

const WORDS = { light: "#ffffff", dark: "#0a0a0a" };
const channel = (value: number): number => value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4;
const light = (hex: string): number => [1, 3, 5].reduce((sum, at, i) => sum + [0.2126, 0.7152, 0.0722][i]! * channel(parseInt(hex.slice(at, at + 2), 16)), 0);
const ratio = (a: string, b: string): number => (Math.max(light(a), light(b)) + 0.05) / (Math.min(light(a), light(b)) + 0.05);

function everySlime(): string[] {
  const host = document.createElement("div");
  host.innerHTML = slimeCharactersHTML(null, esc) + slimeColorsHTML(null, esc);
  return [...host.querySelectorAll<HTMLElement>("button")].map(button =>
    slimeColorOf({ id: 1, avatar: button.dataset.slimeCharacter ? `slime:${button.dataset.slimeCharacter}` : `slime:color:${button.dataset.slimeColor}` }));
}

test("every character and colour makes a bubble whose words read", () => {
  const colours = everySlime();
  expect(colours.length).toBeGreaterThan(20);
  for (const colour of colours) {
    const { fill, words } = ownerBubble(colour);
    expect(ratio(fill, WORDS[words]), `${colour} as ${fill} with ${words} words`).toBeGreaterThanOrEqual(4.5);
  }
});

test("a dark enough colour takes light words, darkened only as far as it must; a light one stays itself with dark words", () => {
  expect(ownerBubble("#2F4A80")).toEqual({ fill: "#2f4a80", words: "light" });
  const sky = ownerBubble("#2A83D5");
  expect(sky.words).toBe("light");
  expect(ratio(sky.fill, WORDS.light)).toBeLessThan(5);
  expect(ownerBubble("#5AB4E8")).toEqual({ fill: "#5ab4e8", words: "dark" });
});

test("two members of different colours never share a bubble", () => {
  const fills = ["#2A83D5", "#D4556D", "#4C8A43", "#9270CB"].map(colour => ownerBubble(colour).fill);
  expect(new Set(fills).size).toBe(fills.length);
});

test("every character and colour marks send, stop and its computer at 3:1 on both themes' panels", () => {
  for (const colour of everySlime()) {
    const [, onLight, onDark] = memberAccent(colour).match(/^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/)!;
    expect(ratio(onLight!, "#ffffff"), `${colour} on white as ${onLight}`).toBeGreaterThanOrEqual(3);
    expect(ratio(onDark!, "#161616"), `${colour} on black as ${onDark}`).toBeGreaterThanOrEqual(3);
  }
  // A colour that already stands off both panels is kept as it is.
  expect(memberAccent("#7c3aed")).toBe("light-dark(#7c3aed, #7c3aed)");
});
