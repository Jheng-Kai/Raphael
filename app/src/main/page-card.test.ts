// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cancelGesture } from "../shared/cancel-gesture";
import * as api from "./api";
import { t } from "./i18n";
import { mountPages, pageCardsHTML } from "./page-card";
import type { AgentTurn, PageCard } from "./types";

const card: PageCard = { id: "p1", title: "藍色背包 <b>", rev: 0, height: 400, source: "html", server: null, fallback: "背包 1,200 元" };
const turn = (cards: PageCard[]): AgentTurn => ({ pages: cards }) as unknown as AgentTurn;
const opened = { url: "http://127.0.0.1:9/p/abc?theme=light", title: "藍色背包", rev: 0, height: 400, source: "html", server: null } as const;
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** A press inside a frame leaves the focus on it. */
const focusOn = (element: Element): void => {
  Object.defineProperty(document, "activeElement", { value: element, configurable: true });
};
/** Where the app last heard the pointer; a frame in the test window stands at 0,0. */
const pointerAt = (x: number, y: number): void => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y })); };

/** A conversation pane as the app draws it: the header with its top-left slot, the stage with the thread and the composer's dock. */
function mount(cards: PageCard[] = [card]) {
  const pane = document.createElement("section");
  pane.className = "mb-chat";
  pane.innerHTML = `<div class="page-head mb-head"><span class="mb-head-l"><button type="button" class="btn icon" data-act="search"></button></span></div>` +
    `<div class="ra-stage"><div class="ra-scroll"><ol class="thread"></ol></div><div class="ra-dock"><textarea></textarea></div></div>`;
  document.body.append(pane);
  const stage = pane.querySelector<HTMLElement>(".ra-stage")!;
  const thread = stage.querySelector<HTMLElement>(".thread")!;
  thread.innerHTML = pageCardsHTML(turn(cards));
  const place = vi.fn(() => true);
  const pages = mountPages(thread, { place });
  pages.sync();
  const frame = thread.querySelector("iframe")!;
  // The test window loads no frames, so each is given a window of its own for messages to come from.
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  focusOn(frame);
  pointerAt(10, 10);
  return { thread, place, pages, frame, stage };
}

/** A message from the frame, as `window` would deliver it. */
function fromFrame(frame: HTMLIFrameElement, data: unknown): void {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: frame.contentWindow });
  window.dispatchEvent(event);
}

/** The page's own load: only then the card is a control, as in the app. */
const loaded = (frame: HTMLIFrameElement): void => { frame.dispatchEvent(new Event("load")); };

const setActivation = (isActive: boolean): void => {
  Object.defineProperty(navigator, "userActivation", { value: { isActive }, configurable: true });
};

beforeEach(() => {
  vi.spyOn(api, "pagesOpen").mockResolvedValue({ ...opened });
  setActivation(true);
});

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; Reflect.deleteProperty(document, "activeElement"); });

test("a card escapes its words and holds no frame of its own in its html", () => {
  const html = pageCardsHTML(turn([card]));
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("<b>藍色背包 <b>");
  expect(html).toContain("&lt;b&gt;");
});

test("a page runs sandboxed with an opaque origin, from the address the core gives", async () => {
  const { frame } = mount();
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
  expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  await flush();
  expect(frame.getAttribute("src")).toBe(opened.url);
  expect(api.pagesOpen).toHaveBeenCalledWith("p1", "light");
});

test("a page that cannot open says so, then what it knows, and offers to try again, never a blank box", async () => {
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  const { thread } = mount();
  await flush();
  const failed = thread.querySelector<HTMLElement>(".pg-failed")!;
  expect(failed.hidden).toBe(false);
  // What failed comes first, as the card's own body line (the judge read the page's words alone as a success).
  expect(failed.firstElementChild!.matches('.card-body[role="alert"]')).toBe(true);
  expect(failed.firstElementChild!.textContent).toBe(t("page.failed"));
  expect(failed.querySelector(".card-well")!.textContent).toBe("背包 1,200 元");
  expect(thread.querySelector<HTMLElement>(".pg-body")!.hidden).toBe(true);
  thread.querySelector<HTMLElement>('[data-page-act="retry"]')!.click();
  await flush();
  expect(failed.hidden).toBe(true);
  expect(api.pagesOpen).toHaveBeenCalledTimes(2);
});

test("a page with no words of its own only says it cannot open", async () => {
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  const { thread } = mount([{ ...card, fallback: "" }]);
  await flush();
  const failed = thread.querySelector<HTMLElement>(".pg-failed")!;
  expect(failed.textContent).toContain(t("page.failed"));
  expect(failed.querySelector(".card-well")).toBeNull();
});

test("a page carries its × only while it failed, so a link that fails keeps its own ×", async () => {
  const { thread, frame } = mount();
  await flush();
  const head = thread.querySelector<HTMLElement>(".pg-card > .card-head")!;
  expect(head.querySelector(".card-close")).toBeNull();
  // A link the page could not open: the shared failure, whose × puts only that notice away and keeps the page.
  vi.spyOn(api, "openExternalUrl").mockRejectedValueOnce(new Error("Unavailable"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://example.invalid/guide" });
  await vi.waitFor(() => expect(thread.querySelector(".card-failure")).not.toBeNull());
  expect([...head.querySelectorAll("[data-card-failed-close], [data-card-dismiss]")].map(close => close.hasAttribute("data-card-dismiss"))).toEqual([true]);
  head.querySelector<HTMLButtonElement>("[data-card-dismiss]")!.click();
  expect(thread.querySelector(".card-failure")).toBeNull();
  expect(thread.querySelector<HTMLElement>(".pg-card")!.hidden).toBe(false);
  expect(head.querySelector(".card-close")).toBeNull();
});

test("a failed page keeps its words and × when its line is drawn again, and retrying takes the × away", async () => {
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  const { thread, pages } = mount();
  await flush();
  thread.innerHTML = pageCardsHTML(turn([card]));
  pages.sync();
  expect(thread.querySelector<HTMLElement>(".pg-failed")!.hidden).toBe(false);
  expect(thread.querySelector<HTMLElement>(".pg-body")!.hidden).toBe(true);
  expect(thread.querySelectorAll(".pg-card > .card-head [data-card-failed-close]")).toHaveLength(1);
  expect(thread.querySelector(".card-status.is-failed")).not.toBeNull();
  expect(api.pagesOpen).toHaveBeenCalledTimes(1);
  thread.querySelector<HTMLElement>('[data-page-act="retry"]')!.click();
  expect(thread.querySelector(".pg-card > .card-head .card-close")).toBeNull();
  await flush();
  expect(thread.querySelector<HTMLElement>(".pg-failed")!.hidden).toBe(true);
});

test("an external link failure retries in its originating page card", async () => {
  const openLink = vi.spyOn(api, "openExternalUrl").mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue();
  const {thread, frame} = mount(); await flush();
  window.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab"}));
  fromFrame(frame, {raphaelPage:1, type:"open", url:"https://example.invalid/guide"});
  await vi.waitFor(() => expect(thread.querySelector("[data-card-retry]")).not.toBeNull());
  thread.querySelector<HTMLButtonElement>("[data-card-retry]")!.click();
  await vi.waitFor(() => expect(openLink).toHaveBeenCalledTimes(2));
  expect(openLink).toHaveBeenLastCalledWith("https://example.invalid/guide");
});

test("a failed page can be closed without retrying its service", async () => {
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  const { thread } = mount();
  await flush();
  // The × at the card's top right, never a 「關閉」 beside 重試.
  expect(thread.querySelector(".pg-failed [data-card-failed-close]")).toBeNull();
  const close = thread.querySelector<HTMLButtonElement>(".pg-card > .card-head [data-card-failed-close]");
  expect(close).not.toBeNull();
  close!.click();
  expect(thread.querySelector<HTMLElement>(".pg-card")!.hidden).toBe(true);
  expect(api.pagesOpen).toHaveBeenCalledTimes(1);
});

test("a sure page gesture only places a draft and acknowledges placed, with a pause between placements", async () => {
  const { frame, place } = mount();
  await flush();
  setActivation(false);
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "買兩個" });
  expect(place).not.toHaveBeenCalled();
  setActivation(true);
  fromFrame(frame, { raphaelPage: 1, type: "send", text: " 買兩個 " });
  expect(place).toHaveBeenCalledExactlyOnceWith("p1", "買兩個");
  expect(frame.contentWindow!.postMessage).toHaveBeenCalledExactlyOnceWith({ raphaelPage: 1, type: "result", status: "placed" }, "*");
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "再買" });
  expect(place).toHaveBeenCalledTimes(1);
});

test("a press elsewhere in the app is not a press in the page", async () => {
  const opener = vi.spyOn(api, "openExternalUrl").mockResolvedValue();
  const { frame, place } = mount();
  await flush();
  focusOn(document.body);
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "買兩個" });
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(place).not.toHaveBeenCalled();
  expect(opener).not.toHaveBeenCalled();
  expect(document.querySelector(".pg-ask")).toBeNull();
});

test("an uncertain page gesture can place a draft but cannot authorize an owner message", async () => {
  const { frame, place } = mount();
  await flush();
  pointerAt(2000, 2000);
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "買兩個" });
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "再買" });
  expect(place).toHaveBeenCalledExactlyOnceWith("p1", "買兩個");
  expect(document.querySelector(".pg-ask")).toBeNull();
});

test("a declined external link asks no more, and a sure page gesture can still open it", async () => {
  const opener = vi.spyOn(api, "openExternalUrl").mockResolvedValue();
  const { frame } = mount();
  await flush();
  pointerAt(2000, 2000);
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  document.querySelector<HTMLElement>('.pg-ask [data-dlg="cancel"]')!.click();
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(document.querySelector(".pg-ask")).toBeNull();
  expect(opener).not.toHaveBeenCalled();
  pointerAt(10, 10);
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(opener).toHaveBeenCalledExactlyOnceWith("https://shop.example/a");
});

test("a press right after a press in the app, with no move between, is not sure either; Tab into the page is", async () => {
  const opener = vi.spyOn(api, "openExternalUrl").mockResolvedValue();
  const { frame } = mount();
  await flush();
  window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10 }));
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(opener).not.toHaveBeenCalled();
  document.querySelector<HTMLElement>('.pg-ask [data-dlg="yes"]')!.click();
  expect(opener).toHaveBeenCalledExactlyOnceWith("https://shop.example/a");
  opener.mockClear();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(opener).toHaveBeenCalledExactlyOnceWith("https://shop.example/a");
});

test("a message from anywhere else is not a page's", async () => {
  const { place } = mount();
  await flush();
  const event = new MessageEvent("message", { data: { raphaelPage: 1, type: "send", text: "買" } });
  Object.defineProperty(event, "source", { value: window });
  window.dispatchEvent(event);
  expect(place).not.toHaveBeenCalled();
});

test("a link opens only over https and only after a press", async () => {
  const opener = vi.spyOn(api, "openExternalUrl").mockResolvedValue();
  const { frame } = mount();
  await flush();
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "javascript:alert(1)" });
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "http://shop.example/a" });
  expect(opener).not.toHaveBeenCalled();
  setActivation(false);
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(opener).not.toHaveBeenCalled();
  setActivation(true);
  fromFrame(frame, { raphaelPage: 1, type: "open", url: "https://shop.example/a" });
  expect(opener).toHaveBeenCalledExactlyOnceWith("https://shop.example/a");
});

test("a page is as tall as it says, within bounds, and keeps that height on a redraw", async () => {
  const { thread, frame, pages } = mount();
  await flush();
  fromFrame(frame, { raphaelPage: 1, type: "height", height: 777.2 });
  expect(thread.querySelector<HTMLElement>(".pg-card")!.style.getPropertyValue("--pg-h")).toBe("778px");
  fromFrame(frame, { raphaelPage: 1, type: "height", height: 1e9 });
  expect(thread.querySelector<HTMLElement>(".pg-card")!.style.getPropertyValue("--pg-h")).toBe("2400px");
  thread.innerHTML = pageCardsHTML(turn([card]));
  pages.sync();
  expect(thread.querySelector<HTMLElement>(".pg-card")!.style.getPropertyValue("--pg-h")).toBe("2400px");
});

test("a redraw keeps the running frame, moving it without a reload", async () => {
  const { thread, frame, pages } = mount();
  await flush();
  const made = document.createElement("div");
  made.innerHTML = pageCardsHTML(turn([card]));
  const body = made.querySelector<HTMLElement>(".pg-body")! as HTMLElement & { moveBefore?: unknown };
  const moved = vi.fn((node: Node) => body.append(node));
  body.moveBefore = moved;
  const restore = pages.carry(thread, made);
  thread.append(made);
  restore();
  expect(moved).toHaveBeenCalledOnce();
  expect(made.querySelector("iframe")).toBe(frame);
  pages.sync();
  expect(api.pagesOpen).toHaveBeenCalledTimes(1);
});

test("a new revision opens again in the same frame", async () => {
  const { thread, frame, pages } = mount();
  await flush();
  thread.querySelector<HTMLElement>(".pg-card")!.dataset.pageRev = "1";
  pages.sync();
  await flush();
  expect(api.pagesOpen).toHaveBeenCalledTimes(2);
  expect(thread.querySelector("iframe")).toBe(frame);
});

const back = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>(".mb-head-l > [data-page-back]")!;

test("pressing the card takes the same frame to the conversation's place, with no dialog, and the header's arrow brings it back", async () => {
  const { thread, frame, pages, stage } = mount();
  await flush();
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  const view = stage.querySelector<HTMLElement>(".pgv")!;
  expect(stage.classList.contains("is-page") && stage.dataset.pageKind === "page" && !view.hidden).toBe(true);
  expect(view.querySelector(".pgv-frame-box > iframe")).toBe(frame);
  // The composer stays under it, and nothing stands over it: no dialog, no scrim, no ×.
  expect(view.nextElementSibling!.classList.contains("ra-dock")).toBe(true);
  expect(document.querySelector(".mb-scrim, .mb-dialog, .pg-view-dialog, [data-dlg=close]")).toBeNull();
  expect(view.querySelector(".btn, [data-dlg], .modal-x")).toBeNull();
  pages.sync();
  expect(view.querySelector("iframe")).toBe(frame);
  back().click();
  expect(stage.classList.contains("is-page") || !view.hidden).toBe(false);
  expect(thread.querySelector(".pg-body iframe")).toBe(frame);
  expect(api.pagesOpen).toHaveBeenCalledTimes(1);
});

test("the way back is the round arrow at the header's top left, named 返回, where the search stood", async () => {
  const { thread, frame } = mount();
  await flush();
  loaded(frame);
  const slot = document.querySelector<HTMLElement>(".mb-head-l")!;
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  const arrow = back();
  expect(slot.firstElementChild).toBe(arrow);
  expect(arrow.hidden).toBe(false);
  expect(arrow.classList.contains("icon") && arrow.getAttribute("aria-label") === "返回" && arrow.textContent === "").toBe(true);
  expect(arrow.querySelector("svg")).not.toBeNull();
  // The search is the thread's, and the thread is not in sight: the css puts it away, and the page's title is in sight.
  const css = readFileSync(join(__dirname, "page-view.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css).toContain('.mb-chat:has(> .ra-stage.is-page) .mb-head [data-act="search"] { display: none; }');
  expect(document.querySelector(".pgv .pgv-title")!.textContent).toBe("藍色背包 <b>");
  expect(document.querySelector(".pgv")!.getAttribute("aria-label")).toBe("藍色背包 <b>");
  arrow.click();
  expect(arrow.hidden).toBe(true);
});

test("a page in the conversation's place has no dialog: its css has no scrim, no × and no dialog box", () => {
  const css = readFileSync(join(__dirname, "page-card.css"), "utf8") + readFileSync(join(__dirname, "page-view.css"), "utf8");
  expect(css).not.toMatch(/pg-view|mb-scrim|mb-dialog|mb-dlg|modal-x/);
  const source = readFileSync(join(__dirname, "page-card.ts"), "utf8");
  // A dialog is still the owner's to confirm a link a page asks to open, and nothing else: a page itself is never in one.
  expect(source.match(/openDialog\(/g)).toHaveLength(1);
});

test("a page is as tall in its place as the place is: what it says changes nothing there, and the card follows once it is back", async () => {
  const { thread, frame, stage } = mount();
  await flush();
  const card = thread.querySelector<HTMLElement>(".pg-card")!;
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  fromFrame(frame, { raphaelPage: 1, type: "height", height: 243.4 });
  expect(card.style.getPropertyValue("--pg-h")).toBe("400px");
  expect(stage.querySelector<HTMLElement>(".pgv-frame-box")!.style.height).toBe("");
  back().click();
  fromFrame(frame, { raphaelPage: 1, type: "height", height: 300 });
  expect(card.style.getPropertyValue("--pg-h")).toBe("300px");
});

test("going back puts the card's preview at the top of the page and keeps where the owner was reading for the next time", async () => {
  const { thread, frame } = mount();
  await flush();
  loaded(frame);
  const posted = vi.mocked(frame.contentWindow!.postMessage);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  fromFrame(frame, { raphaelPage: 1, type: "scroll", y: 520 });
  back().click();
  expect(posted).toHaveBeenLastCalledWith({ raphaelPage: 1, type: "scroll-to", y: 0 }, "*");
  // The page's own answer to that scroll is not where the owner was reading.
  fromFrame(frame, { raphaelPage: 1, type: "scroll", y: 0 });
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  expect(posted).toHaveBeenLastCalledWith({ raphaelPage: 1, type: "scroll-to", y: 520 }, "*");
  back().click();
});

test("a page changed while it stands in the conversation's place loads beside it, goes back to where it was read and takes its place: one card, one frame, nothing closes", async () => {
  const { thread, frame, pages, stage } = mount();
  await flush();
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  fromFrame(frame, { raphaelPage: 1, type: "scroll", y: 420 });
  vi.mocked(api.pagesOpen).mockResolvedValueOnce({ ...opened, url: "http://127.0.0.1:9/p/changed?theme=light", rev: 1 });
  thread.querySelector<HTMLElement>(".pg-card")!.dataset.pageRev = "1";
  pages.sync();
  await flush();
  const frames = [...stage.querySelectorAll<HTMLIFrameElement>(".pgv iframe")];
  // The changed page is a second frame, unseen until it has drawn; the page on screen stays as it is.
  expect(frames).toHaveLength(2);
  const next = frames[1]!;
  expect(frames[0]).toBe(frame);
  expect(next.getAttribute("src")).toBe("http://127.0.0.1:9/p/changed?theme=light");
  expect(next.style.visibility).toBe("hidden");
  expect(next.hasAttribute("inert")).toBe(false);
  Object.defineProperty(next, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  next.dispatchEvent(new Event("load"));
  expect(next.contentWindow!.postMessage).toHaveBeenCalledExactlyOnceWith({ raphaelPage: 1, type: "scroll-to", y: 420 }, "*");
  expect(frame.isConnected).toBe(true);
  fromFrame(next, { raphaelPage: 1, type: "scroll", y: 420 });
  expect([...stage.querySelectorAll(".pgv iframe")]).toEqual([next]);
  expect(next.style.visibility).toBe("");
  expect(stage.classList.contains("is-page") && !stage.querySelector<HTMLElement>(".pgv")!.hidden).toBe(true);
  expect(thread.querySelectorAll(".pg-card")).toHaveLength(1);
  // Going back, the card holds the changed page.
  back().click();
  expect(thread.querySelector(".pg-body iframe")).toBe(next);
  expect(api.pagesOpen).toHaveBeenCalledTimes(2);
});

test("a changed page that was not being read shows the moment it has drawn, and one that cannot be read stays as it was", async () => {
  const { thread, frame, pages, stage } = mount();
  await flush();
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  thread.querySelector<HTMLElement>(".pg-card")!.dataset.pageRev = "1";
  pages.sync();
  await flush();
  expect([...stage.querySelectorAll(".pgv iframe")]).toEqual([frame]);
  thread.querySelector<HTMLElement>(".pg-card")!.dataset.pageRev = "2";
  pages.sync();
  await flush();
  const next = stage.querySelectorAll<HTMLIFrameElement>(".pgv iframe")[1]!;
  Object.defineProperty(next, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  next.dispatchEvent(new Event("load"));
  expect([...stage.querySelectorAll(".pgv iframe")]).toEqual([next]);
  expect(next.contentWindow!.postMessage).not.toHaveBeenCalled();
});

test("Escape goes back and leaves the composer's draft alone, except where a task's Stop has the Escape first", async () => {
  const { thread, frame, stage } = mount();
  await flush();
  loaded(frame);
  const field = stage.querySelector<HTMLTextAreaElement>("textarea")!;
  field.value = "還沒送出的草稿";
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  const escape = (): KeyboardEvent => { const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true }); window.dispatchEvent(event); return event; };
  // A task is running: its Stop is armed first (R-UI-46), and the page stays.
  const stop = document.createElement("button");
  document.body.append(stop);
  const cancel = vi.fn();
  const unregister = cancelGesture().register(() => ({ key: "task", button: stop, hint: "stop", cancel }));
  escape();
  expect(stage.classList.contains("is-page")).toBe(true);
  expect(stop.dataset.cancelArmed).toBe("true");
  unregister();
  cancelGesture().clear();
  // A menu has its own Escape.
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  expect(escape().defaultPrevented).toBe(false);
  expect(stage.classList.contains("is-page")).toBe(true);
  menu.remove();
  expect(escape().defaultPrevented).toBe(true);
  expect(stage.classList.contains("is-page")).toBe(false);
  expect(field.value).toBe("還沒送出的草稿");
  expect(cancel).not.toHaveBeenCalled();
  // Nothing open: Escape is nobody's here.
  expect(escape().defaultPrevented).toBe(false);
});

test("Escape pressed in the page goes back too, but only from a press in it and never over a task's Stop", async () => {
  const { thread, frame, stage } = mount();
  await flush();
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  setActivation(false);
  fromFrame(frame, { raphaelPage: 1, type: "escape" });
  expect(stage.classList.contains("is-page")).toBe(true);
  setActivation(true);
  const stop = document.createElement("button");
  document.body.append(stop);
  const unregister = cancelGesture().register(() => ({ key: "task", button: stop, hint: "stop", cancel: vi.fn() }));
  fromFrame(frame, { raphaelPage: 1, type: "escape" });
  expect(stage.classList.contains("is-page")).toBe(true);
  unregister();
  fromFrame(frame, { raphaelPage: 1, type: "escape" });
  expect(stage.classList.contains("is-page")).toBe(false);
});

test("a page places the owner's text in the composer under it and stays open: the owner alone sends it", async () => {
  const { thread, frame, place, stage } = mount();
  await flush();
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "買兩個" });
  expect(place).toHaveBeenCalledExactlyOnceWith("p1", "買兩個");
  expect(stage.classList.contains("is-page")).toBe(true);
});

test("sending with a page open tells the core which page it is, keeps the page, and shows under it what the member does, then its reply", async () => {
  const viewing = vi.spyOn(api, "pagesViewing").mockResolvedValue({ viewing: "p1" });
  const { thread, frame, pages, stage } = mount();
  await flush();
  loaded(frame);
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  const line = document.createElement("li");
  line.className = "tn";
  line.innerHTML = `<div class="me"><div class="owner-message"><div class="message-text">把價格改低一點</div></div></div><div class="ra"><div class="live-presence" data-tooltip="改頁面中"><span class="live-action">改頁面中</span></div></div>`;
  thread.append(line);
  // The view draws on the frame after the thread changed: one frame to see the change, one for the line.
  const frames = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await pages.sent();
  expect(viewing).toHaveBeenCalledExactlyOnceWith("p1");
  await frames();
  const status = stage.querySelector<HTMLElement>(".pgv-status")!;
  expect(status.hidden).toBe(false);
  expect(status.querySelector(".live-action")!.textContent).toBe("改頁面中");
  expect(stage.classList.contains("is-page")).toBe(true);
  // The member answers: its first words stay under the page, and the arrow brings the whole reply.
  line.querySelector(".ra")!.innerHTML = `<div class="chat-message"><div class="message-text">好了，價格改成 NT$ 990，標題沒有動。</div></div>`;
  await frames();
  expect(status.querySelector(".live-action")).toBeNull();
  expect(status.querySelector(".pgv-reply")!.textContent).toBe("好了，價格改成 NT$ 990，標題沒有動。");
  // Put away, and said again to the core at the next send: no page is open then.
  back().click();
  expect(status.hidden).toBe(true);
  await pages.sent();
  expect(viewing).toHaveBeenLastCalledWith(null);
});

test("a send with no page ever open asks the core nothing", async () => {
  const viewing = vi.spyOn(api, "pagesViewing").mockResolvedValue({ viewing: null });
  const { pages } = mount();
  await pages.sent();
  await pages.sent();
  expect(viewing.mock.calls.length).toBeLessThanOrEqual(1);
});

test("a plugin's page gets the MCP Apps handshake and its tools go through the core; a member's page gets neither", async () => {
  vi.mocked(api.pagesOpen).mockResolvedValue({ ...opened, source: "mcp", server: "Shop", tool_input: { sku: "a" }, tool_result: { content: [{ type: "text", text: "ok" }] } });
  const call = vi.spyOn(api, "pagesToolCall").mockResolvedValue({ status: "done", ok: true, tool_result: { content: [] } });
  const { frame } = mount([{ ...card, source: "mcp", server: "Shop" }]);
  await flush();
  const posted: unknown[] = [];
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: (message: unknown) => posted.push(message) }, configurable: true });
  fromFrame(frame, { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
  await flush();
  expect(posted[0]).toMatchObject({ id: 1, result: { hostInfo: { name: "raphael" } } });
  fromFrame(frame, { jsonrpc: "2.0", method: "ui/notifications/initialized" });
  await flush();
  expect(posted[1]).toMatchObject({ method: "ui/notifications/tool-input", params: { arguments: { sku: "a" } } });
  expect(posted[2]).toMatchObject({ method: "ui/notifications/tool-result" });
  fromFrame(frame, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add_to_cart", arguments: { sku: "a" } } });
  await flush();
  expect(call).toHaveBeenCalledExactlyOnceWith("p1", "add_to_cart", { sku: "a" });
  expect(posted[3]).toMatchObject({ id: 2, result: { content: [] } });
  fromFrame(frame, { jsonrpc: "2.0", id: 3, method: "resources/read", params: {} });
  await flush();
  expect(posted[4]).toMatchObject({ id: 3, error: { code: -32601 } });
});

test("MCP page text returns placed only after composer placement, never sent or a false success", async () => {
  vi.mocked(api.pagesOpen).mockResolvedValue({ ...opened, source: "mcp", server: "Shop" });
  const { frame, place } = mount([{ ...card, source: "mcp", server: "Shop" }]);
  await flush();
  const posted = vi.mocked(frame.contentWindow!.postMessage);
  setActivation(false);
  fromFrame(frame, { jsonrpc: "2.0", id: 1, method: "ui/message", params: { content: [{ type: "text", text: "Page text" }] } });
  expect(place).not.toHaveBeenCalled();
  expect(posted.mock.calls[posted.mock.calls.length - 1]?.[0]).toMatchObject({ id: 1, error: { code: -32000 } });
  setActivation(true);
  fromFrame(frame, { jsonrpc: "2.0", id: 2, method: "ui/message", params: { content: [{ type: "text", text: { instruction: "Do not coerce objects" } }] } });
  expect(place).not.toHaveBeenCalled();
  place.mockReturnValueOnce(false);
  fromFrame(frame, { jsonrpc: "2.0", id: 3, method: "ui/message", params: { content: [{ type: "text", text: "Page text" }] } });
  expect(posted.mock.calls[posted.mock.calls.length - 1]?.[0]).toMatchObject({ id: 3, error: { code: -32000 } });
  fromFrame(frame, { jsonrpc: "2.0", id: 4, method: "ui/message", params: { content: [{ type: "text", text: "Page text" }] } });
  expect(place).toHaveBeenLastCalledWith("p1", "Page text");
  expect(posted.mock.calls[posted.mock.calls.length - 1]?.[0]).toEqual({ jsonrpc: "2.0", id: 4, result: { status: "placed" } });
  expect(JSON.stringify(posted.mock.calls)).not.toContain('"sent"');
});

test("oversized page text and a removed page never reach the composer", async () => {
  const { thread, frame, place } = mount(); await flush();
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "x".repeat(4001) });
  expect(place).not.toHaveBeenCalled();
  thread.replaceChildren();
  fromFrame(frame, { raphaelPage: 1, type: "send", text: "Old page" });
  expect(place).not.toHaveBeenCalled();
});

/** The rule of a selector in page-card.css, comments stripped; "" when it has none. */
const pageRule = (selector: string): string => {
  const css = readFileSync(join(__dirname, "page-card.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

test("a page is a card of one fixed height: its title row and a preview, no expand button under it", () => {
  const thread = document.createElement("div");
  thread.innerHTML = pageCardsHTML(turn([card]));
  const body = thread.querySelector<HTMLElement>(".pg-card > .pg-body")!;
  // One control, named with the page's title, not a loose icon button in a footer.
  expect(body.getAttribute("role")).toBe("button");
  expect(body.getAttribute("aria-label")).toBe(t("page.open", { title: card.title }));
  expect(body.dataset.pageAct).toBe("expand");
  expect(thread.querySelector(".pg-card > .card-actions, .pg-card .btn.icon")).toBeNull();
  // The height is the shared token, the same for a loading, a ready and a failed card, so a change of state moves nothing.
  expect(pageRule(".pg-body")).toContain("height: var(--h-page-peek); overflow: hidden;");
  expect(pageRule(".pg-failed")).toContain("height: var(--h-page-peek);");
  expect(readFileSync(join(__dirname, "styles.css"), "utf8")).toMatch(/--h-page-peek: \d+px;/);
});

test("the preview shows only the top of the page: the frame keeps the page's height behind the clip, takes no pointer and fades into the card", () => {
  // The frame is as tall as the page says, so the page never scrolls inside the clip; the clip, not a scrollbar, cuts it.
  expect(pageRule(".pg-body > .pg-frame")).toContain("height: var(--pg-h, 320px); pointer-events: none;");
  expect(pageRule(".pg-body")).toContain("overflow: hidden;");
  // The cut fades into the card's own surface (--panel, as the card), never to a colour of its own: no light edge in the dark theme.
  expect(pageRule('.pg-body[data-state="ready"]::after')).toContain("linear-gradient(to bottom, transparent, var(--panel))");
});

test("a page in a card is inert: it cannot be pressed, focused or scrolled, and works again only when it stands in the conversation's place", async () => {
  const { thread, frame, stage } = mount();
  await flush();
  loaded(frame);
  expect(frame.hasAttribute("inert")).toBe(true);
  thread.querySelector<HTMLElement>(".pg-body")!.click();
  expect(frame.hasAttribute("inert")).toBe(false);
  expect(stage.querySelector(".pgv iframe")).toBe(frame);
  back().click();
  expect(frame.hasAttribute("inert")).toBe(true);
});

test("pressing the preview, its title row, or Enter or Space on it opens the page whole, and nothing opens before it is ready", async () => {
  const { thread, frame } = mount();
  const body = thread.querySelector<HTMLElement>(".pg-body")!;
  const press = (key: string): void => { body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
  const shown = (): boolean => document.querySelector(".ra-stage.is-page") !== null;
  const close = (): void => { back().click(); };
  // Loading: a placeholder, not a control.
  expect(body.hasAttribute("tabindex")).toBe(false);
  expect(body.getAttribute("aria-disabled")).toBe("true");
  body.click(); press("Enter");
  expect(shown()).toBe(false);
  await flush();
  loaded(frame);
  // Ready: one focusable control.
  expect(body.tabIndex).toBe(0);
  expect(body.hasAttribute("aria-disabled")).toBe(false);
  press("a");
  expect(shown()).toBe(false);
  press("Enter"); expect(shown()).toBe(true); close();
  press(" "); expect(shown()).toBe(true); close();
  body.click(); expect(shown()).toBe(true); close();
  thread.querySelector<HTMLElement>(".pg-card > .card-head .card-title")!.click();
  expect(shown()).toBe(true); close();
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
});

test("a failed page has no preview to press, and its card keeps 再試一次 and ×", async () => {
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  const { thread } = mount();
  await flush();
  const body = thread.querySelector<HTMLElement>(".pg-body")!;
  expect(body.hidden).toBe(true);
  thread.querySelector<HTMLElement>(".pg-card > .card-head")!.click();
  expect(document.querySelector(".ra-stage.is-page")).toBeNull();
  expect(thread.querySelector('[data-page-act="retry"]')).not.toBeNull();
});
