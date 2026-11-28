// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountComposerBrain } from "../composer-brain";
import { setLocale, t } from "../i18n";
import { closeMenu, openPopover } from "../ui";
import type { DeviceSettings, Member } from "../types";
import { touches } from "./place";
import { STEPS } from "./steps";
import { BYE_MS, OFFER_DELAY_MS, createTour, type Tour } from "./tour";

function place(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return this; } }) as DOMRect;
}

const find = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
const button = (id: string): HTMLElement => find('[data-tour="' + id + '"]');
const bubble = (): HTMLElement => find(".tour-bubble");
const words = (): string => bubble().querySelector(".tour-text")!.textContent!;
const count = (): string => find(".tour-count").getAttribute("aria-label")!.match(/\d+/g)!.join("/");
const mode = (): string | undefined => find(".tour")?.dataset.mode;
const spot = (): HTMLElement => find(".tour-spot");
const settle = async (ms = 600): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
const press = async (id: string): Promise<void> => { button(id).click(); await settle(); };
const confirmation = (): HTMLElement => find(".tour-confirm > .mb-confirm");
const confirmButton = (): HTMLElement => find('.tour-confirm [data-dlg="delete"]');
const cancelButton = (): HTMLElement => find('.tour-confirm [data-dlg="cancel"]');
const dismissConfirmation = (method: string): void => {
  if (method === "Cancel") cancelButton().click();
  else if (method === "Escape") key("Escape", cancelButton());
  else {
    const scrim = find(".tour-confirm");
    const options = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true };
    scrim.dispatchEvent(new PointerEvent("pointerdown", options));
    scrim.dispatchEvent(new PointerEvent("pointerup", options));
  }
};
const key = (name: string, target: EventTarget = document.body, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, shiftKey });
  target.dispatchEvent(event);
  return event;
};

const tours: Tour[] = [];
let reduced = true;

function harness(patch: Partial<DeviceSettings> = {}) {
  document.body.innerHTML =
    '<div class="window-chrome"><button class="window-drag">Drag</button><div class="window-controls"><button>Close window</button></div></div>' +
    '<nav id="nav"><div class="sidebar-conversations"></div><button class="sidebar-apps"></button><button class="sidebar-account"></button></nav>' +
    '<main id="main"><div class="page-agent"><form class="composer"><textarea class="cmp-input"></textarea><button type="button" class="cmp-mode"></button>' +
    '<span class="cmp-model"><button type="button" class="mp-trigger" aria-expanded="false"></button></span></form></div></main>';
  place(find(".sidebar-conversations"), 0, 32, 348, 780);
  place(find(".sidebar-apps"), 52, 856, 284, 36);
  place(find(".sidebar-account"), 12, 856, 36, 36);
  place(find(".composer"), 391, 780, 686, 100);
  place(find(".cmp-input"), 405, 785, 650, 40);
  place(find(".cmp-mode"), 440, 832, 60, 26);
  place(find(".cmp-model"), 900, 832, 120, 26);
  place(find(".mp-trigger"), 900, 832, 120, 26);
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

async function completeComposer(): Promise<void> {
  find(".cmp-input").focus();
  await settle();
}

async function advance(): Promise<void> {
  if (!button("next")) {
    const step = find(".tour").dataset.step!;
    if (step === "composer") await completeComposer();
    else {
      const selectors: Record<string, string> = { permission: ".cmp-mode", model: ".mp-trigger", apps: ".sidebar-apps", account: ".sidebar-account" };
      find(selectors[step]!).click();
      await settle(4000);
    }
  }
  await press("next");
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
  expect(words()).toBe("哈囉！我是拉斐爾。要我為你介紹一些基本的操作方式嗎？");
  expect([...bubble().querySelectorAll("button")].map(item => item.textContent)).toEqual(["跳過", "開始"]);
  expect(button("start").classList.contains("pri")).toBe(true);
  expect(button("skip").classList.contains("pri")).toBe(false);
  expect(bubble().getAttribute("aria-label")).toBe("拉斐爾的導覽");
  expect(find(".tour").dataset.dim).toBe("none");
});

test("Start remembers the offer and begins without a confirmation", async () => {
  const { tour, device, setDevice } = harness();
  await offer(tour);
  expect(device.tour_offered).toBe(false);
  expect(setDevice).not.toHaveBeenCalled();
  await press("start");
  expect(setDevice).toHaveBeenCalledExactlyOnceWith({ tour_offered: true });
  expect(mode()).toBe("step");
  expect(confirmation()).toBeNull();
});

test("Skip asks before saving the answer, then closes the offer immediately", async () => {
  const { tour, device, setDevice } = harness();
  await offer(tour);
  await press("skip");
  expect(confirmation().querySelector("h2")?.textContent).toBe("確定要跳過導覽嗎？");
  expect(confirmation().querySelector("p")?.textContent).toBe("跳過後就不會再出現導覽。");
  expect(confirmButton().textContent).toBe("跳過");
  expect(cancelButton().textContent).toBe("取消");
  expect(confirmation().classList.contains("is-quiet")).toBe(true);
  expect(mode()).toBe("offer");
  expect(device.tour_offered).toBe(false);
  expect(setDevice).not.toHaveBeenCalled();
  button("start").click();
  expect(setDevice).not.toHaveBeenCalled();
  reduced = false;
  confirmButton().click();
  await Promise.resolve();
  expect(confirmation()).toBeNull();
  expect(mode()).toBeUndefined();
  expect(setDevice).toHaveBeenCalledExactlyOnceWith({ tour_offered: true });
});

test.each(["Cancel", "Escape", "outside press"])("%s from Skip leaves the offer and its answer untouched", async method => {
  const { tour, device, setDevice } = harness();
  await offer(tour);
  await press("skip");
  dismissConfirmation(method);
  await settle();
  expect(confirmation()).toBeNull();
  expect(mode()).toBe("offer");
  expect(document.activeElement).toBe(button("skip"));
  expect(device.tour_offered).toBe(false);
  expect(setDevice).not.toHaveBeenCalled();
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
  confirmButton().click();
  await settle();
  expect(mode()).toBeUndefined();
  const answered = harness(next.device);
  await offer(answered.tour);
  expect(mode()).toBeUndefined();
});

test("Escape dismisses the offer without answering it", async () => {
  const { tour, setDevice } = harness();
  await offer(tour);
  key("Escape");
  expect(mode()).toBeUndefined();
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

test("seven titled steps show progress dots, no Next before the action, and key caps at the end", async () => {
  const { tour } = harness({ agent_keys: ["ControlLeft+F8"] });
  await begin(tour);
  expect(STEPS.map(step => step.id)).toEqual(["composer", "permission", "model", "apps", "team", "account", "keys"]);
  for (let index = 1; index <= 7; index++) {
    expect(find(".tour-title").textContent).toBe(t(STEPS[index - 1]!.title));
    expect(find(".tour-count").getAttribute("aria-label")).toBe(`第 ${index} 步，共 7 步`);
    const dots = [...bubble().querySelectorAll(".tour-dot")];
    expect(dots).toHaveLength(7);
    expect(dots.filter(dot => dot.hasAttribute("data-current"))).toEqual([dots[index - 1]]);
    expect(button("close").getAttribute("aria-label")).toBe(t("tour.close"));
    expect(!!button("back")).toBe(index > 1);
    if (index < 7) {
      if (index === 5) expect(button("next").classList.contains("pri")).toBe(true);
      else expect(button("next")).toBeNull();
      await advance();
    }
  }
  expect(count()).toBe("7/7");
  expect(spot().hidden).toBe(true);
  expect([...bubble().querySelectorAll("kbd")].map(cap => cap.textContent)).toEqual(["Ctrl", "F8"]);
  await press("back");
  expect(count()).toBe("6/7");
  await advance();
  await press("done");
  expect(mode()).toBe("bye");
  expect(words()).toBe("完成！基本操作都學會了。有問題隨時叫我。");
  expect(find(".tour").dataset.dim).toBe("none");
  await settle(BYE_MS - 601);
  expect(mode()).toBe("bye");
  await settle(1);
  expect(mode()).toBeUndefined();
});

test("Tab and Shift-Tab cycle through the control and bubble buttons only", async () => {
  const { tour } = harness();
  await begin(tour);
  expect(document.activeElement).toBe(bubble());
  expect(find(".tour").dataset.step).toBe("composer");
  expect(key("Tab", bubble()).defaultPrevented).toBe(true);
  expect(find(".tour").dataset.step).toBe("composer");
  expect(document.activeElement).toBe(find(".cmp-input"));
  await settle();
  expect(key("Tab", find(".cmp-input")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button("close"));
  expect(key("Tab", button("close")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button("next"));
  expect(key("Tab", button("next"), true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(button("close"));
  expect(key("Tab", button("close"), true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(find(".cmp-input"));
  const other = find(".sidebar-apps");
  other.focus();
  await settle();
  expect(document.activeElement).toBe(button("next"));
  await press("next");
  expect(key("Tab", button("back")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(find(".cmp-mode"));
});

test("composer focus completes the step and its typing keys are untouched", async () => {
  const { tour } = harness();
  await begin(tour);
  const composer = find(".cmp-input");
  composer.focus();
  await settle();
  expect(words()).toBe("很好！之後直接打字跟史萊姆說。");
  expect(button("next").classList.contains("pri")).toBe(true);
  expect(key("ArrowRight", composer).defaultPrevented).toBe(false);
  expect(key("ArrowLeft", composer).defaultPrevented).toBe(false);
  const typed = vi.fn();
  composer.addEventListener("keydown", typed);
  expect(key("a", composer).defaultPrevented).toBe(false);
  expect(typed).toHaveBeenCalledOnce();
  expect(count()).toBe("1/7");
  expect(document.activeElement).toBe(composer);
  await press("next");
  expect(count()).toBe("2/7");
});

test("the permission step follows its menu from ask to done and back to ask", async () => {
  const { tour } = harness();
  await begin(tour);
  await advance();
  expect(button("next")).toBeNull();
  expect(spot().style.top).toBe("828px");
  permissionMenu();
  await settle();
  expect(words()).toContain(t("chat.modeAsk"));
  expect(button("next").classList.contains("pri")).toBe(true);
  expect(spot().style.top).toBe("520px");
  closeMenu();
  await settle();
  expect(words()).toContain("點一下。");
  expect(button("next")).toBeNull();
  expect(spot().style.top).toBe("828px");
});

test("Next from done closes the step's layer through its own close path", async () => {
  const { tour } = harness();
  await begin(tour);
  await advance();
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
    expect(words()).toBe("左邊的圖示換服務商，點模型名稱挑模型。");
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
  place(find(".mp-trigger"), 900, 832, 120, 26);
  await begin(tour);
  await advance();
  await advance();
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
  for (let i = 0; i < 3; i++) await advance();
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
  for (let i = 0; i < 5; i++) await advance();
  expect(find(".tour").dataset.step).toBe("account");
  expect(spot().style.top).toBe("852px");
  expect(bubble().dataset.side).toBe("above");
  expect(parseFloat(bubble().style.top) + bubble().offsetHeight).toBeLessThanOrEqual(810);
  expect(parseFloat(find(".tour-ground").style.top) + 64).toBeLessThanOrEqual(810);
});

test("Escape and the mouse side buttons keep the walk and its open layer in place", async () => {
  const { tour } = harness();
  await begin(tour);
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(mode()).toBe("step");
  await advance();
  const menu = permissionMenu();
  await settle();
  expect(find(".tour").dataset.step).toBe("permission");
  expect(find(".tour").dataset.state).toBe("done");
  expect(key("Escape", menu).defaultPrevented).toBe(true);
  expect(menu.isConnected).toBe(true);
  for (const [direction, mouseButton] of [["back", 3], ["forward", 4]] as const) {
    const side = new MouseEvent("pointerup", { button: mouseButton, bubbles: true, cancelable: true });
    button("next").dispatchEvent(side);
    expect(side.defaultPrevented).toBe(true);
    expect(tour.navigate(direction)).toBe(true);
  }
  await settle();
  expect(menu.isConnected).toBe(true);
  expect(count()).toBe("2/7");
  expect(mode()).toBe("step");
});

test.each(["Cancel", "Escape", "outside press"])("%s from End tour resumes the same step and open layer", async method => {
  const { tour } = harness();
  await begin(tour);
  await advance();
  const menu = permissionMenu();
  await settle();
  const close = button("close");
  expect(close.matches(".btn.icon.close-button")).toBe(true);
  expect(close.getAttribute("aria-label")).toBe("結束導覽");
  await press("close");
  expect(confirmation().querySelector("h2")?.textContent).toBe("確定要結束導覽嗎？");
  expect(confirmation().querySelector("p")?.textContent).toBe("結束後就不會再出現導覽。");
  expect(confirmButton().textContent).toBe("結束導覽");
  expect(document.activeElement).toBe(cancelButton());
  expect(menu.isConnected).toBe(true);
  expect(key("Tab", cancelButton(), true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(confirmButton());
  const shortcut = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true });
  confirmButton().dispatchEvent(shortcut);
  expect(shortcut.defaultPrevented).toBe(true);
  expect(key("Enter", confirmButton()).defaultPrevented).toBe(false);
  button("next").click();
  expect(count()).toBe("2/7");
  dismissConfirmation(method);
  await settle();
  expect(confirmation()).toBeNull();
  expect(document.activeElement).toBe(close);
  expect(menu.isConnected).toBe(true);
  expect(find(".tour").dataset.state).toBe("done");
  expect(count()).toBe("2/7");
});

test("confirming End tour closes its layer and removes the tour immediately without a goodbye", async () => {
  const { tour, device, setDevice } = harness();
  await begin(tour);
  await advance();
  const menu = permissionMenu();
  await settle();
  await press("close");
  expect(mode()).toBe("step");
  expect(tour.active()).toBe(true);
  expect(confirmButton().classList.contains("pri")).toBe(true);
  expect(confirmation().classList.contains("is-quiet")).toBe(true);
  const css = readFileSync(resolve(__dirname, "../members.css"), "utf8");
  const redSelectors = [...css.matchAll(/(^[^\r\n{]+\.btn\.pri[^\r\n{]*) \{[^}]*background: var\(--close\)/gm)]
    .flatMap(([, selectors]) => selectors!.split(", "));
  expect(redSelectors).toHaveLength(3);
  for (const selector of redSelectors) expect(confirmButton().matches(selector.replace(/:(hover|active)/g, ""))).toBe(false);
  reduced = false;
  confirmButton().click();
  await Promise.resolve();
  expect(tour.active()).toBe(false);
  expect(mode()).toBeUndefined();
  expect(confirmation()).toBeNull();
  expect(menu.isConnected).toBe(false);
  expect(device.tour_offered).toBe(true);
  expect(setDevice).toHaveBeenCalledExactlyOnceWith({ tour_offered: true });
  await offer(tour);
  expect(mode()).toBeUndefined();
});

test("the action fallback timer waits for the confirmation to close", async () => {
  const { tour } = harness();
  await begin(tour);
  await advance();
  find(".cmp-mode").click();
  await settle(1000);
  await press("close");
  await settle(5000);
  expect(find(".tour").dataset.state).toBe("ask");
  dismissConfirmation("Cancel");
  await settle(2500);
  expect(find(".tour").dataset.state).toBe("ask");
  await settle(500);
  expect(find(".tour").dataset.state).toBe("fallback");
});

test("the dim blocks outside presses and opened layers while the target and caption receive presses", async () => {
  const { tour } = harness();
  await begin(tour);
  await advance();
  const opener = find(".cmp-mode");
  const open = vi.fn(permissionMenu);
  opener.addEventListener("click", open);
  const outside = find(".sidebar-account");
  const leaked = vi.fn();
  outside.addEventListener("click", leaked);
  const caption = find(".window-controls button");
  const captionPress = vi.fn();
  caption.addEventListener("click", captionPress);
  outside.click();
  caption.click();
  expect(leaked).not.toHaveBeenCalled();
  expect(captionPress).toHaveBeenCalledOnce();
  expect(button("next")).toBeNull();
  opener.click();
  expect(open).toHaveBeenCalledOnce();
  await settle();
  const menu = open.mock.results[0]!.value;
  menu.querySelector("button")!.addEventListener("click", leaked);
  menu.querySelector("button")!.click();
  const dim = find(".tour-catch");
  for (const type of ["pointerdown", "pointerup", "click"]) {
    const press = new MouseEvent(type, { bubbles: true, cancelable: true });
    dim.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  }
  expect(leaked).not.toHaveBeenCalled();
  expect(menu.isConnected).toBe(true);
});

test("Next becomes available four seconds after a press with no resulting layer", async () => {
  const { tour } = harness();
  await begin(tour);
  await advance();
  await settle(5000);
  expect(button("next")).toBeNull();
  find(".cmp-mode").click();
  await settle(3999);
  expect(button("next")).toBeNull();
  await settle(1);
  expect(find(".tour").dataset.state).toBe("fallback");
  expect(button("next").classList.contains("pri")).toBe(true);
  await press("next");
  expect(count()).toBe("3/7");
  expect(button("next")).toBeNull();
});

test("a missing target shows primary Next and keeps the step in the count", async () => {
  const { tour } = harness({ agent_keys: [] });
  await begin(tour);
  expect(count()).toBe("1/6");
  const composer = find(".composer");
  composer.remove();
  await settle();
  expect(bubble()).toBeTruthy();
  expect(spot().hidden).toBe(true);
  expect(button("next").classList.contains("pri")).toBe(true);
  await press("next");
  expect(count()).toBe("2/6");
  expect(find(".tour").dataset.state).toBe("fallback");
  expect(button("next").classList.contains("pri")).toBe(true);
});

test("placement follows a resized target without a hop, and locale changes redraw the line", async () => {
  const { tour } = harness();
  await begin(tour);
  expect(spot().style.left).toBe("399px");
  place(find(".composer"), 120, 780, 568, 100);
  place(find(".cmp-input"), 134, 785, 536, 40);
  window.dispatchEvent(new Event("resize"));
  await settle();
  expect(spot().style.left).toBe("128px");
  setLocale("ja");
  expect(words()).toMatch(/入力欄/);
});

test("Raphael hops between steps only with motion enabled", async () => {
  const animate = vi.fn(() => ({ cancel: vi.fn(), currentTime: 0 }));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }));
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  try {
    const still = harness();
    await begin(still.tour);
    await advance();
    expect(animate).not.toHaveBeenCalled();
    still.tour.stop();
    reduced = false;
    await begin(harness().tour);
    await completeComposer();
    animate.mockClear();
    await press("next");
    expect(animate).toHaveBeenCalledTimes(3);
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});
