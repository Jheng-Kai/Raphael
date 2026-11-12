import { visibilityGate } from "../window-visibility";
// Home: Raphael's emblem, alive, beside the greeting and his line; then what to do now and what must not be missed
// today (owner, 2026-11-12: 「我覺得現在看起來它並沒有幫助到我太多我日常的行程」): the timed things now and next, what waits
// for his decision, today's tasks, what is overdue, and the routines in one line. Each part is absent when it has nothing
// to say. The sorting is `home-day.ts`; this file draws it.
import * as api from "../api";
import { eventRead } from '../event-read';
import { Emblem } from "../../overlay/emblem";
import { chipClock, dismissOffer, googleNoticeHTML } from "../calendar-view";
import { dayBoard, todayItems, type DayBoard, type DayMoment, type DayTask } from "../home-day";
import type { GoogleCalendarState, HomeItem, HomeOverview } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
import { loadingHTML } from "../loading";
import { faceHTML } from "../members";
import { buildReport } from "../report";
import { dateKey } from "../schedule-picker";
import { plainReplies } from "../../shared/anime";
import { openMemberThread } from "../team-navigation";
import type { AppContext, CalendarCreate, CalendarDate, CalendarEventFocus, Page } from "../types";
import { esc, iconButton, patchHTML } from "../ui";
import "../home.css";

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

const dayKeyOf = (at: number): string => dateKey(new Date(at));

/** Raphael's line when he has not written one: today's schedule and what waits for the owner, in one sentence. */
export function dayLine(data: HomeOverview): string {
  // An event is a timed thing: a task of the board is an all-day item, and a routine run is its member's.
  const events = todayItems(data, dayKeyOf).filter(item => (item.kind === "event" || item.kind === "own") && !item.all_day).length;
  const questions = data.today.filter(item => item.kind === "question").length;
  if (events && questions) return t("home.lineBoth", { p0: events, p1: questions });
  if (events) return t("home.lineEvents", { p0: events });
  if (questions) return t("home.lineQuestions", { p0: questions });
  return t("home.lineQuiet");
}

/** His line as he says it: his own lead word first (告。), unless his words already open with one. The 《…》 caption wrapper stays the desktop's (R-UI-42). */
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
  return `<p class="ho-date"><span>${esc(date)}</span>${iconButton("calendar", t("overview.calendar"), ' data-home-go="calendar"')}</p><h1 class="ho-greet">${esc(greeting(data.generated_at_ms))}</h1><p class="ho-line" role="status">${esc(raphaelSays(words))}</p>${alert}`;
}

/** Where a row leads: the event on its day of the Calendar. */
const eventAttrs = (item: HomeItem): string => ` data-home-event="${esc(item.id)}" data-home-date="${dateKey(new Date(item.at_ms))}"`;
/** Every part of the page is a list of these: a quiet rail at the left (a time, a project, a face), the words, and what is
 * said at the right. A row is a real button that goes somewhere. */
function rowHTML(attrs: string, rail: string, body: string, side = "", cls = ""): string {
  return `<button type="button" class="btn ho-row ho-event${cls ? ` ${cls}` : ""}"${attrs}><span class="ho-rail">${rail}</span><span class="ho-title">${body}</span>${side}</button>`;
}
const taskRowHTML = ({ item, text, tag }: DayTask): string =>
  rowHTML(eventAttrs(item), esc(tag ?? ""), `<b>${esc(text)}</b>`, "", "is-task");
/** The row that stands for the rest of a list: it opens today on the Calendar. */
const moreRowHTML = (words: string, today: string): string =>
  rowHTML(` data-home-go="calendar" data-home-date="${today}"`, "", `<b>${esc(words)}</b>`, "", "is-more");
const faceOf = (item: HomeItem, size: number): string =>
  faceHTML({ id: item.member_id, name: item.name, avatar: item.avatar, avatar_url: (item as HomeItem & { avatar_url?: string }).avatar_url }, size, { cls: "ho-face" });

function sectionHTML(key: string, title: string, rows: string, header = ""): string {
  return `<section class="ho-sec ho-${key}" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2>${header}</header><div class="ho-rows">${rows}</div></section>`;
}

/** How long until a thing that starts later: minutes for the next hour and a half, then hours. */
function momentWhen(moment: DayMoment): string {
  if (moment.when === "now") return t("home.nowOn");
  return moment.minutes < 90 ? t("home.inMinutes", { p0: moment.minutes }) : t("home.inHours", { p0: Math.round(moment.minutes / 60) });
}

function momentsHTML(day: DayBoard): string {
  if (!day.moments.length) return "";
  return sectionHTML("next", t("home.upNext"), day.moments.map(moment => rowHTML(eventAttrs(moment.item),
    `<time>${esc(chipClock({ allDay: false, start: moment.item.at_ms }))}</time>`, `<b>${esc(moment.text)}</b>`,
    `<span class="ho-when">${esc(momentWhen(moment))}</span>`, moment.when === "now" ? "is-timed is-now" : "is-timed")).join(""));
}

function waitingHTML(day: DayBoard): string {
  const { rows, more } = day.waiting;
  if (!rows.length) return "";
  const ask = (item: HomeItem): string => rowHTML(` data-home-item="${esc(item.id)}"`, faceOf(item, 22), `<b>${esc(item.title)}</b>`,
    item.name ? `<span class="ho-who">${esc(item.name)}</span>` : "", "is-ask");
  return sectionHTML("waiting", t("home.waiting"), rows.map(ask).join("") +
    (more.length ? rowHTML(` data-home-item="${esc(more[0]!.id)}"`, "", `<b>${esc(t("home.moreTasks", { p0: more.length }))}</b>`, "", "is-more") : ""),
    `<small class="ho-count">${rows.length + more.length}</small>`);
}

function todoHTML(day: DayBoard, today: string): string {
  const { rows, total, more } = day.todo;
  if (!rows.length) return "";
  return sectionHTML("todo", t("home.todo"), rows.map(taskRowHTML).join("") + (more ? moreRowHTML(t("home.moreTasks", { p0: more }), today) : ""),
    `<small class="ho-count">${total}</small>`);
}

/** The overdue stay one block of one size: the count, the projects they belong to, the three that lead, and a way to all. */
function overdueHTML(day: DayBoard, today: string): string {
  const { total, groups, rows } = day.overdue;
  if (!total) return "";
  const names = groups.map(group => `${group.tag ?? t("home.tagOther")} ${group.count}`).join(" · ");
  return sectionHTML("overdue", t("home.overdue"), rows.map(taskRowHTML).join("") + (total > rows.length ? moreRowHTML(t("home.seeAll"), today) : ""),
    `<small class="ho-count">${total}</small><span class="ho-groups">${esc(names)}</span>`);
}

/** The routines in one line: how many are done of today's, what failed (named) and when the next runs. */
function routinesHTML(day: DayBoard): string {
  const routines = day.routines;
  if (!routines) return "";
  const { done, due, failed, next } = routines;
  const lead = failed[0] ?? next;
  const count = due !== null && done !== null ? `<em>${done}/${due}</em>` : "";
  const notes = [
    failed.length ? `<span class="ho-note is-bad">${esc(failed.length === 1 ? t("home.routineFailedOne", { p0: failed[0]!.title }) : t("home.routinesFailed", { p0: failed.length }))}</span>` : "",
    next ? `<span class="ho-note">${esc(t("home.next", { p0: clock(next.at_ms), p1: next.title }))}</span>`
      : !failed.length && due !== null && done !== null && done >= due ? `<span class="ho-note">${esc(t("home.routinesDone"))}</span>` : "",
  ].join("");
  const attrs = lead ? eventAttrs(lead) : ` data-home-go="calendar"`;
  return `<section class="ho-sec ho-routines" aria-label="${esc(t("home.statRoutines"))}"><div class="ho-rows">` +
    rowHTML(attrs, lead ? faceOf(lead, 22) : "", `<b>${esc(t("home.statRoutines"))}</b>${count}${notes}`, "", "is-routines") + `</div></section>`;
}

/** The page under the hero. Two lanes where the page is wide (what to do now; what is owed and what runs), else one
 * column in that order. A part with nothing to say is not drawn, and takes no space. */
function boardHTML(data: HomeOverview): string {
  const day = dayBoard(data, dayKeyOf), today = dayKeyOf(data.generated_at_ms);
  const lanes = [momentsHTML(day) + waitingHTML(day) + todoHTML(day, today), overdueHTML(day, today) + routinesHTML(day)]
    .filter(Boolean).map(lane => `<div class="ho-lane">${lane}</div>`).join("");
  // Nothing at all: calm words, and 建立 for today.
  const nothing = lanes ? "" : `<section class="ho-sec ho-none" aria-label="${esc(t("overview.noSchedule"))}"><p class="ho-empty">${esc(t("overview.noSchedule"))}${iconButton("plus", t("auto.create"), ` data-home-create="${today}"`, "ho-create")}</p></section>`;
  const notice = googleNoticeHTML(data.calendar_google, { go: 'data-home-go="connections"', dismiss: "data-home-dismiss" });
  return `<div class="ho-lanes">${lanes}${nothing}</div>${notice ? `<div class="ho-foot">${notice}</div>` : ""}`;
}

/** The whole page. The emblem's canvas is drawn once and kept; a refresh patches only the words and the board. */
export function homeHTML(data: HomeOverview): string {
  return `<section class="ho-hero"><div class="ho-orb" aria-hidden="true"><canvas class="ho-emb"></canvas></div><div class="ho-hero-copy">${heroCopyHTML(data)}</div></section>` +
    `<div class="ho-board">${boardHTML(data)}</div>`;
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
    hide() { visible = false; generation++; clearInterval(timer); stopEmblem(); removeEventListener("resize", resize); } };
}
