// @vitest-environment happy-dom
// A picture a member sends is a message the owner can act on, as a text bubble is (owner, 2026-11-14, R-UI-156): the real
// page (happy-dom) with the app, the core and the clipboard faked.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MainEvent } from "../types";

const api = vi.hoisted(() => ({
  agentHistoryList: vi.fn(),
  membersGreet: vi.fn(async () => ({ turn_id: 1 })),
  agentHistoryClear: vi.fn(),
  agentHistorySearch: vi.fn(),
  agentAskText: vi.fn(),
  agentQuestionOpen: vi.fn(),
  agentQuestionAnswer: vi.fn(),
  agentVoice: vi.fn(),
  workerCancel: vi.fn(),
  workerRerun: vi.fn(),
  core: vi.fn(),
  openAttachment: vi.fn(),
}));
vi.mock("../api", () => api);
vi.mock("../ui", async original => ({ ...(await original<typeof import("../ui")>()), toaster: { info: vi.fn() } }));

import { Cleared } from "../cleared";
import { createAgent } from "./agent";

const FIRST = `${"b".repeat(32)}.png`, SECOND = `${"c".repeat(32)}.jpg`, REPORT = `${"d".repeat(32)}.pdf`;
const PNG = btoa("synthetic png bytes");
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const media = (seq: number, id: string, name: string, mime: string) => ({ seq, kind: "media" as const, at_ms: seq, text: JSON.stringify({ attachment: { id, name, mime, size: 1727 } }) });
const turn = (): AgentTurn => ({
  id: 7, created_at_ms: Date.parse("2026-11-14T08:00:00+08:00"), question: "畫兩張辦公室的圖", route: "answer", prefix: "", text: "兩張都畫好了。", detail: null, status: "done",
  session_id: "pictures-7", source: "app", member_id: 0, conversation_id: 1, reactions: { "2": ["❤️"] },
  messages: [media(1, FIRST, "office.png", "image/png"), media(2, SECOND, "office-night.jpg", "image/jpeg"), media(3, REPORT, "report.pdf", "application/pdf"), { seq: 4, kind: "reply", at_ms: 4, text: "兩張都畫好了。" }],
});

let written: Record<string, Promise<Blob> | Blob>[] = [];
class FakeClipboardItem { constructor(readonly items: Record<string, Promise<Blob> | Blob>) { written.push(items); } }

beforeEach(() => {
  document.body.innerHTML = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [turn()] });
  api.agentAskText.mockResolvedValue({});
  api.core.mockImplementation(async (method: string, params: { id?: string }) => method === "attachments.get" && params.id === FIRST ? { mime: "image/png", data: PNG } : null);
  written = [];
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn(async () => {}), writeText: vi.fn(async () => {}) }, configurable: true });
});
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const open = async () => {
  const agent = createAgent({ go: vi.fn(), device: () => ({ dictation_mode: "hold" }), onEvent: (_handler: (event: MainEvent) => void) => () => {}, undo: { begin: vi.fn() }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(agent.el); agent.show(); await flush();
  return agent;
};
const acts = (message: Element): (string | undefined)[] => [...message.querySelectorAll<HTMLElement>(":scope > .message-actions > button")].map(button => button.dataset.act);

test("a picture the member sent stands as a message with the actions of a reply beside it", async () => {
  const agent = await open();
  const pictures = [...agent.el.querySelectorAll<HTMLElement>('.tn[data-id="7"] .chat-message[data-picture]')];
  expect(pictures.map(picture => picture.dataset.message)).toEqual(["1", "2"]);
  const reply = agent.el.querySelector<HTMLElement>('.tn[data-id="7"] .chat-message[data-reply]')!;
  // The same bare buttons, in the same order, as beside the reply's words: react, reply and ⋯.
  expect(acts(reply)).toEqual(["react-message", "reply-message", "more-message"]);
  for (const picture of pictures) {
    expect(acts(picture)).toEqual(acts(reply));
    // The very same markup, but for the message each button belongs to (its focus key) and the reply's Regenerate flag.
    const row = (message: Element): string => message.querySelector(":scope > .message-actions")!.innerHTML.replace(/data-regenerate="\w+"/, "").replace(/(data-focus="[\w-]+:turn:7:)\d+:/g, "$1");
    expect(row(picture)).toBe(row(reply));
    expect(picture.querySelector(":scope > .attachment-image .attachment-picture[data-act='attachment-image'] img[data-attachment]")).not.toBeNull();
  }
  // The owner's reaction to a picture stands on the picture's own frame, never on the side of its actions.
  expect(pictures[1]!.querySelector(":scope > .attachment-image > .message-reactions [data-reaction]")?.textContent).toBe("❤️");
  expect(pictures[0]!.querySelector(".message-reactions")).toBeNull();
  // A file that is not a picture stays as it was, with nothing beside it.
  const report = agent.el.querySelector<HTMLElement>('.tn[data-id="7"] .chat-message[data-message="3"]')!;
  expect(report.hasAttribute("data-picture")).toBe(false);
  expect(report.querySelector(".message-actions")).toBeNull();
  agent.hide();
});

test("replying to a picture quotes it in the composer as the picture, and the quote goes with the message", async () => {
  const agent = await open();
  agent.el.querySelector<HTMLElement>('.chat-message[data-message="1"] [data-act="reply-message"]')!.click(); await flush();
  const card = agent.el.querySelector<HTMLElement>(".cmp-quote")!;
  expect(card.hidden).toBe(false);
  expect(card.querySelector(".message-quote.has-picture .quote-thumb")?.getAttribute("data-attachment")).toBe(FIRST);
  expect(card.querySelector(".quote-text")!.textContent).toBe("圖片");
  expect(card.textContent).not.toContain("attachment:");
  const input = agent.el.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  input.value = "第一張的燈光再暖一點"; input.dispatchEvent(new Event("input", { bubbles: true }));
  agent.el.querySelector<HTMLFormElement>(".composer")!.requestSubmit(); await flush();
  expect(api.agentAskText).toHaveBeenCalledOnce();
  const quote = api.agentAskText.mock.calls[0]![3].quote;
  expect(quote.text).toBe(`[office.png](attachment:${FIRST})`);
  expect(quote.author).toBeTruthy();
  agent.hide();
});

test("a picture's ⋯ offers 複製圖片, which puts the picture itself on the clipboard as PNG", async () => {
  const agent = await open();
  agent.el.querySelector<HTMLElement>('.chat-message[data-message="1"] [data-act="more-message"]')!.click(); await flush();
  const items = [...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")];
  expect(items.map(item => [item.dataset.pick, item.textContent])).toEqual([["reply", "回覆"], ["copy", "複製圖片"]]);
  // Its reactions lead the menu, as a reply's do.
  expect(document.querySelector("#app-popover .menu-reactions")).not.toBeNull();
  items[1]!.click(); await flush();
  expect(api.core).toHaveBeenCalledWith("attachments.get", { id: FIRST });
  expect(navigator.clipboard.write).toHaveBeenCalledOnce();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(written).toHaveLength(1);
  expect(Object.keys(written[0]!)).toEqual(["image/png"]);
  const blob = await written[0]!["image/png"]!;
  expect(blob.type).toBe("image/png");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.from(atob(PNG), c => c.charCodeAt(0)));
  agent.hide();
});

test("a reaction to a picture names that picture's message", async () => {
  const agent = await open();
  agent.el.querySelector<HTMLElement>('.chat-message[data-message="2"] [data-act="react-message"]')!.click(); await flush();
  document.querySelector<HTMLElement>('.reaction-bar [data-quick="👍"]')!.click(); await flush();
  expect(api.core).toHaveBeenCalledWith("agent.react", { member_id: 0, conversation_id: 1, turn_id: 7, message_key: "2", emoji: "👍", active: true });
  agent.hide();
});
