// @vitest-environment happy-dom
// The 拉斐爾 page as a whole, in a page of its own (happy-dom), with the app and the core faked: what
// it asks the app when keys and events come, and what it shows.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MainEvent } from "../types";

const api = vi.hoisted(() => ({
  agentHistoryList: vi.fn(),
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
  core: vi.fn(),
}));
vi.mock("../api", () => api);

import { Cleared } from "../cleared";
import { createAgent } from "./agent";
import { getLocale, setLocale } from "../i18n";
import * as ui from "../ui";

function turn(id: number, more: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id,
    created_at_ms: Date.parse("2026-10-20T10:00:00+08:00") + id * 1000,
    question: `問題 ${id}`,
    route: "chat",
    prefix: "答",
    text: `回答 ${id}`,
    detail: null,
    status: "done",
    session_id: `press-${id}`,
    source: "voice",
    ...more,
  };
}

/** `count` turns, newest first, the newest with id `top`. */
const page = (top: number, count: number): AgentTurn[] => Array.from({ length: count }, (_, i) => turn(top - i));

/** A promise and the hands that settle it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

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
  agent.el.hidden = false;
  agent.show();
  return agent;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  document.body.innerHTML = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.core.mockResolvedValue(null);
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentVoice.mockResolvedValue(undefined);
});

test("the header computer button updates its accessible label and title when the locale changes", async () => {
  const previous = getLocale();
  setLocale("zh-TW");
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  const agent = mount();
  try {
    await flush();
    const button = agent.el.querySelector<HTMLButtonElement>('.mb-head [data-act="computer"]')!;
    for (const [locale, label] of [["zh-TW", "電腦"], ["en", "Computer"], ["ja", "コンピューター"], ["zh-TW", "電腦"]] as const) {
      setLocale(locale);
      expect(button.getAttribute("aria-label"), locale).toBe(label);
      expect(button.title, locale).toBe(label);
    }
  } finally {
    agent.hide();
    setLocale(previous);
  }
});

test("message links and preview cards use the safe opener with the full target; only replies get previews", async () => {
  const url = "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_WARN.html?lang=zh-TW&full=1";
  api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { question: `看 ${url}（颱風）`, messages: [
    { seq: 1, kind: "progress", text: `檢查 ${url}。`, at_ms: 1 },
    { seq: 2, kind: "reply", text: `《答。${url}（颱風警報）》`, at_ms: 2 },
  ] })] });
  api.core.mockResolvedValue(null); api.openExternalUrl.mockResolvedValue(undefined);
  const agent = mount(); await flush();
  expect(document.querySelectorAll(".message-link")).toHaveLength(3);
  expect(document.querySelectorAll(".preview-card")).toHaveLength(1);
  document.querySelector<HTMLAnchorElement>(".bubble a")!.click();
  expect(api.openExternalUrl).toHaveBeenLastCalledWith(url);
  document.querySelector<HTMLButtonElement>(".preview-card")!.click();
  expect(api.openExternalUrl).toHaveBeenLastCalledWith(url);
  const middle = new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true });
  document.querySelector(".bubble a")!.dispatchEvent(middle);
  expect(middle.defaultPrevented).toBe(true);
  expect(api.openExternalUrl).toHaveBeenCalledTimes(3);
  expect(api.openExternalUrl).toHaveBeenLastCalledWith(url);
  agent.hide();
});

test("each reply control reflects the shared work detail expansion", async () => {
  api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { messages: [
    { seq: 1, kind: "progress", text: "Checking the sample.", at_ms: 1 },
    { seq: 2, kind: "reply", text: "First sample reply.", at_ms: 2 },
    { seq: 3, kind: "reply", text: "Second sample reply.", at_ms: 3 },
  ] })] });
  const agent = mount(); await flush();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.tn[data-id="1"] .message-work')];
  expect(buttons).toHaveLength(2);
  buttons[0].click();
  expect(document.querySelector<HTMLElement>('.tn[data-id="1"] .think-body')!.hidden).toBe(false);
  expect(buttons.map(button => button.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
  buttons[1].click();
  expect(document.querySelector<HTMLElement>('.tn[data-id="1"] .think-body')!.hidden).toBe(true);
  expect(buttons.map(button => button.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
  agent.hide();
});

test("messages copy plain text, code copies exactly, only the latest reply regenerates, and long replies stay full", async () => {
  const body = "**bold**\n\n```js\na < b\n```\n" + Array.from({ length: 35 }, (_, i) => `line ${i}`).join("\n");
  api.agentHistoryList.mockResolvedValue({ turns: [turn(2, { text: body }), turn(1)] });
  api.agentAskText.mockResolvedValue(undefined);
  const copy = vi.spyOn(ui, "copyButton").mockResolvedValue(true);
  const agent = mount(); await flush();
  const latest = document.querySelector<HTMLElement>('.tn[data-id="2"]')!;
  document.querySelector<HTMLButtonElement>('.tn[data-id="1"] [data-act="more-message"]')!.click();
  await flush(); expect(document.querySelector('[data-pick="regenerate"]')).toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  latest.querySelector<HTMLButtonElement>('.owner-message [data-act="copy-message"]')!.click();
  await flush(); expect(copy).toHaveBeenLastCalledWith(expect.any(HTMLElement), "問題 2");
  latest.querySelector<HTMLButtonElement>('.ra [data-act="copy-message"]')!.click();
  await flush(); expect(copy.mock.lastCall?.[1]).toContain("bold\na < b\n");
  expect(copy.mock.lastCall?.[1]).not.toContain("**");
  latest.querySelector<HTMLButtonElement>('[data-act="copy-code"]')!.click();
  await flush(); expect(copy).toHaveBeenLastCalledWith(expect.any(HTMLElement), "a < b");
  expect(latest.querySelector('.ra [data-act="expand-message"]')).toBeNull();
  expect([...latest.querySelectorAll('.ra .message-text')].map(node => node.textContent).join("\n")).toContain("line 34");
  expect(latest.querySelector('.ans .message-code')).toBeNull();
  latest.querySelector<HTMLButtonElement>('[data-act="more-message"]')!.click();
  await flush(); document.querySelector<HTMLButtonElement>('[data-pick="regenerate"]')!.click();
  await flush(); expect(api.agentAskText).toHaveBeenCalledExactlyOnceWith("問題 2", [], 0, expect.objectContaining({ requestId: expect.any(String) }));
  copy.mockRestore(); agent.hide();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the voice button held down with a key", () => {
  test("letting the key go ends the recording even when the focus has left the button meanwhile", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [] });
    mount();
    await flush();
    const button = document.querySelector<HTMLButtonElement>(".cmp-voice")!;
    button.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(api.agentVoice).toHaveBeenCalledWith("down");
    // the picture went up and the button lost the focus: the release comes to the page itself
    button.blur();
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    expect(api.agentVoice.mock.calls).toEqual([["down"], ["up"]]);
    // another key's release, or a second one, sends nothing more
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    expect(api.agentVoice).toHaveBeenCalledTimes(2);
  });

  test("a release on the button itself is sent once", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: [] });
    mount();
    await flush();
    const button = document.querySelector<HTMLButtonElement>(".cmp-voice")!;
    button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    expect(api.agentVoice.mock.calls).toEqual([["down"], ["up"]]);
  });
});

describe("loading the earlier turns", () => {
  test("an earlier page that fails after a newer refresh began does not keep paging up blocked", async () => {
    vi.useFakeTimers();
    const earlier = deferred<{ turns: AgentTurn[] }>();
    const newest = deferred<{ turns: AgentTurn[] }>();
    api.agentHistoryList
      .mockResolvedValueOnce({ turns: page(200, 50) })
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(newest.promise)
      .mockResolvedValue({ turns: page(150, 50) });
    mount();
    await flush();
    expect(shownIds()).toHaveLength(25);
    await scrollEarlier(); // Expand the already loaded window before asking the core for more.
    expect(shownIds()).toHaveLength(45);
    await scrollEarlier();
    expect(api.agentHistoryList).toHaveBeenCalledTimes(2);
    expect(api.agentHistoryList.mock.calls[1][0]).toEqual({ limit: 50, before_id: 151 });
    // a turn is written: the newest turns are brought again while the earlier ones are on their way
    send({ type: "AgentTurn", turn_id: 201 });
    await vi.advanceTimersByTimeAsync(200);
    expect(api.agentHistoryList).toHaveBeenCalledTimes(3);
    earlier.reject(new Error("the core went away"));
    await flush();
    newest.resolve({ turns: page(201, 50) });
    await flush();
    // the page can page up again: the earlier ones are asked once more
    await scrollEarlier();
    expect(api.agentHistoryList.mock.calls.some((call, i) => i > 2 && call[0]?.before_id !== undefined)).toBe(true);
  });
});

/** The ids of the turns the thread shows, oldest first. */
const shownIds = (): number[] => [...document.querySelectorAll<HTMLElement>(".tn[data-id]")].map((line) => Number(line.dataset.id));

/** The reader asks for earlier turns through the window's real wheel/animation-frame path. */
async function scrollEarlier(): Promise<void> {
  const scroller = document.querySelector<HTMLElement>(".ra-scroll")!;
  vi.advanceTimersToNextFrame(); // Settle the initial follow-to-bottom frame before the reader scrolls.
  scroller.scrollTop = 0;
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
  vi.advanceTimersToNextFrame();
  await flush();
}

describe("coming back to the page", () => {
  test("turns written while it was away are paged back to without leaving a gap", async () => {
    vi.useFakeTimers();
    // A history of `size` turns, ids 1..size, answered a page at a time as the core does.
    let size = 50;
    api.agentHistoryList.mockImplementation(async (q: { limit: number; before_id?: number }) => {
      const top = Math.min(size, (q.before_id ?? Infinity) - 1);
      return { turns: page(top, Math.max(0, Math.min(q.limit, top))) };
    });
    const agent = mount();
    for (let i = 0; i < 5; i++) await flush();
    expect(shownIds()).toEqual(Array.from({ length: 25 }, (_, i) => i + 26));
    expect(document.querySelector<HTMLElement>(".ra-scroll")!.dataset.windowTotal).toBe("50");
    agent.hide();
    size = 150; // a hundred turns while the page was not shown
    agent.show();
    for (let i = 0; i < 10; i++) await flush();
    expect(shownIds()).toEqual(Array.from({ length: 25 }, (_, i) => i + 126));
    const seen = new Set(shownIds());
    for (let i = 0; i < 8; i++) {
      await scrollEarlier();
      const ids = shownIds();
      expect(ids.length).toBeLessThanOrEqual(100);
      expect(ids).toEqual(Array.from({ length: ids.length }, (_, at) => ids[0] + at));
      ids.forEach(id => seen.add(id));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(api.agentHistoryList).toHaveBeenCalledWith({ limit: 50, before_id: 101 });
    expect(api.agentHistoryList).toHaveBeenCalledWith({ limit: 50, before_id: 51 });
  }, 20_000); // Renders and pages through 150 turns eight times; a loaded machine needs more than the default 5 s.
});

describe("the search", () => {
  test("the owner can navigate occurrences with a position and total", async () => {
    vi.useFakeTimers();
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { question: "needle and needle", text: "needle" })] });
    mount(); await flush();
    document.querySelector<HTMLElement>('[data-act="search"]')!.click();
    const field = document.querySelector<HTMLInputElement>(".ra-find-input")!;
    field.value = "needle"; field.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(250);
    expect(document.querySelector('.ra-find-count')?.textContent).toBe('3/3');
    field.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));
    expect(document.querySelector('.ra-find-count')?.textContent).toBe('1/3');
  });
  test("search loads older pages and keeps their words in the complete conversation", async () => {
    vi.useFakeTimers();
    const newest = (count: number) => [turn(250, { question: "needle" }), ...page(249, count - 1)];
    api.agentHistoryList.mockImplementation(async (params: {limit:number;before_id?:number}) => params.limit===200 ? {turns:params.before_id ? [turn(3,{question:"needle"})] : newest(200)} : {turns:params.before_id ? [] : newest(50)});
    mount(); await flush();
    document.querySelector<HTMLElement>('[data-act="search"]')!.click();
    const field=document.querySelector<HTMLInputElement>('.ra-find-input')!;
    field.value='needle';field.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
    expect(api.agentHistoryList).toHaveBeenCalledWith(expect.objectContaining({before_id:51,limit:200}));
    expect(document.querySelector('.ra-find-count')?.textContent).toBe('2/2');
    document.querySelector<HTMLButtonElement>('[data-find="previous"]')!.click();
    expect(document.querySelector('.tn[data-id="3"] mark.is-current')?.textContent).toBe('needle');
    expect(shownIds()).toHaveLength(25);
    expect(document.querySelector<HTMLElement>(".ra-scroll")!.dataset.windowTotal).toBe("201");
    expect(document.querySelector('.tn[data-id="250"]')).toBeNull();
    expect(document.querySelector('.ra-find-count')?.textContent).toBe('1/2');
    document.querySelector<HTMLButtonElement>('[data-find="next"]')!.click();
    expect(document.querySelector('.tn[data-id="250"] mark.is-current')?.textContent).toBe('needle');
    expect(shownIds()).toHaveLength(25);
    expect(document.querySelector('.ra-find-count')?.textContent).toBe('2/2');
  });

});

describe("a question said aloud", () => {
  test("its 「正在辨識」 line goes after the longest wait even when nothing more comes from the core", async () => {
    vi.useFakeTimers();
    api.agentHistoryList.mockResolvedValue({ turns: page(10, 3) });
    mount();
    await flush();
    send({ type: "Dictation", phase: "processing", agent: true });
    expect(document.querySelector('[data-key="hearing"]')).not.toBeNull();
    // the core crashed: no turn, no last phase, no refresh
    await vi.advanceTimersByTimeAsync(120_000 + 10);
    expect(document.querySelector('[data-key="hearing"]')).toBeNull();
  });
});

describe("a question of the background", () => {
  test("its gold card is in the slot above the composer, and is answered from here", async () => {
    api.agentHistoryList.mockResolvedValue({ turns: page(10, 2) });
    const question = { id: "q-1", task_id: 4, member_id: 0, prefix: "問", text: "是否讓「Notes」執行「note」？", tier: "T2", created_at_ms: 1, expires_at_ms: 2 };
    let waiting = [question];
    api.core.mockImplementation(async (method: string) => {
      if (method === "background.questions.list") return { questions: waiting };
      if (method === "background.answer") {
        waiting = [];
        return { status: "approved" };
      }
      return {};
    });
    mount();
    await flush();
    expect(api.core).toHaveBeenCalledWith("background.questions.list", { member_id: 0 });
    const card = document.querySelector<HTMLElement>('[data-mount="background-questions"] .bgq-card')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("是否讓「Notes」執行「note」？");
    expect(card.textContent).not.toContain("《");
    card.querySelector<HTMLButtonElement>(".bgq-yes")!.click();
    await flush();
    expect(api.core).toHaveBeenCalledWith("background.answer", { task_id: 4, question_id: "q-1", approved: true });
    expect(document.querySelector<HTMLElement>(".bgq-list")!.hidden).toBe(true);
  });
});

describe("a continuous typed turn", () => {
  test("new progress updates the live avatar hover and the final reply removes it", async () => {
    vi.useFakeTimers();
    let live = turn(1, { source: "app", status: "running", text: "", messages: [] });
    api.agentHistoryList.mockImplementation(async () => ({ turns: [live] }));
    mount();
    await flush();
    expect(document.querySelectorAll('.tn[data-id="1"] .live-presence')).toHaveLength(1);
    live = { ...live, messages: [{ seq: 1, kind: "progress", text: "《告。先確認今天的日期。》", at_ms: 1 }] };
    send({ type: "AgentTurn", turn_id: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector<HTMLElement>('.tn[data-id="1"] .live-presence')?.dataset.tooltip).toBe("先確認今天的日期。");
    expect(document.querySelector('.tn[data-id="1"] .work-latest, .tn[data-id="1"] .think')).toBeNull();
    live = { ...live, status: "done", text: "今天星期五。", messages: [...live.messages!, { seq: 2, kind: "reply", text: "《答。今天星期五。》", at_ms: 2 }] };
    send({ type: "AgentTurn", turn_id: 1 });
    // The trailing refresh also respects the shared event reader's 300ms window.
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelectorAll('.tn[data-id="1"] .ans')).toHaveLength(1);
    expect(document.querySelector('.tn[data-id="1"] .work-body')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.tn[data-id="1"] .think')).toBeNull();
  });

  test("the permission card stays inline after another history refresh and remains answerable", async () => {
    vi.useFakeTimers();
    api.agentHistoryList.mockResolvedValue({ turns: [turn(1, { source: "app", status: "confirm", messages: [{ seq: 1, kind: "progress", text: "《告。先存下你的範例。》", at_ms: 1 }] })] });
    api.agentQuestionAnswer.mockResolvedValue(undefined);
    mount();
    await flush();
    send({ type: "AgentQuestion", id: "inline-q", prefix: "問", text: "儲存嗎？", tier: "T2", timeout_ms: 30000 });
    const card = document.querySelector('.turn-question .ask-card');
    expect(card).not.toBeNull();
    send({ type: "AgentTurn", turn_id: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector('.turn-question .ask-card')).toBe(card);
    card!.querySelector<HTMLButtonElement>(".ask-yes")!.click();
    await flush();
    expect(api.agentQuestionAnswer).toHaveBeenCalledWith("inline-q", true);
  });

  test("clicking the thinking header expands and collapses the thinking block, and media actions open lightbox, expand PDF, and use the safe external opener", async () => {
    api.openExternalUrl.mockResolvedValue(undefined);
    api.agentHistoryList.mockResolvedValue({
      turns: [
        turn(1, {
          source: "app",
          status: "done",
          text: "完成",
          messages: [
            { seq: 1, kind: "thinking", text: "先分析使用者的問題。", at_ms: 1000 },
            {
              seq: 2,
              kind: "media",
              text: JSON.stringify({
                type: "image",
                url: "https://example.com/photo.png",
                title: "東京鐵塔",
                site: "NHK",
              }),
              at_ms: 2000,
            },
            {
              seq: 3,
              kind: "media",
              text: JSON.stringify({
                type: "pdf",
                url: "https://example.com/doc.pdf",
                title: "報告.pdf",
                site: "NHK",
              }),
              at_ms: 3000,
            },
            { seq: 4, kind: "reply", text: "這是你要的圖片與報告。", at_ms: 4000 },
          ],
        }),
      ],
    });
    mount();
    await flush();

    // Thinking block starts collapsed on a done turn, and expands on click
    const thinkBtn = document.querySelector<HTMLButtonElement>('[data-act="thinking"]')!;
    const thinkBody = document.querySelector<HTMLElement>(".think-body")!;
    expect(thinkBtn.getAttribute("aria-expanded")).toBe("false");
    expect(thinkBody.hidden).toBe(true);
    thinkBtn.click();
    expect(thinkBtn.getAttribute("aria-expanded")).toBe("true");
    expect(thinkBody.hidden).toBe(false);
    thinkBtn.click();
    expect(thinkBody.hidden).toBe(true);

    // Clicking image opens in-app lightbox, Escape closes it
    document.querySelector<HTMLButtonElement>('[data-act="lightbox"]')!.click();
    expect(document.querySelector(".media-lightbox")).not.toBeNull();
    expect(document.querySelector<HTMLImageElement>(".media-lightbox .lb-img")!.src).toBe("https://example.com/photo.png");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".media-lightbox")).toBeNull();

    document.querySelector<HTMLButtonElement>('[data-act="lightbox"]')!.click();
    const press = (start: Element, end = start) => {
      start.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }));
      end.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, isPrimary: true }));
      end.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    };
    press(document.querySelector(".lb-img")!, document.body);
    expect(document.querySelector(".media-lightbox")).not.toBeNull();
    press(document.body);
    expect(document.querySelector(".media-lightbox")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-act="lightbox"]'));

    // Clicking PDF expand toggles .is-expanded
    const pdfBtn = document.querySelector<HTMLButtonElement>('[data-act="pdf-expand"]')!;
    pdfBtn.click();
    expect(document.querySelector(".media-pdf")?.classList.contains("is-expanded")).toBe(true);
    expect(pdfBtn.getAttribute("aria-expanded")).toBe("true");

    // Clicking the site action passes the complete http(s) address to the safe opener.
    document.querySelector<HTMLButtonElement>('[data-act="open-url"]')!.click();
    expect(api.openExternalUrl).toHaveBeenCalledWith("https://example.com/photo.png");
  });
});
