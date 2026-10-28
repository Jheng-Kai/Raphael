// @vitest-environment happy-dom
// Home's hero (pages/home.ts): Raphael's emblem turns while the window allows motion and stands still when
// the person asked for less; nothing beside his report asks him, and a refresh does not start his turn over.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HomeOverview } from "../home-types";
import type { AppContext, MainEvent } from "../types";

const { queue } = vi.hoisted(() => ({ queue: [] as unknown[] }));
vi.mock("../api", () => ({ homeOverview: vi.fn(async () => queue.length > 1 ? queue.shift() : queue[0]), statusCheckOpenrouter: vi.fn() }));
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
  vi.resetModules();
  return import("./home");
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
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
  return { page, emit: (event: MainEvent) => heard.forEach((handler) => handler(event)) };
}

describe("the hero", () => {
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
        expect(page.el.querySelector(".ho-today h2")!.textContent).toContain(t("overview.today"));
        for (const [card, key] of [["pending", "overview.pending"], ["reports", "overview.reports"], ["spend", "overview.month"], ["allowance", "overview.allowance"], ["dictation", "nav.dictation"]] as const) {
          expect(page.el.querySelector(`.ho-${card} :is(h2, h3)`)!.textContent).toContain(t(key));
        }
        expect(page.el.querySelector(".ho-said")!.textContent).toBe(buildReport(sample.report, sample.generated_at_ms).text);
        expect(page.el.querySelector(".ho-today .ho-empty")!.textContent).toBe(t("overview.noSchedule"));
        expect(page.el.querySelector(".ho-pending .ho-empty")!.textContent).toBe(t("overview.nothing"));
        expect(page.el.querySelector(".ho-reports .ho-empty")!.textContent).toBe(t("overview.noReports"));
        expect(page.el.querySelector(".ho-meter-row small")!.textContent).toBe("Codex");
        expect(page.el.querySelector(".ho-meter-row")!.getAttribute("title")).toContain(t("overview.reset", { p0: "" }));
        expect(page.el.querySelector(".ho-spend svg[role=img]")!.getAttribute("aria-label")).toBe(t("overview.chart", { p0: "0.00, 5.00" }));
        expect(page.el.querySelector(".ho-dictation .ho-bars")!.getAttribute("aria-label")).toBe(t("overview.wordsChart", { p0: "" }));
        expect(page.el.querySelector(".ho-dictation .ho-big small")!.textContent).toBe(t("home.003"));
        expect(page.el.querySelector(".ho-dictation .ho-sub")!.textContent).toBe(`${t("home.005")} 0${t("unit.seconds")}`);
        for (const open of page.el.querySelectorAll(".ho-open")) expect(open.getAttribute("aria-label")).toBe(t("overview.all"));
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
