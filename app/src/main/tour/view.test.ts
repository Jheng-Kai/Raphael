// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createView, type TourView, type ViewModel } from "./view";

const modelAt = (left: number, top: number): ViewModel => ({
  mode: "step", text: "Follow Raphael.", label: "Raphael's tour", buttons: [],
  locate: () => null, anchor: () => ({ left, top, width: 100, height: 80 }),
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

  view.render(modelAt(430, 250), { hop: true });
  // Three hops of 110 px along one straight line: the ground moves a third of the way during each and waits on every touch-down.
  expect(motion("ground").frames.map(frame => frame.transform)).toEqual([
    "translate(-330px, 0px)", "translate(-330px, 0px)", "translate(-220px, 0px)", "translate(-220px, 0px)",
    "translate(-110px, 0px)", "translate(-110px, 0px)", "translate(0px, 0px)", "translate(0px, 0px)",
  ]);
  expect(times("ground")).toEqual([0, 80, 346, 416, 682, 752, 1018, 1198]);
  const glowFrames = motion("glow").frames;
  expect(glowFrames.every(frame => !String(frame.transform).includes("translate"))).toBe(true);
  expect(glowFrames.filter(frame => frame.transform === "scaleX(0.65)").map(frame => Math.round(frame.offset! * 1198))).toEqual([213, 549, 885]);
  expect(glowFrames.find(frame => frame.transform === "scaleX(0.65)")?.opacity).toBe("calc(var(--hop-glow-opacity, 0.5) * 0.5)");
});

test("the hops crouch, stretch at their tops, touch down, land and settle before turning to idle, eyes to the side in the air", () => {
  view.render(modelAt(100, 250), { hop: false });
  view.render(modelAt(430, 250), { hop: true });
  const body = motion("slime");
  expect(body.duration).toBe(1198);
  expect(times("slime")).toEqual([0, 80, 213, 346, 366, 416, 549, 682, 702, 752, 885, 1018, 1053, 1118, 1198]);
  expect(body.frames.map(frame => String(frame.transform).split("scale")[1])).toEqual([
    "(1, 1)", "(1.12, 0.88)", "(0.94, 1.08)", "(1, 1)", "(1.1, 0.9)", "(1, 1)",
    "(0.94, 1.08)", "(1, 1)", "(1.1, 0.9)", "(1, 1)",
    "(0.94, 1.08)", "(1, 1)", "(1.16, 0.84)", "(0.97, 1.04)", "(1, 1)",
  ]);
  expect(body.frames[2]?.transform).toBe("translateY(-38.5px) rotate(3deg) scale(0.94, 1.08)");
  expect(bubbleDelay()).toBe("1198ms");
  const root = document.querySelector<HTMLElement>(".tour")!;
  expect(root.dataset.facing).toBe("right");
  expect(root.classList.contains("is-idle")).toBe(false);
  view.reflow();
  expect(body.animation.cancel).not.toHaveBeenCalled();
  expect(calls).toHaveLength(3);
  body.animation.onfinish?.call(body.animation, new Event("finish") as AnimationPlaybackEvent);
  expect(root.classList.contains("is-idle")).toBe(true);
  expect(root.dataset.facing).toBeUndefined();
});

test("a move the layout forces is hopped too, and hops under way keep their course until they land", () => {
  view.render(modelAt(100, 250), { hop: false });
  expect(calls).toHaveLength(0);
  // A resize or a layer that opened moves the place without a new step: Raphael still hops there, never appearing at once.
  view.render(modelAt(430, 250), { hop: false });
  const hops = motion("slime");
  expect(hops.duration).toBe(1198);
  // Meanwhile the place moves again: the hops go on to where they were going, on their straight line, and nothing is cut short.
  view.render(modelAt(600, 250), { hop: false });
  expect(hops.animation.cancel).not.toHaveBeenCalled();
  expect(calls).toHaveLength(3);
  expect(find("ground").style.left).toBe(`${430 + 100 + 12 + 16 - 16}px`);
  // Landed, Raphael hops on from there to the new place, again in a straight line.
  hops.animation.onfinish?.call(hops.animation, new Event("finish") as AnimationPlaybackEvent);
  expect(calls).toHaveLength(6);
  expect(motion("ground").frames[0]?.transform).toBe("translate(-170px, 0px)");
});

test("the offer grows out of its origin and fades the glow in at touchdown", () => {
  view.render({ ...modelAt(100.3, 250.7), mode: "offer", origin: () => ({ left: 30, top: 500, width: 36, height: 36 }) }, { hop: true });
  const body = motion("slime");
  expect(body.duration).toBe(430);
  expect(String(body.frames[0].transform)).toContain("scale(0.3, 0.3)");
  expect(motion("glow").frames.filter(frame => frame.opacity === 0).map(frame => Math.round(frame.offset! * body.duration))).toEqual([0, 180]);
  expect(bubbleDelay()).toBe("430ms");
  expect(body.frames[body.frames.length - 1]?.transform).toBe("translateY(0px) rotate(0deg) scale(1, 1)");
  const ground = motion("ground").frames;
  expect(ground[ground.length - 1]?.transform).toBe("translate(0px, 0px)");
  expect(find("ground").style.left).toMatch(/^\d+px$/);
  expect(find("ground").style.top).toMatch(/^\d+px$/);
});

test("an uncovered offer plays the same pop from the account button even at the same position", () => {
  const offer: ViewModel = { ...modelAt(100, 250), mode: "offer", origin: () => ({ left: 30, top: 500, width: 36, height: 36 }) };
  view.render(offer, { hop: true });
  const first = motion("slime");
  view.hideOffer();
  view.render(offer, { hop: true });
  expect(first.animation.cancel).toHaveBeenCalledOnce();
  expect(motion("slime").frames).toEqual(first.frames);
  expect(bubbleDelay()).toBe("430ms");
  view.reflow();
  expect(animate).toHaveBeenCalledTimes(6);
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
  view.render({ ...modelAt(140, 250), mode: "bye", celebrate: true }, { hop: true });
  expect(animate).not.toHaveBeenCalled();
});

test("the goodbye adds two 12 px hops in place as its words appear", () => {
  view.render(modelAt(100, 250), { hop: false });
  view.render({ ...modelAt(140, 250), mode: "bye", celebrate: true }, { hop: true });
  expect(bubbleDelay()).toBe("810ms");
  expect(motion("slime").duration).toBe(1110);
  expect(times("slime").slice(-5)).toEqual([810, 885, 960, 1035, 1110]);
  expect(motion("slime").frames.slice(-4).map(frame => parseFloat(String(frame.transform).slice("translateY(".length)))).toEqual([-12, 0, -12, 0]);
  expect(motion("ground").frames.filter(frame => frame.offset! >= 810 / 1110).map(frame => frame.transform))
    .toEqual(["translate(0px, 0px)", "translate(0px, 0px)"]);
  expect(document.querySelector(".tour")?.getAttribute("data-dim")).toBe("none");
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
  sample("slime", "matrix(0.97, 0.05, -0.054, 1.04, 0, -32)", "1");
  sample("glow", "matrix(0.71, 0, 0, 1, 0, 0)", "0.36");

  view.render(modelAt(500, 400), { hop: true });
  expect(first.every(call => vi.mocked(call.animation.cancel).mock.calls.length === 1)).toBe(true);
  expect(motion("ground").frames[0].transform).toBe("translate(-290px, -113px)");
  const transform = String(motion("slime").frames[0].transform);
  expect(transform).toMatch(/^translateY\(-32px\) rotate\(2\.95/);
  expect(motion("glow").frames[0]).toMatchObject({ transform: "scaleX(0.71)", opacity: "0.36" });
  expect(motion("slime").frames.some(frame => String(frame.transform).endsWith("scale(1.12, 0.88)"))).toBe(false);
});
