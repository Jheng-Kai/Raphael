// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountCardFloat } from "./card-float";
import { setLocale } from "./i18n";

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
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  watched = []; callback = null;
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

function mount(html: string) {
  document.body.innerHTML = `<div class="ra-stage"><div class="ra-scroll"><div class="ra-col"><ol class="thread">${html}</ol></div></div></div>`;
  const stage = document.querySelector<HTMLElement>(".ra-stage")!, thread = document.querySelector<HTMLElement>(".thread")!;
  const float = mountCardFloat({ stage, scroller: document.querySelector<HTMLElement>(".ra-scroll")!, thread });
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
