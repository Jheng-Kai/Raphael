// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { stopOffscreenSlimes } from "./slime-offscreen";
import { handOver, slimeSVG } from "./slime";

type Entry = { target: Element; isIntersecting: boolean };
let observers: FakeObserver[] = [];
class FakeObserver {
  observed = new Set<Element>();
  constructor(readonly report: (entries: Entry[]) => void, readonly options: IntersectionObserverInit) { observers.push(this); }
  observe(el: Element): void { this.observed.add(el); }
  unobserve(el: Element): void { this.observed.delete(el); }
  disconnect(): void { this.observed.clear(); }
}
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const surface = (): HTMLElement => Object.assign(document.createElement("span"), { className: "slime-surface" });

let stop: () => void = () => {};
beforeEach(() => {
  observers = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  document.body.innerHTML = "";
  stop = stopOffscreenSlimes(document.body);
});
afterEach(() => stop());

test("a slime far outside the visible part of its scroller stops moving, and moves again when it comes near", async () => {
  const near = surface(), far = surface();
  document.body.append(near, far);
  await flush();
  const [io] = observers;
  expect(io!.options.rootMargin).toBe("0px");
  expect([...io!.observed]).toEqual([near, far]);
  io!.report([{ target: near, isIntersecting: true }, { target: far, isIntersecting: false }]);
  expect(near.hasAttribute("data-offscreen")).toBe(false);
  expect(far.hasAttribute("data-offscreen")).toBe(true);
  io!.report([{ target: far, isIntersecting: true }]);
  expect(far.hasAttribute("data-offscreen")).toBe(false);
});

test("a newly drawn slime keeps moving until it is placed, and one moved by a redraw keeps its state", async () => {
  const fresh = surface();
  document.body.append(fresh);
  await flush();
  // Held still first, a slime in view would start from its rest pose and jump into its loop.
  expect(fresh.hasAttribute("data-offscreen")).toBe(false);
  const [io] = observers;
  io!.report([{ target: fresh, isIntersecting: false }]);
  const other = document.createElement("div");
  document.body.append(other);
  other.append(fresh);
  await flush();
  expect(fresh.hasAttribute("data-offscreen")).toBe(true);
  expect(io!.observed.has(fresh)).toBe(true);
});

test("slimes drawn later inside new lines are watched, and removed ones are let go", async () => {
  const line = document.createElement("li");
  line.innerHTML = `<span class="av"><span class="slime-surface"></span></span><span class="slime-surface"></span>`;
  document.body.append(line);
  await flush();
  const [io] = observers;
  expect(io!.observed.size).toBe(2);
  line.remove();
  await flush();
  expect(io!.observed.size).toBe(0);
});

test("the stylesheet stops every animation inside an off-screen slime, whatever rule started it", () => {
  const css = readFileSync("src/main/slime.css", "utf8");
  expect(css).toContain(".slime-surface[data-offscreen], .slime-surface[data-offscreen] * { animation: none !important; }");
});

test("an offscreen state defers its cells and visibility restores them without transition reads", async () => {
  const line = document.createElement('div'); line.innerHTML = slimeSVG({color:'sky'});
  document.body.append(line); await flush();
  const surface = line.querySelector('.slime-surface')!, svg = line.querySelector<SVGElement>('svg.slime')!;
  observers[0]!.report([{target:surface,isIntersecting:false}]);
  handOver(svg,'working');
  expect(surface.hasAttribute('data-slime-pending')).toBe(true);
  expect(surface.querySelector('.slime-loop')).toBeNull();
  const styles = vi.spyOn(globalThis,'getComputedStyle');
  try {
    observers[0]!.report([{target:surface,isIntersecting:true}]);
    await vi.waitFor(() => expect(surface.querySelector('.slime-loop')).not.toBeNull());
    expect(surface.hasAttribute('data-slime-pending')).toBe(false);
    expect(styles).not.toHaveBeenCalled();
  } finally { styles.mockRestore(); }
});
