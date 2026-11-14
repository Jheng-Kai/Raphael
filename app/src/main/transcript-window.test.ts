// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { TranscriptWindow, TRANSCRIPT_WINDOW, mountTranscriptWindow } from "./transcript-window";
afterEach(() => vi.unstubAllGlobals());

test("scrolling far from either observed window edge does not measure position", async () => {
  let update!: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { update = callback; }
    observe() {} disconnect() {}
  });
  const scroll = document.createElement("div"), thread = document.createElement("div");
  scroll.append(thread); document.body.append(scroll);
  const window = new TranscriptWindow(); window.select(items, key, true);
  const controller = mountTranscriptWindow(scroll, thread, window, {draw() {}, async older() {}, canOlder: () => false});
  let reads = 0;
  Object.defineProperty(scroll, "scrollTop", {get() { reads++; return 500; }});
  for (let index = 0; index < 20; index++) scroll.dispatchEvent(new Event("scroll"));
  await new Promise(requestAnimationFrame);
  expect(reads).toBe(0);
  update([{target: scroll.querySelector('[data-window-edge="top"]'), isIntersecting:true} as IntersectionObserverEntry], {} as IntersectionObserver);
  await new Promise(requestAnimationFrame);
  expect(reads).toBe(1);
  controller.stop(); scroll.remove();
});

test("the latest window does not read container height on a content scroll", async () => {
  const scroll = document.createElement("div"), thread = document.createElement("div");
  scroll.append(thread); document.body.append(scroll); scroll.scrollTop = 500;
  const window = new TranscriptWindow(); window.select(items, key, true);
  const controller = mountTranscriptWindow(scroll, thread, window, {draw() {}, async older() {}, canOlder: () => false});
  Object.defineProperty(scroll, "scrollHeight", {get() { throw new Error("No later turns need a height read"); }});
  scroll.dispatchEvent(new WheelEvent("wheel", {deltaY:-1}));
  await new Promise(resolve => requestAnimationFrame(resolve));
  controller.stop(); scroll.remove();
});

test("fallback scroll bursts read the current position once in their shared frame", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const scroll = document.createElement("div"), thread = document.createElement("div");
  scroll.append(thread); document.body.append(scroll);
  const window = new TranscriptWindow(); window.select(items, key, true);
  const controller = mountTranscriptWindow(scroll, thread, window, {draw() {}, async older() {}, canOlder: () => false});
  let reads = 0;
  Object.defineProperty(scroll, "scrollTop", {get() { reads++; return 500; }});
  for (let index = 0; index < 20; index++) scroll.dispatchEvent(new Event("scroll"));
  expect(reads).toBe(0);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(reads).toBe(1);
  controller.stop(); scroll.remove();
});

const items = Array.from({ length: 160 }, (_, id) => ({ id: String(id) }));
const key = (item: { id: string }): string => item.id;

test("a conversation opens 25 turns, grows by 20 and never mounts more than 100", () => {
  const window = new TranscriptWindow();
  expect(window.select(items, key, true).map(key)).toEqual(items.slice(-25).map(key));
  expect(window.earlier()).toBe(true);
  expect(window.select(items, key)).toHaveLength(45);
  for (let index = 0; index < 8; index++) {
    window.earlier(); expect(window.select(items, key).length).toBeLessThanOrEqual(TRANSCRIPT_WINDOW.maximum);
  }
  expect(window.before).toBe(0); expect(window.after).toBeGreaterThan(0);
});

test("an unmounted search or question target gets a finite centered window and latest restores the tail", () => {
  const window = new TranscriptWindow(); window.select(items, key, true);
  expect(window.focus("4")).toBe(true);
  expect(window.select(items, key).some(item => item.id === "4")).toBe(true);
  expect(window.mounted).toBe(25); expect(window.after).toBeGreaterThan(0);
  window.latest(); expect(window.select(items, key, true)).toEqual(items.slice(-25));
});

test("prepends preserve keys and arrivals do not evict a reader in an older window", () => {
  const window = new TranscriptWindow(); window.select(items.slice(50), key, true); window.earlier();
  const before = window.select(items.slice(50), key).map(key);
  expect(window.select(items, key).map(key)).toEqual(before);
  const arrived = [...items, ...Array.from({length: 150}, (_, index) => ({id:String(160 + index)}))];
  expect(window.select(arrived, key).map(key)).toEqual(before);
  window.latest(); expect(window.select(arrived, key, true)).toHaveLength(25);
  expect(window.select([...arrived, {id:"310"}], key, true)).toHaveLength(26);
  expect(window.select([...arrived, ...Array.from({length:150},(_,index)=>({id:String(310+index)}))], key, true)).toHaveLength(100);
  expect(window.after).toBe(0);
});

test("a window is put back as it was after another turn was revealed, and not into turns that are not there (a page opened from the Library)", () => {
  const window = new TranscriptWindow(); window.select(items, key, true);
  const was = window.snapshot();
  const mounted = window.select(items, key).map(key);
  // A page's turn far above is revealed for a while; the window moves to it.
  expect(window.focus("4")).toBe(true);
  expect(window.select(items, key).map(key)).not.toEqual(mounted);
  expect(window.restore(was)).toBe(true);
  expect(window.select(items, key).map(key)).toEqual(mounted);
  // Another conversation's turns hold none of its keys: it stays as it is.
  window.reset();
  window.select([{ id: "x1" }, { id: "x2" }], key, true);
  expect(window.restore(was)).toBe(false);
  expect(window.select([{ id: "x1" }, { id: "x2" }], key).map(key)).toEqual(["x1", "x2"]);
});
