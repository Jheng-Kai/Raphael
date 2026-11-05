// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { mountConversationScroll } from "./conversation-scroll";
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
