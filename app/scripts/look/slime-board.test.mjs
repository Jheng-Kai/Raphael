import { afterEach, expect, test, vi } from "vitest";
import { holdStaticPose, slimeParts } from "./slime-board.mjs";

afterEach(() => vi.unstubAllGlobals());

test("the loop bounds check rejects detached eyes and hats", () => {
  const box = (left, top, width, height) => ({left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {return {left, top, width, height};}});
  const body = {getBoundingClientRect: () => box(10, 10, 17, 12)};
  const eyes = {getBoundingClientRect: () => box(16, 14, 4, 2)};
  const hat = {getBoundingClientRect: () => box(11, 4, 14, 8)};
  const surface = {parentElement: {getBoundingClientRect: () => box(8, 6, 20, 19)}, getAnimations: () => []};
  const drop = {getBoundingClientRect: () => box(9, 7, 2, 3)};
  const svg = {dataset: {state: "searching"}, closest: () => surface, getBoundingClientRect: () => box(8, 6, 19, 19), querySelector: selector => selector === '.slime-body' ? body : eyes, querySelectorAll: selector => selector === '.slime-mark' ? [hat] : [drop]};
  vi.stubGlobal('document', {querySelectorAll: () => [svg]});
  vi.stubGlobal('getComputedStyle', () => ({visibility: 'visible'}));
  expect(slimeParts()).toEqual({check: 'slime-parts', samples: 1});
  const attachedEyes = eyes.getBoundingClientRect;
  eyes.getBoundingClientRect = () => box(26, 14, 4, 2);
  expect(slimeParts).toThrow('Slime parts separate');
  eyes.getBoundingClientRect = attachedEyes;
  hat.getBoundingClientRect = () => box(3, 4, 14, 8);
  expect(slimeParts).toThrow('Slime parts separate');
  hat.getBoundingClientRect = () => box(11, 4, 14, 8);
  drop.getBoundingClientRect = () => box(7, 7, 2, 3);
  expect(slimeParts).toThrow('Slime parts separate');
});

test("the static comparison retains resolved SVG alpha when animation variables disappear", () => {
  const values = new Map();
  const part = { style: { setProperty: (name, value) => values.set(name, value) } };
  const animation = { effect: { target: part, getKeyframes: () => [{ scale: "0.85" }, { scale: "1" }] } };
  const surface = { getAnimations: () => [animation] };
  vi.stubGlobal("document", { querySelectorAll: () => [{ closest: () => surface }] });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: name => name === "scale" ? "0.85" : "",
    get fillOpacity() { return values.get("fill-opacity") ?? (values.has("animation") ? "1" : "0.45"); },
    strokeOpacity: "1",
  }));
  holdStaticPose(".sample");
  expect(getComputedStyle(part).fillOpacity).toBe("0.45");
  expect(values.get("animation")).toBe("none");
});
