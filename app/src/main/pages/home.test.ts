// @vitest-environment happy-dom
// Home (pages/home.ts, owner 2026-11-08): Raphael's live emblem beside the greeting and his line, four figures, today's
// hours as a band over today's schedule as a table, and the last two weeks as a chart. No member rows, open-item list,
// yesterday paragraph or health check; no spend, allowance or dictation figures; no slime.
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
    // No member rows, open-item list, yesterday or health check (owner, 2026-11-08), and no face anywhere.
    for (const gone of [".ho-team", ".ho-pending", ".ho-yesterday", ".ho-checks", ".ho-member", ".av", "svg.slime", ".ho-card", ".ho-spend", ".ho-dictation"])
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
    // He speaks as himself: his lead word 告。 first (owner, 2026-11-08), once, never doubled.
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
    expect([...broken.querySelectorAll(".ho-hero button")].map(button => button.getAttribute("data-home-go"))).toEqual(["report"]);
    expect(broken.innerHTML).not.toContain('data-home-go="agent"');
  });
});

describe("the day in numbers", () => {
  test("four figures: today's events, routines done of due, questions waiting and this week against last", async () => {
    const sample = { ...overview(5), activity: activity() };
    sample.today = [item("event:x", "event", "Design review", NOW + 3_600_000), item("question:7", "question", "Which source?", NOW - 60_000, { turn_id: 7 })];
    queue.splice(0, queue.length, sample);
    const { page, app } = await mount();
    const tiles = [...page.el.querySelectorAll<HTMLElement>(".ho-stats > .ho-stat")];
    expect(tiles.map(tile => [tile.dataset.stat, tile.querySelector("small")!.textContent, tile.querySelector("b")!.textContent, tile.querySelector("span")!.textContent])).toEqual([
      ["events", "行程", "1", "下一個 11:00 Design review"],
      ["routines", "例行工作", "3/6", "1 次沒完成"],
      ["questions", "等你回答", "1", "最新：Which source?"],
      // This week: six days of 4 and today's 6 = 30; the week before: seven days of 3 = 21.
      ["week", "本週完成", "30", "▲ 比上週多 9"],
    ]);
    expect(tiles.map(tile => tile.tagName)).toEqual(["BUTTON", "DIV", "BUTTON", "DIV"]);
    expect(tiles[1]!.querySelector("span")!.classList.contains("is-bad")).toBe(true);
    tiles[0]!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations");
    const { openMemberThread } = await import("../team-navigation");
    tiles[2]!.click();
    expect(openMemberThread).toHaveBeenCalledWith(app, 1, 7);
  });

  test("without the core's activity the routine and week figures and the chart are left out", async () => {
    const { homeHTML } = await load();
    const page = parse(homeHTML(overview(5)));
    expect([...page.querySelectorAll<HTMLElement>(".ho-stat")].map(tile => tile.dataset.stat)).toEqual(["events", "questions"]);
    expect(page.querySelector(".ho-trend")).toBeNull();
    expect(page.querySelector(".ho-schedule")).not.toBeNull();
  });

  test("the last two weeks are stacked bars of work, messages and routines with a scale, today's total, a tooltip and a table", async () => {
    const { homeHTML, dayTipHTML } = await load();
    const data = activity();
    const page = parse(homeHTML({ ...overview(5), activity: data }));
    const cols = [...page.querySelectorAll<HTMLElement>(".ho-trend .ho-col")];
    expect(cols).toHaveLength(14);
    expect(cols[13]!.classList.contains("is-today")).toBe(true);
    // Each finished kind is one part of its day's bar, bottom first: work, messages, routines.
    expect([...cols[13]!.querySelectorAll<HTMLElement>(".ho-bar > i")].map(part => [part.dataset.s, parseFloat(part.style.flexGrow)])).toEqual([["work", 2], ["messages", 1], ["routines", 3]]);
    expect(cols[13]!.querySelector(".ho-bar-value")!.textContent).toBe("6");
    expect(cols.slice(0, 13).every(col => !col.querySelector(".ho-bar-value"))).toBe(true);
    // The busiest day is 6, so the scale's top is a round 10 and its middle 5.
    expect([...page.querySelectorAll(".ho-grid small")].map(label => label.textContent)).toEqual(["5", "10"]);
    expect(parseFloat(cols[13]!.querySelector<HTMLElement>(".ho-bar")!.style.height)).toBe(60);
    expect([...page.querySelectorAll(".ho-trend .ho-legend > span")].map(key => key.textContent)).toEqual(["工作", "訊息", "例行"]);
    const labels = [...page.querySelectorAll(".ho-xaxis > span")];
    expect(labels[13]!.textContent).toBe("今天");
    // Every third day back from today is named: today and four more of the fourteen.
    expect(labels.filter(label => label.classList.contains("is-minor"))).toHaveLength(9);
    const tip = parse(dayTipHTML(data.days[13]!));
    expect([...tip.querySelectorAll(".ho-tip-row")].map(row => row.textContent)).toEqual(["工作2", "訊息1", "例行3", "沒完成2"]);
    const table = page.querySelector(".ho-sr > table")!;
    expect(table.querySelector("caption")!.textContent).toBe("近兩週完成的事");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(14);
    expect([...table.querySelectorAll("tbody tr:last-child td")].map(cell => cell.textContent)).toEqual(["2", "1", "3", "2"]);
  });

  test("a day's bar shows its figures under the pointer, inside the window", async () => {
    queue.splice(0, queue.length, { ...overview(5), activity: activity() });
    const { page } = await mount();
    const col = page.el.querySelectorAll<HTMLElement>(".ho-col")[13]!;
    col.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const tip = page.el.querySelector<HTMLElement>(".ho-tip")!;
    expect(tip.hidden).toBe(false);
    expect(tip.querySelectorAll(".ho-tip-row")).toHaveLength(4);
    page.el.dispatchEvent(new PointerEvent("pointerleave"));
    expect(tip.hidden).toBe(true);
  });
});

describe("today's schedule", () => {
  test("today's schedule is a band of the day's hours over a table of time, title and kind, every row and nothing for more, each opening its event", async () => {
    const sample = overview(5);
    const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).getTime();
    sample.calendar_items = [
      item("own:4", "own", "Dentist", at(14), { member_id: -1, name: "", added_by: null, end_ms: at(15) }),
      item("routine:1:1", "routine", "Morning digest", at(9), { routine_id: 1 }),
      item("rhythm:2:2026-10-27", "routine", "Inbox sweep", at(0), { all_day: true, rhythm: true, routine_id: 2 }),
      item("event:x", "event", "Design review", at(16)),
      item("event:y", "event", "Tomorrow", new Date(2026, 9, 28, 9).getTime()),
    ];
    sample.calendar_counts = { "2026-10-27": 6 };
    queue.splice(0, queue.length, sample);
    const { page, app } = await mount();
    const rows = [...page.el.querySelectorAll<HTMLElement>(".ho-schedule .ho-event")];
    expect(rows.map(row => row.querySelector("b")!.textContent)).toEqual(["Inbox sweep", "Morning digest", "Dentist", "Design review"]);
    expect(rows.map(row => row.querySelector("time")!.textContent)).toEqual(["", "09:00", "14:00", "16:00"]);
    expect(rows.map(row => row.querySelector(".ho-kind")!.textContent)).toEqual(["例行・Ari", "例行・Ari", "自己的", "行事曆"]);
    expect([...page.el.querySelectorAll(".ho-thead span")].map(cell => cell.textContent)).toEqual(["時間", "事項", "類型"]);
    // A rhythm shows no time (R-CAL-03) and no face; a run that is over is dimmed.
    expect(rows[0]!.classList.contains("is-rhythm") && !rows[0]!.querySelector(".av")).toBe(true);
    expect(rows[1]!.classList.contains("is-past")).toBe(true);
    expect(rows[2]!.classList.contains("is-own")).toBe(true);
    // No 「還有…」 to press (owner, 2026-11-08): the heading's calendar icon is the way to the whole calendar.
    expect(page.el.querySelector(".ho-schedule .ho-more, .ho-count")).toBeNull();
    rows[2]!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations", "calendar:2026-10-27:own%3A4");
    page.el.querySelector<HTMLButtonElement>('.ho-schedule header [data-home-go="calendar"]')!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations");
  });

  test("the band marks each timed entry where it falls, a routine run as a tick, and where the day is now", async () => {
    const { homeHTML } = await load();
    const sample = { ...overview(5), activity: activity() };
    const at = (h: number) => new Date(2026, 9, 27, h).getTime();
    sample.today = [
      item("own:4", "own", "Dentist", at(12), { end_ms: at(18) }),
      ...[6, 9, 12].map(h => item(`routine:5:${at(h)}`, "routine", "Inbox sweep", at(h), { routine_id: 5 })),
      item(`routine:5:${at(15)}`, "routine", "Inbox sweep", at(15), { routine_id: 5, run_status: "error" }),
      item("event:all", "event", "Holiday", at(0), { all_day: true }),
      item("question:1", "question", "Which source?", at(8)),
    ];
    const band = parse(homeHTML(sample)).querySelector('.ho-schedule .ho-band[aria-hidden="true"]')!;
    const marks = [...band.querySelectorAll<HTMLElement>(".ho-mark")];
    expect(marks.map(mark => [mark.className, parseFloat(mark.style.left)])).toEqual([
      ["ho-mark is-own", 50], ["ho-mark is-routine", 25], ["ho-mark is-routine", 37.5], ["ho-mark is-routine", 50], ["ho-mark is-routine is-failed", 62.5]]);
    expect(marks[0]!.getAttribute("style")).toContain("--w:25.00%");
    expect(marks[0]!.dataset.tip).toBe("12:00 Dentist");
    expect(parseFloat(band.querySelector<HTMLElement>(".ho-now")!.style.left)).toBe(41.67);
    expect([...band.querySelectorAll(".ho-band-hours span")].map(hour => hour.textContent)).toEqual(["00", "06", "12", "18", "24"]);
  });

  test("an empty day stays calm and offers to make something today", async () => {
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-schedule .ho-empty")!.textContent).toBe("今天沒有行程");
    expect(page.el.querySelector(".cal-notice")).toBeNull();
    page.el.querySelector<HTMLButtonElement>(".ho-create")!.click();
    expect(app.go).toHaveBeenCalledWith("automations", "calendar-new:2026-10-27");
  });

  test("today is every item of the day in time order, a routine due many times is one row with its count", async () => {
    const { todaysSchedule, homeHTML } = await load();
    const sample = { ...overview(5), activity: activity() };
    const at = (h: number) => new Date(2026, 9, 27, h).getTime();
    sample.today = [
      item("question:1", "question", "Which source?", at(8)),
      ...[8, 10, 12, 14].map(h => item(`routine:5:${at(h)}`, "routine", "Inbox sweep", at(h), { routine_id: 5 })),
      item(`routine:5:${at(11)}`, "routine", "Inbox sweep", at(11), { routine_id: 5, run_status: "error" }),
      item("routine:6:1", "routine", "Morning digest", at(9), { routine_id: 6 }),
      item("event:x", "event", "Design review", at(16)),
    ];
    const rows = todaysSchedule(sample);
    expect(rows.map(({ item: row, times }) => [row.title, times, row.rhythm === true])).toEqual([
      ["Inbox sweep", 4, true], ["Morning digest", 1, false], ["Inbox sweep", 1, false], ["Design review", 1, false]]);
    const page = parse(homeHTML(sample));
    expect(page.querySelector(".ho-event.is-rhythm .ho-times")!.textContent).toBe("4 次");
    expect(page.querySelector('.ho-schedule [data-home-event="question:1"]')).toBeNull();
  });

  test("Home tells not connected from a failed read from nothing, and a closed offer stays closed", async () => {
    const off = overview(5); off.calendar_google = "not_connected";
    queue.splice(0, queue.length, off);
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-schedule .cal-notice")!.textContent).toMatch(/未連接|isn't connected/);
    page.el.querySelector<HTMLButtonElement>('.ho-schedule [data-home-go="connections"]')!.click();
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
    expect(page.el.querySelector('[data-stat="questions"] b')!.textContent).toBe("1");
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
      expect([...page.el.querySelectorAll(".ho-sec h2")].map(h => h.textContent)).toEqual([t("home.schedule"), t("home.trend")]);
      expect(page.el.querySelector('[data-stat="week"] small')!.textContent).toBe(t("home.statWeek"));
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
