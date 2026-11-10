// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { esc } from "./ui";
import { LIGHT_WORDS_RATIO, memberAccent, memberColor, nameAccent, ownerBubble } from "./owner-bubble";
import { RAPHAEL_COLOR, slimeCharactersHTML, slimeColorOf, slimeColorsHTML } from "./slime";

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
    // White words on coloured bubbles use a 3.4:1 minimum; dark words on a nearly white slime read at 4.5:1 or more.
    expect(ratio(fill, WORDS[words]), `${colour} as ${fill} with ${words} words`).toBeGreaterThanOrEqual(words === "light" ? LIGHT_WORDS_RATIO : 4.5);
  }
});

test("Raphael's colour is his first blue slime's everywhere: his bubble, his controls and his name", () => {
  expect(memberColor({ id: 0 })).toBe(RAPHAEL_COLOR);
  expect(ownerBubble(memberColor({ id: 0 }))).toEqual(ownerBubble(slimeColorOf({ id: 3, avatar: "slime:rimuru" })));
  expect(ownerBubble(memberColor({ id: 0 })).words).toBe("light");
  expect(nameAccent({ id: 0 })).toBe(memberAccent(RAPHAEL_COLOR));
});

test("words are white on a shade darkened only to 3.4:1, a nearly white slime keeps dark words", () => {
  expect(ownerBubble("#2F4A80")).toEqual({ fill: "#2f4a80", words: "light" });
  for (const colour of ["#14C370", "#5AB4E8", "#F69412"]) {
    const bubble = ownerBubble(colour);
    expect(bubble.words, colour).toBe("light");
    expect(ratio(bubble.fill, WORDS.light), colour).toBeLessThan(3.8);
  }
  expect(ownerBubble("#D5D9D6")).toEqual({ fill: "#d5d9d6", words: "dark" });
});

test("two members of different colours never share a bubble", () => {
  const fills = ["#1884FC", "#FC2C3E", "#14C370", "#905AFB"].map(colour => ownerBubble(colour).fill);
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
