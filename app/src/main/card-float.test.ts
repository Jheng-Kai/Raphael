// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { core } from "./api";
import { cardCloseHTML, cardHTML } from "./card";
import { mountCardFloat, waitingCard } from "./card-float";
import { setLocale } from "./i18n";
import { cardFloatInk, memberColor } from "./owner-bubble";

vi.mock("./api", () => ({ core: vi.fn(async () => ({})) }));

/** Plays the scroller's IntersectionObserver: `sight(false)` scrolls what it watches out of view. */
let watched: Element[] = [];
let callback: ((entries: { isIntersecting: boolean; target: Element }[]) => void) | null = null;
class FakeObserver {
  constructor(fn: typeof callback) { callback = fn; }
  observe(target: Element) { watched.push(target); }
  unobserve(target: Element) { watched = watched.filter(other => other !== target); }
  disconnect() { watched = []; }
}
const sight = (visible: boolean) => callback?.(watched.map(target => ({ isIntersecting: visible, target })));
const frame = () => new Promise(resolve => setTimeout(resolve, 20));

const card = (status: string) =>
  `<li><section class="conversation-card"><header class="card-head"><div class="card-heading"><b class="card-title">儲存金鑰</b></div>` +
  `<span class="card-status is-${status}"></span></header><input data-secret-input="1"></section></li>`;

beforeEach(() => {
  setLocale("zh-TW");
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  watched = []; callback = null;
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function mount(html: string, member = { id: 1, avatar: "slime:color:lime" }, raphaelColor = "#1f9fe8") {
  document.body.innerHTML = `<div class="ra-stage"><div class="ra-scroll"><div class="ra-col"><ol class="thread">${html}</ol></div></div></div>`;
  const stage = document.querySelector<HTMLElement>(".ra-stage")!, thread = document.querySelector<HTMLElement>(".thread")!;
  stage.style.setProperty("--raphael-color", raphaelColor);
  const float = mountCardFloat({ stage, scroller: document.querySelector<HTMLElement>(".ra-scroll")!, thread, memberOfCard: () => member });
  return { stage, thread, float, pill: stage.querySelector<HTMLElement>(".card-float")! };
}

test("a waiting card scrolled out of sight is named by a pill at the top, and a press stands the card itself over the thread", async () => {
  const { pill, thread } = mount(`<li>reply</li>${card("waiting")}<li>later</li>`);
  expect(pill.hidden).toBe(true);
  sight(false);
  expect(pill.hidden).toBe(false);
  expect(pill.querySelector(".card-float-title")!.textContent).toBe("儲存金鑰");
  expect(pill.querySelector(".card-float-back")!.getAttribute("aria-label")).toBe("回到原位");
  const open = pill.querySelector<HTMLElement>(".card-float-open")!;
  open.click();
  const shown = thread.querySelector<HTMLElement>(".conversation-card")!;
  expect(shown.classList.contains("is-floating")).toBe(true);
  expect(shown.previousElementSibling?.classList.contains("card-float-place")).toBe(true);
  // It is the same card, still in the thread: its field and buttons keep working where they are bound.
  expect(thread.contains(shown) && shown.querySelector("[data-secret-input]")).toBeTruthy();
  expect(open.getAttribute("aria-expanded")).toBe("true");
  open.click();
  expect(shown.classList.contains("is-floating")).toBe(false);
  expect(thread.querySelector(".card-float-place")).toBeNull();
});

test("the pill wears the member's slime colour with one ink and no warning dot", () => {
  const member = { id: 1, avatar: "slime:color:gold" };
  const { pill } = mount(card("waiting"), member);
  sight(false);
  expect(pill.style.getPropertyValue("--card-float-fill")).toBe(memberColor(member));
  expect(pill.style.getPropertyValue("--card-float-ink")).toBe("#000000");
  expect(pill.querySelector(".card-float-dot")).toBeNull();
});

test.each(["#1f9fe8", "#5cc4ff"])("Raphael's pill uses the theme's Raphael colour %s", color => {
  const { pill } = mount(card("waiting"), { id: 0, avatar: "slime:color:yellow" }, color);
  sight(false);
  expect(pill.style.getPropertyValue("--card-float-fill")).toBe("var(--raphael-color)");
  expect(pill.style.getPropertyValue("--card-float-ink")).toBe("#000000");
});

test("the pill chooses dark ink on light colours and white on dark colours at a contrast of at least 4.5 to 1", () => {
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance = (hex: string) => [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) =>
    sum + weight * linear(Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255), 0);
  for (const [fill, expected] of [["#fff375", "#000000"], ["#18233b", "#ffffff"], ["#757575", "#ffffff"], ["#767676", "#000000"]] as const) {
    const { ink, maxMix } = cardFloatInk(fill);
    expect(ink).toBe(expected);
    const inkLight = luminance(ink), fillLight = luminance(fill);
    for (const mix of [0, maxMix]) {
      const mixedLight = fillLight + (inkLight - fillLight) * mix;
      expect((Math.max(mixedLight, inkLight) + 0.05) / (Math.min(mixedLight, inkLight) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

const cancellableCard = () => `<li>${cardHTML({ title: "Save a key", status: "waiting", close: cardCloseHTML("key") })}</li>`;

test("the floating card's close collapses it without sending a cancel and leaves the pill and card waiting", () => {
  const { pill, thread } = mount(cancellableCard());
  const shown = thread.querySelector<HTMLElement>(".conversation-card")!;
  const close = shown.querySelector<HTMLButtonElement>(".card-close")!;
  const open = pill.querySelector<HTMLButtonElement>(".card-float-open")!;
  sight(false);
  open.click();
  close.querySelector("svg")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(shown.classList.contains("is-floating")).toBe(false);
  expect(thread.querySelector(".card-float-place")).toBeNull();
  expect(open.getAttribute("aria-expanded")).toBe("false");
  expect(pill.hidden).toBe(false);
  expect(waitingCard(shown)).toBe(true);
  expect(close.disabled).toBe(false);
  expect(core).not.toHaveBeenCalled();
});

test("the close is named collapse while floating and cancels as before back in the thread", () => {
  const { pill, thread } = mount(cancellableCard());
  const close = thread.querySelector<HTMLButtonElement>(".card-close")!;
  expect(close.getAttribute("aria-label")).toBe("取消");
  sight(false);
  pill.querySelector<HTMLButtonElement>(".card-float-open")!.click();
  expect(close.getAttribute("aria-label")).toBe("收起");
  expect(close.title).toBe("收起");
  close.click();
  sight(true);
  expect(close.getAttribute("aria-label")).toBe("取消");
  expect(close.title).toBe("取消");
  close.click();
  expect(core).toHaveBeenCalledExactlyOnceWith("integrations.card_close", { id: "key" });
});

test("the pill pops once per waiting card when motion is allowed", async () => {
  const { pill, thread } = mount(card("waiting"));
  const animate = pill.animate = vi.fn();
  sight(false);
  sight(true);
  sight(false);
  expect(animate).toHaveBeenCalledTimes(1);
  thread.insertAdjacentHTML("beforeend", card("waiting"));
  await frame();
  sight(false);
  expect(animate).toHaveBeenCalledTimes(2);
  thread.lastElementChild!.remove();
  await frame();
  sight(false);
  expect(animate).toHaveBeenCalledTimes(2);
});

test("the pill appears without a pop under reduced motion", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const { pill } = mount(card("waiting"));
  const animate = pill.animate = vi.fn();
  sight(false);
  expect(pill.hidden).toBe(false);
  expect(animate).not.toHaveBeenCalled();
});

test("redrawing the same waiting card does not replay its pop", async () => {
  const { pill, thread } = mount(cancellableCard());
  const animate = pill.animate = vi.fn();
  sight(false);
  thread.innerHTML = cancellableCard();
  await frame();
  sight(false);
  expect(pill.hidden).toBe(false);
  expect(animate).toHaveBeenCalledTimes(1);
});

test("回到原位 scrolls back to the card where it was born and marks it for a moment, back in sight the pill goes", async () => {
  const { pill, thread } = mount(card("waiting"));
  const shown = thread.querySelector<HTMLElement>(".conversation-card")!;
  shown.scrollIntoView = vi.fn();
  sight(false);
  pill.querySelector<HTMLElement>(".card-float-open")!.click();
  pill.querySelector<HTMLElement>(".card-float-back")!.click();
  expect(shown.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  expect(shown.classList.contains("is-floating")).toBe(false);
  expect(shown.classList.contains("is-flash")).toBe(true);
  sight(true);
  expect(pill.hidden).toBe(true);
});

test("an answered card takes its pill away, and a card that waits for nothing never floats", async () => {
  const { pill, thread, float } = mount(card("waiting"));
  sight(false);
  expect(pill.hidden).toBe(false);
  // The thread draws the answered card again: its status is no longer waiting.
  thread.querySelector(".card-status")!.setAttribute("class", "card-status is-done");
  float.sync();
  await frame();
  expect(pill.hidden).toBe(true);
  const done = mount(card("done"));
  sight(false);
  expect(done.pill.hidden).toBe(true);
});

test("the floating card stands centred under the pill, as wide as it was, and never past the conversation's edge", () => {
  const { pill, stage, thread } = mount(`<li>reply</li>${card("waiting")}<li>later</li>`);
  sight(false);
  const shown = thread.querySelector<HTMLElement>(".conversation-card")!;
  const rect = (left: number, width: number, top = 0, height = 40) => ({ left, width, right: left + width, top, height, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(pill, "offsetParent", { configurable: true, get: () => stage });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(rect(300, 900, 0, 800));
  vi.spyOn(shown, "getBoundingClientRect").mockReturnValue(rect(340, 420, 500, 200));
  const at = (pillLeft: number) => {
    vi.spyOn(pill, "getBoundingClientRect").mockReturnValue(rect(pillLeft, 160, 20, 36));
    pill.querySelector<HTMLElement>(".card-float-open")!.click();
    const left = shown.style.getPropertyValue("--float-left"), width = shown.style.getPropertyValue("--float-width");
    pill.querySelector<HTMLElement>(".card-float-open")!.click();
    return [left, width];
  };
  // The pill's middle is at 750: the card's middle too.
  expect(at(670)).toEqual(["540px", "420px"]);
  // A pill near the pane's right edge: the card stops 8 px inside it.
  expect(at(1020)).toEqual(["772px", "420px"]);
});
