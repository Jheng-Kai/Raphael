// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

function mount(cards: PageCard[] = [card]) {
  const thread = document.createElement("div");
  thread.innerHTML = pageCardsHTML(turn(cards));
  document.body.append(thread);
  const place = vi.fn(() => true);
  const pages = mountPages(thread, { place });
  pages.sync();
  const frame = thread.querySelector("iframe")!;
  // The test window loads no frames, so each is given a window of its own for messages to come from.
  Object.defineProperty(frame, "contentWindow", { value: { postMessage: vi.fn() }, configurable: true });
  focusOn(frame);
  pointerAt(10, 10);
  return { thread, place, pages, frame };
}

/** A message from the frame, as `window` would deliver it. */
function fromFrame(frame: HTMLIFrameElement, data: unknown): void {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: frame.contentWindow });
  window.dispatchEvent(event);
}

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

test("expand takes the same frame to the large dialog and closing brings it back", async () => {
  const { thread, frame, pages } = mount();
  await flush();
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  expect(document.querySelector(".pg-view iframe")).toBe(frame);
  pages.sync();
  expect(document.querySelector(".pg-view iframe")).toBe(frame);
  document.querySelector<HTMLElement>('.pg-view-dialog [data-dlg="close"]')!.click();
  expect(document.querySelector(".pg-view")).toBeNull();
  expect(thread.querySelector(".pg-body iframe")).toBe(frame);
  expect(api.pagesOpen).toHaveBeenCalledTimes(1);
});

test("a page made larger keeps its × outside the page: above its top right corner, on the scrim", async () => {
  // The × once lay over the page's top right corner (top: 12px; right: 16px), so whatever a page drew there was covered (2026-11-11).
  const { thread } = mount();
  await flush();
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  const dialog = document.querySelector<HTMLElement>(".pg-view-dialog")!;
  const close = dialog.querySelector<HTMLElement>('[data-dlg="close"]')!;
  expect(close.closest(".mb-dlg-head")!.parentElement).toBe(dialog);
  expect(dialog.querySelector(".pg-view")!.contains(close)).toBe(false);
  const css = readFileSync(join(__dirname, "page-card.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => { const at = css.indexOf(`\n${selector} {`); return at < 0 ? "" : css.slice(at, css.indexOf("}", at)); };
  // Just outside the page's top right corner (the dialog is the page's box), right-aligned with it, the standard small gap above it.
  expect(rule(".pg-view-dialog .mb-dlg-head")).toContain("position: absolute; bottom: calc(100% + var(--sp-2)); right: 0;");
  // So the dialog must not clip what stands outside it, nor leave its page's corners to it; the scrim keeps the room above.
  expect(rule(".mb-dialog.pg-view-dialog")).toContain("overflow: visible");
  expect(rule(".mb-dialog.pg-view-dialog .mb-dlg-body")).toContain("overflow: hidden; border-radius: var(--r-lg)");
  expect(rule(".mb-scrim:has(> .pg-view-dialog)")).toContain("padding-top: calc(var(--window-controls-height) + var(--sp-2) + 36px + var(--sp-2))");
  close.click();
});

test("a page made larger is as tall in its dialog as it says it is there, under its card's title", async () => {
  const { thread, frame } = mount();
  await flush();
  const card = thread.querySelector<HTMLElement>(".pg-card")!;
  thread.querySelector<HTMLElement>('[data-page-act="expand"]')!.click();
  // The title once, as the card has it (it was escaped twice and showed 「&lt;b&gt;」).
  expect(document.querySelector(".pg-view-dialog .mb-dlg-head h2")!.textContent).toBe("藍色背包 <b>");
  const view = document.querySelector<HTMLElement>(".pg-view")!;
  expect(view.style.getPropertyValue("--pg-h")).toBe("400px");
  // Wider, the page says again how tall it is: only the dialog follows, the card keeps its height behind it.
  fromFrame(frame, { raphaelPage: 1, type: "height", height: 243.4 });
  expect(view.style.getPropertyValue("--pg-h")).toBe("244px");
  expect(card.style.getPropertyValue("--pg-h")).toBe("400px");
  document.querySelector<HTMLElement>('.pg-view-dialog [data-dlg="close"]')!.click();
  fromFrame(frame, { raphaelPage: 1, type: "height", height: 300 });
  expect(card.style.getPropertyValue("--pg-h")).toBe("300px");
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
