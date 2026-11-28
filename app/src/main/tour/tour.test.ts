// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openMemberCreator } from "../member-creator";
import { setLocale, t } from "../i18n";
import { closeMenu, openPopover } from "../ui";
import type { DeviceSettings, MainEvent } from "../types";
import { STEPS, type TourStep } from "./steps";
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
    '<nav id="nav"><div class="sidebar-conversations"><button data-col="add"></button></div><button class="sidebar-apps"></button><button class="sidebar-account"></button></nav>' +
    '<main id="main"><div class="page-agent"><button type="button" class="conversation-trigger">Slime</button>' +
    '<form class="composer"><textarea class="cmp-input"></textarea><button type="button" class="cmp-send"></button><button type="button" class="cmp-mode"></button>' +
    '<span class="cmp-model"><button type="button" class="mp-trigger" aria-expanded="false"></button></span></form></div></main>';
  place(find(".conversation-trigger"), 680, 12, 110, 36);
  place(find(".sidebar-conversations"), 0, 32, 348, 780);
  place(find(".sidebar-apps"), 52, 856, 284, 36);
  place(find(".sidebar-account"), 12, 856, 36, 36);
  place(find(".composer"), 391, 780, 686, 100);
  place(find(".cmp-input"), 405, 785, 650, 40);
  place(find(".cmp-mode"), 440, 832, 60, 26);
  place(find(".cmp-model"), 900, 832, 120, 26);
  place(find(".mp-trigger"), 900, 832, 120, 26);
  place(find(".cmp-send"), 1040, 830, 28, 28);
  place(find('[data-col="add"]'), 315, 40, 30, 30);
  place(find("#main"), 348, 0, 772, 900);
  place(find(".page-agent"), 348, 0, 772, 900);
  const device = { onboarded: true, agent_keys: ["AltRight+Space"], tour_offered: false, ...patch } as DeviceSettings;
  const setDevice = vi.fn(async (change: Partial<DeviceSettings>) => Object.assign(device, change));
  const closeSettings = vi.fn(() => find(".modal-scrim")?.remove());
  let conversation = true;
  // Going back to the conversation takes the other pages away, as the app's own `go("agent")` hides them.
  const go = vi.fn(() => { find("#main").querySelectorAll(".page-dictation, .au-page, .ms-pane").forEach(page => page.remove()); conversation = true; });
  const listeners = new Set<(event: MainEvent) => void>();
  const emit = (event: MainEvent) => listeners.forEach(listener => listener(event));
  const practiseKeys = vi.fn(), rehearse = vi.fn();
  const tour = createTour({ device: () => device, setDevice, closeSettings, go, practiseKeys, rehearse, isConversation: () => conversation,
    onEvent: listener => { listeners.add(listener); return () => void listeners.delete(listener); } });
  const showConversation = (shown: boolean) => { conversation = shown; tour.conversationChanged(); };
  tours.push(tour);
  return { tour, device, setDevice, closeSettings, showConversation, emit, go, practiseKeys, rehearse };
}

async function offer(tour: Tour): Promise<void> {
  tour.offerOnce();
  await settle(OFFER_DELAY_MS + 50);
}

async function begin(tour: Tour): Promise<void> {
  await offer(tour);
  await press("start");
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
  expect(words()).toBe(t("tour.offer"));
  expect(words()).toContain("兩分鐘");
  expect([...bubble().querySelectorAll("button")].map(item => item.textContent)).toEqual(["跳過", "開始"]);
  expect(button("start").classList.contains("pri")).toBe(true);
  expect(button("skip").classList.contains("pri")).toBe(false);
  expect(bubble().getAttribute("aria-label")).toBe("拉斐爾的導覽");
  expect(find(".tour").dataset.dim).toBe("none");
});

test.each(["modal-scrim", "mb-scrim", "cs-scrim"])("the offer hides under %s and returns unanswered when it closes", async scrimClass => {
  const { tour, device, setDevice } = harness();
  const scrim = document.createElement("div");
  scrim.className = scrimClass;
  scrim.hidden = true;
  document.body.append(scrim);
  await offer(tour);
  const root = find(".tour");
  scrim.hidden = false;
  button("start").click();
  await settle();
  expect(root.inert).toBe(true);
  expect(root.classList.contains("is-covered")).toBe(true);
  expect(tour.active()).toBe(false);
  button("start").click();
  key("Escape");
  expect(device.tour_offered).toBe(false);
  expect(setDevice).not.toHaveBeenCalled();

  scrim.hidden = true;
  await settle();
  expect(tour.active()).toBe(true);
  expect(root.inert).toBe(false);
  expect(root.classList.contains("is-covered")).toBe(false);
  expect(setDevice).not.toHaveBeenCalled();
});

test("the offer hides on another page and pops in once on each return to the conversation", async () => {
  const { tour, showConversation, setDevice } = harness();
  await offer(tour);
  const root = find(".tour"), firstStart = button("start");
  for (let visit = 0; visit < 2; visit++) {
    const before = button("start");
    showConversation(false);
    await settle();
    expect(root.inert).toBe(true);
    showConversation(true);
    await settle();
    expect(root.inert).toBe(false);
    const after = button("start");
    expect(after).not.toBe(before);
    showConversation(true);
    document.body.append(document.createElement("p"));
    await settle(8000);
    expect(button("start")).toBe(after);
  }
  expect(button("start")).not.toBe(firstStart);
  expect(setDevice).not.toHaveBeenCalled();
});

test("the first offer waits for the conversation and for its covering dialog to clear", async () => {
  const { tour, showConversation, setDevice } = harness();
  showConversation(false);
  await offer(tour);
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  document.body.append(scrim);
  showConversation(true);
  await settle(OFFER_DELAY_MS + 50);
  expect(mode()).toBeUndefined();
  scrim.remove();
  await settle(OFFER_DELAY_MS + 50);
  expect(mode()).toBe("offer");
  expect(setDevice).not.toHaveBeenCalled();
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
  expect(confirmation().querySelector("p")?.textContent).toBe("跳過以後，導覽就不會再出現了");
  expect(confirmButton().textContent).toBe("跳過");
  expect(cancelButton().textContent).toBe("取消");
  expect(confirmation().classList.contains("is-quiet")).toBe(true);
  expect(mode()).toBe("offer");
  expect(tour.active()).toBe(true);
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

const stepId = () => find(".tour")?.dataset.step;
const state = () => find(".tour")?.dataset.state;
/** Without the sidebar's plus, the slime's title (so none of its panel's steps) and Connect apps, the walk starts at the model chip. */
const fromModel = () => { for (const selector of ['[data-col="add"]', ".conversation-trigger", ".sidebar-apps"]) find(selector).remove(); };
const line = (key: TourStep["text"]) => t(key, { name: t("agent.title") });

function wireSteps(showConversation: (shown: boolean) => void) {
  const open = (selector: string, html: string) => {
    const parent = document.createElement("div");
    parent.innerHTML = html;
    const layer = parent.firstElementChild as HTMLElement;
    document.body.append(layer);
    place(layer, 260, 310, 500, 330);
    for (const [index, el] of Array.from(layer.querySelectorAll("button, input, .modal, .cb-body, [data-cs-body], .cs-grid")).entries()) {
      place(el, 280, 335 + index * 24, 400, 22);
    }
    return layer.querySelector<HTMLElement>(selector) ?? layer;
  };
  const model = () => open(".cb-menu", '<div class="cb-menu"><div class="cb-now"><button data-cb-act="models" class="cb-pick">Models</button></div><div class="cb-body" hidden></div></div>');
  find(".cmp-mode").addEventListener("click", () => {
    const menu = openPopover(find(".cmp-mode"), '<div class="cb-modes"><button class="cb-row" data-mode="ask">Manual</button></div>', { className: "menu cb-menu", role: "dialog" });
    place(menu, 420, 560, 320, 200);
  });
  find(".mp-trigger").addEventListener("click", () => {
    // The shared close path owns the popover, just as it does in the app.
    const paint = model();
    const menu = openPopover(find(".mp-trigger"), paint.innerHTML, { className: "menu cb-menu", role: "dialog" });
    paint.remove();
    place(menu, 420, 400, 420, 300);
    const pick = menu.querySelector<HTMLElement>("button")!, body = menu.querySelector<HTMLElement>(".cb-body")!;
    place(pick, 445, 445, 315, 42);
    place(body, 430, 430, 400, 265);
    pick.addEventListener("click", () => { body.hidden = false; body.dataset.view = "models"; });
  });
  find(".sidebar-apps").addEventListener("click", () => {
    const panel = open(".modal", '<div class="modal-scrim" data-standalone="connections"><div class="modal"><input id="conn-search"><div data-cs-body></div></div></div>');
    place(panel, 140, 100, 780, 600);
    const input = find("#conn-search");
    input.addEventListener("input", () => {
      find("[data-cs-body]").innerHTML = '<div class="cs-grid"></div>';
      place(find(".cs-grid"), 210, 450, 620, 150);
    });
  });
  const create = vi.fn(async () => null);
  const cancel = vi.fn();
  find('[data-col="add"]').addEventListener("click", () => {
    const maker = openMemberCreator({ groupId: null, taken: [], create });
    const dialog = find(".cr-dialog");
    place(dialog, 180, 185, 640, 495);
    place(find(".cr-picker"), 205, 415, 480, 115);
    find(".cr-picker").addEventListener("click", () => {
      place(find('.cr-face svg[data-state="arriving"]'), 410, 245, 96, 96);
    });
    maker.el.querySelector('[data-dlg="cancel"]')!.addEventListener("click", cancel);
  });
  // The slime's title opens its panel, with its tabs and the gear that opens its settings in the page.
  find(".conversation-trigger").addEventListener("click", () => {
    const shown = find(".mb-det");
    if (shown) { shown.hidden = !shown.hidden; return; }
    {
      find(".page-agent").insertAdjacentHTML("beforeend", '<aside class="mb-det"><button data-det="gear"></button><button data-det="close"></button>' +
        '<div class="mb-tabs"><button role="tab" data-det="tab" data-tab="details" aria-selected="true"></button>' +
        '<button role="tab" data-det="tab" data-tab="computer" aria-selected="false"></button></div></aside>');
      const panel = find(".mb-det");
      place(panel, 760, 0, 360, 900);
      place(find('[data-det="gear"]'), 772, 12, 28, 28);
      place(find('[data-det="close"]'), 1080, 12, 28, 28);
      for (const [index, tab] of [...panel.querySelectorAll<HTMLElement>("[data-tab]")].entries()) place(tab, 800 + index * 90, 180, 80, 28);
      panel.addEventListener("click", event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-det]");
        if (button?.dataset.det === "tab") panel.querySelectorAll("[data-tab]").forEach(tab => tab.setAttribute("aria-selected", String(tab === button)));
        if (button?.dataset.det === "close") panel.hidden = true;
        if (button?.dataset.det === "gear") {
          find(".page-agent").insertAdjacentHTML("beforeend", '<section class="ms-pane"><h2>Settings</h2></section>');
          place(find(".ms-pane"), 348, 0, 772, 900);
        }
      });
    }
  });
  // The account menu's rows go to pages, as the app's do: dictation and the calendar take the conversation's place, Raphael's opens in it.
  const rows = ["dictation", "calendar", "raphael", "settings"];
  find(".sidebar-account").addEventListener("click", () => {
    if (find(".account-menu")) { closeMenu(); return; }
    const menu = openPopover(find(".sidebar-account"), rows.map(id => `<button data-account="${id}">${id}</button>`).join(""), { className: "menu account-menu", role: "menu" });
    place(menu, 12, 600, 240, 240);
    for (const [index, row] of [...menu.querySelectorAll<HTMLElement>("button")].entries()) place(row, 16, 606 + index * 32, 232, 30);
    menu.addEventListener("click", event => {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-account]")?.dataset.account;
      closeMenu();
      if (id === "raphael") { find(".page-agent").setAttribute("data-raphael", ""); return; }
      const page = document.createElement(id === "calendar" ? "section" : "div");
      page.className = id === "calendar" ? "au-page" : "page page-dictation";
      find("#main").append(page);
      place(page, 348, 0, 772, 900);
      showConversation(false);
    });
  });
  return { create, cancel };
}

test("every step is one action, and what it opens is lit and explained until 好的, with no Next or Back", async () => {
  const { tour, closeSettings, emit, go, showConversation } = harness();
  const { create, cancel } = wireSteps(showConversation);
  const row = (id: string) => () => find(`.account-menu [data-account="${id}"]`).click();
  const actions = [
    () => find('[data-col="add"]').click(),
    () => find(".conversation-trigger").click(),
    () => find('.mb-det [data-tab="computer"]').click(),
    () => find('.mb-det [data-det="gear"]').click(),
    () => find(".sidebar-apps").click(),
    () => find(".mp-trigger").click(),
    () => find('[data-cb-act="models"]').click(),
    () => find(".sidebar-account").click(),
    row("dictation"), row("calendar"), row("raphael"),
  ];

  await begin(tour);
  // What sets the app apart first: a slime's own panel, computer and settings, and the apps it works in; then the model, the avatar's tools and Raphael.
  expect(STEPS.map(step => step.id)).toEqual(["team", "member", "computer", "member-settings", "apps", "model", "model-list", "account", "dictation", "calendar", "raphael", "keys"]);
  for (const [index, step] of STEPS.entries()) {
    expect(stepId()).toBe(step.id);
    expect(state()).toBe("do");
    expect(count()).toBe(`${index + 1}/12`);
    expect(words()).toBe(line(step.text));
    // A row of the account menu is framed inside the menu, which the tour opened again after the last page was looked at.
    if (step.layer === "account") expect(find(".account-menu")).not.toBeNull();
    expect([...bubble().querySelectorAll("button")].map(el => el.dataset.tour)).toEqual(["close"]);
    emit({ type: "Dictation", phase: "processing", agent: true });
    document.body.append(document.createElement("hr"));
    await settle(80);
    expect(stepId()).toBe(step.id);
    if (step.keys) break;

    actions[index]();
    await settle(490);
    expect(stepId()).toBe(step.id);
    await settle(60);
    if (!step.seen) continue;
    // The person reads at their own pace: nothing moves on until 好的.
    expect(stepId()).toBe(step.id);
    expect(state(), step.id).toBe("see");
    expect(words()).toBe(t(step.seen));
    expect(button("gotIt").textContent).toBe("好的");
    expect([...bubble().querySelectorAll("button")].map(el => el.dataset.tour)).toEqual(["close", "gotIt"]);
    expect(spot().hidden).toBe(false);
    // A page is lit whole beside the dimmed sidebar, its frame just inside its edges so the whole ring shows.
    if (step.page) expect([spot().style.left, spot().style.width]).toEqual(["354px", "760px"]);
    await settle(30000);
    expect(stepId()).toBe(step.id);
    await press("gotIt");
  }
  // The slime's settings and then its panel were closed for Connect apps; dictation and the calendar each gave the conversation back
  // for the next row; Raphael's own conversation stays open.
  expect(go.mock.calls).toEqual([["agent"], ["agent"], ["agent"]]);
  expect(find(".ms-pane")).toBeNull();
  expect(find(".mb-det")?.hidden).toBe(true);
  expect(find(".page-agent").hasAttribute("data-raphael")).toBe(true);
  expect(closeSettings).toHaveBeenCalledTimes(1);
  expect(find(".cb-menu")).toBeNull();
  expect(find(".account-menu")).toBeNull();
  expect(find(".cr-dialog")).toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
  expect(find(".modal-scrim")).toBeNull();
  expect(find(".tour-keys kbd")).not.toBeNull();

  emit({ type: "Dictation", phase: "listening", agent: false });
  expect(button("done")).toBeNull();
  emit({ type: "Dictation", phase: "listening", agent: true });
  await settle(3000);
  expect(button("done")).not.toBeNull();
  await press("done");
  expect(mode()).toBe("bye");
  await settle(BYE_MS);
  expect(mode()).toBeUndefined();
});

test("a slime's panel already open in a wide window is closed first, so the person opens it", async () => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  find(".conversation-trigger").click();
  expect(find(".mb-det").hidden).toBe(false);
  find('[data-col="add"]').remove();
  await begin(tour);
  expect(stepId()).toBe("member");
  expect(find(".mb-det").hidden).toBe(true);
  find(".conversation-trigger").click();
  await settle();
  expect(state()).toBe("see");
});

test("nothing moves the walk on by the clock: a press the app does not react to leaves the step for another press", async () => {
  const { tour } = harness();
  fromModel();
  await begin(tour);
  find(".mp-trigger").click();
  await settle(60000);
  expect(stepId()).toBe("model");
  expect(state()).toBe("do");
  expect([...bubble().querySelectorAll("button")].map(el => el.dataset.tour)).toEqual(["close"]);
});

test("a missing target skips immediately and keeps the original progress count", async () => {
  const { tour } = harness();
  find('[data-col="add"]').remove();
  await begin(tour);
  expect(stepId()).toBe("member");
  expect(count()).toBe("2/12");
});

test("the shortcut's keys are large caps that light while held, and all of them down makes the real corner answer before Finish", async () => {
  const { tour, rehearse } = harness();
  await offer(tour);
  for (const selector of ['[data-col="add"]', ".conversation-trigger", ".mp-trigger", ".sidebar-apps", ".sidebar-account"]) find(selector).remove();
  button("start").click();
  expect(stepId()).toBe("keys");
  expect(words()).not.toContain("最後一招");
  const caps = () => [...document.querySelectorAll<HTMLElement>(".tour-keys .tour-key")];
  expect(caps().map(cap => cap.textContent)).toEqual(["右 Alt", "Space"]);
  const keyAt = (type: string, code: string, key: string) => document.body.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
  await settle(60000);
  expect(button("done")).toBeNull();
  keyAt("keydown", "AltRight", "Alt");
  expect(caps().map(cap => cap.hasAttribute("data-down"))).toEqual([true, false]);
  keyAt("keyup", "AltRight", "Alt");
  keyAt("keydown", "Space", " ");
  expect(caps().map(cap => cap.hasAttribute("data-down"))).toEqual([false, true]);
  expect(button("done")).toBeNull();
  keyAt("keydown", "AltRight", "Alt");
  expect(caps().map(cap => cap.hasAttribute("data-down"))).toEqual([true, true]);
  // The real quick ask's corner says Raphael's own introduction as a notice and goes by itself, listening to nothing; Finish shows.
  expect(rehearse).toHaveBeenCalledExactlyOnceWith("告", "我是拉斐爾，有什麼問題請儘管吩咐");
  expect(find(".tour-summon")).toBeNull();
  expect(button("done")?.classList.contains("pri")).toBe(true);
});

test("between a press and what it opens, Raphael stays where it is instead of hopping into the page and back", async () => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  for (const selector of ['[data-col="add"]', ".conversation-trigger", ".sidebar-apps", ".mp-trigger"]) find(selector).remove();
  await begin(tour);
  expect(stepId()).toBe("account");
  find(".sidebar-account").click();
  await settle();
  expect(stepId()).toBe("dictation");
  const before = find(".tour-ground").style.left;
  // The row is gone with its menu and the page took the conversation's place; until the page is explained, nothing moves.
  find('.account-menu [data-account="dictation"]').click();
  await settle(300);
  expect(state()).toBe("do");
  expect(find(".tour-ground").style.left).toBe(before);
  // The frame went with the words at once; the next one comes with the next words, so no frame lingers on the pressed row.
  expect(spot().hidden).toBe(true);
  await settle(300);
  expect(state()).toBe("see");
});

test("the shortcut is practised: the hook's keys light the caps and start nothing, and the practice ends with the tour", async () => {
  const { tour, emit, practiseKeys } = harness({ dictation_keys: ["AltRight"] });
  await offer(tour);
  for (const selector of ['[data-col="add"]', ".conversation-trigger", ".mp-trigger", ".sidebar-apps", ".sidebar-account"]) find(selector).remove();
  button("start").click();
  expect(stepId()).toBe("keys");
  expect(practiseKeys).toHaveBeenLastCalledWith(true);
  const down = () => [...document.querySelectorAll<HTMLElement>(".tour-keys .tour-key")].map(cap => cap.hasAttribute("data-down"));
  emit({ type: "Hotkey", kind: "dictation_down" });
  expect(down()).toEqual([true, false]);
  expect(button("done")).toBeNull();
  emit({ type: "Hotkey", kind: "dictation_up" });
  expect(down()).toEqual([false, false]);
  emit({ type: "Hotkey", kind: "agent_down" });
  expect(down()).toEqual([true, true]);
  await settle(3000);
  expect(button("done")?.classList.contains("pri")).toBe(true);
  await press("done");
  expect(practiseKeys).toHaveBeenLastCalledWith(false);
});

async function reachModelList(tour: Tour): Promise<void> {
  fromModel();
  await begin(tour);
  find(".mp-trigger").click();
  await settle();
  find('[data-cb-act="models"]').click();
  await settle();
}

test.each(["Cancel", "Escape", "outside press"])("%s from End tour resumes the same step and open layer", async method => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  await reachModelList(tour);
  expect([stepId(), state()]).toEqual(["model-list", "see"]);
  await press("close");
  expect(confirmation()).not.toBeNull();
  dismissConfirmation(method);
  await settle();
  expect(stepId()).toBe("model-list");
  expect(state()).toBe("see");
  expect(find(".cb-menu")).not.toBeNull();
  expect(document.activeElement).toBe(button("close"));
});

test("a resize that closes the lit menu opens it again where it now belongs, with its model list", async () => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  await reachModelList(tour);
  const before = find(".cb-menu");
  window.dispatchEvent(new Event("resize"));
  expect(find(".cb-menu")).toBeNull();
  await settle();
  expect([stepId(), state()]).toEqual(["model-list", "see"]);
  expect(find(".cb-menu")).not.toBeNull();
  expect(find(".cb-menu")).not.toBe(before);
  expect(find('.cb-menu .cb-body[data-view="models"]')?.hidden).toBe(false);
});

test("what is lit can be used while it is explained, and closing it by its use moves the walk on", async () => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  await reachModelList(tour);
  const pick = vi.fn();
  const row = find(".cb-menu .cb-body");
  row.addEventListener("click", pick);
  row.click();
  expect(pick).toHaveBeenCalledOnce();
  closeMenu();
  await settle();
  expect(stepId()).toBe("account");
});

test("confirming End tour closes its layer and removes the tour immediately without a goodbye", async () => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  fromModel();
  await begin(tour);
  find(".mp-trigger").click();
  await settle();
  expect(stepId()).toBe("model-list");
  await press("close");
  confirmButton().click();
  await settle();
  expect(mode()).toBeUndefined();
  expect(find(".cb-menu")).toBeNull();
});

test("Tab cycles through the framed control and the close button while outside presses are blocked", async () => {
  const { tour } = harness();
  fromModel();
  await begin(tour);
  const trigger = find(".mp-trigger");
  const outside = vi.fn(), caption = vi.fn();
  find(".sidebar-account").addEventListener("click", outside);
  find(".window-controls button").addEventListener("click", caption);
  find(".sidebar-account").click();
  find(".window-controls button").click();
  expect(outside).not.toHaveBeenCalled();
  expect(caption).toHaveBeenCalledOnce();

  button("close").focus();
  key("Tab", button("close"));
  expect(document.activeElement).toBe(trigger);
  key("Tab", trigger);
  expect(document.activeElement).toBe(button("close"));
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(tour.navigate("back")).toBe(true);
  expect(stepId()).toBe("model");
});

test("placement follows a resized target without a hop, and locale changes redraw the line", async () => {
  const { tour } = harness();
  fromModel();
  await begin(tour);
  expect(spot().style.left).toBe("896px");
  place(find(".mp-trigger"), 160, 832, 120, 26);
  window.dispatchEvent(new Event("resize"));
  await settle();
  expect(spot().style.left).toBe("156px");
  setLocale("ja");
  expect(words()).toBe(t("tour.model"));
});

test("a dialog the tour lights keeps its place: nothing pads or moves the window's own layer", async () => {
  const { tour, showConversation } = harness();
  wireSteps(showConversation);
  for (const selector of ['[data-col="add"]', ".conversation-trigger"]) find(selector).remove();
  await begin(tour);
  expect(stepId()).toBe("apps");
  find(".sidebar-apps").click();
  await settle();
  expect(state()).toBe("see");
  const scrim = find('.modal-scrim[data-standalone="connections"]');
  expect(scrim.hasAttribute("data-tour-clearance")).toBe(false);
  expect(scrim.style.paddingTop).toBe("");
  expect(scrim.style.getPropertyValue("--tour-clearance")).toBe("");
});
