// @vitest-environment happy-dom
// Settings › 用量 › 分析: a period's charts drawn from the core's `usage.analytics`, in words, never raw keys.
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { createUsageAnalysis, scaleTop, seriesLabel, usageAnalysisHTML, type UsageAnalysisView } from "./usage-analysis";
import type { UsageAnalytics, UsageBreakdown } from "./usage-analytics-types";

afterEach(() => { document.body.replaceChildren(); setLocale("zh-TW"); });

const DAYS = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
const line = (key: string, values: number[], share: number, label = key) => ({ key, label, values, total: values.reduce((a, b) => a + b, 0), share });
const breakdown = (...series: ReturnType<typeof line>[]): UsageBreakdown => ({ total: series.reduce((sum, s) => sum + s.total, 0), series });
const none: UsageBreakdown = { total: 0, series: [] };
const person = (id: number, name: string, turns: number, cost: number, model = "openai/gpt-6-sol") => ({ id, name, role: "", turns, cost_usd: cost, share: 0, models: [{ model, turns, cost_usd: cost }] });

/** A week as the core answers it: six purposes (the sixth and seventh folded into __other__), seven people, two tools. */
const WEEK: UsageAnalytics = {
  range: "7d", days: DAYS,
  cost_by: {
    purpose: breakdown(
      line("agent", [1, 0.5, 0, 1, 0.5, 0, 1], 0.5), line("cleanup", [0.2, 0.2, 0, 0.2, 0.2, 0, 0.2], 0.1),
      line("stt", [0.2, 0, 0, 0.2, 0, 0, 0.2], 0.06), line("memory", [0.1, 0, 0, 0, 0, 0, 0], 0.01),
      line("image", [0, 0, 0, 0, 0, 0, 1], 0.1), line("__other__", [0.5, 0.5, 0, 0.5, 0.5, 0, 0.5], 0.23),
    ),
    model: breakdown(line("openai/gpt-6-sol", [2, 1, 0, 2, 1, 0, 3], 0.9), line("cli:codex:gpt-6.1", [0, 0, 0, 0, 0, 0, 1], 0.1)),
    provider: breakdown(line("openrouter", [2, 1, 0, 2, 1, 0, 4], 1, "OpenRouter")),
  },
  members: [person(0, "Raphael", 20, 1.2), person(1, "小晴", 9, 2.4, "anthropic/claude-sonnet-5.5"), person(2, "小森", 7, 0.8), person(3, "小葵", 5, 0.4),
    person(4, "阿哲", 3, 0.3), person(5, "小安", 2, 0.2), person(6, "小樂", 1, 0.1, "unknown")],
  tools: breakdown(line("web_search", [3, 1, 0, 2, 0, 0, 4], 0.6), line("connection:Gmail", [1, 0, 0, 1, 0, 0, 2], 0.27, "Gmail"), line("__other__", [1, 0, 0, 0, 0, 0, 1], 0.13)),
  messages_by: {
    model: breakdown(line("openai/gpt-6-sol", [4, 2, 0, 4, 2, 0, 6], 0.9), line("unknown", [1, 0, 0, 0, 0, 0, 1], 0.1)),
    source: breakdown(line("app", [3, 1, 0, 3, 1, 0, 4], 0.7), line("telegram", [1, 1, 0, 1, 1, 0, 2], 0.3), line("future-source", [1, 0, 0, 0, 0, 0, 0], 0.05)),
  },
};
const EMPTY: UsageAnalytics = { range: "7d", days: DAYS, cost_by: { purpose: none, model: none, provider: none }, members: [], tools: none, messages_by: { model: none, source: none } };
const names = { model: (id: string) => ({ "openai/gpt-6-sol": "GPT-6 Sol", "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5" } as Record<string, string>)[id] ?? `name of ${id}` };
const view = (over: Partial<UsageAnalysisView> = {}): UsageAnalysisView => ({ range: "7d", group: "purpose", messages: "model", allPeople: false, data: WEEK, people: new Map(), ...over });
const draw = (over: Partial<UsageAnalysisView> = {}): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = usageAnalysisHTML(view(over), names);
  document.body.append(host);
  return host;
};
const texts = (root: ParentNode, selector: string): string[] => [...root.querySelectorAll(selector)].map((node) => node.textContent ?? "");

describe("花費紀錄", () => {
  test("the period's total, a stacked bar a day on a scale with two lines, the dates under a few days, and each line's share", () => {
    const host = draw();
    const card = host.querySelector('[data-ua-card="cost"]')!;
    expect(texts(card, ".ua-sum > *")).toEqual(["11/15 – 11/21 花費", "US$9.20"]);
    expect(card.querySelector(".ua-plot")!.getAttribute("role")).toBe("img");
    expect(card.querySelector(".ua-plot")!.getAttribute("aria-label")).toBe("每天的花費");
    // The highest day is 2.9: the scale goes to 3 with its middle at 1.5.
    expect(texts(card, ".ua-y > span")).toEqual(["US$3.00", "US$1.50", "US$0.00"]);
    const days = card.querySelectorAll(".ua-bars > .ua-day");
    expect(days).toHaveLength(7);
    expect((days[6] as HTMLElement).style.height).toBe("96.67%");
    expect(days[6].querySelectorAll("i")).toHaveLength(5);
    expect(days[2].querySelectorAll("i")).toHaveLength(0);
    expect(days[6].getAttribute("title")).toBe("11/21 · US$2.90");
    expect(texts(card, ".ua-x > span")).toEqual(["11/15", "", "", "11/18", "", "", "11/21"]);
    // Purposes read as words, __other__ as 其他, each with its share, in the chart's colours in order and 其他 grey.
    expect(texts(card, ".ua-lname")).toEqual(["對話", "聽寫整理", "語音轉文字", "記憶", "畫圖", "其他"]);
    expect(texts(card, ".ua-legend strong")).toEqual(["50%", "10%", "6%", "1%", "10%", "23%"]);
    expect([...card.querySelectorAll<HTMLElement>(".ua-legend > li")].map((li) => li.dataset.s)).toEqual(["1", "2", "3", "4", "5", "other"]);
    expect(host.innerHTML).not.toContain("__other__");
  });

  test("the period, a choice of 7 or 30 days, and the grouping, a dropdown by purpose, model or provider: there is no 依成員", () => {
    const host = draw({ range: "30d" });
    const period = host.querySelector('[data-ua-section="cost"] .tabs.seg')!;
    expect(period.getAttribute("aria-label")).toBe("期間");
    expect(texts(period, ".tab .tab-label > span")).toEqual(["7 天", "30 天"]);
    expect(period.querySelector('[data-ua-range="30d"]')!.getAttribute("aria-pressed")).toBe("true");
    const group = host.querySelector<HTMLButtonElement>('.sel[data-k="ua-group"]')!;
    expect(group.getAttribute("aria-label")).toBe("分類方式");
    expect(group.textContent).toBe("依用途");
    const controller = createUsageAnalysis({ api: { usageAnalytics: vi.fn() }, redraw: vi.fn() });
    expect(controller.menuFor("ua-group")!.choices.map((c) => c.label)).toEqual(["依用途", "依模型", "依供應商"]);
    expect(host.innerHTML).not.toContain("依成員");
  });

  test("by model a model reads as the app names models, and by provider the core's name of it", () => {
    expect(texts(draw({ group: "model" }), '[data-ua-card="cost"] .ua-lname')).toEqual(["GPT-6 Sol", "name of cli:codex:gpt-6.1"]);
    expect(texts(draw({ group: "provider" }), '[data-ua-card="cost"] .ua-lname')).toEqual(["OpenRouter"]);
  });

  test("a month of days labels every seventh and the last", () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const month: UsageAnalytics = { ...WEEK, days, cost_by: { ...WEEK.cost_by, purpose: breakdown(line("agent", days.map((_, i) => (i % 3 ? 0.1 : 0)), 1)) } };
    const labels = texts(draw({ range: "30d", data: month }), ".ua-x > span");
    expect(labels.filter(Boolean)).toEqual(["10/1", "10/8", "10/15", "10/22", "10/30"]);
    expect(draw({ data: month }).querySelector(".ua-bars")!.getAttribute("data-n")).toBe("30");
  });
});

describe("誰花最多", () => {
  test("five rows, the one who cost most first, each with a face, replies, cost and most used model, then 顯示更多", () => {
    const people = new Map([[0, { id: 0, name: "拉斐爾", avatar: "" }], [2, { id: 2, name: "小森", avatar: "slime:green-plain" }]]);
    const host = draw({ people });
    expect(texts(host, ".ua-table thead th")).toEqual(["名字", "回覆", "花費", "最常用的模型"]);
    const rows = [...host.querySelectorAll(".ua-table tbody tr")];
    expect(rows.map((row) => texts(row, "th, td"))).toEqual([
      ["小晴", "9", "US$2.40", "Claude Sonnet 5.5"],
      ["拉斐爾", "20", "US$1.20", "GPT-6 Sol"],
      ["小森", "7", "US$0.80", "GPT-6 Sol"],
      ["小葵", "5", "US$0.40", "GPT-6 Sol"],
      ["阿哲", "3", "US$0.30", "GPT-6 Sol"],
    ]);
    // Every row has the member's face as the app draws members.
    expect(rows.every((row) => row.querySelector(".ua-who .av"))).toBe(true);
    expect(host.querySelector('[data-ua-person="0"] .av')!.getAttribute("data-presence-member")).toBe("0");
    expect(host.querySelector<HTMLButtonElement>("[data-ua-more]")!.className).toBe("btn sm ua-more");
    expect(host.querySelector("[data-ua-more]")!.textContent).toBe("顯示更多");
    // 顯示更多 shows everyone, and a model the core did not record reads 未記錄.
    const all = draw({ allPeople: true });
    expect(all.querySelectorAll(".ua-table tbody tr")).toHaveLength(7);
    expect(all.querySelector('[data-ua-person="6"] .ua-model')!.textContent).toBe("未記錄");
    expect(all.querySelector("[data-ua-more]")).toBeNull();
  });

  test("Raphael without the list is named in the window's language, not by the core's English name", () => {
    expect(draw().querySelector('[data-ua-person="0"] th')!.textContent).toBe("拉斐爾");
  });
});

describe("工具使用 and 訊息", () => {
  test("the period's count, a line a day per tool on one scale, the first and last day, and each tool's count", () => {
    const card = draw().querySelector('[data-ua-card="tools"]')!;
    expect(texts(card, ".ua-sum > *")).toEqual(["工具呼叫", "16"]);
    const svg = card.querySelector("svg.ua-lines")!;
    expect(svg.getAttribute("aria-label")).toBe("每天的工具呼叫次數");
    expect(svg.querySelectorAll("polyline")).toHaveLength(3);
    expect(svg.querySelectorAll("line.ua-grid")).toHaveLength(2);
    // The busiest day (4 searches) touches the top of the scale (4): its point is at the top line.
    expect(svg.querySelector("polyline")!.getAttribute("points")!.split(" ")[6]).toBe("600.0,8.0");
    expect(texts(card, ".ua-ends > span")).toEqual(["11/15", "11/21"]);
    expect(texts(card, ".ua-lname")).toEqual(["搜尋網路", "Gmail", "其他"]);
    expect(texts(card, ".ua-legend strong")).toEqual(["10 次", "4 次", "2 次"]);
  });

  test("messages by model or by source, chosen with a segmented choice, a source read as words and an unknown one as 其他", () => {
    const byModel = draw();
    const choice = byModel.querySelector('[data-ua-section="messages"] .tabs.seg')!;
    expect(choice.getAttribute("aria-label")).toBe("訊息分類");
    expect(choice.querySelector('[data-ua-messages="model"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(texts(byModel, '[data-ua-card="messages"] .ua-lname')).toEqual(["GPT-6 Sol", "未記錄"]);
    expect(texts(byModel, '[data-ua-card="messages"] .ua-sum > *')).toEqual(["訊息", "20"]);
    const bySource = draw({ messages: "source" });
    expect(texts(bySource, '[data-ua-card="messages"] .ua-lname')).toEqual(["打字", "Telegram", "其他"]);
    expect(texts(bySource, '[data-ua-card="messages"] .ua-legend strong')).toEqual(["12 則", "6 則", "1 則"]);
  });
});

describe("a period with nothing in it", () => {
  test("each section says so in one quiet line: no chart frame, no dropdown with nothing to group, no raw key", () => {
    const host = draw({ data: EMPTY });
    expect(texts(host, ".ua-line")).toEqual(["這段時間沒有花費。", "這段時間沒有人回覆。", "這段時間沒有用到工具。", "這段時間沒有訊息。"]);
    expect(host.querySelector(".ua-card, .ua-plot, svg, table, [data-ua-more], [data-ua-messages]")).toBeNull();
    expect(host.querySelector('[data-k="ua-group"]')).toBeNull();
    // The period stays to be changed.
    expect(host.querySelectorAll("[data-ua-range]")).toHaveLength(2);
  });

  test("while the first reading is out it says so, and one that failed says so, with the period still there", () => {
    const loading = draw({ data: null });
    expect(texts(loading, ".ua-line")).toEqual(["正在載入用量…"]);
    expect(loading.querySelectorAll("[data-ua-section]")).toHaveLength(1);
    const failed = draw({ data: "failed" });
    expect(texts(failed, ".ua-line")).toEqual(["讀不到這段時間的紀錄，等一下再打開看看。"]);
    expect(failed.querySelectorAll("[data-ua-range]")).toHaveLength(2);
  });
});

describe("the words of a line", () => {
  test("never a raw key: purposes, tools and sources have words, connections their own names, the rest 其他", () => {
    const say = (kind: Parameters<typeof seriesLabel>[0], key: string, label = key) => seriesLabel(kind, { key, label }, names);
    expect([say("purpose", "agent"), say("purpose", "video"), say("purpose", "vision"), say("purpose", "future-service"), say("purpose", "__other__"), say("purpose", "unknown")])
      .toEqual(["對話", "做影片", "看圖片", "其他", "其他", "未記錄"]);
    expect([say("tool", "computer"), say("tool", "web_read"), say("tool", "routines"), say("tool", "ask_member"), say("tool", "files"), say("tool", "connection:Notion", "Notion")])
      .toEqual(["操作電腦", "讀網頁", "例行工作", "請同事幫忙", "檔案", "Notion"]);
    expect([say("source", "voice"), say("source", "overlay"), say("source", "routine"), say("source", "worker"), say("source", "slack")])
      .toEqual(["語音", "快速提問", "例行工作", "背景工作", "Slack"]);
    setLocale("en");
    expect(say("purpose", "__other__")).toBe("Other");
    expect(say("source", "app")).toBe("Typed");
  });

  test("the scale's top is the next round step above the highest day", () => {
    expect([scaleTop(0), scaleTop(0.0042), scaleTop(1.23), scaleTop(3.2), scaleTop(7), scaleTop(12)]).toEqual([1, 0.005, 1.5, 4, 8, 15]);
  });
});

describe("the tab's state", () => {
  test("reads the chosen period with the members' faces, keeps what it knew when a reading fails, and draws again only on a change", async () => {
    const usageAnalytics = vi.fn().mockResolvedValueOnce(WEEK).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(EMPTY);
    const membersList = vi.fn().mockResolvedValue({ members: [{ id: 2, name: "小森", avatar: "slime:green-plain" }], groups: [] });
    const redraw = vi.fn();
    const tab = createUsageAnalysis({ api: { usageAnalytics, membersList }, redraw });
    expect(tab.view().data).toBeNull();
    await tab.load();
    expect(usageAnalytics).toHaveBeenLastCalledWith("7d");
    expect(tab.view().data).toBe(WEEK);
    expect(tab.view().people.get(2)!.name).toBe("小森");
    expect(redraw).toHaveBeenCalledTimes(1);
    await tab.load();
    expect(tab.view().data).toBe(WEEK);
    expect(redraw).toHaveBeenCalledTimes(1);
    // A press on 30 天 draws the tab at once and reads the month; 顯示更多 and 依來源 only draw.
    const range = document.createElement("button"); range.dataset.uaRange = "30d";
    expect(tab.click(range)).toBe(true);
    expect(tab.view().range).toBe("30d");
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(usageAnalytics).toHaveBeenLastCalledWith("30d");
    const more = document.createElement("button"); more.dataset.uaMore = "";
    expect(tab.click(more)).toBe(true);
    expect(tab.view().allPeople).toBe(true);
    const source = document.createElement("button"); source.dataset.uaMessages = "source";
    expect(tab.click(source)).toBe(true);
    expect(tab.view().messages).toBe("source");
    tab.menuFor("ua-group")!.pick("model");
    expect(tab.view().group).toBe("model");
    expect(tab.click(document.createElement("button"))).toBe(false);
  });

  test("a core that does not know the reading is a failed reading, said once", async () => {
    const tab = createUsageAnalysis({ api: { usageAnalytics: () => { throw new Error("unknown method"); } }, redraw: vi.fn() });
    await tab.load();
    expect(tab.view().data).toBe("failed");
  });
});
