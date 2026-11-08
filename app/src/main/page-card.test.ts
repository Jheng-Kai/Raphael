// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
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

test("a page that cannot open says what it knows and offers to try again, never a blank box", async () => {
  vi.mocked(api.pagesOpen).mockRejectedValueOnce(new Error("gone"));
  const { thread } = mount();
  await flush();
  const failed = thread.querySelector<HTMLElement>(".pg-failed")!;
  expect(failed.hidden).toBe(false);
  expect(failed.textContent).toContain("背包 1,200 元");
  expect(thread.querySelector<HTMLElement>(".pg-body")!.hidden).toBe(true);
  thread.querySelector<HTMLElement>('[data-page-act="retry"]')!.click();
  await flush();
  expect(failed.hidden).toBe(true);
  expect(api.pagesOpen).toHaveBeenCalledTimes(2);
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
