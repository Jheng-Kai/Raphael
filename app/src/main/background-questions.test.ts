// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";

const api = vi.hoisted(() => ({ core: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("./ui", async (original) => ({ ...(await original<typeof import("./ui")>()), toaster: { info: vi.fn() } }));

import { type BackgroundQuestion, backgroundQuestionHTML, createBackgroundQuestions } from "./background-questions";
import { toaster } from "./ui";

afterEach(() => setLocale("zh-TW"));

test("a background local command uses the shared card and submits its digest and global choice", async () => {
  const question: BackgroundQuestion = { ...QUESTION, permission: { id: "q-1", source: "background", kind: "local_access", service: "Alex", tool: "local_exec", summary: "Get-Process", reason: null, digest: "local-digest", always: true, state: "pending", expires_at_ms: 0 } };
  api.core.mockImplementation(async (method: string) => method === "background.questions.list" ? { questions: [question] } : { status: "approved" });
  const questions = createBackgroundQuestions({ memberId: () => 0 });
  document.body.append(questions.element);
  await questions.load();
  expect(questions.element.querySelector(".permission-card")).not.toBeNull();
  questions.element.querySelector<HTMLButtonElement>('[data-act="perm-always"]')!.click();
  await Promise.resolve();
  expect(api.core).toHaveBeenCalledWith("background.answer", { task_id: 7, question_id: "q-1", approved: true, digest: "local-digest", always: true, never: false });
});

const QUESTION: BackgroundQuestion = {
  id: "q-1",
  task_id: 7,
  member_id: 0,
  prefix: "問",
  text: "是否讓「Notes」執行「note」（買牛奶）？",
  tier: "T2",
  created_at_ms: 1,
  expires_at_ms: 86_400_001,
};
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the card of a question of the background", () => {
  test("it is Raphael's face and plain question, then 否 outlined and 是 gold, both real buttons", () => {
    const html = backgroundQuestionHTML(QUESTION);
    expect(html).toContain('class="conversation-card connector-card bgq-card"');
    expect(html).toContain('data-bgq-card="q-1"');
    expect(visible(html)).toBe("需要你的允許 需要你允許 是否讓「Notes」執行「note」（買牛奶）？ 允許一次 拒絕");
    expect(html).toContain('<button type="button" class="btn sm bgq-no" data-bgq="no" data-task="7" data-id="q-1">拒絕</button>');
    expect(html).toContain('<button type="button" class="btn sm pri bgq-yes" data-bgq="yes" data-task="7" data-id="q-1">允許一次</button>');
    expect(html).not.toContain("/brand/app-emblem-light-64.webp");
  });

  test("in a member's thread it is that member's: their face and name, plain words, no 《》 and no emblem", () => {
    const face = '<span class="av mb-av mb-av-letter bgq-face" aria-hidden="true">小</span>';
    const html = backgroundQuestionHTML({ ...QUESTION, member_id: 3, prefix: "問" }, false, { face, name: "小幫手" });
    expect(visible(html)).toBe("小幫手 想要執行動作 需要你允許 是否讓「Notes」執行「note」（買牛奶）？ 允許一次 拒絕");
    expect(html).not.toContain("《");
    expect(html).not.toContain("/brand/");
    expect(html).toContain("小幫手 想要執行動作");
    expect(html).not.toContain("bgq-face");
    expect(html).toContain('data-bgq="yes" data-task="7" data-id="q-1"');
  });

  test("Raphael's own card has no name and keeps the emblem, bare", () => {
    const html = backgroundQuestionHTML(QUESTION);
    expect(html).not.toContain("bgq-name");
    expect(html).not.toContain("《");
  });

  test("its words are escaped, and its buttons are off while it is answered", () => {
    const html = backgroundQuestionHTML({ ...QUESTION, text: "<b>x</b>" }, true);
    expect(html).not.toContain("<b>x</b>");
    expect(html.match(/ disabled>/g)).toHaveLength(2);
  });

  test("one language at a time", () => {
    setLocale("en");
    expect(visible(backgroundQuestionHTML({ ...QUESTION, prefix: "Question", text: "Allow Notes to run note?" }))).toBe(
      "Needs your permission Approval needed Allow Notes to run note? Allow once Deny",
    );
  });
});

describe("the cards of a thread", () => {
  let changed = 0;
  let listed: BackgroundQuestion[] = [];
  let answered: string = "approved";

  beforeEach(() => {
    changed = 0;
    listed = [QUESTION];
    answered = "approved";
    vi.clearAllMocks();
    api.core.mockImplementation(async (method: string) => {
      if (method === "background.questions.list") return { questions: structuredClone(listed) };
      if (method === "background.answer") {
        listed = [];
        return { status: answered };
      }
      return {};
    });
  });

  const make = (member = 0) => createBackgroundQuestions({ memberId: () => member, changed: () => void changed++ });

  test("they show the questions that wait in this member's thread, and nothing when none does", async () => {
    const cards = make(3);
    expect(cards.element.hidden).toBe(true);
    await cards.load();
    expect(api.core).toHaveBeenCalledWith("background.questions.list", { member_id: 3 });
    expect(cards.element.hidden).toBe(false);
    expect(cards.element.querySelectorAll(".bgq-card")).toHaveLength(1);
    expect(changed).toBe(1);
    listed = [];
    await cards.load();
    expect(cards.element.hidden).toBe(true);
    expect(changed).toBe(2);
  });

  test("a card that did not change is not drawn again", async () => {
    const cards = make();
    await cards.load();
    const first = cards.element.firstElementChild;
    await cards.load();
    expect(cards.element.firstElementChild).toBe(first);
    expect(changed).toBe(1);
  });

  test("是 answers yes from the app, and the card goes", async () => {
    const cards = make();
    await cards.load();
    cards.element.querySelector<HTMLButtonElement>(".bgq-yes")!.click();
    await vi.waitFor(() => expect(cards.element.hidden).toBe(true));
    expect(api.core).toHaveBeenCalledWith("background.answer", { task_id: 7, question_id: "q-1", approved: true });
    expect(toaster.info).not.toHaveBeenCalled();
  });

  test("否 answers no", async () => {
    answered = "denied";
    const cards = make();
    await cards.load();
    cards.element.querySelector<HTMLButtonElement>(".bgq-no")!.click();
    await vi.waitFor(() => expect(api.core).toHaveBeenCalledWith("background.answer", { task_id: 7, question_id: "q-1", approved: false }));
    expect(toaster.info).not.toHaveBeenCalled();
  });

  test("a question that ended meanwhile says so", async () => {
    answered = "expired";
    const cards = make();
    await cards.load();
    cards.element.querySelector<HTMLButtonElement>(".bgq-yes")!.click();
    await vi.waitFor(() => expect(toaster.info).toHaveBeenCalledWith("這個問題已經結束"));
  });

  test("a background task that moved on has them read again", async () => {
    vi.useFakeTimers();
    try {
      const cards = make();
      cards.follow({ type: "WorkerChanged", task_id: 7, state: "waiting", running: false });
      cards.follow({ type: "WorkerChanged", task_id: 7, state: "waiting", running: false });
      cards.follow({ type: "AgentTurn", turn_id: 3 });
      await vi.advanceTimersByTimeAsync(200);
      expect(api.core.mock.calls.filter(([m]) => m === "background.questions.list")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
