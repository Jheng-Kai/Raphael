// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createView, type TourView, type ViewModel } from "./view";

const modelAt = (left: number, top: number): ViewModel => ({
  mode: "step", text: "Follow Raphael.", label: "Raphael's tour", buttons: [],
  locate: () => ({ box: { left, top, width: 100, height: 80 }, radius: 8, dim: true }),
  prefer: ["right"], align: "center", origin: () => null,
});

let view: TourView;
let reduced = false;
const calls: { element: HTMLElement; frames: Keyframe[]; duration: number; animation: Animation }[] = [];
const animate = vi.fn(function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
  const animation = { currentTime: 0, cancel: vi.fn(), onfinish: null } as unknown as Animation;
  calls.push({ element: this, frames, duration: Number(options.duration), animation });
  return animation;
});
const find = (name: string): HTMLElement => document.querySelector<HTMLElement>(`.tour-${name}`)!;
const motion = (name: string) => calls.filter(call => call.element === find(name)).slice(-1)[0]!;
const bubbleDelay = () => find("bubble").style.getPropertyValue("--tour-in-delay");
const times = (name: string) => motion(name).frames.map(frame => Math.round(frame.offset! * motion(name).duration));

beforeEach(() => {
  calls.length = 0;
  animate.mockClear();
  reduced = false;
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: reduced, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("innerWidth", 1120);
  vi.stubGlobal("innerHeight", 900);
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  view = createView(vi.fn(), vi.fn());
});

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
afterEach(() => {
  view.destroy();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.unstubAllGlobals();
});

test("the glow travels on the ground while the body rises and falls", () => {
  view.render(modelAt(100, 250), { hop: false });
  const glow = find("glow");
  const ground = find("ground");
  expect(glow.parentElement).toBe(ground);
  expect(find("slime").parentElement).toBe(ground);

  view.render(modelAt(400, 350), { hop: true });
  expect(motion("ground").frames.map(frame => frame.transform)).toEqual([
    "translate(-300px, -100px)", "translate(-300px, -100px)", "translate(0px, 0px)", "translate(0px, 0px)",
  ]);
  expect(times("ground")).toEqual([0, 100, 400, 600]);
  expect(motion("slime").frames.find(frame => frame.offset === 250 / 600)?.transform).toBe("translateY(-63px) scale(1, 1)");
  const glowFrames = motion("glow").frames;
  expect(glowFrames.every(frame => !String(frame.transform).includes("translate"))).toBe(true);
  expect(glowFrames.find(frame => frame.offset === 250 / 600)).toMatchObject({
    transform: "scaleX(0.65)", opacity: "calc(var(--tour-glow-opacity) * 0.5)",
  });
  expect(glowFrames.find(frame => frame.offset === 400 / 600)).toMatchObject({ transform: "scaleX(1)", opacity: "var(--tour-glow-opacity)" });
});

test("a long hop anticipates, stretches, lands and settles before turning to idle", () => {
  view.render(modelAt(100, 250), { hop: false });
  view.render(modelAt(400, 350), { hop: true });
  const body = motion("slime");
  expect(body.duration).toBe(600);
  expect(times("slime")).toEqual([0, 100, 136, 250, 400, 435, 480, 528, 600]);
  expect(body.frames.map(frame => String(frame.transform).split("scale")[1])).toEqual([
    "(1, 1)", "(1.12, 0.88)", "(0.92, 1.1)", "(1, 1)", "(1, 1)", "(1.16, 0.84)", "(1.03, 0.97)", "(0.97, 1.04)", "(1, 1)",
  ]);
  expect(bubbleDelay()).toBe("480ms");
  expect(document.querySelector(".tour")?.classList.contains("is-idle")).toBe(false);
  view.reflow();
  expect(body.animation.cancel).not.toHaveBeenCalled();
  expect(calls).toHaveLength(3);
  body.animation.onfinish?.call(body.animation, new Event("finish") as AnimationPlaybackEvent);
  expect(document.querySelector(".tour")?.classList.contains("is-idle")).toBe(true);
});

test("a short hop uses shorter anticipation and the bubble waits for its own landing", () => {
  view.render(modelAt(100, 250), { hop: false });
  view.render(modelAt(140, 250), { hop: true });
  expect(motion("slime").duration).toBe(455);
  expect(times("ground")).toEqual([0, 35, 255, 455]);
  expect(bubbleDelay()).toBe("335ms");
});

test("the offer grows out of its origin and fades the glow in at touchdown", () => {
  view.render({ ...modelAt(100.3, 250.7), mode: "offer", origin: () => ({ left: 30, top: 500, width: 36, height: 36 }) }, { hop: true });
  const body = motion("slime");
  expect(body.duration).toBe(450);
  expect(String(body.frames[0].transform)).toContain("scale(0.3, 0.3)");
  expect(motion("glow").frames.filter(frame => frame.opacity === 0).map(frame => Math.round(frame.offset! * body.duration))).toEqual([0, 180]);
  expect(bubbleDelay()).toBe("330ms");
  expect(body.frames[body.frames.length - 1]?.transform).toBe("translateY(0px) scale(1, 1)");
  const ground = motion("ground").frames;
  expect(ground[ground.length - 1]?.transform).toBe("translate(0px, 0px)");
  expect(find("ground").style.left).toMatch(/^\d+px$/);
  expect(find("ground").style.top).toMatch(/^\d+px$/);
});

test("reduced motion puts the face and its static glow at the destination without animations", () => {
  reduced = true;
  view.render({ ...modelAt(100, 250), mode: "offer", origin: () => ({ left: 30, top: 500, width: 36, height: 36 }) }, { hop: true });
  const previous = find("ground").style.left;
  view.render(modelAt(400, 350), { hop: true });
  expect(find("ground").style.left).not.toBe(previous);
  expect(find("glow").parentElement).toBe(find("ground"));
  expect(document.querySelector(".tour")?.classList.contains("is-idle")).toBe(false);
  expect(animate).not.toHaveBeenCalled();
  expect(bubbleDelay()).toBe("0ms");
});

test("interrupting an airborne hop starts at the current ground, body and glow poses", () => {
  view.render(modelAt(100, 250), { hop: false });
  view.render(modelAt(400, 350), { hop: true });
  const first = [...calls];
  motion("slime").animation.currentTime = 210;
  const sample = (name: string, transform: string, opacity: string) => {
    const element = find(name);
    Object.assign(element.style, { transform, opacity });
    vi.mocked(motion(name).animation.cancel).mockImplementationOnce(() => {
      element.style.removeProperty("transform");
      element.style.removeProperty("opacity");
    });
  };
  sample("ground", "matrix(1, 0, 0, 1, -190, -63)", "1");
  sample("slime", "matrix(0.97, 0, 0, 1.04, 0, -57)", "1");
  sample("glow", "matrix(0.71, 0, 0, 1, 0, 0)", "0.36");

  view.render(modelAt(500, 400), { hop: true });
  expect(first.every(call => vi.mocked(call.animation.cancel).mock.calls.length === 1)).toBe(true);
  expect(motion("ground").frames[0].transform).toBe("translate(-290px, -113px)");
  expect(motion("slime").frames[0].transform).toBe("translateY(-57px) scale(0.97, 1.04)");
  expect(motion("glow").frames[0]).toMatchObject({ transform: "scaleX(0.71)", opacity: "0.36" });
  expect(motion("slime").frames.some(frame => String(frame.transform).endsWith("scale(1.12, 0.88)"))).toBe(false);
});
