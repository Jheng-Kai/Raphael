// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { mountConversationScroll, passWheelUnder } from "./conversation-scroll";
import { setLocale } from "./i18n";

afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); setLocale("zh-TW"); });

test("scrolling up exposes latest, incoming messages preserve position, and latest returns to the bottom", async () => {
  document.body.innerHTML = '<div><div class="ra-scroll"><ol></ol></div><form></form></div>';
  const scroller = document.querySelector<HTMLElement>(".ra-scroll")!;
  let height = 900;
  Object.defineProperty(scroller, "scrollHeight", { get: () => height });
  Object.defineProperty(scroller, "clientHeight", { value: 300 });
  scroller.scrollTop = 600;
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    scroller.scrollTop = Math.min(options.top ?? 0, height - 300);
    scroller.dispatchEvent(new Event("scroll"));
  });
  Object.defineProperty(scroller, "scrollTo", { value: scrollTo });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("IntersectionObserver", undefined);
  mountConversationScroll(scroller);
  const latest = document.querySelector<HTMLButtonElement>(".conversation-latest")!;
  expect(latest.hidden).toBe(true);
  expect(scroller.tabIndex).toBe(0);
  scroller.scrollTop = 200;
  scroller.dispatchEvent(new Event("scroll"));
  await vi.waitFor(() => expect(latest.hidden).toBe(false));
  height = 1100;
  scroller.querySelector("ol")!.append(document.createElement("li"));
  await vi.waitFor(() => expect(latest.hidden).toBe(false));
  expect(scroller.scrollTop).toBe(200);
  latest.click();
  expect(scrollTo).toHaveBeenCalledWith({ top: 1100, behavior: "smooth" });
  await vi.waitFor(() => expect(latest.hidden).toBe(true));
  for (const [locale, label] of [["en", "Jump to latest"], ["ja", "最新のメッセージへ"], ["zh-TW", "跳至最新訊息"]] as const) {
    setLocale(locale);
    expect(latest.getAttribute("aria-label")).toBe(label);
  }
});


test("observer-driven latest visibility never measures container heights on content mutations", async () => {
  document.body.innerHTML = '<div><div class="ra-scroll"><ol></ol></div></div>';
  const scroller = document.querySelector<HTMLElement>('.ra-scroll')!;
  let update!: IntersectionObserverCallback;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { update = callback; }
    observe = vi.fn();
  });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => { throw new Error('Unexpected container height read'); } });
  mountConversationScroll(scroller);
  const latest = document.querySelector<HTMLButtonElement>('.conversation-latest')!;
  const geometry = vi.spyOn(scroller, 'getBoundingClientRect');
  update([{isIntersecting:false} as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(latest.hidden).toBe(false);
  for (let index = 0; index < 20; index++) scroller.querySelector('ol')!.append(document.createElement('li'));
  await new Promise(requestAnimationFrame);
  expect(geometry).not.toHaveBeenCalled();
  update([{isIntersecting:true} as IntersectionObserverEntry], {} as IntersectionObserver);
  expect(latest.hidden).toBe(true);
  scroller.dataset.windowLater = '20';
  await vi.waitFor(() => expect(latest.hidden).toBe(false));
});

test("a wheel turned over the header moves the thread under it, or the report open in its place, and leaves a zoom alone", () => {
  document.body.innerHTML = '<section><header class="mb-head"></header><div class="ra-stage"><div class="ra-scroll"></div><div class="pgv"><div class="rp-scroll"></div></div></div></section>';
  const head = document.querySelector<HTMLElement>(".mb-head")!, stage = document.querySelector<HTMLElement>(".ra-stage")!;
  const thread = document.querySelector<HTMLElement>(".ra-scroll")!, report = document.querySelector<HTMLElement>(".rp-scroll")!;
  for (const scroller of [thread, report]) { Object.defineProperty(scroller, "scrollHeight", { value: 2000 }); Object.defineProperty(scroller, "clientHeight", { value: 600 }); scroller.scrollTop = 500; }
  passWheelUnder(head, stage);
  const wheel = (init: WheelEventInit): WheelEvent => {
    const event = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
    if (init.ctrlKey) Object.defineProperty(event, "ctrlKey", { value: true });
    head.dispatchEvent(event);
    return event;
  };
  expect(wheel({ deltaY: -120 }).defaultPrevented).toBe(true);
  expect(thread.scrollTop).toBe(380);
  expect(wheel({ deltaY: 3, deltaMode: 1 }).defaultPrevented).toBe(true);
  expect(thread.scrollTop).toBe(500);
  expect(wheel({ deltaY: -120, ctrlKey: true }).defaultPrevented).toBe(false);
  expect(thread.scrollTop).toBe(500);
  stage.classList.add("is-page");
  wheel({ deltaY: 100 });
  expect([thread.scrollTop, report.scrollTop]).toEqual([500, 600]);
});

test("a wheel turned over the header moves an HTML page's area too, which scrolls as a whole (R-PAGE-08)", () => {
  document.body.innerHTML = '<section><header class="mb-head"></header><div class="ra-stage is-page"><div class="ra-scroll"></div><div class="pgv"><div class="pgv-page"></div></div></div></section>';
  const head = document.querySelector<HTMLElement>(".mb-head")!, stage = document.querySelector<HTMLElement>(".ra-stage")!;
  const thread = document.querySelector<HTMLElement>(".ra-scroll")!, area = document.querySelector<HTMLElement>(".pgv-page")!;
  for (const scroller of [thread, area]) { Object.defineProperty(scroller, "scrollHeight", { value: 2000 }); Object.defineProperty(scroller, "clientHeight", { value: 600 }); scroller.scrollTop = 500; }
  passWheelUnder(head, stage);
  head.dispatchEvent(new WheelEvent("wheel", { cancelable: true, bubbles: true, deltaY: 100 }));
  expect([thread.scrollTop, area.scrollTop]).toEqual([500, 600]);
});
