// @vitest-environment happy-dom
// Home (pages/home.ts) is Raphael as a secretary: his emblem and greeting, one health line on the team, today's
// schedule, what is still open and what each member does. No spend, allowance or dictation figures; no boxes.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HomeItem, HomeOverview } from "../home-types";
import type { AppContext, MainEvent, Member } from "../types";

const { queue, retained, team } = vi.hoisted(() => ({ queue: [] as unknown[], retained: { value: undefined as unknown }, team: { members: [] as unknown[] } }));
vi.mock("../api", () => ({
  homeOverview: vi.fn(async (refresh = false) => refresh ? retained.value : (retained.value = queue.length > 1 ? queue.shift() : queue[0])),
  membersList: vi.fn(async () => ({ members: team.members, groups: [] })),
  statusCheckOpenrouter: vi.fn(),
}));
vi.mock("../team-navigation", () => ({ openMemberThread: vi.fn() }));

let reduce = true;
let change: ((e: { matches: boolean }) => void) | null = null;

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
const person = (id: number, name: string, more: Partial<Member> = {}): Member => ({
  id, name, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0,
  unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const item = (id: string, kind: HomeItem["kind"], title: string, at: number, more: Partial<HomeItem> = {}): HomeItem => ({
  id, kind, title, summary: "", at_ms: at, member_id: 1, name: "Ari", avatar: "", turn_id: null, conversation_id: null, routine_id: null, ...more,
});

async function load() {
  return import("./home");
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.resetModules();
  change = null;
  reduce = true;
  queue.length = 0;
  queue.push(overview(5));
  team.members = [person(0, "Raphael"), person(1, "Ari"), person(2, "Bo")];
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduce : false,
    media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (change = fn),
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

describe("the secretary's page", () => {
  test("greets the owner by the time of day, with the date, his emblem and no figures of spend or dictation", async () => {
    const { homeHTML } = await load();
    const page = parse(homeHTML(overview(5), team.members as Member[]));
    expect(page.querySelector(".ho-hero h1")!.textContent).toBe("早安，主人");
    expect(page.querySelector(".ho-hero .ho-orb > .av")).not.toBeNull();
    expect(page.querySelector(".ho-date")!.textContent).toContain("27");
    expect(page.querySelectorAll(".ho-board > .ho-sec")).toHaveLength(3);
    expect(page.textContent).not.toMatch(/US\$|%|字/);
    for (const gone of [".ho-card", ".ho-calendar", ".ho-spend", ".ho-allowance", ".ho-dictation", ".ho-bars", ".ho-meter"]) expect(page.querySelector(gone), gone).toBeNull();
    const evening = { ...overview(5), generated_at_ms: new Date(2026, 9, 27, 20).getTime() };
    expect(parse(homeHTML(evening)).querySelector("h1")!.textContent).toBe("晚上好，主人");
  });

  test("the health line names who waits for the owner, and says all is well otherwise", async () => {
    const { healthText, teamOf } = await load();
    const all = team.members as Member[];
    expect(healthText(teamOf(all))).toBe("《告。健康檢查完成，2 位成員都正常。》");
    expect(healthText(teamOf([...all, person(3, "Cy", { hidden: true })]))).toBe("《告。健康檢查完成，2 位成員都正常。》");
    expect(healthText(teamOf([all[0]!, person(1, "Ari", { waiting: true }), person(2, "Bo", { activity: "error", activity_label: "需要你處理" })]))).toBe("《告。健康檢查完成，Ari和Bo 在等你。》");
    expect(healthText([])).toBe("《告。健康檢查完成，一切正常。》");
  });

  test("each member says what it does, the ones who wait for the owner first, and a row opens its conversation", async () => {
    team.members = [person(0, "Raphael"), person(1, "Ari"), person(2, "Bo", { activity: "searching", activity_label: "正在搜尋網路" }), person(3, "Cy", { waiting: true, activity: "blocked", activity_label: "等你回答" }), person(4, "Di", { unread: true })];
    const { page, app } = await mount();
    const rows = [...page.el.querySelectorAll<HTMLElement>(".ho-team .ho-member")];
    expect(rows.map(row => [row.querySelector("strong")!.textContent, row.dataset.state, row.querySelector(".ho-row-copy span")!.textContent]))
      .toEqual([["Cy", "needs", "等你回答"], ["Bo", "busy", "正在搜尋網路"], ["Di", "unread", "有新回覆"], ["Ari", "idle", "待命中"]]);
    expect(page.el.querySelector('.ho-member[data-home-member="0"]')).toBeNull();
    const { openMemberThread } = await import("../team-navigation");
    rows[0]!.click();
    expect(openMemberThread).toHaveBeenCalledWith(app, 3);
  });

  test("a member starting work changes its row and the health line at once, without a read", async () => {
    const { page, emit } = await mount();
    const { membersList } = await import("../api");
    const reads = vi.mocked(membersList).mock.calls.length;
    emit({ type: "MemberActivity", member_id: 2, state: "blocked", label: "等你回答" });
    expect(page.el.querySelector('.ho-member[data-home-member="2"]')!.getAttribute("data-state")).toBe("needs");
    expect(page.el.querySelector(".ho-health")!.textContent).toBe("《告。健康檢查完成，Bo 在等你。》");
    emit({ type: "MemberActivity", member_id: 2, state: "idle" });
    expect(page.el.querySelector('.ho-member[data-home-member="2"]')!.getAttribute("data-state")).toBe("idle");
    expect(vi.mocked(membersList).mock.calls.length).toBe(reads);
  });

  test("today's schedule lists today in time order with the calendar's colour, counts the rest and opens each one", async () => {
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
    // A rhythm shows its face and title, never a time (R-CAL-03); a run that is over is dimmed.
    expect(rows[0]!.classList.contains("is-rhythm") && !!rows[0]!.querySelector(".av")).toBe(true);
    expect(rows[1]!.classList.contains("is-past")).toBe(true);
    expect(rows[2]!.classList.contains("is-own")).toBe(true);
    expect(page.el.querySelector(".ho-schedule .ho-more")!.textContent).toBe("還有 2 個");
    rows[2]!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations", "calendar:2026-10-27:own%3A4");
    page.el.querySelector<HTMLButtonElement>('.ho-schedule header [data-home-go="calendar"]')!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations");
    page.el.querySelector<HTMLButtonElement>(".ho-schedule .ho-more")!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations", "2026-10-27");
  });

  test("an empty day stays calm and offers to make something today", async () => {
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-schedule .ho-empty")!.textContent).toBe("今天沒有行程");
    expect(page.el.querySelector(".cal-notice")).toBeNull();
    page.el.querySelector<HTMLButtonElement>(".ho-create")!.click();
    expect(app.go).toHaveBeenCalledWith("automations", "calendar-new:2026-10-27");
  });

  test("what is still open lists questions and reports, never routines, and opens the conversation at its turn", async () => {
    const sample = overview(5);
    sample.today = [item("question:7", "question", "Which source?", NOW - 60_000, { turn_id: 7 }), item("routine:1:1", "routine", "Morning digest", NOW)];
    sample.reports = [item("report:2", "report", "Research", NOW - 120_000, { member_id: 2, name: "Bo", summary: "Done.", turn_id: 2 })];
    sample.counts = { today: 2, reports: 1, calendar: 0 };
    queue.splice(0, queue.length, sample);
    const { page } = await mount();
    const rows = [...page.el.querySelectorAll<HTMLElement>(".ho-pending .ho-row")];
    expect(rows.map(row => row.dataset.homeItem)).toEqual(["question:7", "report:2"]);
    const { openMemberThread } = await import("../team-navigation");
    rows[1]!.click();
    expect(openMemberThread).toHaveBeenCalledWith(expect.anything(), 2, 2);
    queue.splice(0, queue.length, overview(5));
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

  test("only a report that needs fixing speaks under the health line, with its one fix and no ask", async () => {
    const { homeHTML } = await load();
    expect(parse(homeHTML(overview(5))).querySelector(".ho-alert")).toBeNull();
    const broken = parse(homeHTML(overview(5, "no_key")));
    expect(broken.querySelector(".ho-alert")!.textContent).toContain("OpenRouter");
    expect([...broken.querySelectorAll(".ho-hero button")].map(button => button.getAttribute("data-home-go"))).toEqual(["report"]);
    expect(broken.innerHTML).not.toContain('data-home-go="agent"');
  });

  test("translates the retained Home behind Settings immediately in every locale", async () => {
    const { page } = await mount();
    const { setLocale, t } = await import("../i18n");
    const { homeOverview } = await import("../api");
    const emblem = page.el.querySelector(".ho-orb > .av");
    page.hide();
    const calls = vi.mocked(homeOverview).mock.calls.length;
    try {
      for (const locale of ["en", "ja", "zh-TW"] as const) {
        setLocale(locale);
        expect(page.el.querySelector(".ho-greet")!.textContent).toBe(t("home.greetMorning"));
        expect(page.el.querySelector(".ho-health")!.textContent).toBe(t("home.healthWell", { p0: 2 }));
        expect([...page.el.querySelectorAll(".ho-sec h2")].map(h => h.textContent)).toEqual([t("home.schedule"), t("home.pending"), t("members.title")]);
        expect(page.el.querySelector(".ho-pending .ho-empty")!.textContent).toBe(t("overview.allClear"));
        expect(page.el.querySelector('.ho-member[data-home-member="1"] .ho-row-copy span')!.textContent).toBe(t("home.stateIdle"));
      }
      expect(vi.mocked(homeOverview).mock.calls.length).toBe(calls);
      expect(page.el.querySelector(".ho-orb > .av")).toBe(emblem);
    } finally { setLocale("zh-TW"); }
  });
});

describe("Raphael's arrival", () => {
  test("he flies in once a day when motion is allowed, and the mark goes when his outer ring has gone", async () => {
    reduce = false;
    const { page } = await mount();
    expect(page.el.hasAttribute("data-arrive")).toBe(true);
    const orb = page.el.querySelector(".ho-orb")!;
    const ended = (animationName: string, pseudoElement: string) => orb.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }), { animationName, pseudoElement }));
    // A part that ends early (as the sections do when motion is held) leaves him arriving.
    ended("ho-rise", ""); ended("ho-ring", "::before");
    expect(page.el.hasAttribute("data-arrive")).toBe(true);
    ended("ho-ring", "::after");
    expect(page.el.hasAttribute("data-arrive")).toBe(false);
    page.hide(); page.el.remove();
    const again = await mount();
    expect(again.page.el.hasAttribute("data-arrive")).toBe(false);
  });

  test("under reduced motion he is simply there, and the day still counts as seen", async () => {
    const { page } = await mount();
    expect(page.el.hasAttribute("data-arrive")).toBe(false);
    expect(localStorage.getItem("raphael.home.arrived")).not.toBeNull();
  });
});

describe("the emblem", () => {
  test("turns while the window allows motion", async () => {
    reduce = false;
    const { homeHTML } = await load();
    const emblem = parse(homeHTML(overview(5))).querySelector(".ho-orb > .av")!;
    expect([...emblem.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(["/brand/app-emblem-light-loop.webp", "/brand/app-emblem-dark-loop.webp"]);
  });

  test("stands still under reduced motion, and turns again when the preference goes", async () => {
    const { page } = await mount();
    const sources = (): (string | null)[] => [...page.el.querySelectorAll(".ho-orb > .av img")].map((image) => image.getAttribute("src"));
    expect(sources()).toEqual(["/brand/app-emblem-light-128.webp", "/brand/app-emblem-dark-128.webp"]);
    expect(change).not.toBeNull();
    change!({ matches: false });
    expect(sources()).toEqual(["/brand/app-emblem-light-loop.webp", "/brand/app-emblem-dark-loop.webp"]);
    change!({ matches: true });
    expect(sources().join()).not.toContain("loop");
  });

  test("is drawn again by a refresh without starting his turn over: the emblem stays the same node", async () => {
    reduce = false;
    const first = overview(2), second = overview(2);
    second.reports = [item("report:2", "report", "Research", NOW, { member_id: 2, name: "Bo", summary: "Done." })];
    queue.splice(0, queue.length, first, second);
    const { page, emit } = await mount();
    const emblem = page.el.querySelector(".ho-orb > .av")!;
    emit({ type: "AgentTurn" } as MainEvent);
    await new Promise(resolve => setTimeout(resolve, 400));
    await flush();
    expect(page.el.querySelector(".ho-orb > .av")).toBe(emblem);
    expect(page.el.querySelectorAll(".ho-pending .ho-row")).toHaveLength(1);
  });
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
