// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountComposerBrain } from "../composer-brain";
import { setLocale, t } from "../i18n";
import { closeMenu, openPopover } from "../ui";
import type { DeviceSettings, Member } from "../types";
import { touches } from "./place";
import { STEPS, tourMinutes } from "./steps";
import { BYE_MS, OFFER_DELAY_MS, createTour, type Tour } from "./tour";

function place(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; } }) as DOMRect;
}

const find = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
const button = (id: string): HTMLElement => find('[data-tour="' + id + '"]');
const bubble = (): HTMLElement => find(".tour-bubble");
const words = (): string => bubble().querySelector(".tour-text")!.textContent!;
const count = (): string => find(".tour-count").textContent!;
const mode = (): string | undefined => find(".tour")?.dataset.mode;
const spot = (): HTMLElement => find(".tour-spot");
const settle = async (ms = 600): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
const press = async (id: string): Promise<void> => { button(id).click(); await settle(); };
const key = (name: string, target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const tours: Tour[] = [];
let reduced = true;

function harness(patch: Partial<DeviceSettings> = {}) {
  document.body.innerHTML =
    '<nav id="nav"><div class="sidebar-conversations"></div><button class="sidebar-apps"></button><button class="sidebar-account"></button></nav>' +
    '<main id="main"><div class="page-agent"><form class="composer"><textarea class="cmp-input"></textarea><button type="button" class="cmp-mode"></button>' +
    '<span class="cmp-model"><button type="button" class="mp-trigger" aria-expanded="false"></button></span></form></div></main>';
  place(find(".sidebar-conversations"), 0, 32, 348, 780);
  place(find(".sidebar-apps"), 52, 856, 284, 36);
  place(find(".sidebar-account"), 12, 856, 36, 36);
  place(find(".composer"), 391, 780, 686, 100);
  place(find(".cmp-mode"), 440, 832, 60, 26);
  place(find(".cmp-model"), 900, 832, 120, 26);
  const device = { onboarded: true, agent_keys: ["AltRight+Space"], tour_offered: false, ...patch } as DeviceSettings;
  const setDevice = vi.fn(async (change: Partial<DeviceSettings>) => Object.assign(device, change));
  const closeSettings = vi.fn(() => find(".modal-scrim")?.remove());
  const tour = createTour({ device: () => device, setDevice, closeSettings });
  tours.push(tour);
  return { tour, device, setDevice, closeSettings };
}

async function offer(tour: Tour): Promise<void> {
  tour.offerOnce();
  await settle(OFFER_DELAY_MS + 50);
}

async function begin(tour: Tour): Promise<void> {
  await offer(tour);
  await press("start");
}

function permissionMenu(): HTMLElement {
  const menu = openPopover(find(".cmp-mode"), '<div class="cb-modes"><button>Manual</button></div>', { className: "menu cb-menu", role: "dialog" });
  place(menu, 440, 520, 305, 290);
  return menu;
}

beforeEach(() => {
  vi.useFakeTimers();
  reduced = true;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("innerWidth", 1120);
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  for (const tour of tours.splice(0)) tour.stop();
  closeMenu();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLocale("zh-TW");
  document.body.replaceChildren();
});

test("the offer introduces Raphael and has Skip and Start, with no dim", async () => {
  const { tour } = harness();
  await offer(tour);
  expect(words()).toBe("哈囉！我是拉斐爾，這裡的管家。第一次見面，要不要我花 " + tourMinutes(STEPS.length) + " 分鐘，帶你動手逛一圈？");
  expect(find(".tour-text").innerHTML.split("<br>")).toEqual([
    "哈囉！", "我是拉斐爾，這裡的管家。", `第一次見面，要不要我花 ${tourMinutes(STEPS.length)} 分鐘，帶你動手逛一圈？`,
  ]);
  expect([...bubble().querySelectorAll("button")].map(item => item.textContent)).toEqual(["跳過", "開始"]);
  expect(button("start").classList.contains("pri")).toBe(true);
  expect(button("skip").classList.contains("pri")).toBe(false);
  expect(bubble().getAttribute("aria-label")).toBe("拉斐爾的導覽");
  expect(find(".tour").dataset.dim).toBe("none");
});

test.each(["skip", "start"])("the offer is remembered only after the person presses %s", async answer => {
  const { tour, device, setDevice } = harness();
  await offer(tour);
  expect(device.tour_offered).toBe(false);
  expect(setDevice).not.toHaveBeenCalled();
  await press(answer);
  expect(setDevice).toHaveBeenCalledExactlyOnceWith({ tour_offered: true });
  expect(mode()).toBe(answer === "start" ? "step" : "bye");
});

test("an onboarded launch offers an unanswered tour again and leaves a saved answer alone", async () => {
  const source = readFileSync(resolve(__dirname, "../main.ts"), "utf8");
  const launch = source.slice(source.indexOf("if (deviceRead && !device.get().onboarded)"));
  expect(launch).toMatch(/else \{[\s\S]*?firstViewShown\(\);[\s\S]*?tour\?\.offerOnce\(\)/);
  const first = harness();
  await offer(first.tour);
  first.tour.stop();
  expect(first.device.tour_offered).toBe(false);
  const next = harness(first.device);
  await offer(next.tour);
  expect(mode()).toBe("offer");
  await press("skip");
  expect(words()).toBe("逛完啦！之後有事，直接叫我就好。");
  await settle(BYE_MS);
  const answered = harness(next.device);
  await offer(answered.tour);
  expect(mode()).toBeUndefined();
});

test("Escape dismisses the offer without answering it", async () => {
  const { tour, setDevice } = harness();
  await offer(tour);
  key("Escape");
  expect(mode()).toBe("bye");
  expect(setDevice).not.toHaveBeenCalled();
});

test("the offer gives up quietly when the account button never appears", async () => {
  const { tour, setDevice } = harness();
  find(".sidebar-account").remove();
  await offer(tour);
  await settle(7000);
  expect(mode()).toBeUndefined();
  expect(setDevice).not.toHaveBeenCalled();
});

test("the walk has seven ordered steps, quiet Next while waiting, and key caps on the last step", async () => {
  const { tour } = harness({ agent_keys: ["ControlLeft+F8"] });
  await begin(tour);
  expect(STEPS.map(step => step.id)).toEqual(["composer", "permission", "model", "apps", "team", "account", "keys"]);
  for (let index = 1; index < 7; index++) {
    expect(count()).toBe(index + "/7");
    expect(button("next").classList.contains("pri")).toBe(index === 5);
    expect(!!button("back")).toBe(index > 1);
    await press("next");
  }
  expect(count()).toBe("7/7");
  expect(spot().hidden).toBe(true);
  expect([...bubble().querySelectorAll("kbd")].map(cap => cap.textContent)).toEqual(["Ctrl", "F8"]);
  await press("back");
  expect(count()).toBe("6/7");
  await press("next");
  await press("done");
  expect(mode()).toBe("bye");
});

test("the dim never makes the window inert and the non-modal bubble never traps Tab or focus", async () => {
  const { tour } = harness();
  await begin(tour);
  expect(document.querySelector("[inert]")).toBeNull();
  expect(find("#nav").inert).toBeFalsy();
  expect(find("#main").inert).toBeFalsy();
  expect(bubble().hasAttribute("aria-modal")).toBe(false);
  button("next").focus();
  expect(key("Tab", button("next")).defaultPrevented).toBe(false);
  const other = find(".sidebar-apps");
  other.focus();
  expect(document.activeElement).toBe(other);
});

test("composer focus completes the step and its arrows are untouched", async () => {
  const { tour } = harness();
  await begin(tour);
  const composer = find(".cmp-input");
  composer.focus();
  await settle();
  expect(words()).toContain("現在不用送出喔");
  expect(button("next").classList.contains("pri")).toBe(true);
  expect(key("ArrowRight", composer).defaultPrevented).toBe(false);
  expect(key("ArrowLeft", composer).defaultPrevented).toBe(false);
  expect(count()).toBe("1/7");
  expect(document.activeElement).toBe(composer);
  button("next").focus();
  expect(key("ArrowRight", button("next")).defaultPrevented).toBe(true);
  await settle();
  expect(count()).toBe("2/7");
});

test("the permission step follows its menu from ask to done and back to ask", async () => {
  const { tour } = harness();
  await begin(tour);
  await press("next");
  expect(button("next").classList.contains("pri")).toBe(false);
  expect(spot().style.top).toBe("828px");
  permissionMenu();
  await settle();
  expect(words()).toContain(t("chat.modeAsk"));
  expect(button("next").classList.contains("pri")).toBe(true);
  expect(spot().style.top).toBe("520px");
  closeMenu();
  await settle();
  expect(words()).toContain("點開看看");
  expect(button("next").classList.contains("pri")).toBe(false);
  expect(spot().style.top).toBe("828px");
});

test("Next from done closes the step's layer through its own close path", async () => {
  const { tour } = harness();
  await begin(tour);
  await press("next");
  const menu = permissionMenu();
  await settle();
  const heard = vi.fn();
  document.addEventListener("pointerdown", heard, true);
  button("next").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  document.removeEventListener("pointerdown", heard, true);
  expect(heard).not.toHaveBeenCalled();
  expect(menu.isConnected).toBe(true);
  await press("next");
  expect(menu.isConnected).toBe(false);
  expect(count()).toBe("3/7");
  const dismiss = vi.fn();
  const modelMenu = openPopover(find(".mp-trigger"), '<div class="cb-now"></div>', { className: "menu cb-menu", role: "dialog", onClose: dismiss });
  place(modelMenu, 620, 640, 300, 100);
  try {
    await settle();
    expect(words()).toBe("左邊的圖示換服務商，點模型名稱就能挑模型。");
    expect(spot().style.width).toBe("300px");
    await press("next");
    expect(dismiss).toHaveBeenCalledOnce();
    expect(count()).toBe("4/7");
  } finally { closeMenu(); }
});

test("the tour completes the model step when the composer chip opens its own menu", async () => {
  const { tour } = harness();
  const slot = find(".cmp-model");
  slot.replaceChildren();
  mountComposerBrain(slot, () => ({ id: 0, name: "Raphael" }) as Member);
  await begin(tour);
  await press("next");
  await press("next");
  const trigger = find(".mp-trigger");
  trigger.click();
  const menu = find(".cb-menu:has(.cb-now)");
  try {
    expect(menu).toBeTruthy();
    place(menu, 620, 640, 300, 100);
    await settle();
    expect(find(".tour").dataset.state).toBe("done");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  } finally { closeMenu(); }
});

test("the standalone Connect apps dialog completes the apps step and Back returns to its prompt", async () => {
  const { tour, closeSettings } = harness();
  await begin(tour);
  for (let i = 0; i < 3; i++) await press("next");
  expect(find(".tour").dataset.step).toBe("apps");
  expect(find(".tour").dataset.state).toBe("ask");
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  scrim.dataset.page = "settings";
  scrim.dataset.standalone = "connections";
  scrim.innerHTML = '<div class="modal" role="dialog"><div class="modal-body"><div class="cs"></div></div></div>';
  document.body.append(scrim);
  place(scrim, 0, 0, 1120, 900);
  const panel = find(".modal");
  place(panel, 128, 100, 864, 730);
  Object.defineProperties(panel, {
    offsetParent: { value: scrim }, offsetLeft: { value: 110 }, offsetTop: { value: 86 },
    offsetWidth: { value: 900 }, offsetHeight: { value: 760 },
  });
  Object.defineProperties(bubble(), { offsetWidth: { value: 288 }, offsetHeight: { value: 81 } });
  const main = find("#main");
  main.setAttribute("inert", "");
  closeSettings.mockImplementationOnce(() => {
    main.removeAttribute("inert");
    scrim.remove();
  });
  await settle();
  expect(find(".tour").dataset.state).toBe("done");
  expect(spot().style.width).toBe("900px");
  const ground = find(".tour-ground");
  const left = parseFloat(ground.style.left), top = parseFloat(ground.style.top);
  const inset = parseFloat(ground.style.getPropertyValue("--tour-ground-inset"));
  const composer = find(".composer").getBoundingClientRect();
  expect(touches({ left, top, width: 64 + 2 * inset, height: 64 }, composer)).toBe(false);
  await press("next");
  expect(closeSettings).toHaveBeenCalledOnce();
  expect(scrim.isConnected).toBe(false);
  await press("back");
  expect(find(".tour").dataset.step).toBe("apps");
  expect(find(".tour").dataset.state).toBe("ask");
});

test("the account step highlights the avatar while the group stands above the sidebar foot", async () => {
  const { tour } = harness();
  const foot = document.createElement("div");
  foot.className = "side-foot";
  foot.append(find(".sidebar-account"), find(".sidebar-apps"));
  find("#nav").append(foot);
  place(foot, 12, 810, 324, 82);
  await begin(tour);
  Object.defineProperties(bubble(), { offsetWidth: { value: 260 }, offsetHeight: { value: 100 } });
  for (let i = 0; i < 5; i++) await press("next");
  expect(find(".tour").dataset.step).toBe("account");
  expect(spot().style.top).toBe("852px");
  expect(bubble().dataset.side).toBe("above");
  expect(parseFloat(bubble().style.top) + bubble().offsetHeight).toBeLessThanOrEqual(810);
  expect(parseFloat(find(".tour-ground").style.top) + 64).toBeLessThanOrEqual(810);
});

test("Escape closes the step layer first and ends the tour only with no layer", async () => {
  const { tour } = harness();
  await begin(tour);
  await press("next");
  const menu = permissionMenu();
  await settle();
  key("Escape", menu);
  await settle();
  expect(menu.isConnected).toBe(false);
  expect(mode()).toBe("step");
  expect(button("next").classList.contains("pri")).toBe(false);
  key("Escape");
  await settle();
  expect(mode()).toBe("bye");
});

test.each(["back", "forward"] as const)("mouse %s closes the step layer before moving through the walk", async direction => {
  const { tour } = harness();
  await begin(tour);
  await press("next");
  const menu = permissionMenu();
  await settle();
  expect(tour.navigate(direction)).toBe(true);
  await settle();
  expect(menu.isConnected).toBe(false);
  expect(count()).toBe("2/7");
  expect(tour.navigate(direction)).toBe(true);
  await settle();
  expect(count()).toBe(direction === "back" ? "1/7" : "3/7");
});

test("a missing current target leaves the bubble in place and a missing future target is skipped", async () => {
  const { tour } = harness({ agent_keys: [] });
  await begin(tour);
  expect(count()).toBe("1/6");
  const composer = find(".composer");
  const clone = composer.cloneNode(true) as HTMLElement;
  composer.remove();
  await settle();
  expect(bubble()).toBeTruthy();
  expect(spot().hidden).toBe(true);
  find(".page-agent").append(clone);
  place(clone, 391, 780, 686, 100);
  place(find(".cmp-model"), 900, 832, 120, 26);
  await settle();
  expect(spot().hidden).toBe(false);
  await press("next");
  expect(count()).toBe("2/5");
  expect(words()).toContain("API 金鑰");
  await press("next");
  await press("next");
  await press("next");
  expect(count()).toBe("5/5");
  expect(button("next").classList.contains("pri")).toBe(false);
  await press("next");
  expect(mode()).toBe("bye");
});

test("placement follows a resized target without a hop, and locale changes redraw the line", async () => {
  const { tour } = harness();
  await begin(tour);
  expect(spot().style.left).toBe("385px");
  place(find(".composer"), 120, 780, 568, 100);
  window.dispatchEvent(new Event("resize"));
  await settle();
  expect(spot().style.left).toBe("114px");
  setLocale("ja");
  expect(words()).toMatch(/スライム/);
});

test("Raphael hops between steps only with motion enabled", async () => {
  const animate = vi.fn(() => ({ cancel: vi.fn(), currentTime: 0 }));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }));
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  try {
    const still = harness();
    await begin(still.tour);
    await press("next");
    expect(animate).not.toHaveBeenCalled();
    still.tour.stop();
    reduced = false;
    await begin(harness().tour);
    animate.mockClear();
    await press("next");
    expect(animate).toHaveBeenCalledTimes(3);
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});
