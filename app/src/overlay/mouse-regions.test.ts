// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { reportMouseRegions } from "./overlay";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("reports question, expansion and Stop in physical pixels, then nothing", async () => {
  document.body.innerHTML = '<div class="ask-card" hidden><button class="ask-btn">Yes</button><button id="ask-expand">More</button></div><button id="overlay-stop" hidden>Stop</button>';
  const card = document.querySelector<HTMLElement>(".ask-card")!, stop = document.querySelector<HTMLElement>("#overlay-stop")!;
  const button = document.querySelector<HTMLElement>(".ask-btn")!, expand = document.querySelector<HTMLElement>("#ask-expand")!;
  card.style.pointerEvents = button.style.pointerEvents = expand.style.pointerEvents = stop.style.pointerEvents = "auto";
  let cardHeight = 80;
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => new DOMRect(10, 20, 120, cardHeight));
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 60, 40, 24));
  vi.spyOn(expand, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, 40, 20));
  vi.spyOn(stop, "getBoundingClientRect").mockReturnValue(new DOMRect(160, 50, 60, 24));
  vi.stubGlobal("devicePixelRatio", 1.5);
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send);
  mouse.reset(1);
  await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ revision: 1, rects: [], held: false }));
  card.hidden = stop.hidden = false;
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects).toEqual([
    { x: 15, y: 30, width: 180, height: 120 },
    { x: 30, y: 90, width: 60, height: 36 },
    { x: 30, y: 60, width: 60, height: 30 },
    { x: 240, y: 75, width: 90, height: 36 },
  ]));
  cardHeight = 140; card.dataset.expanded = "true";
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects[0].height).toBe(210));
  card.hidden = stop.hidden = true;
  await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ revision: 1, rects: [], held: false }));
  mouse.dispose();
});

test("a held control stays live outside it, release and hide clear it", async () => {
  document.body.innerHTML = '<button id="overlay-stop" style="pointer-events:auto">Stop</button>';
  const stop = document.querySelector<HTMLElement>("button")!;
  vi.spyOn(stop, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 60, 24));
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send); mouse.reset(2);
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects).toHaveLength(1));
  stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }));
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].held).toBe(true));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 500 }));
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].held).toBe(false));
  stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, button: 0 }));
  stop.hidden = true; mouse.reset(3);
  await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ revision: 3, rects: [], held: false }));
  mouse.dispose();
});

test("resize and DPI changes are reported; idle observation stops and disabled buttons are excluded", async () => {
  document.body.innerHTML = '<button id="overlay-stop" style="pointer-events:auto">Stop</button>';
  const stop = document.querySelector<HTMLButtonElement>("button")!;
  let x = 10;
  const bounds = vi.spyOn(stop, "getBoundingClientRect").mockImplementation(() => new DOMRect(x, 20, 60, 24));
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send);
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects[0].x).toBe(10));
  x = 30; vi.stubGlobal("devicePixelRatio", 2); window.dispatchEvent(new Event("resize"));
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects[0]).toEqual({ x: 60, y: 40, width: 120, height: 48 }));
  stop.disabled = true;
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects).toEqual([]));
  const count = bounds.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(bounds.mock.calls).toHaveLength(count);
  mouse.dispose();
});

test("a slow report cannot overtake release, and pointer cancellation clears a held control", async () => {
  document.body.innerHTML = '<button id="overlay-stop" style="pointer-events:auto">Stop</button>';
  const stop = document.querySelector<HTMLButtonElement>("button")!;
  vi.spyOn(stop, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 60, 24));
  let finish!: () => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }));
  await new Promise(resolve => setTimeout(resolve, 30));
  document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(send).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(send.mock.calls.map(call => call[0].held)).toEqual([false, true, false]));
  mouse.dispose();
});

test("the learned body and Undo report only their bounds, never the window margin", async () => {
  document.body.innerHTML = '<div id="learned-pill"><button class="learned-undo">Undo</button></div>';
  const body = document.querySelector<HTMLElement>("#learned-pill")!, undo = document.querySelector<HTMLElement>("button")!;
  body.style.pointerEvents = undo.style.pointerEvents = "auto";
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 12, 300, 40));
  vi.spyOn(undo, "getBoundingClientRect").mockReturnValue(new DOMRect(280, 20, 60, 24));
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send, "#learned-pill, .learned-undo");
  mouse.reset(4);
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects).toEqual([
    { x: 50, y: 12, width: 300, height: 40 }, { x: 280, y: 20, width: 60, height: 24 },
  ]));
  body.hidden = true;
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects).toEqual([]));
  mouse.dispose();
});

test("leaving the page clears every region even if the pointer release is lost", async () => {
  document.body.innerHTML = '<button id="overlay-stop" style="pointer-events:auto">Stop</button>';
  const stop = document.querySelector<HTMLButtonElement>("button")!;
  vi.spyOn(stop, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 60, 24));
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send);
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects).toHaveLength(1));
  stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }));
  await vi.waitFor(() => expect(send.mock.lastCall?.[0].held).toBe(true));
  window.dispatchEvent(new Event("pagehide"));
  try {
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ revision: 0, rects: [], held: false }));
  } finally { mouse.dispose(); }
});

test("capturing release preserves drag-off cancellation and keyboard clicks", async () => {
  document.body.innerHTML = '<button id="overlay-stop" style="pointer-events:auto">Stop</button>';
  const stop = document.querySelector<HTMLButtonElement>("button")!;
  vi.spyOn(stop, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 60, 24));
  const clicked = vi.fn(); stop.addEventListener("click", clicked);
  const mouse = reportMouseRegions(document.body, vi.fn().mockResolvedValue(undefined));
  stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }));
  stop.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 200, clientY: 200 }));
  stop.dispatchEvent(new PointerEvent("click", { bubbles: true, pointerId: 1 }));
  try {
    expect(clicked).not.toHaveBeenCalled();
    stop.click(); expect(clicked).toHaveBeenCalledTimes(1);
    stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, button: 0 }));
    stop.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2, clientX: 20, clientY: 30 }));
    stop.dispatchEvent(new PointerEvent("click", { bubbles: true, pointerId: 2 }));
    expect(clicked).toHaveBeenCalledTimes(2);
  } finally { mouse.dispose(); }
});

test("root layout variables report moved controls without a resize", async () => {
  document.body.innerHTML = '<canvas id="emblem"></canvas><button id="overlay-stop" style="pointer-events:auto">Stop</button>';
  const stop = document.querySelector<HTMLButtonElement>("button")!;
  let x = 10;
  vi.spyOn(stop, "getBoundingClientRect").mockImplementation(() => new DOMRect(x, 20, 60, 24));
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send);
  try {
    await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects[0].x).toBe(10));
    x = 30; document.documentElement.style.setProperty("--test-overlay-offset", "30px");
    await vi.waitFor(() => expect(send.mock.lastCall?.[0].rects[0].x).toBe(30));
  } finally { mouse.dispose(); document.documentElement.style.removeProperty("--test-overlay-offset"); }
});

test("removing the last nested control clears both its rectangle and its held pointer", async () => {
  document.body.innerHTML = '<section><button id="overlay-stop" style="pointer-events:auto">Stop</button></section>';
  const stop = document.querySelector<HTMLButtonElement>("button")!;
  vi.spyOn(stop, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 60, 24));
  const send = vi.fn().mockResolvedValue(undefined);
  const mouse = reportMouseRegions(document.body, send);
  try {
    stop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }));
    await vi.waitFor(() => expect(send.mock.lastCall?.[0].held).toBe(true));
    stop.remove();
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ revision: 0, rects: [], held: false }));
  } finally { mouse.dispose(); }
});
