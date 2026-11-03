// @vitest-environment happy-dom
// Home's hero (pages/home.ts): Raphael's emblem turns while the window allows motion and stands still when
// the person asked for less; nothing beside his report asks him, and a refresh does not start his turn over.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HomeOverview } from "../home-types";
import type { AppContext, MainEvent } from "../types";

const { queue, retained } = vi.hoisted(() => ({ queue: [] as unknown[], retained: { value: undefined as unknown } }));
vi.mock("../api", () => ({ homeOverview: vi.fn(async (refresh = false) => refresh ? retained.value : (retained.value = queue.length > 1 ? queue.shift() : queue[0])), statusCheckOpenrouter: vi.fn() }));
vi.mock("../team-navigation", () => ({ openMemberThread: vi.fn() }));

let reduce = true;
let change: ((e: { matches: boolean }) => void) | null = null;

const overview = (month: number, state: "ok" | "no_key" = "ok"): HomeOverview => ({
  generated_at_ms: Date.UTC(2026, 9, 27, 4, 0),
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
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") ? reduce : false,
    media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (change = fn),
    removeEventListener() {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hero = (html: string): HTMLElement => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector<HTMLElement>(".ho-hero")!;
};

/** The page as the app mounts it, and the events its refreshes hear. */
async function mount() {
  const { createHome } = await load();
  const heard: ((event: MainEvent) => void)[] = [];
  const app = { go: vi.fn(), onEvent: (handler: (event: MainEvent) => void) => (heard.push(handler), () => {}), cleared: { on: () => () => {} } } as unknown as AppContext;
  const page = createHome(app);
  document.body.append(page.el);
  page.show();
  await flush();
  return { page, app, emit: (event: MainEvent) => heard.forEach((handler) => handler(event)) };
}

describe("the hero", () => {
  test("Home rhythm copy keeps only its face and title and exceptions remain visible", async () => {
    const sample=overview(5), base={id:"rhythm:1",kind:"routine" as const,title:"Review samples",summary:"",at_ms:new Date(2026,9,27).getTime(),member_id:1,name:"Sample",avatar:"",turn_id:null,conversation_id:null,routine_id:1,all_day:true};
    sample.calendar_items=[{...base,rhythm:true,rhythm_schedule:{kind:"every",hours:3,from:"08:00",to:"23:00"}},...(["error","confirm"] as const).map((run_status,i)=>({...base,id:`run:${i}`,all_day:false,run_status}))];
    sample.calendar_counts={"2026-10-27":3};
    queue.splice(0,queue.length,sample);
    const {page}=await mount();
    const bars=[...page.el.querySelectorAll('.is-rhythm')];
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every(bar=>bar.querySelector('.av') && bar.querySelector('b')?.textContent===base.title && !bar.querySelector('small, time'))).toBe(true);
    const marks=[...page.el.querySelectorAll('.cal-run-mark')];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every(mark=>!mark.closest('.cal-chip')!.classList.contains('is-past'))).toBe(true);
    page.hide();page.el.remove();
  });
  test("the month has weekday headings, today and schedule dots, and opens the chosen day", async () => {
    const sample = overview(5);
    sample.calendar_days = ["2026-10-02", "2026-10-30"];
    queue.splice(0, queue.length, sample);
    const { page, app } = await mount();
    expect(page.el.querySelectorAll('.ho-weekday')).toHaveLength(7);
    expect(page.el.querySelectorAll('.ho-day')).toHaveLength(42);
    expect(page.el.querySelectorAll('.ho-day[aria-current="date"]')).toHaveLength(1);
    expect(page.el.querySelectorAll('.ho-dots i')).toHaveLength(2);
    expect(page.el.querySelector('.ho-week')).toBeNull();
    page.el.querySelector<HTMLButtonElement>('[data-home-select="2026-10-30"]')!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations", "2026-10-30");
    page.el.querySelector<HTMLButtonElement>('.ho-calendar > .ho-target')!.click();
    expect(app.go).toHaveBeenLastCalledWith("automations");
    page.hide(); page.el.remove();
  });
  const own = (title: string): HomeOverview["calendar"][number] => ({ id: "own:4", kind: "own", event_id: 4, title, summary: "", at_ms: new Date(2026, 9, 27, 14).getTime(), end_ms: new Date(2026, 9, 27, 15).getTime(), member_id: -1, name: "", avatar: "", turn_id: null, conversation_id: null, routine_id: null, all_day: false, notes: "", added_by: null });
  test("the block draws the calendar's own chip, and a click opens that event on the Calendar page", async () => {
    const sample = overview(5);
    sample.calendar_items = [own("Dentist")]; sample.calendar_counts = { "2026-10-27": 1 };
    queue.splice(0, queue.length, sample);
    const { page, app } = await mount();
    const chip = page.el.querySelector<HTMLButtonElement>('.ho-agenda .cal-chip.is-own')!;
    expect(chip.querySelector("time")!.textContent).toBe("14:00");
    expect(chip.querySelector("b")!.textContent).toBe("Dentist");
    chip.click();
    expect(app.go).toHaveBeenCalledWith("automations", "calendar:2026-10-27:own%3A4");
    page.hide(); page.el.remove();
  });
  test("an empty day stays calm and offers to make something on that day", async () => {
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-day-empty")).not.toBeNull();
    expect(page.el.querySelector(".cal-notice")).toBeNull();
    page.el.querySelector<HTMLButtonElement>(".ho-create-day")!.click();
    expect(app.go).toHaveBeenCalledWith("automations", "calendar-new:2026-10-27");
    page.hide(); page.el.remove();
  });
  test("Home tells not connected from a failed read from nothing, and a closed offer stays closed", async () => {
    localStorage.clear();
    const off = overview(5); off.calendar_google = "not_connected";
    queue.splice(0, queue.length, off);
    const { page, app } = await mount();
    expect(page.el.querySelector(".ho-calendar-note .cal-notice")!.textContent).toMatch(/未連接|isn't connected/);
    page.el.querySelector<HTMLButtonElement>('.ho-calendar-note [data-home-go="connections"]')!.click();
    expect(app.go).toHaveBeenCalledWith("settings", "connections");
    page.el.querySelector<HTMLButtonElement>("[data-home-dismiss]")!.click();
    expect(page.el.querySelector(".cal-notice")).toBeNull();
    page.hide(); page.el.remove();
    const failed = overview(5); failed.calendar_google = "unreadable";
    queue.splice(0, queue.length, failed);
    const second = await mount();
    expect(second.page.el.querySelector(".cal-notice")!.textContent).toMatch(/讀不到|can't be read/);
    expect(second.page.el.querySelector("[data-home-dismiss]")).toBeNull();
    second.page.hide(); second.page.el.remove();
    localStorage.clear();
  });
  test("month arrows request the selected month while a vertical wheel leaves it unchanged", async () => {
    const { page, app } = await mount();
    const { homeOverview } = await import("../api");
    page.el.querySelector<HTMLButtonElement>('[data-home-month="1"]')!.click(); await flush();
    expect(page.el.querySelector('.ho-calendar')?.getAttribute('data-month')).toBe('2026-11');
    expect(homeOverview).toHaveBeenCalledWith(true, '2026-11');
    page.el.querySelector('.ho-calendar')!.dispatchEvent(new WheelEvent('wheel', {bubbles:true,deltaY:100,deltaX:0}));
    expect(page.el.querySelector('.ho-calendar')?.getAttribute('data-month')).toBe('2026-11');
    expect(app.go).not.toHaveBeenCalled();
    page.hide(); page.el.remove();
  });
  test("paints local records before the shared live refresh and does not reload on its completion", async () => {
    const { homeOverview } = await import("../api");
    let finish!: (value: HomeOverview) => void;
    vi.mocked(homeOverview).mockResolvedValueOnce(overview(2)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { page } = await mount();
    expect(page.el.querySelector('.ho-spend .ho-big')?.textContent).toContain('2.00');
    const before = vi.mocked(homeOverview).mock.calls.length;
    const emblem = page.el.querySelector('.ho-hero > .av');
    finish(overview(3));
    await flush();
    expect(page.el.querySelector('.ho-spend .ho-big')?.textContent).toContain('3.00');
    expect(page.el.querySelector('.ho-hero > .av')).toBe(emblem);
    expect(vi.mocked(homeOverview).mock.calls.length).toBe(before);
    page.hide(); page.el.remove();
  });
  test("translates the retained Home behind Settings immediately in every locale", async () => {
    const sample = overview(5);
    sample.usage.allowances.brains.push({ id: "codex", name: "Codex CLI", windows: [{ period: "fiveHour", remaining_percent: 75, resets_at: 1_800_000_000 }] });
    queue.splice(0, queue.length, sample);
    const { page } = await mount();
    const { setLocale, t } = await import("../i18n");
    const { homeOverview } = await import("../api");
    const { buildReport } = await import("../report");
    const emblem = page.el.querySelector(".ho-hero > .av");
    page.hide();
    const calls = vi.mocked(homeOverview).mock.calls.length;
    try {
      for (const locale of ["en", "ja", "zh-TW"] as const) {
        setLocale(locale);
        // Settings retains the page DOM. Translation must not wait for another RPC or show().
        expect(page.el.querySelector(".ho-calendar h2")!.textContent).toBe(new Date(sample.generated_at_ms).toLocaleDateString(locale, { year: "numeric", month: "long" }));
        for (const [card, key] of [["inbox", "overview.needsYou"], ["spend", "overview.month"], ["allowance", "overview.allowance"], ["dictation", "nav.dictation"]] as const) {
          expect(page.el.querySelector(`.ho-${card} :is(h2, h3)`)!.textContent).toContain(t(key));
        }
        expect(page.el.querySelector(".ho-said")!.textContent).toBe(buildReport(sample.report, sample.generated_at_ms).text);
        expect(page.el.querySelector(".ho-inbox .ho-empty")!.textContent).toBe(t("overview.allClear"));
        expect(page.el.querySelector(".ho-meter-row small")!.textContent).toBe("Codex");
        expect(page.el.querySelector(".ho-meter-row")!.getAttribute("title")).toContain(t("overview.reset", { p0: "" }));
        expect(page.el.querySelector(".ho-spend svg[role=img]")!.getAttribute("aria-label")).toBe(t("overview.chart", { p0: "0.00, 5.00" }));
        expect(page.el.querySelector(".ho-dictation .ho-bars")).toBeNull();
        expect(page.el.querySelector(".ho-dictation .ho-chart")!.textContent).toBe(t("overview.noDictation"));
        expect(page.el.querySelector(".ho-dictation .ho-big small")!.textContent).toBe(t("home.003"));
        expect(page.el.querySelector(".ho-dictation .ho-sub")!.textContent).toBe(`${t("home.005")} 0${t("unit.seconds")}`);
        for (const target of page.el.querySelectorAll(".ho-target")) expect(target.getAttribute("aria-label")).toBe(target.closest(".ho-calendar") ? t("overview.calendar") : target.parentElement!.querySelector("h2")!.childNodes[0].textContent);
      }
      expect(vi.mocked(homeOverview).mock.calls.length).toBe(calls);
      expect(page.el.querySelector(".ho-hero > .av")).toBe(emblem);
    } finally { setLocale("zh-TW"); page.el.remove(); }
  });

  test("is his emblem and his report, and nothing beside the report asks him", async () => {
    const { homeHTML } = await load();
    const well = hero(homeHTML(overview(5)));
    expect([...well.children].map((child) => child.className)).toEqual(["av", "ho-lead-copy"]);
    expect(well.querySelector("button")).toBeNull();
    // a report that needs fixing keeps its one icon, and it is not an ask
    const broken = hero(homeHTML(overview(5, "no_key")));
    expect([...broken.querySelectorAll("button")].map((button) => button.getAttribute("data-home-go"))).toEqual(["report"]);
    for (const html of [well.outerHTML, broken.outerHTML]) {
      expect(html).not.toContain("ho-ask");
      expect(html).not.toContain('data-home-go="agent"');
    }
  });

  test("shows his emblem turning while the window allows motion", async () => {
    reduce = false;
    const { homeHTML } = await load();
    const emblem = hero(homeHTML(overview(5))).querySelector(".av")!;
    expect([...emblem.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(["/brand/app-emblem-light-loop.webp", "/brand/app-emblem-dark-loop.webp"]);
  });

  test("stands his emblem still under reduced motion, and turns it again when the preference goes", async () => {
    const { page } = await mount();
    const sources = (): (string | null)[] => [...page.el.querySelectorAll(".ho-hero > .av img")].map((image) => image.getAttribute("src"));
    expect(sources()).toEqual(["/brand/app-emblem-light-128.webp", "/brand/app-emblem-dark-128.webp"]);
    expect(change).not.toBeNull();
    change!({ matches: false });
    expect(sources()).toEqual(["/brand/app-emblem-light-loop.webp", "/brand/app-emblem-dark-loop.webp"]);
    change!({ matches: true });
    expect(sources().join()).not.toContain("loop");
    page.hide();
  });

  test("is drawn again by a refresh without starting his turn over: the emblem stays the same node", async () => {
    reduce = false;
    queue.splice(0, queue.length, overview(2), overview(11));
    const { page, emit } = await mount();
    const emblem = page.el.querySelector(".ho-hero > .av")!;
    const said = page.el.querySelector(".ho-said")!.textContent;
    emit({ type: "QuotaChanged" });
    await flush();
    expect(page.el.querySelector(".ho-hero > .av")).toBe(emblem);
    expect(emblem.isConnected).toBe(true);
    // the words and the board are the new ones
    expect(page.el.querySelector(".ho-said")!.textContent).not.toBe(said);
    expect(page.el.querySelectorAll(".ho-hero").length).toBe(1);
    expect(page.el.querySelectorAll(".ho-board").length).toBe(1);
    expect(page.el.querySelector(".ho-spend .ho-big")!.textContent).toContain("11.00");
    page.hide();
  });
});


test("Home ticks use cached allowances for five minutes and resume once after being hidden", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const { page } = await mount();
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
  page.hide(); page.el.remove(); vi.useRealTimers();
});
