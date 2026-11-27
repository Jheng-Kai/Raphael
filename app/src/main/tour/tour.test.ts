// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setLocale, t } from "../i18n";
import type { DeviceSettings, PageArgument, PageId } from "../types";
import { askKeys, STEPS, tourMinutes } from "./steps";
import { BYE_MS, OFFER_DELAY_MS, createTour, type Tour, type TourHost } from "./tour";

// ---------- a window with the parts the tour points at ----------

const SIZE = { width: 1120, height: 900 };
const place = (el: Element, left: number, top: number, width: number, height: number): void => {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; } }) as DOMRect;
};

function windowHTML(): void {
  document.body.innerHTML =
    `<nav id="nav"><div class="sidebar-conversations"></div><button class="sidebar-apps"></button><button class="sidebar-account"></button></nav>` +
    `<main id="main"><div class="page-agent"><form class="composer"><button class="cmp-mode"></button><span class="cmp-model"></span></form></div></main>`;
  const at = (selector: string, ...box: [number, number, number, number]): void => place(document.querySelector(selector)!, ...box);
  at(".sidebar-conversations", 0, 32, 348, 780);
  at(".sidebar-apps", 52, 856, 284, 36);
  at(".sidebar-account", 12, 856, 36, 36);
  at(".composer", 391, 780, 686, 100);
  at(".cmp-mode", 440, 832, 60, 26);
  at(".cmp-model", 900, 832, 120, 26);
}

const tours: Tour[] = [];

interface Harness { tour: Tour; host: TourHost; device: DeviceSettings; calls: string[]; setDevice: ReturnType<typeof vi.fn> }

function harness(patch: Partial<DeviceSettings> = {}): Harness {
  windowHTML();
  const device = { agent_keys: ["AltRight+Space"], tour_offered: false, ...patch } as DeviceSettings;
  const calls: string[] = [];
  const setDevice = vi.fn(async (change: Partial<DeviceSettings>) => { Object.assign(device, change); return device; });
  const host: TourHost = {
    go(page: PageId, arg?: PageArgument) {
      calls.push(`go ${page}${arg ? ` ${arg}` : ""}`);
      if (page !== "settings") return;
      const scrim = document.createElement("div");
      scrim.className = "modal-scrim";
      scrim.dataset.page = "settings";
      scrim.innerHTML = `<div class="modal"><nav>${["usage", "skills", "safety"].map(pane => `<button data-pane="${pane}" aria-current="false"></button>`).join("")}</nav></div>`;
      document.body.append(scrim);
      place(scrim.querySelector(".modal")!, 60, 32, 1000, 813);
      const show = (pane: string): void => scrim.querySelectorAll("[data-pane]").forEach(button => button.setAttribute("aria-current", (button as HTMLElement).dataset.pane === pane ? "page" : "false"));
      scrim.addEventListener("click", event => { const button = (event.target as Element).closest<HTMLElement>("[data-pane]"); if (button) { calls.push(`pane ${button.dataset.pane}`); show(button.dataset.pane!); } });
      show(String(arg));
    },
    closeSettings() { calls.push("close settings"); document.querySelector(".modal-scrim")?.remove(); },
    device: () => device,
    setDevice,
  };
  const tour = createTour(host);
  tours.push(tour);
  return { tour, host, device, calls, setDevice };
}

const bubble = (): HTMLElement | null => document.querySelector(".tour-bubble");
const words = (): string => bubble()?.querySelector(".tour-text")?.textContent ?? "";
const count = (): string => bubble()?.querySelector(".tour-count")?.textContent ?? "";
const press = async (id: string): Promise<void> => {
  document.querySelector<HTMLElement>(`.tour [data-tour="${id}"]`)!.click();
  await vi.advanceTimersByTimeAsync(600);
};
const key = (name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
};
const settle = async (ms = 600): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
const begin = async (h: Harness): Promise<void> => { h.tour.start(); await settle(); };

let reduced = true;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = true;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(window, "innerWidth", { value: SIZE.width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: SIZE.height, configurable: true });
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { for (const tour of tours.splice(0)) tour.stop(); vi.unstubAllGlobals(); vi.useRealTimers(); setLocale("zh-TW"); document.body.replaceChildren(); });

// ---------- the offer ----------

test("the offer comes once, from the account button, and says how many minutes the steps take", async () => {
  const h = harness();
  expect(document.querySelector(".tour")).toBeNull();
  h.tour.offerOnce();
  expect(document.querySelector(".tour")).toBeNull();
  await settle(OFFER_DELAY_MS + 50);
  expect(words()).toBe(t("tour.offer", { minutes: tourMinutes(STEPS.length) }));
  expect(words()).toContain("2");
  expect([...bubble()!.querySelectorAll("button")].map(button => button.textContent)).toEqual(["之後再說", "開始"]);
  expect(document.querySelector(".tour")!.getAttribute("data-mode")).toBe("offer");
  // No dim, nothing blocked: the window still works under the question.
  expect(document.querySelector<HTMLElement>(".tour-catch")!.style.display).toBe("");
  expect(document.getElementById("nav")!.inert).toBeFalsy();
});

test("it is remembered in the device settings the moment it is offered, and never offered again on its own", async () => {
  const h = harness();
  h.tour.offerOnce();
  await settle(OFFER_DELAY_MS + 50);
  expect(h.setDevice).toHaveBeenCalledExactlyOnceWith({ tour_offered: true });
  await press("later");
  await settle(BYE_MS + 500);
  expect(document.querySelector(".tour")).toBeNull();
  // The same window, or a later one that reads the saved settings: nothing comes.
  h.tour.offerOnce();
  await settle(OFFER_DELAY_MS + 50);
  expect(document.querySelector(".tour")).toBeNull();
  const later = harness({ tour_offered: true });
  later.tour.offerOnce();
  await settle(OFFER_DELAY_MS + 50);
  expect(document.querySelector(".tour")).toBeNull();
  expect(later.setDevice).not.toHaveBeenCalled();
});

test("only the first-run guide's end asks for the offer: the window's start never does", () => {
  const source = readFileSync(resolve(__dirname, "../main.ts"), "utf8");
  expect(source.match(/offerOnce\(\)/g)).toHaveLength(1);
  const done = source.slice(source.indexOf("onDone: () => {"), source.indexOf("ctx,\n    );", source.indexOf("onDone: () => {")));
  expect(done).toContain("tour?.offerOnce()");
});

test("之後再說 and Escape close the offer, and Raphael says where to find the tour again", async () => {
  for (const close of [() => press("later"), async () => { key("Escape"); await settle(); }]) {
    const h = harness();
    h.tour.offerOnce();
    await settle(OFFER_DELAY_MS + 50);
    await close();
    expect(document.querySelector(".tour")!.getAttribute("data-mode")).toBe("bye");
    expect(words()).toBe(t("tour.bye"));
    expect(bubble()!.querySelector("button")).toBeNull();
    await settle(BYE_MS + 500);
    expect(document.querySelector(".tour")).toBeNull();
    expect(h.tour.active()).toBe(false);
    h.tour.stop();
  }
});

test("the offer waits for a window that has its account button, and gives up quietly without one", async () => {
  const h = harness();
  document.querySelector(".sidebar-account")!.remove();
  h.tour.offerOnce();
  await settle(OFFER_DELAY_MS + 7000);
  expect(document.querySelector(".tour")).toBeNull();
  expect(h.setDevice).not.toHaveBeenCalled();
});

// ---------- the walk ----------

test("開始 walks the nine steps forward and back, each with its own line and count, 完成 on the last", async () => {
  const h = harness();
  await begin(h);
  expect(STEPS.map(step => step.id)).toEqual(["composer", "team", "apps", "permission", "model", "usage", "skills", "safety", "keys"]);
  expect(h.tour.active()).toBe(true);
  for (let index = 0; index < STEPS.length; index++) {
    expect(count()).toBe(`${index + 1}/${STEPS.length}`);
    expect(words()).toBe(t(STEPS[index]!.text as "tour.composer", { ask: t("chat.modeAsk") } as never));
    const names = [...bubble()!.querySelectorAll(".tour-buttons button")].map(button => button.textContent);
    expect(names).toEqual(index === 0 ? ["下一步"] : index === STEPS.length - 1 ? ["上一步", "完成"] : ["上一步", "下一步"]);
    if (index < STEPS.length - 1) await press("next");
  }
  await press("back");
  expect(count()).toBe("8/9");
  await press("back");
  expect(count()).toBe("7/9");
  await press("next");
  await press("next");
  expect(count()).toBe("9/9");
  await press("done");
  expect(document.querySelector(".tour")!.getAttribute("data-mode")).toBe("bye");
  expect(words()).toBe(t("tour.bye"));
  await settle(BYE_MS + 500);
  expect(document.querySelector(".tour")).toBeNull();
});

test("the permission step names the chip's own word, and the model's words are those of the window's language", async () => {
  const h = harness();
  await begin(h);
  await press("next"); await press("next"); await press("next");
  expect(words()).toContain("手動");
  h.tour.stop();
  setLocale("en");
  const again = harness();
  await begin(again);
  expect(words()).toBe(t("tour.composer"));
  await press("next"); await press("next"); await press("next");
  expect(words()).toContain("Manual");
});

test("the cut-out follows the target's box and the group stands beside it, and the dim takes every press", async () => {
  const h = harness();
  await begin(h);
  const spot = document.querySelector<HTMLElement>(".tour-spot")!;
  expect(spot.hidden).toBe(false);
  // The composer's box, 6 px of room round it.
  expect([spot.style.left, spot.style.top, spot.style.width, spot.style.height]).toEqual(["385px", "774px", "698px", "112px"]);
  expect(document.querySelector(".tour")!.getAttribute("data-dim")).toBe("spot");
  const before = count();
  document.querySelector<HTMLElement>(".tour-catch")!.click();
  document.querySelector<HTMLElement>(".tour-catch")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  await settle();
  expect(count()).toBe(before);
  expect(h.tour.active()).toBe(true);
  // What is pointed at cannot be operated: the sidebar and the page are inert while the walk lasts.
  expect(document.getElementById("nav")!.inert).toBe(true);
  expect(document.getElementById("main")!.inert).toBe(true);
});

test("a window that changes size is measured again, with no hop", async () => {
  const h = harness();
  await begin(h);
  const spot = document.querySelector<HTMLElement>(".tour-spot")!;
  place(document.querySelector(".composer")!, 120, 780, 568, 100);
  window.dispatchEvent(new Event("resize"));
  await settle(50);
  expect(spot.style.left).toBe("114px");
  expect(spot.style.width).toBe("580px");
});

test("a step whose target is not on screen is skipped, the count follows, and a width with no sidebar drops its steps", async () => {
  const h = harness();
  document.querySelector(".cmp-model")!.remove();
  document.querySelector<HTMLElement>(".sidebar-conversations")!.hidden = true;
  await begin(h);
  expect(count()).toBe("1/7");
  const seen: string[] = [];
  for (let index = 0; index < 6; index++) { seen.push(words()); await press("next"); }
  seen.push(words());
  expect(seen).not.toContain(t("tour.model"));
  expect(seen).not.toContain(t("tour.team"));
  expect(count()).toBe("7/7");
});

test("a target that disappears while the tour is on is dropped when its turn comes, never pointed at", async () => {
  const h = harness();
  await begin(h);
  document.querySelector(".cmp-mode")!.remove();
  await press("next"); await press("next");
  expect(words()).toBe(t("tour.apps"));
  await press("next");
  expect(words()).toBe(t("tour.model", {} as never));
  expect(count()).toBe("4/8");
});

test("Settings steps open their tab, switch it by its own button and close Settings again when the tour leaves them", async () => {
  const h = harness();
  await begin(h);
  for (let i = 0; i < 5; i++) await press("next");
  expect(words()).toBe(t("tour.usage"));
  expect(h.calls).toContain("go settings usage");
  const spot = document.querySelector<HTMLElement>(".tour-spot")!;
  expect([spot.style.left, spot.style.width, spot.style.borderRadius === ""].slice(0, 2)).toEqual(["60px", "1000px"]);
  await press("next");
  expect(words()).toBe(t("tour.skills"));
  await press("next");
  expect(words()).toBe(t("tour.safety"));
  expect(h.calls.filter(call => call.startsWith("pane"))).toEqual(["pane skills", "pane safety"]);
  await press("next");
  expect(words()).toBe(t("tour.keys"));
  expect(h.calls[h.calls.length - 1]).toBe("close settings");
  expect(document.querySelector(".modal-scrim")).toBeNull();
  // Back into Settings, and out of it by the way back to the composer's steps.
  await press("back");
  expect(words()).toBe(t("tour.safety"));
  await press("back"); await press("back"); await press("back");
  expect(words()).toBe(t("tour.model", {} as never));
  expect(document.querySelector(".modal-scrim")).toBeNull();
});

test("the last step has no window to point at: it stands in the middle and draws the keys that ask Raphael as caps", async () => {
  const h = harness({ agent_keys: ["AltRight+Space"] });
  await begin(h);
  for (let i = 0; i < 8; i++) await press("next");
  expect(document.querySelector(".tour")!.getAttribute("data-dim")).toBe("all");
  expect(document.querySelector<HTMLElement>(".tour-spot")!.hidden).toBe(true);
  expect([...bubble()!.querySelectorAll(".tour-keys kbd")].map(cap => cap.textContent)).toEqual(["右 Alt", "Space"]);
  h.tour.stop();
  // Whatever the shortcut settings say is what it names.
  const other = harness({ agent_keys: ["ControlLeft+F8"] });
  expect(askKeys(other.device)).toEqual(["Ctrl", "F8"]);
  await begin(other);
  for (let i = 0; i < 8; i++) await press("next");
  expect([...bubble()!.querySelectorAll(".tour-keys kbd")].map(cap => cap.textContent)).toEqual(["Ctrl", "F8"]);
});

test("a computer with no key that asks Raphael has no step about keys", async () => {
  const h = harness({ agent_keys: [] });
  await begin(h);
  expect(count()).toBe("1/8");
});

test("Escape and the × end the tour: the window works again and Raphael says where to find it", async () => {
  for (const end of [async () => { key("Escape"); await settle(); }, () => press("close")]) {
    const h = harness();
    await begin(h);
    await press("next"); await press("next"); await press("next"); await press("next"); await press("next");
    expect(h.calls[h.calls.length - 1]).toBe("go settings usage");
    await end();
    expect(document.getElementById("nav")!.inert).toBe(false);
    expect(document.getElementById("main")!.inert).toBe(false);
    expect(document.querySelector(".modal-scrim")).toBeNull();
    expect(document.querySelector(".tour")!.getAttribute("data-mode")).toBe("bye");
    expect(document.querySelector(".tour")!.getAttribute("data-dim")).toBe("none");
    expect(words()).toBe(t("tour.bye"));
    await settle(BYE_MS + 500);
    expect(document.querySelector(".tour")).toBeNull();
    h.tour.stop();
  }
});

test("the × is the walk's way out, named for a reader, and the arrows and Tab belong to the bubble", async () => {
  const h = harness();
  await begin(h);
  const close = bubble()!.querySelector<HTMLElement>('[data-tour="close"]')!;
  expect(close.getAttribute("aria-label")).toBe(t("tour.close"));
  expect(bubble()!.getAttribute("aria-modal")).not.toBeNull();
  expect(document.activeElement).toBe(bubble()!.querySelector(".btn.pri"));
  expect(key("ArrowRight").defaultPrevented).toBe(true);
  await settle();
  expect(count()).toBe("2/9");
  key("ArrowLeft"); await settle();
  expect(count()).toBe("1/9");
  // Tab goes round the bubble's own buttons and nowhere else.
  const stops = [...bubble()!.querySelectorAll<HTMLElement>("button")];
  const seen: Element[] = [];
  for (let i = 0; i < stops.length + 1; i++) { key("Tab"); seen.push(document.activeElement!); }
  expect(new Set(seen).size).toBe(stops.length);
  expect(stops).toEqual(expect.arrayContaining(seen));
});

test("Raphael hops between the steps in 300 ms unless the window asks for less motion", async () => {
  const animate = vi.fn(() => ({}));
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  try {
    reduced = true;
    const still = harness();
    await begin(still);
    await press("next");
    expect(animate).not.toHaveBeenCalled();
    still.tour.stop();
    reduced = false;
    const moving = harness();
    await begin(moving);
    const first = animate.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    await press("next");
    expect(animate.mock.calls.length).toBeGreaterThan(first);
    const hop = animate.mock.calls[animate.mock.calls.length - 1] as unknown as [{ transform: string }[], { duration: number }];
    expect(hop[1].duration).toBe(300);
    expect(hop[0].length).toBeGreaterThanOrEqual(3);
  } finally { delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate; }
});

test("the tour starts again from the menu, from wherever the window is, and a second start is the same walk", async () => {
  const h = harness();
  document.querySelector(".composer")!.remove();
  await begin(h);
  expect(h.calls).toContain("go agent");
  h.tour.start();
  await settle();
  expect(h.tour.active()).toBe(true);
  // An offer still on screen turns into the walk.
  h.tour.stop();
  const offered = harness();
  offered.tour.offerOnce();
  await settle(OFFER_DELAY_MS + 50);
  await press("start");
  expect(count()).toBe("1/9");
  expect(document.querySelectorAll(".tour")).toHaveLength(1);
});

test("a change of language redraws the step's line in the new one", async () => {
  const h = harness();
  await begin(h);
  setLocale("ja");
  await settle(50);
  expect(words()).toBe(t("tour.composer"));
  expect(words()).toMatch(/スライム/);
});

test("a press on the tour never reaches the window's own dismissals: Settings stay open under the walk", async () => {
  const h = harness();
  await begin(h);
  const heard = vi.fn();
  for (const type of ["pointerdown", "pointerup", "mousedown", "click", "contextmenu"]) document.addEventListener(type, heard);
  for (const target of [".tour-catch", ".tour-bubble", '.tour [data-tour="next"]']) {
    for (const type of ["pointerdown", "pointerup", "mousedown", "contextmenu"]) document.querySelector(target)!.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  document.querySelector<HTMLElement>(".tour-catch")!.click();
  document.querySelector<HTMLElement>(".tour-bubble")!.click();
  expect(heard).not.toHaveBeenCalled();
  for (const type of ["pointerdown", "pointerup", "mousedown", "click", "contextmenu"]) document.removeEventListener(type, heard);
});

test("the mouse's back and forward buttons go between the steps while the walk is on, and navigate nothing under the dim", async () => {
  const h = harness();
  expect(h.tour.navigate("back")).toBe(false);
  await begin(h);
  expect(h.tour.navigate("forward")).toBe(true);
  await settle();
  expect(count()).toBe("2/9");
  expect(h.tour.navigate("back")).toBe(true);
  await settle();
  expect(count()).toBe("1/9");
  // At the first step back goes nowhere, and still the window under the dim is not navigated.
  expect(h.tour.navigate("back")).toBe(true);
  await settle();
  expect(count()).toBe("1/9");
  for (let i = 0; i < 12; i++) { h.tour.navigate("forward"); await settle(); }
  expect(count()).toBe("9/9");
  expect(h.tour.active()).toBe(true);
});
