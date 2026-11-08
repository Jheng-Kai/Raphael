import { visibilityGate } from "../window-visibility";
// Home (owner, 2026-11-08): Raphael's emblem, alive, beside the greeting and his line; then the day in numbers and
// pictures: four figures, today's hours as a band over today's schedule as a table, and what was finished on each of
// the last two weeks as a chart. No member rows, open-item list, yesterday paragraph or health check, and no slime:
// 「我希望它更有圖像的感覺…表格啊、數據啊、文字啊」.
import * as api from "../api";
import { eventRead } from '../event-read';
import { Emblem } from "../../overlay/emblem";
import { chipClock, dismissOffer, googleNoticeHTML, runMarkHTML } from "../calendar-view";
import type { GoogleCalendarState, HomeActivity, HomeActivityDay, HomeItem, HomeOverview } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
import { loadingHTML } from "../loading";
import { buildReport } from "../report";
import { dateKey } from "../schedule-picker";
import { plainReplies } from "../../shared/anime";
import { openMemberThread } from "../team-navigation";
import type { AppContext, CalendarCreate, CalendarDate, CalendarEventFocus, Page } from "../types";
import { esc, ico, iconButton, patchHTML } from "../ui";
import "../home.css";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The emblem's diameter on Home, and in a narrow window (the main area 760 px or less). */
const EMBLEM_PX = 96, EMBLEM_NARROW_PX = 72;
/** He speaks his line once he has appeared (the appear animation takes 0.833 s), for this long. */
const SPEAK_DELAY_MS = 900, SPEAK_S = 2.8;
/** Then the canvas holds still and the compositor turns it; with reduced motion it settles once its first frame is drawn. */
const SETTLE_MS = SPEAK_DELAY_MS + SPEAK_S * 1000 + 300, SETTLE_STILL_MS = 300;

const clock = (at: number): string => new Date(at).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function greeting(at: number): string {
  const hour = new Date(at).getHours();
  return t(hour >= 5 && hour < 12 ? "home.greetMorning" : hour >= 12 && hour < 18 ? "home.greetAfternoon" : "home.greetEvening");
}

/** Today's schedule as one list: the core's every item of today (calendar, own events, routine runs), questions aside.
 * A routine due many times a day is one row with its count, as the calendar's rhythm bar (R-CAL-03). */
export function todaysSchedule(data: HomeOverview): { item: HomeItem; times: number }[] {
  const today = dateKey(new Date(data.generated_at_ms));
  const all = data.activity ? data.today.filter(item => item.kind !== "question")
    : (data.calendar_items ?? data.calendar).filter(item => dateKey(new Date(item.at_ms)) === today);
  const runs = new Map<number, HomeItem[]>();
  for (const item of all) if (item.kind === "routine" && item.routine_id !== null && !item.run_status) runs.set(item.routine_id, [...(runs.get(item.routine_id) ?? []), item]);
  const rows: { item: HomeItem; times: number }[] = [];
  for (const item of all) {
    const same = item.kind === "routine" && item.routine_id !== null && !item.run_status ? runs.get(item.routine_id)! : null;
    if (same && same.length > 2) {
      if (same[0] === item) rows.push({ item: { ...item, rhythm: true, all_day: true }, times: same.length });
    } else rows.push({ item, times: 1 });
  }
  return rows.sort((a, b) => Number(b.item.all_day === true) - Number(a.item.all_day === true) || a.item.at_ms - b.item.at_ms);
}

const questionsOf = (data: HomeOverview): HomeItem[] => data.today.filter(item => item.kind === "question").sort((a, b) => b.at_ms - a.at_ms);
/** Everything finished on a day: the owner's work, messages handled and routines run well. */
export const doneOn = (day: HomeActivityDay): number => day.work + day.messages + day.routines_ok;

/** Raphael's line when he has not written one: today's schedule and what waits for the owner, in one sentence. */
export function dayLine(data: HomeOverview): string {
  const events = todaysSchedule(data).length, questions = questionsOf(data).length;
  if (events && questions) return t("home.lineBoth", { p0: events, p1: questions });
  if (events) return t("home.lineEvents", { p0: events });
  if (questions) return t("home.lineQuestions", { p0: questions });
  return t("home.lineQuiet");
}

/** His line as he says it: his own lead word first (告。), unless his words already open with one (owner, 2026-11-08:
 * Raphael's 告／否 wherever he speaks). The 《…》 caption wrapper stays the desktop's (R-UI-42). */
export function raphaelSays(words: string): string {
  const lead = t("home.notice");
  return /^(告|解|否|是)。|^(Notice|Answer|No|Yes)\./.test(words.trim()) ? words : `${lead}${words}`;
}

function heroCopyHTML(data: HomeOverview): string {
  const report = buildReport(data.report, data.generated_at_ms);
  const date = new Date(data.generated_at_ms).toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "long" });
  // Only a report that needs fixing speaks here, with its one fix. The main window shows his words plainly (R-UI-42).
  const alert = report.action ? `<p class="ho-alert">${esc(plainReplies([report.text])[0] ?? report.text)}${iconButton(report.action.target === "retry" ? "refresh" : "info", report.action.label, ' data-home-go="report"')}</p>` : "";
  const words = data.today_plan?.state === "ready" && data.today_plan.narrative ? data.today_plan.narrative : dayLine(data);
  return `<p class="ho-date">${esc(date)}</p><h1 class="ho-greet">${esc(greeting(data.generated_at_ms))}</h1><p class="ho-line" role="status">${esc(raphaelSays(words))}</p>${alert}`;
}

/** One figure: its name, the number and a few words under it. A figure that leads somewhere is a button. */
function statHTML(key: string, label: string, value: string, words: string, o: { attrs?: string; tone?: "up" | "bad" } = {}): string {
  const inner = `<small>${esc(label)}</small><b>${value}</b><span${o.tone ? ` class="is-${o.tone}"` : ""}>${esc(words)}</span>`;
  return o.attrs ? `<button type="button" class="btn ho-stat" data-stat="${key}"${o.attrs}>${inner}</button>` : `<div class="ho-stat" data-stat="${key}">${inner}</div>`;
}

function statsHTML(data: HomeOverview): string {
  const now = data.generated_at_ms, rows = todaysSchedule(data), activity = data.activity;
  const next = rows.map(row => row.item).filter(item => !item.all_day && item.at_ms >= now).sort((a, b) => a.at_ms - b.at_ms)[0];
  const tiles = [statHTML("events", t("home.statEvents"), String(rows.length),
    next ? t("home.next", { p0: clock(next.at_ms), p1: next.title }) : t(rows.length ? "home.dayOver" : "overview.noSchedule"), { attrs: ' data-home-go="calendar"' })];
  if (activity) {
    const { routines_due: due, routines_done: done, routines_failed: failed } = activity.today;
    const left = Math.max(0, due - done - failed);
    const words = failed ? t("home.routinesFailed", { p0: failed }) : left ? t("home.routinesLeft", { p0: left }) : t(due ? "home.routinesDone" : "home.routinesNone");
    tiles.push(statHTML("routines", t("home.statRoutines"), `${done}<em>/${due}</em>`, words, failed ? { tone: "bad" } : {}));
  }
  const questions = questionsOf(data);
  tiles.push(questions.length
    ? statHTML("questions", t("home.statQuestions"), String(questions.length), t("home.questionsNewest", { p0: questions[0]!.title }), { attrs: ` data-home-item="${esc(questions[0]!.id)}"` })
    : statHTML("questions", t("home.statQuestions"), "0", t("home.questionsNone")));
  if (activity) {
    const week = activity.days.slice(-7).reduce((sum, day) => sum + doneOn(day), 0);
    const before = activity.days.slice(-14, -7).reduce((sum, day) => sum + doneOn(day), 0);
    const change = week - before;
    tiles.push(statHTML("week", t("home.statWeek"), String(week),
      change > 0 ? `▲ ${t("home.weekUp", { p0: change })}` : change < 0 ? `▼ ${t("home.weekDown", { p0: -change })}` : t("home.weekSame"), change > 0 ? { tone: "up" } : {}));
  }
  return `<div class="ho-stats" style="--tiles:${tiles.length}">${tiles.join("")}</div>`;
}

/** Where a time of day falls on today's band, 0 to 100. */
const bandAt = (at: number, start: number): number => Math.max(0, Math.min(100, (at - start) / DAY * 100));

/** Today's hours as a band: each timed entry where it falls (an event as long as it lasts, a routine run as a tick), and
 * where the day is now. It is a picture of the table under it, which carries the words and the presses. */
function bandHTML(data: HomeOverview): string {
  const now = data.generated_at_ms, start = new Date(now).setHours(0, 0, 0, 0);
  const timed = data.today.filter(item => item.kind !== "question" && !item.all_day && !item.rhythm);
  const marks = timed.map(item => {
    const kind = item.kind === "routine" ? "routine" : item.kind === "own" ? "own" : "event";
    const left = bandAt(item.at_ms, start), end = item.end_ms ?? item.at_ms;
    const width = kind === "routine" ? 0 : Math.max(0, bandAt(end, start) - left);
    const tip = `${chipClock({ allDay: false, start: item.at_ms })} ${item.title}`;
    return `<i class="ho-mark is-${kind}${item.run_status === "error" ? " is-failed" : ""}" style="left:${left.toFixed(2)}%;--w:${width.toFixed(2)}%" data-tip="${esc(tip)}"></i>`;
  }).join("");
  const hours = [0, 6, 12, 18, 24].map(hour => `<span style="left:${hour / 24 * 100}%">${String(hour).padStart(2, "0")}</span>`).join("");
  return `<div class="ho-band" aria-hidden="true"><div class="ho-band-track">${marks}<i class="ho-now" style="left:${bandAt(now, start).toFixed(2)}%"></i></div>` +
    `<div class="ho-band-hours">${hours}</div></div>`;
}

/** What kind of entry a row is, in words: the calendar, the owner's own, or a member's routine. */
function kindWords(item: HomeItem): string {
  if (item.kind === "routine") return item.name ? t("home.kindRoutine", { p0: item.name }) : t("home.countRoutines");
  return t(item.kind === "own" ? "home.kindOwn" : "home.kindEvent");
}

/** One row of today's table: time, title, kind. A routine due `times` times today says so after its title. */
function eventRowHTML(item: HomeItem, now: number, times = 1): string {
  const kind = item.kind === "own" ? "own" : item.kind === "routine" ? "routine" : "event";
  const mark = runMarkHTML({ run: item.run_status ? { status: item.run_status } : undefined });
  // A rhythm is the calendar's quiet bar: no time (R-CAL-03).
  const when = item.rhythm ? `<span class="ho-repeat" aria-hidden="true">${ico("repeat")}</span>` : esc(chipClock({ allDay: item.all_day === true, start: item.at_ms }));
  const past = !mark && !item.all_day && (item.end_ms ?? item.at_ms + HOUR) <= now;
  const count = times > 1 ? `<small class="ho-times">${esc(t("home.times", { p0: times }))}</small>` : "";
  return `<button type="button" class="btn ho-row ho-event is-${kind}${item.rhythm ? " is-rhythm" : ""}${past ? " is-past" : ""}"` +
    ` data-home-event="${esc(item.id)}" data-home-date="${dateKey(new Date(item.at_ms))}"><time>${when}</time>` +
    `<span class="ho-title"><b>${esc(item.title)}</b>${count}${mark}</span><span class="ho-kind">${esc(kindWords(item))}</span></button>`;
}

function scheduleHTML(data: HomeOverview): string {
  const now = data.generated_at_ms, today = dateKey(new Date(now));
  const rows = todaysSchedule(data);
  // Every item of today, all drawn: no 「還有…」 to press (owner, 2026-11-08).
  const notice = googleNoticeHTML(data.calendar_google, { go: 'data-home-go="connections"', dismiss: "data-home-dismiss" });
  const table = rows.length
    ? `<div class="ho-thead" aria-hidden="true"><span>${esc(t("home.colTime"))}</span><span>${esc(t("home.colTitle"))}</span><span>${esc(t("home.colKind"))}</span></div>` +
      rows.map(({ item, times }) => eventRowHTML(item, now, times)).join("")
    : `<p class="ho-empty">${esc(t("overview.noSchedule"))}${iconButton("plus", t("auto.create"), ` data-home-create="${today}"`, "ho-create")}</p>`;
  return sectionHTML("schedule", t("home.schedule"), bandHTML(data) + table + notice, iconButton("calendar", t("overview.calendar"), ' data-home-go="calendar"'));
}

/** The three kinds of finished work, bottom of a bar first, in the chart's fixed colours (validated for colour blindness). */
const SERIES = [["work", "home.countWork"], ["messages", "home.countMessages"], ["routines", "home.countRoutines"]] as const;
type Series = (typeof SERIES)[number][0];
const seriesValue = (day: HomeActivityDay, key: Series): number => key === "routines" ? day.routines_ok : day[key];

/** A round top for the scale: 1, 2, 5, 10, 20, 50… at or above the busiest day. */
function niceTop(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find(step => step * power >= value) ?? 10) * power;
}

const dayLabel = (date: string, o: Intl.DateTimeFormatOptions): string => new Date(`${date}T12:00:00`).toLocaleDateString(getLocale(), o);

/** The day's figures as the tooltip shows them: the date, each kind with its swatch, and what failed. */
export function dayTipHTML(day: HomeActivityDay): string {
  const rows = SERIES.map(([key, label]) => `<span class="ho-tip-row"><i class="ho-key" data-s="${key}"></i>${esc(t(label))}<b>${seriesValue(day, key)}</b></span>`).join("");
  const failed = day.failed + day.routines_failed;
  return `<strong>${esc(dayLabel(day.date, { month: "numeric", day: "numeric", weekday: "short" }))}</strong>${rows}` +
    (failed ? `<span class="ho-tip-row is-bad"><i class="ho-key" data-s="failed"></i>${esc(t("home.countFailed"))}<b>${failed}</b></span>` : "");
}

/** The last fourteen days as stacked bars of what was finished, today's labelled with its total, a scale of two quiet
 * lines, a tooltip on each day, and the same figures as a table for a screen reader. */
function trendHTML(activity: HomeActivity): string {
  const days = activity.days, top = niceTop(Math.max(0, ...days.map(doneOn)));
  const legend = `<span class="ho-legend">${SERIES.map(([key, label]) => `<span><i class="ho-key" data-s="${key}"></i>${esc(t(label))}</span>`).join("")}</span>`;
  const cols = days.map((day, index) => {
    const total = doneOn(day), today = index === days.length - 1;
    const parts = SERIES.map(([key]) => seriesValue(day, key) ? `<i data-s="${key}" style="flex-grow:${seriesValue(day, key)}"></i>` : "").join("");
    const bar = total ? `<span class="ho-bar" style="height:${(total / top * 100).toFixed(2)}%">${parts}</span>` : `<span class="ho-bar is-zero"></span>`;
    // Today's total stands over its bar, a 0 included (an empty day says so in a number).
    const value = today ? `<small class="ho-bar-value" style="bottom:${(total / top * 100).toFixed(2)}%">${total}</small>` : "";
    return `<div class="ho-col${today ? " is-today" : ""}" data-tip-day="${index}">${bar}${value}</div>`;
  }).join("");
  const labels = days.map((day, index) => {
    const fromToday = days.length - 1 - index;
    const words = fromToday === 0 ? t("home.today") : dayLabel(day.date, { month: "numeric", day: "numeric" });
    // Every third day back from today is named, so the labels breathe in a narrow panel too.
    return `<span class="${fromToday === 0 ? "is-today" : fromToday % 3 ? "is-minor" : ""}">${esc(words)}</span>`;
  }).join("");
  const grid = [top / 2, top].map(value => `<span class="ho-grid" style="bottom:${value / top * 100}%"><small>${value}</small></span>`).join("");
  const empty = days.every(day => doneOn(day) === 0) ? `<p class="ho-empty">${esc(t("home.trendEmpty"))}</p>` : "";
  const table = `<div class="ho-sr"><table><caption>${esc(t("home.trend"))}</caption><thead><tr><th>${esc(t("home.colDate"))}</th>` +
    `${SERIES.map(([, label]) => `<th>${esc(t(label))}</th>`).join("")}<th>${esc(t("home.countFailed"))}</th></tr></thead><tbody>` +
    days.map(day => `<tr><th>${esc(dayLabel(day.date, { month: "numeric", day: "numeric" }))}</th>${SERIES.map(([key]) => `<td>${seriesValue(day, key)}</td>`).join("")}` +
      `<td>${day.failed + day.routines_failed}</td></tr>`).join("") + `</tbody></table></div>`;
  const chart = `<div class="ho-chart" aria-hidden="true"><div class="ho-plot">${grid}<div class="ho-cols">${cols}</div></div><div class="ho-xaxis">${labels}</div></div>`;
  return sectionHTML("trend", t("home.trend"), empty + chart + table, legend);
}

function sectionHTML(key: string, title: string, body: string, action = ""): string {
  return `<section class="ho-sec ho-${key}" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2>${action}</header><div class="ho-rows">${body}</div></section>`;
}

function boardHTML(data: HomeOverview): string {
  return statsHTML(data) + `<div class="ho-panels">${scheduleHTML(data)}${data.activity ? trendHTML(data.activity) : ""}</div>`;
}

/** The whole page. The emblem's canvas is drawn once and kept; a refresh patches only the words and the board. */
export function homeHTML(data: HomeOverview): string {
  return `<section class="ho-hero"><div class="ho-orb" aria-hidden="true"><canvas class="ho-emb"></canvas></div><div class="ho-hero-copy">${heroCopyHTML(data)}</div></section>` +
    `<div class="ho-board">${boardHTML(data)}</div><div class="ho-tip" role="tooltip" hidden></div>`;
}

export function createHome(app: AppContext): Page {
  const el = document.createElement("section");
  el.className = "page page-home";
  el.dataset.page = "home";
  el.hidden = true;
  let visible = false, generation = 0;
  let data: HomeOverview | null = null;
  let live: Promise<HomeOverview> | undefined;
  let liveAt = -Infinity;
  const poll = visibilityGate(() => void load(), () => visible);
  let timer: ReturnType<typeof setInterval> | undefined;
  let emblem: Emblem | null = null, settled = false, emblemTimers: ReturnType<typeof setTimeout>[] = [];
  const emblemPx = (): number => (document.querySelector<HTMLElement>(".main")?.clientWidth ?? innerWidth) <= 760 ? EMBLEM_NARROW_PX : EMBLEM_PX;
  /** Raphael appears and then speaks his line, drawn frame by frame; with reduced motion he just stands there. */
  function startEmblem(): void {
    if (!visible || emblem) return;
    const canvas = el.querySelector<HTMLCanvasElement>("canvas.ho-emb");
    if (!canvas || typeof canvas.getContext !== "function") return;
    canvas.parentElement?.classList.remove("is-turning");
    settled = false;
    emblem = new Emblem(canvas, emblemPx(), { base: 0.05, surface: "transparent" });
    emblem.set("steady");
    emblem.appear();
    const still = reducedMotion();
    if (!still) emblemTimers.push(setTimeout(() => emblem?.speak(SPEAK_S), SPEAK_DELAY_MS));
    emblemTimers.push(setTimeout(settle, still ? SETTLE_STILL_MS : SETTLE_MS));
  }
  /** Once he has appeared and spoken, the canvas keeps its last frame and turns on the compositor: an open Home draws
   * nothing more on the main thread: endless motion is a transform only (R-PERF-01, the busy-team motion budget). */
  function settle(): void {
    if (!emblem) return;
    emblem.dispose();
    settled = true;
    el.querySelector(".ho-orb")?.classList.add("is-turning");
  }
  /** Hidden, Home costs nothing: the emblem leaves the shared animation loop and stops turning. */
  function stopEmblem(): void {
    emblemTimers.forEach(clearTimeout);
    emblemTimers = [];
    emblem?.dispose();
    emblem = null;
    el.querySelector(".ho-orb")?.classList.remove("is-turning");
  }
  const resize = (): void => {
    if (!emblem || !visible) return;
    emblem.size(emblemPx());
    // A settled emblem is out of the loop: its one new frame is drawn here.
    if (settled) emblem.draw();
  };
  // Drawn again on every refresh, but a refresh that changes nothing touches nothing.
  let paintedHTML = "";
  const paint = (): void => {
    if (!data) return;
    const copy = heroCopyHTML(data), board = boardHTML(data);
    if (copy + board === paintedHTML) return;
    paintedHTML = copy + board;
    const hero = el.querySelector(".ho-hero-copy"), boardEl = el.querySelector(".ho-board");
    if (!hero || !boardEl) {
      el.innerHTML = homeHTML(data);
      startEmblem();
      return;
    }
    patchHTML(hero, copy);
    patchHTML(boardEl, board);
  };
  const sameData = (next: HomeOverview): boolean => data !== null && JSON.stringify(data) === JSON.stringify(next);
  async function load(fromEvent = false): Promise<void> {
    const mine = ++generation;
    if (!data) el.innerHTML = loadingHTML();
    try {
      const read = () => api.homeOverview(false);
      const next = await (fromEvent ? eventRead("home.overview:", read, app) : read());
      if (!visible || mine !== generation) return;
      if (!sameData(next)) data = next;
      paint();
      if (fromEvent || Date.now() - liveAt < 300_000) return;
      // Local records paint first. One live read fills the same page without emitting changes.
      if (!live) {
        liveAt = Date.now();
        const pending = api.homeOverview(true);
        live = pending;
        const clear = (): void => { if (live === pending) live = undefined; };
        void pending.then(clear, clear);
      }
      const fresh = await live;
      if (!visible || mine !== generation) return;
      if (!sameData(fresh)) { data = fresh; paint(); }
    } catch {
      if (!visible || mine !== generation) return;
      if (!data) el.innerHTML = `<p class="ho-empty" role="status">${esc(t("overview.error"))}</p><button type="button" class="btn" data-home-go="reload">${esc(t("overview.retry"))}</button>`;
    }
  }
  // One tooltip for the band's marks and the chart's days, kept inside the window.
  const hideTip = (): void => { const tip = el.querySelector<HTMLElement>(".ho-tip"); if (tip) tip.hidden = true; };
  el.addEventListener("pointerover", event => {
    const tip = el.querySelector<HTMLElement>(".ho-tip"), at = (event.target as Element).closest<HTMLElement>("[data-tip], [data-tip-day]");
    if (!tip) return;
    if (!at) { tip.hidden = true; return; }
    const day = at.dataset.tipDay !== undefined ? data?.activity?.days[Number(at.dataset.tipDay)] : undefined;
    tip.innerHTML = day ? dayTipHTML(day) : esc(at.dataset.tip ?? "");
    tip.hidden = false;
    const box = at.getBoundingClientRect(), size = tip.getBoundingClientRect();
    let left: number, top: number;
    if (day) {
      // A day's figures stand beside its bar, inside the plot: never over the legend or the schedule above it.
      const room = at.closest(".ho-sec")?.getBoundingClientRect() ?? { left: 0, right: innerWidth };
      left = box.left - size.width - 8 >= room.left ? box.left - size.width - 8 : box.right + 8;
      left = Math.max(8, Math.min(innerWidth - size.width - 8, left));
      top = Math.max(8, Math.min(innerHeight - size.height - 8, box.top + box.height / 2 - size.height / 2));
    } else {
      left = Math.max(8, Math.min(innerWidth - size.width - 8, box.left + box.width / 2 - size.width / 2));
      top = box.top - size.height - 8 >= 8 ? box.top - size.height - 8 : box.bottom + 8;
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  });
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("click", event => {
    const at = event.target as Element;
    const creating = at.closest<HTMLElement>('[data-home-create]');
    if (creating) { app.go('automations', `calendar-new:${creating.dataset.homeCreate}` as CalendarCreate); return; }
    const dismissing = at.closest<HTMLElement>('[data-home-dismiss]');
    if (dismissing) { dismissOffer(dismissing.dataset.homeDismiss as GoogleCalendarState); paintedHTML = ""; paint(); return; }
    const target = at.closest<HTMLElement>("[data-home-item], [data-home-go], [data-home-event]");
    if (!target) return;
    if (target.dataset.homeEvent) {
      app.go('automations', `calendar:${target.dataset.homeDate}:${encodeURIComponent(target.dataset.homeEvent)}` as CalendarEventFocus); return;
    }
    const item = data?.today.find(item => item.id === target.dataset.homeItem);
    if (item) { openMemberThread(app, item.member_id, item.turn_id ?? undefined); return; }
    switch (target.dataset.homeGo) {
      case "reload": void load(); break;
      case "connections": app.go("settings", "connections"); break;
      case "calendar":
        if (target.dataset.homeDate) app.go("automations", target.dataset.homeDate as CalendarDate);
        else app.go("automations");
        break;
      case "report":
        if (data && buildReport(data.report, data.generated_at_ms).action?.target === "retry") {
          void api.statusCheckOpenrouter().then(() => load(), () => load());
        } else app.go("settings", data?.report.openrouter.state === "ok" ? "usage" : "models");
        break;
    }
  });
  // Settings retains Home behind its dialog. Translate cached data even while the page is inactive.
  onLocaleChange(() => { paintedHTML = ""; paint(); });
  app.onEvent(event => {
    if (!visible) return;
    if (["MembersChanged", "AgentQuestion", "AgentQuestionClosed", "ConversationsChanged", "AgentTurn", "RoutinesChanged", "CalendarChanged",
      "SettingsChanged", "ConnectionsChanged", "HomeChanged"].includes(event.type)) void load(true);
  });
  app.cleared.on("conversation", () => { if (visible) void load(); });
  return { id: "home", el,
    show() {
      visible = true; void load(); startEmblem(); addEventListener("resize", resize);
      clearInterval(timer); timer = setInterval(() => { poll.run(); }, 30_000);
    },
    hide() { visible = false; generation++; clearInterval(timer); stopEmblem(); hideTip(); removeEventListener("resize", resize); } };
}
