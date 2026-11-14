// @vitest-environment happy-dom
// A picture a member sent in a group room stands as a message, with the actions of the room message it belongs to beside it
// (R-UI-156). The room pane runs for real, with the core and the clipboard faked.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AppContext, Member } from "./types";
const api = vi.hoisted(() => ({ membersList: vi.fn(), roomsCreate: vi.fn(), roomsList: vi.fn(), roomMessages: vi.fn(), roomSend: vi.fn(), roomsDelete: vi.fn(), roomsUpdate: vi.fn(), roomStop: vi.fn(), core: vi.fn(), pagesOpen: vi.fn(), ownerQuestionBring: vi.fn(), openTeamFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./api", () => api);
import { clearRoomSelection, configureRooms, createRoomPane } from "./group-chats";
import { setLocale } from "./i18n";

const ID = `${"b".repeat(32)}.png`, PNG = btoa("room picture bytes");
const room = { id: 1, name: "Launch", member_ids: [0, 1], group_id: null, created: 1, is_team: 0 };
const flush = async (): Promise<void> => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
let written: Record<string, Promise<Blob>>[] = [];

beforeEach(() => {
  localStorage.clear(); document.body.innerHTML = ""; vi.clearAllMocks(); setLocale("zh-TW");
  api.membersList.mockResolvedValue({ members: [0, 1].map(id => ({ id, name: id ? "小晴" : "Raphael", avatar: "" } as Member)), groups: [] });
  api.roomsList.mockResolvedValue({ rooms: [room] });
  api.roomsUpdate.mockResolvedValue({ room });
  api.roomMessages.mockResolvedValue({ messages: [{ id: 12, member_id: 1, text: "兩張都畫好了。", created: 1, status: "done", turn: { id: 40, messages: [
    { seq: 1, kind: "media", at_ms: 1, text: JSON.stringify({ attachment: { id: ID, name: "office.png", mime: "image/png" } }) },
    { seq: 2, kind: "reply", at_ms: 2, text: "兩張都畫好了。" }] } }] });
  api.core.mockImplementation(async (method: string, params: { id?: string }) => method === "attachments.get" && params.id === ID ? { mime: "image/png", data: PNG } : {});
  written = [];
  vi.stubGlobal("ClipboardItem", class { constructor(item: Record<string, Promise<Blob>>) { written.push(item); } });
  Object.defineProperty(navigator, "clipboard", { value: { write: vi.fn(async () => {}), writeText: vi.fn(async () => {}) }, configurable: true });
  const app = { go: vi.fn(), onEvent: () => () => {} } as unknown as AppContext;
  clearRoomSelection(); configureRooms(app);
});
afterEach(() => { vi.unstubAllGlobals(); });

const pane = async () => {
  const view = createRoomPane({ go: vi.fn(), onEvent: () => () => {} } as unknown as AppContext, vi.fn());
  document.body.append(view.el); await view.open(1); await flush();
  return view;
};

test("a member's picture in a room has its message's actions beside it, and its Copy copies the picture itself", async () => {
  const view = await pane();
  const picture = view.el.querySelector<HTMLElement>('[data-room-message="12"] .chat-message[data-picture]')!;
  expect(picture.querySelector(".attachment-picture img[data-attachment]")).not.toBeNull();
  const words = view.el.querySelector<HTMLElement>('[data-room-message="12"] .chat-message[data-room-part]')!;
  const acts = (message: Element) => [...message.querySelectorAll<HTMLElement>(":scope > .message-actions > button")].map(button => button.dataset.roomAct ?? button.dataset.act);
  expect(acts(words)).toEqual(["copy-message", "react-message", "thread", "reply"]);
  expect(acts(picture)).toEqual(["copy-picture", "react-message", "thread", "reply"]);
  picture.querySelector<HTMLElement>('[data-act="copy-picture"]')!.click(); await flush();
  expect(api.core).toHaveBeenCalledWith("attachments.get", { id: ID });
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(written).toHaveLength(1);
  expect(await (await written[0]!["image/png"]!).text()).toBe("room picture bytes");
  // Reply answers the room message the picture belongs to.
  picture.querySelector<HTMLElement>('[data-room-act="reply"]')!.click(); await flush();
  expect(view.el.querySelector<HTMLElement>(".cmp-quote")!.hidden).toBe(false);
  expect(view.el.querySelector(".cmp-quote")!.textContent).toContain("小晴");
  view.close();
});
