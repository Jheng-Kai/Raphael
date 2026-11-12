// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { esc } from "./ui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIGHT_WORDS_RATIO, memberAccent, memberColor, memberSwitch, nameAccent, ownerBubble } from "./owner-bubble";
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

test("a switch that is on wears the member's colour and its knob stands off it in both themes, a light slime's knob is dark", () => {
  const KNOB = { "var(--on-tint-light)": "#ffffff", "var(--on-tint-dark)": "#0a0a0a" } as Record<string, string>;
  for (const colour of everySlime()) {
    const [, trackLight, trackDark] = memberSwitch(colour).track.match(/^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/)!;
    const [, knobLight, knobDark] = memberSwitch(colour).knob.match(/^light-dark\((var\(--on-tint-(?:light|dark)\)), (var\(--on-tint-(?:light|dark)\))\)$/)!;
    // On the white theme the track is the owner's bubble, whose words the knob follows; on the black theme it stands 3:1 off the panel.
    expect(trackLight, colour).toBe(ownerBubble(colour).fill);
    expect(ratio(KNOB[knobLight!]!, trackLight!), `${colour} knob on ${trackLight} in the light theme`).toBeGreaterThanOrEqual(3);
    expect(ratio(KNOB[knobDark!]!, trackDark!), `${colour} knob on ${trackDark} in the dark theme`).toBeGreaterThanOrEqual(3);
    expect(ratio(trackDark!, "#161616"), `${colour} track on the black panel`).toBeGreaterThanOrEqual(3);
  }
  // A yellow or white-ish slime is a light bubble with dark words: its knob is dark on the white theme as well, white slimes' too on the black.
  expect(memberSwitch("#FFC83D").knob).toBe("light-dark(var(--on-tint-dark), var(--on-tint-dark))");
  expect(memberSwitch("#D5D9D6").knob).toBe("light-dark(var(--on-tint-dark), var(--on-tint-dark))");
  expect(memberSwitch("#905AFB").knob).toBe("light-dark(var(--on-tint-light), var(--on-tint-light))");
  // Raphael's own places wear Raphael's colour: the same source as his bubble.
  expect(memberSwitch(memberColor({ id: 0 }))).toEqual(memberSwitch(RAPHAEL_COLOR));
});

test("only a member's panel and settings page wear the colour on switches, the rest of the app keeps its own", () => {
  const css = readFileSync(join(__dirname, "styles.css"), "utf8");
  expect(css).toContain('[data-member-switch] .tg[aria-checked="true"] { background: var(--member-switch); border-color: var(--member-accent); }');
  expect(css).toContain('[data-member-switch] .tg[aria-checked="true"]::after { background: var(--member-knob); }');
  const source = readFileSync(join(__dirname, "pages", "agent.ts"), "utf8");
  expect(source).toContain("for (const place of [members.details, members.settings.el]) {");
  expect(source).toContain('"--member-knob": knob');
  // A refresh that changes nothing touches nothing in the panel: the colour is written only when it differs.
  expect(source).toContain("if (place.style.getPropertyValue(name) !== value) place.style.setProperty(name, value);");
  // Nothing else marks a place: the Settings dialog, Home and the store never carry the mark.
  for (const file of ["owner-settings.ts", "member-store.ts"]) expect(readFileSync(join(__dirname, file), "utf8"), file).not.toContain("memberSwitch");
});
