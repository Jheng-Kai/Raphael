// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { FLYER_GAP_PX, FLYER_PX, VoiceMode, flightPath, spotTransform } from "./voice-mode";

const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe("the voice mode's flight", () => {
  const stage = box(200, 100, 800, 600);
  const composer = box(220, 620, 760, 50);
  const button = box(940, 628, 34, 34);

  test("from the voice button at its size to just above the composer, in the middle, at the empty page's size", () => {
    const { from, to } = flightPath(stage, button, composer);
    expect(from).toEqual({ x: 957 - 200, y: 645 - 100, s: 34 / FLYER_PX });
    expect(to).toEqual({ x: 400, y: 620 - 100 - FLYER_PX / 2 - FLYER_GAP_PX, s: 1 });
    expect(FLYER_PX).toBe(132);
  });

  test("on the empty page it lands on the emblem in the middle, at its size", () => {
    const { to } = flightPath(stage, button, composer, box(534, 200, 132, 132));
    expect(to).toEqual({ x: 534 + 66 - 200, y: 266 - 100, s: 1 });
  });

  test("a place is a translation of the flyer's box and a scale", () => {
    expect(spotTransform({ x: 400, y: 300, s: 1 })).toBe("translate(334px, 234px) scale(1)");
    expect(spotTransform({ x: 66, y: 66, s: 34 / 132 })).toBe("translate(0px, 0px) scale(0.258)");
  });
});

describe("the voice button while the picture is up", () => {
  test("an unchanged voice redraw retains the listening picture", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const stage = document.createElement("div"), composer = document.createElement("form"), button = document.createElement("button");
    composer.append(button); stage.append(composer); document.body.append(stage);
    button.getClientRects = () => [{}] as unknown as DOMRectList;
    const voice = new VoiceMode({ stage, button: () => button, composer: () => composer, target: () => null, face: () => '<span class="av"><svg></svg></span>', onClick() {} });
    try {
      voice.up(); const face = stage.querySelector(".av");
      expect(face).not.toBeNull(); voice.redraw(); expect(stage.querySelector(".av")).toBe(face);
    } finally { voice.down(); stage.remove(); vi.unstubAllGlobals(); }
  });

  test("only its picture is hidden: the button stays on screen, so it keeps the focus and hears the key let go", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const stage = document.createElement("div");
    const composer = document.createElement("form");
    const button = document.createElement("button");
    button.innerHTML = `<span class="av"></span>`;
    composer.append(button);
    stage.append(composer);
    document.body.append(stage);
    button.getClientRects = () => [{}] as unknown as DOMRectList;
    button.focus();
    const voice = new VoiceMode({ stage, button: () => button, composer: () => composer, target: () => null, face: () => "", onClick: () => {} });
    voice.up();
    expect(voice.isUp).toBe(true);
    expect(button.style.visibility).toBe("");
    expect(button.classList.contains("vm-away")).toBe(true);
    expect(document.activeElement).toBe(button);
    // the stylesheet hides what is inside it, whatever picture is drawn there meanwhile
    const css = readFileSync(path.resolve(import.meta.dirname, "agent.css"), "utf8");
    expect(css).toContain(".vm-away > * { visibility: hidden; }");
    voice.down();
    expect(button.classList.contains("vm-away")).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("the flyer in front of a page", () => {
  /** A stage with a composer and a voice button, the way the conversation has them; `page` puts a page in the thread's place. */
  function setup(page: boolean) {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const stage = document.createElement("div"), composer = document.createElement("form"), button = document.createElement("button");
    composer.append(button); stage.append(composer); document.body.append(stage);
    button.getClientRects = () => [{}] as unknown as DOMRectList;
    if (page) stage.classList.add("is-page");
    const voice = new VoiceMode({ stage, button: () => button, composer: () => composer, target: () => null, face: () => '<span class="av"></span>', onClick() {} });
    return { stage, button, voice };
  }
  const css = (name: string): string => readFileSync(path.resolve(import.meta.dirname, name), "utf8").replace(/\r\n/g, "\n");

  test("the page's stylesheet puts away every child of the stage but the thread, the page, the composer and the flyer", () => {
    const rules = css("page-view.css");
    expect(rules).toContain(".ra-stage.is-page > :not(.ra-scroll, .pgv, .ra-dock, .ra-flyer) { display: none; }");
    // the page scrolls and its buttons work under the flyer
    expect(rules).toMatch(/\.ra-stage\.is-page > \.ra-flyer \{[^}]*pointer-events: none/);
    // nothing makes a page or the composer stand over it
    expect(css("agent.css")).toMatch(/\.ra-flyer \{[^}]*z-index: 5/);
  });

  test("with a page open the flyer stays after the recording and leaves when the words are in", () => {
    const { stage, button, voice } = setup(true);
    try {
      voice.up();
      expect(stage.querySelector(".ra-flyer")).not.toBeNull();
      expect(voice.hold()).toBe(true);
      expect(voice.isUp).toBe(true);
      expect(voice.isHeld).toBe(true);
      expect(stage.querySelector(".ra-flyer")).not.toBeNull();
      // the recording is over: the button is the slot's again
      expect(button.classList.contains("vm-away")).toBe(false);
      voice.down();
      expect(voice.isUp).toBe(false);
      expect(voice.isHeld).toBe(false);
      expect(stage.querySelector(".ra-flyer")).toBeNull();
    } finally { voice.drop(); stage.remove(); vi.unstubAllGlobals(); }
  });

  test("without a page it is not held: the flyer goes back as it always did", () => {
    const { stage, voice } = setup(false);
    try {
      voice.up();
      expect(voice.hold()).toBe(false);
      expect(voice.isHeld).toBe(false);
      voice.down();
      expect(stage.querySelector(".ra-flyer")).toBeNull();
    } finally { voice.drop(); stage.remove(); vi.unstubAllGlobals(); }
  });

  test("a held flyer goes back when the page is put away, and a new press listens with the same one", async () => {
    const first = setup(true);
    try {
      first.voice.up(); first.voice.hold();
      first.stage.classList.remove("is-page");
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(first.voice.isUp).toBe(false);
      expect(first.stage.querySelector(".ra-flyer")).toBeNull();
    } finally { first.voice.drop(); first.stage.remove(); vi.unstubAllGlobals(); }
    const again = setup(true);
    try {
      again.voice.up(); again.voice.hold();
      const flyer = again.stage.querySelector(".ra-flyer");
      again.voice.up();
      expect(again.voice.isHeld).toBe(false);
      expect(again.stage.querySelectorAll(".ra-flyer")).toHaveLength(1);
      expect(again.stage.querySelector(".ra-flyer")).toBe(flyer);
      expect(again.button.classList.contains("vm-away")).toBe(true);
    } finally { again.voice.drop(); again.stage.remove(); vi.unstubAllGlobals(); }
  });
});
