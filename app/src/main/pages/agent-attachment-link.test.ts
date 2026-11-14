// @vitest-environment happy-dom
// A reply's `[words](attachment:<id>)` link in the real page (happy-dom), with the app and the core faked (R-MSG-LINK-01).
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

const ID = "4e43d6d3fd9d47fab8b552f849c3c48b.md";
const OTHER = "0123456789abcdef0123456789abcdef.md";
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const turn = (): AgentTurn => ({
  id: 7, created_at_ms: Date.parse("2026-11-14T08:00:00+08:00"), question: "Notion 專案進度同步與排期", route: "routine", prefix: "", text: "", detail: null, status: "done",
  session_id: "routine-7", source: "routine", member_id: 0, conversation_id: 1,
  messages: [
    { seq: 1, kind: "media", at_ms: 1, text: JSON.stringify({ attachment: { id: ID, name: "2026-11-14-notion-sync-partial.md", mime: "text/markdown", size: 12_000 } }) },
    { seq: 2, kind: "reply", at_ms: 2, text: `同步未完成；[已查核的部分紀錄](attachment:${ID})、[別的對話的檔案](attachment:${OTHER})` },
  ],
});

beforeEach(() => {
  document.body.innerHTML = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [turn()] });
  api.core.mockResolvedValue(null);
  api.openAttachment.mockResolvedValue(undefined);
});
afterEach(() => { document.body.innerHTML = ""; });

test("the link is the file's chip, which opens that file once; a file of no turn is its words alone", async () => {
  const agent = createAgent({ go: vi.fn(), device: () => ({ dictation_mode: "hold" }), onEvent: (_handler: (event: MainEvent) => void) => () => {}, undo: { begin: vi.fn() }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(agent.el); agent.show(); await flush();
  const message = agent.el.querySelector<HTMLElement>('.tn[data-id="7"] [data-message="2"]')!;
  expect(message.textContent).not.toContain("attachment:");
  expect(message.textContent).toContain("別的對話的檔案");
  const chips = [...message.querySelectorAll<HTMLElement>("button[data-attachment-link]")];
  expect(chips.map(chip => [chip.dataset.id, chip.textContent])).toEqual([[ID, "已查核的部分紀錄"]]);
  chips[0]!.click(); await flush();
  expect(api.openAttachment).toHaveBeenCalledExactlyOnceWith(ID);
  agent.hide();
});
