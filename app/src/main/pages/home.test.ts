// @vitest-environment happy-dom
// Home (pages/home.ts): Raphael's live emblem beside the greeting and his line, then what to do now and what must not be
// missed today: the timed things, what waits, today's tasks, the overdue and the routines in one line (owner, 2026-11-12).
// The sorting itself is tested in home-day.test.ts. No figures, charts, tables, spend, allowance or dictation numbers.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HomeActivity, HomeItem, HomeOverview } from "../home-types";
import type { AppContext, MainEvent } from "../types";

const { queue, retained, emblems } = vi.hoisted(() => ({
  queue: [] as unknown[], retained: { value: undefined as unknown },
  emblems: [] as { px: number; calls: string[] }[],
}));
vi.mock("../api", () => ({
  homeOverview: vi.fn(async (refresh = false) => refresh ? retained.value : (retained.value = queue.length > 1 ? queue.shift() : queue[0])),
  statusCheckOpenrouter: vi.fn(),
}));
vi.mock("../team-navigation", () => ({ openMemberThread: vi.fn() }));
// The canvas renderer is the desktop's own (overlay/emblem.test.ts); here only what Home asks of it.
vi.mock("../../overlay/emblem", () => ({
  Emblem: class {
    record: { px: number; calls: string[] };
    constructor(_canvas: HTMLCanvasElement, px: number) { this.record = { px, calls: [] }; emblems.push(this.record); }
    set(mode: string) { this.record.calls.push(`set:${mode}`); }
    appear() { this.record.calls.push("appear"); }
    speak() { this.record.calls.push("speak"); }
    size(px: number) { this.record.calls.push(`size:${px}`); }
    dispose() { this.record.calls.push("dispose"); }
  },
}));

let reduce = true;

const NOW = new Date(2026, 9, 27, 10, 0).getTime();
const overview = (month: number, state: "ok" | "no_key" = "ok"): HomeOverview => ({
  generated_at_ms: NOW,
  report: {
    openrouter: { state, latency_ms: 120, checked_at_ms: null, error: null, key: null, usage: null },
    spend: { month_usd: month, today_usd: 0, limit_usd: 20, forecast_usd: 2, daily: [0, month] },
    last: null,
  },
  today: [], reports: [], calendar: [],
  counts: { today: 0, reports: 0, calendar: 0 },
  usage: { month_usd: month, limit_usd: 20, daily: [0, month], allowances: { brains: [] } },
  dictation: { words: 0, time_saved_seconds: 0, speed_wpm: null, audio_seconds: 0, daily: [] },
});
const item = (id: string, kind: HomeItem["kind"], title: string, at: number, more: Partial<HomeItem> = {}): HomeItem => ({
  id, kind, title, summary: "", at_ms: at, member_id: 1, name: "Ari", avatar: "", turn_id: null, conversation_id: null, routine_id: null, ...more,
});
/** Fourteen days ending on the 27th: the week before finished 3 a day, this week 4, today 2 work, 1 message, 3 routines. */
const activity = (): HomeActivity => ({
  days: Array.from({ length: 14 }, (_, i) => {
    const date = `2026-10-${String(14 + i).padStart(2, "0")}`;
    if (i === 13) return { date, work: 2, messages: 1, routines_ok: 3, routines_failed: 1, failed: 1 };
    return { date, work: i < 7 ? 3 : 4, messages: 0, routines_ok: 0, routines_failed: 0, failed: 0 };
  }),
  today: { routines_due: 6, routines_done: 3, routines_failed: 1, events: 1, questions: 0 },
});

async function load() {
  return import("./home");
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.resetModules();
  reduce = true;
  queue.length = 0;
  queue.push(overview(5));
  emblems.length = 0;
  localStorage.clear();
  if (typeof HTMLCanvasElement.prototype.getContext !== "function") HTMLCanvasElement.prototype.getContext = (() => null) as never;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduce : false,
    media: query,
    addEventListener: () => {},
    removeEventListener() {},
  }));
});

// A test that times out never reaches its own cleanup; stop its page and timers here so the
// next test does not count the refreshes it would still schedule.
const mounted: { hide(): void; el: HTMLElement }[] = [];
afterEach(() => {
  for (const page of mounted.splice(0)) { page.hide(); page.el.remove(); }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const parse = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};

/** The page as the app mounts it, and the events its refreshes hear. */
async function mount() {
  const { createHome } = await load();
  const heard: ((event: MainEvent) => void)[] = [];
  const app = { go: vi.fn(), onEvent: (handler: (event: MainEvent) => void) => (heard.push(handler), () => {}), cleared: { on: () => () => {} } } as unknown as AppContext;
  const page = createHome(app);
  mounted.push(page);
  document.body.append(page.el);
  page.show();
  await flush();
  return { page, app, emit: (event: MainEvent) => heard.forEach((handler) => handler(event)) };
}

// Each test imports Home afresh (vi.resetModules), with every catalogue behind it: on a loaded machine the first ones
// passed their assertions only after the default 5 s, twice in full runs (2026-11-10).
describe("Home's hero", { timeout: 15_000 }, () => {
  test("greets the owner by the time of day, with the date and his live emblem, and no figures of spend or dictation", async () => {
    const { homeHTML } = await load();
    const page = parse(homeHTML({ ...overview(5), activity: activity() }));
    expect(page.querySelector(".ho-hero h1")!.textContent).toBe("早安，主人");
    expect(page.querySelector('.ho-hero .ho-orb[aria-hidden="true"] > canvas.ho-emb')).not.toBeNull();
    expect(page.querySelector(".ho-orb .av, .ho-orb img, .ho-orb svg.slime")).toBeNull();
    expect(page.querySelector(".ho-date")!.textContent).toContain("27");
    expect(page.textContent).not.toMatch(/US\$|%|字/);
    // No member rows, open-item list, yesterday or health check, and no face anywhere.
    for (const gone of [".ho-team", ".ho-pending", ".ho-yesterday", ".ho-checks", ".ho-member", ".av", "svg.slime", ".ho-card", ".ho-spend", ".ho-dictation", ".ho-stats", ".ho-trend"])
      expect(page.querySelector(gone), gone).toBeNull();
    const evening = { ...overview(5), generated_at_ms: new Date(2026, 9, 27, 20).getTime() };
    expect(parse(homeHTML(evening)).querySelector("h1")!.textContent).toBe("晚上好，主人");
  });

  test("his line is his word on today, else today's schedule and what waits for the owner in one sentence", async () => {
    const { dayLine, homeHTML } = await load();
    const sample = overview(5);
    expect(dayLine(sample)).toBe("今天沒有行程，也沒有事在等你。");
    sample.today = [item("event:x", "event", "Design review", NOW + 3_600_000), item("question:7", "question", "Which source?", NOW - 60_000, { turn_id: 7 })];
    sample.activity = activity();
    expect(dayLine(sample)).toBe("今天有 1 個行程，1 件事在等你回答。");
    sample.today_plan = { date: "2026-10-27", items: [], narrative: "今天有兩個行程。", state: "ready", reason: null, model: null };
    // He speaks as himself: his lead word 告。 first, once, never doubled.
    expect(parse(homeHTML(sample)).querySelector(".ho-hero .ho-line")!.textContent).toBe("告。今天有兩個行程。");
    sample.today_plan = { ...sample.today_plan, narrative: "解。研究方向還在等你決定。" };
    expect(parse(homeHTML(sample)).querySelector(".ho-hero .ho-line")!.textContent).toBe("解。研究方向還在等你決定。");
  });

  test("only a report that needs fixing speaks under his line, with its one fix and no ask", async () => {
    const { homeHTML } = await load();
    expect(parse(homeHTML(overview(5))).querySelector(".ho-alert")).toBeNull();
    const broken = parse(homeHTML(overview(5, "no_key")));
    expect(broken.querySelector(".ho-alert")!.textContent).toContain("OpenRouter");
    // The main window shows his words plainly; 《告。…》 is the desktop caption's (R-UI-42).
    expect(broken.querySelector(".ho-hero")!.textContent).not.toMatch(/[《》]/);
    expect([...broken.querySelectorAll(".ho-hero button")].map(button => button.getAttribute("data-home-go"))).toEqual(["calendar", "report"]);
    expect(broken.innerHTML).not.toContain('data-home-go="agent"');
  });
});

/** A day of the owner's task board: all-day own events whose titles carry the board's words. */
const board = (title: string, id: number): HomeItem => item(`own:${id}`, "own", title, new Date(2026, 9, 27).getTime(), { all_day: true, event_id: id, member_id: -1, name: "", end_ms: new Date(2026, 9, 28).getTime() });
const at = (h: number, m = 0): number => new Date(2026, 9, 27, h, m).getTime();
/** A day with no routines due, so that nothing at all can be quiet. */
const idle = (): HomeActivity => ({ ...activity(), today: { routines_due: 0, routines_done: 0, routines_failed: 0, events: 0, questions: 0 } });
const sections = (page: ParentNode): string[] => [...page.querySelectorAll(".ho-sec")].map(section => section.classList[1]!);

describe("what to do now", () => {
  test("the page is the parts of the day that change what he does, in order, and a part with nothing to say is not drawn", async () => {
    const { homeHTML } = await load();
    const sample = { ...overview(5), activity: idle() };
    expect(sections(parse(homeHTML(sample)))).toEqual(["ho-none"]);
    sample.today = [
      item("own:1", "own", "Dentist", at(14), { end_ms: at(15) }),
      item("question:7", "question", "Which source?", NOW - 60_000, { turn_id: 7 }),
      board("今天：[Filia] 預留 bucket", 2), board("逾期：[Filia] remote 改指向", 3),
      item(`routine:5:${at(8)}`, "routine", "Inbox sweep", at(8), { routine_id: 5 }),
    ];
    const page = parse(homeHTML(sample));
    expect(sections(page)).toEqual(["ho-next", "ho-waiting", "ho-todo", "ho-overdue", "ho-routines"]);
    // No figures, no chart, no band, no table, no tooltip.
    for (const gone of [".ho-stats", ".ho-stat", ".ho-trend", ".ho-band", ".ho-thead", ".ho-tip", ".ho-chart", ".ho-panels"]) expect(page.querySelector(gone), gone).toBeNull();
    expect(page.textContent).not.toMatch(/近兩週|本週完成|今天：|逾期：/);
    // Each part is named in one or two words.
    expect([...page.querySelectorAll(".ho-sec h2")].map(h => h.textContent)).toEqual(["接下來", "等你決定", "今天要做的", "逾期"]);
    // Taking a part away leaves no heading and no empty lane.
    sample.today = [board("今天：[Filia] 預留 bucket", 2)];
    const only = parse(homeHTML(sample));
    expect(sections(only)).toEqual(["ho-todo"]);
    expect(only.querySelectorAll(".ho-lane")).toHaveLength(1);
  });

  test("now and next show the timed things only, with how long until each, and the one on now says so", async () => {
    const { homeHTML } = await load();
    const sample = { ...overview(5), activity: activity() };
    sample.today = [
      item("own:1", "own", "Standup", at(8), { end_ms: at(8, 30) }),
      item("own:2", "own", "Review", at(9, 30), { end_ms: at(10, 30) }),
      item("event:x", "event", "Supplier", at(10, 35), { end_ms: at(11, 30) }),
      item("own:3", "own", "Dentist", at(14), { end_ms: at(15) }),
      item("own:4", "own", "Weekly", at(16)),
      board("今天：[Filia] 預留 bucket", 9),
    ];
    const page = parse(homeHTML(sample));
    const rows = [...page.querySelectorAll<HTMLElement>(".ho-next .ho-event")];
    expect(rows.map(row => [row.querySelector("time")!.textContent, row.querySelector("b")!.textContent, row.querySelector(".ho-when")!.textContent])).toEqual([
      ["09:30", "Review", "進行中"], ["10:35", "Supplier", "35 分鐘後"], ["14:00", "Dentist", "4 小時後"]]);
    expect(rows[0]!.classList.contains("is-now")).toBe(true);
    expect(rows.every(row => row.tagName === "BUTTON" && row.dataset.homeEvent && row.dataset.homeDate === "2026-10-27")).toBe(true);
  });

  test("what waits for his decision opens its conversation with the member's face, and the rest are one row", async () => {
    const sample = { ...overview(5), activity: activity() };
    sample.today = Array.from({ length: 7 }, (_, i) => item(`question:${i}`, "question", `Question ${i}`, NOW - i * 60_000, { turn_id: i, member_id: i % 2 }));
    queue.splice(0, queue.length, sample);
    const { page } = await mount();
    const { openMemberThread } = await import("../team-navigation");
    const rows = [...page.el.querySelectorAll<HTMLElement>(".ho-waiting .ho-event")];
    expect(rows.map(row => row.querySelector("b")!.textContent)).toEqual(["Question 0", "Question 1", "Question 2", "Question 3", "Question 4", "還有 2 件"]);
    expect(page.el.querySelector(".ho-waiting .ho-count")!.textContent).toBe("7");
    expect(rows[0]!.querySelector(".ho-face, .av, svg.slime")).not.toBeNull();
    rows[1]!.click();
    expect(openMemberThread).toHaveBeenLastCalledWith(expect.anything(), 1, 1);
    rows[5]!.click();
    expect(openMemberThread).toHaveBeenLastCalledWith(expect.anything(), 1, 5);
  });

  test("today's tasks are at most five with the prefix stripped and the project a quiet label, and the rest open today on the Calendar", async () => {
    const sample = { ...overview(5), activity: activity() };
    sample.today = [board("[Notion] 今日重點", 1), ...Array.from({ length: 8 }, (_, i) => board(`今天：[${i % 2 ? "Raphael" : "Filia"}] 事 ${i}`, 10 + i))];
    queue.splice(0, queue.length, sample);
    const { page, app } = await mount();
    const rows = [...page.el.querySelectorAll<HTMLElement>(".ho-todo .ho-event")];
    expect(rows.map(row => row.querySelector("b")!.textContent)).toEqual(["今日重點", "事 0", "事 1", "事 2", "事 3", "還有 4 件"]);
    expect(rows.map(row => row.querySelector(".ho-rail")!.textContent)).toEqual(["Notion", "Filia", "Raphael", "Filia", "Raphael", ""]);
    expect(page.el.querySelector(".ho-todo .ho-count")!.textContent).toBe("9");
    rows[1]!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations", "calendar:2026-10-27:own%3A10");
    rows[5]!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations", "2026-10-27");
  });

  test("the overdue are one block of one size: the count, the projects, three rows and a way to all, whether there are 12 or 40", async () => {
    const { homeHTML } = await load();
    const html = (count: number): HTMLElement => parse(homeHTML({ ...overview(5), activity: activity(), today:
      Array.from({ length: count }, (_, i) => board(`逾期：[${["Filia", "Raphael", "Notion", "Docs", "Ops"][i % 5]}] 舊事 ${i}`, i + 1)) }));
    for (const count of [12, 40]) {
      const page = html(count);
      expect(page.querySelectorAll(".ho-overdue .ho-event")).toHaveLength(4);
      expect([...page.querySelectorAll(".ho-overdue .ho-event b")].map(b => b.textContent).slice(0, 3)).toEqual(["舊事 0", "舊事 1", "舊事 2"]);
      expect(page.querySelector(".ho-overdue .ho-count")!.textContent).toBe(String(count));
      expect(page.querySelector(".ho-overdue .ho-groups")!.textContent).toMatch(/^(Filia|Raphael|Notion|Docs|Ops) \d+ · .+ · .+ · 其他 \d+$/);
      const more = page.querySelector<HTMLElement>(".ho-overdue .is-more")!;
      expect([more.textContent, more.dataset.homeGo, more.dataset.homeDate]).toEqual(["看全部", "calendar", "2026-10-27"]);
    }
    // Three or fewer are all shown, with nothing more to see.
    expect(html(3).querySelectorAll(".ho-overdue .ho-event")).toHaveLength(3);
  });

  test("the routines are one line: done of due, the failed one named, the next to run", async () => {
    const sample = { ...overview(5), activity: { ...activity(), today: { routines_due: 4, routines_done: 1, routines_failed: 1, events: 0, questions: 0 } } };
    sample.today = [
      item("routine:1:1", "routine", "Inbox sweep", at(8), { routine_id: 1 }),
      item("routine:2:1", "routine", "Morning digest", at(9), { routine_id: 2, run_status: "error" }),
      item("routine:3:1", "routine", "Evening notes", at(18), { routine_id: 3 }),
    ];
    queue.splice(0, queue.length, sample);
    const { page } = await mount();
    const line = page.el.querySelector<HTMLElement>(".ho-routines .ho-event")!;
    expect(line.querySelector("b")!.textContent).toBe("例行工作");
    expect(line.querySelector("em")!.textContent).toBe("1/4");
    expect([...line.querySelectorAll(".ho-note")].map(note => note.textContent)).toEqual(["「Morning digest」沒完成", "下一個 18:00 Evening notes"]);
    expect(line.querySelector(".ho-note.is-bad")).not.toBeNull();
    expect(line.querySelector(".ho-face, .av, svg.slime")).not.toBeNull();
    expect(page.el.querySelectorAll(".ho-routines .ho-event")).toHaveLength(1);
  });

  test("every row is a real button that goes somewhere", async () => {
    const sample = { ...overview(5), activity: activity() };
    sample.today = [
      item("own:1", "own", "Dentist", at(14), { end_ms: at(15) }), item("question:7", "question", "Which source?", NOW, { turn_id: 7 }),
      board("今天：x", 2), board("逾期：y", 3), item("routine:1:1", "routine", "Inbox", at(18), { routine_id: 1 }),
    ];
    queue.splice(0, queue.length, sample);
    const { page } = await mount();
    const rows = [...page.el.querySelectorAll<HTMLElement>(".ho-sec .ho-event")];
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.tagName).toBe("BUTTON");
      expect(row.dataset.homeEvent || row.dataset.homeItem || row.dataset.homeGo, row.textContent!).toBeTruthy();
    }
  });

  test("the date has the calendar's icon beside it, the way to the whole Calendar", async () => {
    const { page, app } = await mount();
    page.el.querySelector<HTMLButtonElement>('.ho-date [data-home-go="calendar"]')!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations");
  });

  test("an empty day stays calm and offers to make something today", async () => {
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-none .ho-empty")!.textContent).toBe("今天沒有行程");
    expect(page.el.querySelector(".cal-notice")).toBeNull();
    page.el.querySelector<HTMLButtonElement>(".ho-create")!.click();
    expect(app.go).toHaveBeenCalledWith("automations", "calendar-new:2026-10-27");
  });

  test("Home tells not connected from a failed read from nothing, and a closed offer stays closed", async () => {
    const off = overview(5); off.calendar_google = "not_connected";
    queue.splice(0, queue.length, off);
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-foot .cal-notice")!.textContent).toMatch(/未連接|isn't connected/);
    page.el.querySelector<HTMLButtonElement>('.ho-foot [data-home-go="connections"]')!.click();
    expect(app.go).toHaveBeenCalledWith("settings", "connections");
    page.el.querySelector<HTMLButtonElement>("[data-home-dismiss]")!.click();
    expect(page.el.querySelector(".cal-notice")).toBeNull();
    page.hide(); page.el.remove();
    const failed = overview(5); failed.calendar_google = "unreadable";
    queue.splice(0, queue.length, failed);
    const second = await mount();
    expect(second.page.el.querySelector(".cal-notice")!.textContent).toMatch(/讀不到|can't be read/);
    expect(second.page.el.querySelector("[data-home-dismiss]")).toBeNull();
  });
});

describe("Raphael's emblem", () => {
  test("is 拉斐爾大師's emblem drawn alive on a canvas, appearing then speaking his line, then turning on the compositor until Home hides", async () => {
    vi.useFakeTimers();
    reduce = false;
    const { page } = await mount();
    expect(emblems).toHaveLength(1);
    expect(emblems[0]!.px).toBe(96);
    expect(emblems[0]!.calls).toEqual(["set:steady", "appear"]);
    await vi.advanceTimersByTimeAsync(900);
    expect(emblems[0]!.calls).toEqual(["set:steady", "appear", "speak"]);
    // Then he holds his last frame and the compositor turns it: no more frames are drawn while Home stays open.
    const orb = page.el.querySelector(".ho-orb")!;
    expect(orb.classList.contains("is-turning")).toBe(false);
    await vi.advanceTimersByTimeAsync(3100);
    expect(emblems[0]!.calls).toEqual(["set:steady", "appear", "speak", "dispose"]);
    expect(orb.classList.contains("is-turning")).toBe(true);
    page.hide();
    expect(orb.classList.contains("is-turning")).toBe(false);
    page.show(); await flush();
    expect(emblems).toHaveLength(2);
    expect(emblems[1]!.calls.slice(0, 2)).toEqual(["set:steady", "appear"]);
    vi.useRealTimers();
  });

  test("with reduced motion he appears without speaking or turning, and leaves the animation loop at once", async () => {
    vi.useFakeTimers();
    reduce = true;
    const { page } = await mount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(emblems[0]!.calls).toEqual(["set:steady", "appear", "dispose"]);
    // The class is set, but the turning itself is inside prefers-reduced-motion: no-preference (home.css).
    expect(page.el.querySelector(".ho-orb")!.classList.contains("is-turning")).toBe(true);
    vi.useRealTimers();
  });

  test("is drawn again by a refresh without starting over: the canvas stays the same node and appears once", async () => {
    const first = overview(2), second = overview(2);
    second.today = [item("question:7", "question", "Which source?", NOW, { turn_id: 7 })];
    queue.splice(0, queue.length, first, second);
    const { page, emit } = await mount();
    const canvas = page.el.querySelector("canvas.ho-emb")!;
    emit({ type: "AgentTurn" } as MainEvent);
    await new Promise(resolve => setTimeout(resolve, 400));
    await flush();
    expect(page.el.querySelector("canvas.ho-emb")).toBe(canvas);
    expect(page.el.querySelector(".ho-waiting .ho-count")!.textContent).toBe("1");
    expect(emblems).toHaveLength(1);
  });
});

test("translates the retained Home behind Settings immediately in every locale", async () => {
  queue.splice(0, queue.length, { ...overview(5), activity: activity() });
  const { page } = await mount();
  const { setLocale, t } = await import("../i18n");
  const { homeOverview } = await import("../api");
  const canvas = page.el.querySelector("canvas.ho-emb");
  page.hide();
  const calls = vi.mocked(homeOverview).mock.calls.length;
  try {
    for (const locale of ["en", "ja", "zh-TW"] as const) {
      setLocale(locale);
      expect(page.el.querySelector(".ho-greet")!.textContent).toBe(t("home.greetMorning"));
      expect(page.el.querySelector(".ho-line")!.textContent).toBe(t("home.notice") + t("home.lineQuiet"));
      expect(page.el.querySelector(".ho-routines b")!.textContent).toBe(t("home.statRoutines"));
      expect(page.el.querySelector(".ho-date .btn")!.getAttribute("aria-label")).toBe(t("overview.calendar"));
    }
    expect(vi.mocked(homeOverview).mock.calls.length).toBe(calls);
    expect(page.el.querySelector("canvas.ho-emb")).toBe(canvas);
  } finally { setLocale("zh-TW"); }
});

test("written summaries arriving (HomeChanged) read Home again", async () => {
  const { emit } = await mount();
  const { homeOverview } = await import("../api");
  const reads = vi.mocked(homeOverview).mock.calls.length;
  emit({ type: "HomeChanged" });
  await new Promise(resolve => setTimeout(resolve, 400));
  await flush();
  expect(vi.mocked(homeOverview).mock.calls.length).toBeGreaterThan(reads);
});

test("Home ticks use cached records for five minutes and resume once after being hidden", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  await mount();
  const { homeOverview } = await import("../api");
  const liveCalls = (): number => vi.mocked(homeOverview).mock.calls.filter(([refresh]) => refresh).length;
  const start = liveCalls();
  await vi.advanceTimersByTimeAsync(270_000); await flush();
  expect(liveCalls()).toBe(start);
  await vi.advanceTimersByTimeAsync(30_000); await flush();
  expect(liveCalls()).toBe(start + 1);
  hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  const reads = vi.mocked(homeOverview).mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000); await flush();
  expect(vi.mocked(homeOverview).mock.calls.length).toBe(reads);
  hidden = false; document.dispatchEvent(new Event("visibilitychange")); await flush();
  expect(vi.mocked(homeOverview).mock.calls.length).toBe(reads + 1);
  expect(liveCalls()).toBe(start + 1);
  vi.useRealTimers();
});
