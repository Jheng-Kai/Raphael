// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { followOffset, installSlimeFollow } from "./slime-follow";

const box = { left: 100, top: 100, width: 40, height: 40 };

test("the eyes turn toward a pointer near the slime, all the way from a width off, and stay put when it is far", () => {
  const right = followOffset(box, 270, 119.2)!;
  expect(right.x).toBeGreaterThan(3); expect(Math.abs(right.y)).toBeLessThan(0.1);
  const below = followOffset(box, 120, 260)!;
  expect(below.y).toBeGreaterThan(2); expect(Math.abs(below.x)).toBeLessThan(0.1);
  const close = followOffset(box, 130, 119.2)!;
  expect(close.x).toBeGreaterThan(0); expect(close.x).toBeLessThan(right.x);
  expect(followOffset(box, 1000, 1000)).toBeNull();
  expect(followOffset({ ...box, width: 0 }, 120, 120)).toBeNull();
});

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

test("only resting slimes near the pointer follow it, and they ease back when it leaves", () => {
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => { run(0); return 0; });
  document.body.innerHTML = '<svg class="slime" data-state="idle"><g class="slime-follow"></g></svg><svg class="slime" data-state="sleeping"><g class="slime-follow"></g></svg>';
  const [idle, sleeping] = [...document.querySelectorAll<SVGElement>("svg.slime")];
  for (const svg of [idle, sleeping]) svg!.getBoundingClientRect = () => ({ ...box, right: 140, bottom: 140, x: 100, y: 100, toJSON: () => ({}) });
  const stop = installSlimeFollow(document);
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: 260, clientY: 119 }));
  const follow = (svg: SVGElement): string => svg.querySelector<SVGElement>(".slime-follow")!.style.getPropertyValue("--slime-follow-x");
  expect(parseFloat(follow(idle!))).toBeGreaterThan(3);
  expect(follow(sleeping!)).toBe("");
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: 2000, clientY: 2000 }));
  expect(follow(idle!)).toBe("");
  stop();
});
