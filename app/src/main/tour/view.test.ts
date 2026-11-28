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
  // One jump: the ground waits through the crouch, slides the whole way while Raphael is in the air, and rests on the landing.
  expect(motion("ground").frames.map(frame => frame.transform)).toEqual([
    "translate(-330px, 0px)", "translate(-330px, 0px)", "translate(0px, 0px)", "translate(0px, 0px)",
  ]);
  expect(times("ground")).toEqual([0, 80, 522, 702]);
  const glowFrames = motion("glow").frames;
  expect(glowFrames.every(frame => !String(frame.transform).includes("translate"))).toBe(true);
  expect(glowFrames.filter(frame => frame.transform === "scaleX(0.5)").map(frame => Math.round(frame.offset! * 702))).toEqual([301]);
  expect(glowFrames.find(frame => frame.transform === "scaleX(0.5)")?.opacity).toBe("calc(var(--tour-glow-opacity) * 0.5)");
});

test("the jump crouches, stretches at its top, lands and settles before turning to idle, its eyes to the side while in the air", () => {
  view.render(modelAt(100, 250), { hop: false });
  view.render(modelAt(430, 250), { hop: true });
  const body = motion("slime");
  expect(body.duration).toBe(702);
  expect(times("slime")).toEqual([0, 80, 301, 522, 557, 622, 702]);
  expect(body.frames.map(frame => String(frame.transform).split("scale")[1])).toEqual([
    "(1, 1)", "(1.12, 0.88)", "(0.94, 1.08)", "(1, 1)", "(1.16, 0.84)", "(0.97, 1.04)", "(1, 1)",
  ]);
  expect(body.frames[2]?.transform).toBe("translateY(-99px) rotate(3deg) scale(0.94, 1.08)");
  expect(bubbleDelay()).toBe("702ms");
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

test.each([
  [30, 560, 18], [100, 575, 30], [330, 702, 99], [800, 960, 150],
])("a %i px move is one jump of %i ms, %i px high, and the bubble waits for its landing", (distance, duration, height) => {
  view.render(modelAt(100, 250), { hop: false });
  view.render(modelAt(100 + distance, 250), { hop: true });
  const body = motion("slime");
  expect(body.duration).toBe(duration);
  const apexes = body.frames.filter(frame => String(frame.transform).endsWith("scale(0.94, 1.08)"));
  expect(apexes).toHaveLength(1);
  expect(parseFloat(String(apexes[0]!.transform).slice("translateY(".length))).toBeCloseTo(-height);
  expect(bubbleDelay()).toBe(`${duration}ms`);
});

test("a move the layout forces is a jump too, and a nudge of a few pixels never cuts a jump short", () => {
  view.render(modelAt(100, 250), { hop: false });
  expect(calls).toHaveLength(0);
  // A resize or a layer that opened moves the place without a new step: Raphael still jumps there, never appearing at once.
  view.render(modelAt(430, 250), { hop: false });
  const jump = motion("slime");
  expect(jump.duration).toBe(702);
  view.render(modelAt(433, 252), { hop: false });
  expect(jump.animation.cancel).not.toHaveBeenCalled();
  expect(calls).toHaveLength(3);
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
  expect(bubbleDelay()).toBe("560ms");
  expect(motion("slime").duration).toBe(860);
  expect(times("slime").slice(-5)).toEqual([560, 635, 710, 785, 860]);
  expect(motion("slime").frames.slice(-4).map(frame => parseFloat(String(frame.transform).slice("translateY(".length)))).toEqual([-12, 0, -12, 0]);
  expect(motion("ground").frames.filter(frame => frame.offset! >= 560 / 860).map(frame => frame.transform))
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
