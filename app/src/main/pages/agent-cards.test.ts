// @vitest-environment happy-dom
// The permission card and the email card in the 拉斐爾 page (happy-dom), with the app and the core faked: the question is
// answered once, by the card and not also by the gold card; an edit is saved as a version on the digest the card holds, and
// 傳送 sends the digest of the version that results, never an older one.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MailDraftCard, MainEvent, PermissionCard } from "../types";

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
  openLink: vi.fn(),
  openExternalUrl: vi.fn(),
  permissionAnswer: vi.fn(),
  settingsSet: vi.fn(),
  mailSave: vi.fn(),
  mailSend: vi.fn(),
  mailDiscard: vi.fn(),
  mailHandover: vi.fn(),
  core: vi.fn(),
}));
vi.mock("../api", () => api);

import { Cleared } from "../cleared";
import { createAgent } from "./agent";
import { setLocale } from "../i18n";

const AT = Date.parse("2026-10-20T10:00:00+08:00");

function turn(id: number, more: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id, created_at_ms: AT + id * 1000, question: `問題 ${id}`, route: "answer", prefix: "答", text: `回答 ${id}`, detail: null,
    status: "done", session_id: `type-${id}`, source: "app", member_id: 0, ...more,
  };
}

const permission = (more: Partial<PermissionCard> = {}): PermissionCard => ({
  id: "q1", source: "ask", kind: "tool", service: "Gmail", tool: "send_email", summary: "是否讓「Gmail」執行「send_email」？", reason: null,
  digest: "d".repeat(64), always: true, state: "pending", expires_at_ms: AT + 30_000, ...more,
});

const mail = (more: Partial<MailDraftCard> = {}): MailDraftCard => ({
  id: "dr1", mode: "card", state: "draft", version: 1, digest: "a".repeat(64), from: { key: "mcp:gmail/send_email", name: "Gmail" },
  senders: [{ key: "mcp:gmail/send_email", name: "Gmail" }, { key: "mcp:work/send", name: "Work mail" }], to: "mei@example.com", cc: "",
  subject: "週四會議", body: "您好，週四下午三點可以開會。", offer: null, error: null, holder_id: 0, author_name: "", ...more,
});

let send: (event: MainEvent) => void = () => {};

function mount() {
  const app = {
    go: vi.fn(),
    device: () => ({ dictation_mode: "hold" }),
    onEvent(handler: (event: MainEvent) => void) {
      send = handler;
      return () => {};
    },
    undo: { begin: vi.fn() },
    cleared: new Cleared(),
  } as unknown as AppContext;
  const agent = createAgent(app);
  document.body.append(agent.el);
  agent.show();
  return agent;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  setLocale("zh-TW");
  document.body.innerHTML = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentVoice.mockResolvedValue(undefined);
  api.agentQuestionAnswer.mockResolvedValue(undefined);
  api.core.mockResolvedValue(null);
});

const asked = { type: "AgentQuestion", id: "q1", prefix: "問", text: "是否讓「Gmail」執行「send_email」？", tier: "T2", timeout_ms: 30_000, yes: "允許一次", no: "拒絕", always: "一律允許" } as const;

test("approval titles name the known action and localized speaker, with an explanatory body", async () => {
  for (const [locale, heading, title] of [["zh-TW","建立成員","拉斐爾想要建立成員"],["en","Create member","Raphael wants to create a member"],["ja","メンバーを作成","ラファエルがメンバーを作成します"]] as const) {
    setLocale(locale); document.body.replaceChildren();
    api.agentHistoryList.mockResolvedValue({turns:[turn(1,{status:"confirm",text:""})]});
    const agent=mount(); await flush();
    send({...asked,text:`${heading}\nAlex: Reviewer`,always:undefined}); await flush();
    expect(document.querySelector(".ask-card .card-title")?.textContent).toBe(title);
    expect(document.querySelector(".ask-card .card-body.cc-state")?.textContent).not.toBe(heading);
    expect(document.querySelector(".ask-q")?.textContent).toContain("Alex: Reviewer");
    if (locale === "zh-TW") expect(document.querySelector(".ask-card")?.textContent).not.toContain("Raphael");
    agent.hide();
  }
  setLocale("zh-TW");
});

// (owner, 2026-11-11: 「有連續兩張卡片的時候…理論上是要一張卡片顯示出來就好，然後就可以一次把三個都刪掉」, and 「長按才會繼續，點一下就可以了」)
describe("the card of changes that cannot be undone", () => {
  const LINES = ["永久刪除成員及其所有資料：「工程師」", "永久刪除成員及其所有資料：「架構師」", "刪除群聊及全部訊息：「Raphael macOS 版規劃」"];
  const many = { ...asked, id: "many", tier: "T3" as const, yes: "是", no: "否", always: undefined,
    text: ["有 3 項變更需要你同意", ...LINES, "允許以上所有變更嗎？"].join("\n") };

  test("three changes are one card with a line each, open, and no JSON", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "" })] });
    mount();
    await flush();
    send(many);
    await flush();
    expect(document.querySelectorAll(".ask-card").length).toBe(1);
    expect(document.querySelector(".ask-card .card-body.cc-state")?.textContent).toBe("有 3 項變更需要你同意");
    const detail = document.querySelector<HTMLElement>(".ask-card .card-detail")!;
    expect(detail.hidden).toBe(false);
    expect(document.querySelector('.ask-card [data-card-disclosure]')?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".ask-q")!.textContent!.split("\n").slice(0, 3)).toEqual(LINES);
    expect(document.querySelector(".ask-card pre:not([hidden])")).toBeNull();
    expect(document.querySelector(".ask-card")!.textContent).not.toMatch(/[{}]|ID/);
  });

  test("one press of 是 answers all of them, once, and a second press does nothing", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "" })] });
    mount();
    await flush();
    send(many);
    await flush();
    const yes = document.querySelector<HTMLButtonElement>(".ask-card .ask-yes")!;
    // No hold: nothing fills under the word and no timer waits for the pointer to stay down.
    expect(yes.dataset.hold).toBeUndefined();
    expect(yes.querySelector(".ask-fill")).toBeNull();
    yes.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenCalledExactlyOnceWith("many", true);
    expect(yes.disabled).toBe(true);
    yes.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenCalledTimes(1);
  });

  test("a change of one line keeps its one line: the heading, then its target by name, with no JSON", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "" })] });
    mount();
    await flush();
    send({ ...many, id: "one", text: "刪除群聊及全部訊息\n「Raphael macOS 版規劃」\n允許這項變更嗎？" });
    await flush();
    expect(document.querySelector(".ask-card .card-body.cc-state")?.textContent).toBe("刪除群聊及全部訊息");
    expect(document.querySelector(".ask-q")!.textContent!.split("\n")[0]).toBe("「Raphael macOS 版規劃」");
    expect(document.querySelector(".ask-card pre:not([hidden])")).toBeNull();
  });

  test("a question that can be undone keeps its detail folded", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "" })] });
    mount();
    await flush();
    send({ ...many, id: "plain", tier: "T2" as const });
    await flush();
    expect(document.querySelector<HTMLElement>(".ask-card .card-detail")!.hidden).toBe(true);
  });
});

describe("the permission card in the page", () => {
  test("the question is answered by the card, and the gold card stays away", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "", permissions: [permission()] })] });
    const agent = mount();
    await flush();
    send(asked);
    await flush();
    expect(document.querySelector('[data-permission-card="q1"]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".ask-card-host")!.hidden).toBe(true);
    const once = document.querySelector<HTMLButtonElement>('[data-act="perm-once"]')!;
    expect(once.disabled).toBe(false);
    once.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", true);
    agent.hide();
  });

  test("拒絕 says no, and 一律允許 says yes with always", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "", permissions: [permission()] })] });
    mount();
    await flush();
    send(asked);
    await flush();
    document.querySelector<HTMLButtonElement>('[data-act="perm-deny"]')!.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenLastCalledWith("q1", false);
    // The first answer is on its way: no second answer goes while it is.
    document.querySelector<HTMLButtonElement>('[data-act="perm-once"]')?.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenCalledTimes(1);
  });

  test("a question without a card keeps the gold card, and a card without its question can not be pressed", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "" })] });
    mount();
    await flush();
    send({ ...asked, id: "plain", yes: undefined, no: undefined, always: undefined });
    await flush();
    expect(document.querySelector<HTMLElement>(".ask-card-host")!.hidden).toBe(false);
    document.body.innerHTML = "";
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "", permissions: [permission()] })] });
    mount();
    await flush();
    expect(document.querySelector<HTMLButtonElement>('[data-act="perm-once"]')!.disabled).toBe(true);
  });

  test("the always answer is only sent where the card offers it", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "", permissions: [permission()] })] });
    mount();
    await flush();
    send(asked);
    await flush();
    document.querySelector<HTMLButtonElement>('[data-act="perm-always"]')!.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", true, true);
  });

  test("a card of a task that went on after the computer was given back answers through its own door, with its digest", async () => {
    api.permissionAnswer.mockResolvedValue({ card: permission({ source: "run", state: "allowed" }), answered: true });
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "", permissions: [permission({ id: "r1", source: "run", kind: "step", service: "", tool: "", always: false })] })] });
    mount();
    await flush();
    const once = document.querySelector<HTMLButtonElement>('[data-act="perm-once"]')!;
    expect(once.disabled).toBe(false); // no question is held for it
    once.click();
    await flush();
    expect(api.permissionAnswer).toHaveBeenCalledExactlyOnceWith("allow", "r1", "d".repeat(64));
    expect(api.agentQuestionAnswer).not.toHaveBeenCalled();
  });
});

test("Never on a local consent card saves the shared setting before declining once", async () => {
  api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { status: "confirm", text: "", permissions: [permission({ kind: "local_access", service: "Alex", tool: "local_exec", summary: "Get-Process" })] })] });
  api.settingsSet.mockResolvedValue({ settings: { local_commands_mode: "never" } });
  mount();
  await flush();
  send(asked);
  await flush();
  document.querySelector<HTMLButtonElement>('[data-act="perm-never"]')!.click();
  await flush();
  expect(api.settingsSet).toHaveBeenCalledExactlyOnceWith("local_commands_mode", "never");
  expect(api.agentQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", false);
  expect(api.settingsSet.mock.invocationCallOrder[0]).toBeLessThan(api.agentQuestionAnswer.mock.invocationCallOrder[0]);
});

describe("the email card in the page", () => {
  const drafted = (more: Partial<MailDraftCard> = {}): AgentTurn => turn(1, { drafts: [mail(more)] });
  const field = (name: string): HTMLInputElement | HTMLTextAreaElement => document.querySelector(`[data-mail-field="${name}"]`)!;
  const type = (name: string, value: string): void => {
    field(name).value = value;
    field(name).dispatchEvent(new Event("change", { bubbles: true }));
  };

  test("an edit is saved as a new version on the digest the card holds, with every field as the owner sees it", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted({ cc: "reviewer@example.com" })] });
    api.mailSave.mockResolvedValue({ draft: mail({ version: 2, digest: "b".repeat(64), cc: "boss@example.com" }), saved: true });
    mount();
    await flush();
    type("cc", "boss@example.com");
    await flush();
    expect(api.mailSave).toHaveBeenCalledExactlyOnceWith("dr1", "a".repeat(64), {
      to: "mei@example.com", cc: "boss@example.com", subject: "週四會議", body: "您好，週四下午三點可以開會。", via: "mcp:gmail/send_email" });
  });

  test("saves one after the other, each on the digest the one before came back with", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted({ cc: "reviewer@example.com" })] });
    api.mailSave
      .mockResolvedValueOnce({ draft: mail({ version: 2, digest: "b".repeat(64) }), saved: true })
      .mockResolvedValueOnce({ draft: mail({ version: 3, digest: "c".repeat(64) }), saved: true });
    mount();
    await flush();
    type("subject", "週四會議（改）");
    type("cc", "boss@example.com");
    await flush();
    expect(api.mailSave.mock.calls.map((call) => call[1])).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(api.mailSave.mock.calls[1][2]).toMatchObject({ subject: "週四會議（改）", cc: "boss@example.com" });
  });

  test("傳送 first saves what is typed and sends the digest of the version that results, once", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted()] });
    api.mailSave.mockResolvedValue({ draft: mail({ version: 2, digest: "b".repeat(64) }), saved: true });
    api.mailSend.mockResolvedValue({ draft: mail({ state: "sent" }), sent: true });
    mount();
    await flush();
    field("subject").value = "週四會議（改）"; // typed, not yet left: no change event has come
    document.querySelector<HTMLButtonElement>('[data-act="mail-send"]')!.click();
    await flush();
    expect(api.mailSave).toHaveBeenCalledExactlyOnceWith("dr1", "a".repeat(64), expect.objectContaining({ subject: "週四會議（改）" }));
    expect(api.mailSend).toHaveBeenCalledExactlyOnceWith("dr1", "b".repeat(64));
    expect(api.mailSave.mock.invocationCallOrder[0]).toBeLessThan(api.mailSend.mock.invocationCallOrder[0]);
  });

  test("editing failed mail sends the new saved revision without replaying the failed attempt", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted({state:"failed",error:"interrupted"})] });
    api.mailSave.mockResolvedValue({draft:mail({version:2,digest:"b".repeat(64),subject:"Updated project note"}),saved:true});
    api.mailSend.mockResolvedValue({draft:mail({state:"sent"}),sent:true});
    mount(); await flush(); field("subject").value="Updated project note";
    document.querySelector<HTMLButtonElement>('[data-act="mail-send"]')!.click(); await flush();
    expect(api.mailSend).toHaveBeenCalledExactlyOnceWith("dr1","b".repeat(64));
  });

  test("an untouched card sends the digest it holds without saving", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted()] });
    api.mailSend.mockResolvedValue({ draft: mail({ state: "sent" }), sent: true });
    mount();
    await flush();
    document.querySelector<HTMLButtonElement>('[data-act="mail-send"]')!.click();
    await flush();
    expect(api.mailSave).not.toHaveBeenCalled();
    expect(api.mailSend).toHaveBeenCalledExactlyOnceWith("dr1", "a".repeat(64));
  });

  test("a draft that moved on under the card is not sent: the owner looks it over first", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted()] });
    // The member revised it meanwhile: the core refuses the edit on the old digest and answers with the current draft.
    api.mailSave.mockResolvedValue({ draft: mail({ version: 2, digest: "e".repeat(64), subject: "新的主旨" }), saved: false });
    mount();
    await flush();
    field("body").value = "我改了內文。";
    document.querySelector<HTMLButtonElement>('[data-act="mail-send"]')!.click();
    await flush();
    expect(api.mailSave).toHaveBeenCalledTimes(1);
    expect(api.mailSend).not.toHaveBeenCalled();
    expect(document.querySelector(".toast")?.textContent ?? "").toContain("草稿剛被更新");
  });

  test("捨棄 discards and sends nothing; the answer to the choice card hands over and sends nothing", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted({ offer: { member_id: 2, name: "焦媽媽" } })] });
    api.mailDiscard.mockResolvedValue({ draft: mail({ state: "discarded" }), discarded: true });
    api.mailHandover.mockResolvedValue({ draft: mail(), handed: true });
    mount();
    await flush();
    document.querySelector<HTMLButtonElement>('[data-act="mail-handover-yes"]')!.click();
    await flush();
    expect(api.mailHandover).toHaveBeenCalledExactlyOnceWith("dr1", "yes");
    document.querySelector<HTMLButtonElement>('[data-act="mail-discard"]')!.click();
    await flush();
    expect(api.mailDiscard).toHaveBeenCalledExactlyOnceWith("dr1");
    expect(api.mailSend).not.toHaveBeenCalled();
    expect(api.mailSave).not.toHaveBeenCalled();
  });

  test("the sender is chosen from a dropdown and saved as a new version", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted()] });
    api.mailSave.mockResolvedValue({ draft: mail({ version: 2, digest: "b".repeat(64), from: { key: "mcp:work/send", name: "Work mail" } }), saved: true });
    mount();
    await flush();
    document.querySelector<HTMLButtonElement>('[data-act="mail-from"]')!.click();
    await flush();
    const pick = document.querySelector<HTMLButtonElement>('#app-popover [data-value="mcp:work/send"]');
    expect(pick).not.toBeNull();
    pick!.click();
    await flush();
    expect(api.mailSave).toHaveBeenCalledExactlyOnceWith("dr1", "a".repeat(64), expect.objectContaining({ via: "mcp:work/send" }));
  });

  test("a card drawn again after an unrelated change keeps what the owner was typing", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [drafted()] });
    mount();
    await flush();
    field("body").value = "還沒存的內文";
    // Another turn arrives: the list is loaded again with a changed card (a colleague's offer came in).
    api.agentHistoryList.mockResolvedValue({ turns: [drafted({ offer: { member_id: 2, name: "焦媽媽" } })] });
    send({ type: "AgentTurn", turn_id: 1, member_id: 0 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flush();
    expect(document.querySelector('[data-mail-offer="dr1"]')).not.toBeNull();
    expect(field("body").value).toBe("還沒存的內文");
  });
});
