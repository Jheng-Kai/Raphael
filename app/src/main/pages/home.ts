import { visibilityGate } from "../window-visibility";
// Home is Raphael as a secretary (owner, 2026-11-07): his emblem beside the greeting and his word on today, then today's
// schedule, what is still open, what each member does and will do next, yesterday in numbers and his words, and what the
// health check looked at. No figures of spend or dictation, no slime and no fly-in (owner, 2026-11-07 night).
import * as api from "../api";
import { eventRead } from '../event-read';
import { avatarHTML, onAvatarChange } from "../avatar";
import { chipClock, chipColor, dismissOffer, googleMark, googleNoticeHTML, runMarkHTML, type CalendarPerson, type EntryKind } from "../calendar-view";
import type { GoogleCalendarState, HomeCheck, HomeItem, HomeNarrative, HomeOverview, HomeUnfinished } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
import type { MessageKey } from "../i18n/zh-TW";
import { loadingHTML } from "../loading";
import { buildReport } from "../report";
import { dateKey } from "../schedule-picker";
import { RAPHAEL_ID, faceHTML as memberFaceHTML } from "../members";
import { onOwnerProfile } from "../owner-avatar";
import { plainReplies } from "../../shared/anime";
import { openMemberThread } from "../team-navigation";
import type { AppContext, CalendarCreate, CalendarDate, CalendarEventFocus, Member, Page } from "../types";
import { btn, esc, ico, iconButton, patchHTML } from "../ui";
import "../home.css";

const HOUR = 3_600_000;
/** Rows a section shows; the rest is counted below them (owner, 2026-11-07 night: everything of today at a glance). */
const ROWS = 8;

const clock = (at: number): string => new Date(at).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
const faceHTML = (item: HomeItem, size: number): string => memberFaceHTML({ id: item.member_id, name: item.name, avatar: item.avatar }, size);

/** What a member is doing, as Home says it: waiting for the owner first, then at work, then unread, then free. */
export type TeamState = "needs" | "busy" | "unread" | "idle";
export function memberState(m: Member): { kind: TeamState; words: string } {
  const activity = m.activity ?? "idle";
  if (m.waiting || activity === "blocked" || activity === "error") return { kind: "needs", words: m.activity_label || t("home.stateWaiting") };
  if (activity !== "idle" && activity !== "done" && m.activity_label) return { kind: "busy", words: m.activity_label };
  if (m.unread) return { kind: "unread", words: t("home.stateUnread") };
  return { kind: "idle", words: t("home.stateIdle") };
}
const ORDER: readonly TeamState[] = ["needs", "busy", "unread", "idle"];

/** The members Home reports on: everyone the owner sees, Raphael aside (he is the one reporting). */
export const teamOf = (members: readonly Member[]): Member[] => members.filter(m => m.id !== RAPHAEL_ID && !m.hidden);

/** Raphael's one line on the team: all well, or who needs the owner. */
export function healthText(team: readonly Member[]): string {
  if (!team.length) return t("home.healthAlone");
  const needs = team.filter(m => memberState(m).kind === "needs");
  if (!needs.length) return t("home.healthWell", { p0: team.length });
  if (needs.length > 3) return t("home.healthMany", { p0: needs.length });
  return t("home.healthNeeds", { p0: new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(needs.map(m => m.name)) });
}

function greeting(at: number): string {
  const hour = new Date(at).getHours();
  return t(hour >= 5 && hour < 12 ? "home.greetMorning" : hour >= 12 && hour < 18 ? "home.greetAfternoon" : "home.greetEvening");
}

/** A calendar item as the Calendar page tells it apart: its kind, the member it is for and a run that went wrong. */
function entryOf(item: HomeItem): { kind: EntryKind; member?: CalendarPerson; run?: { status: string } } {
  const kind: EntryKind = item.kind === "own" ? "own" : item.kind === "routine" ? "routine" : "event";
  const by = kind === "routine" ? item.member_id : item.added_by;
  const member = kind !== "event" && typeof by === "number" && item.name ? { id: by, name: item.name, avatar: item.avatar } : undefined;
  return { kind, member, run: item.run_status ? { status: item.run_status } : undefined };
}

/** One line of today's schedule: its time, the calendar's colour as a tick, the title and who it is for. No box.
 * A routine due `times` times today says so after its title. */
function eventRowHTML(item: HomeItem, now: number, times = 1): string {
  const entry = entryOf(item), mark = runMarkHTML(entry);
  // A rhythm is the calendar's quiet bar: its face and title, no time (R-CAL-03).
  const when = item.rhythm ? `<span class="ho-repeat" aria-hidden="true">${ico("repeat")}</span>` : esc(chipClock({ allDay: item.all_day === true, start: item.at_ms }));
  const lead = entry.kind === "event" ? googleMark() : entry.member ? memberFaceHTML(entry.member, 20) : "";
  const past = !mark && !item.all_day && (item.end_ms ?? item.at_ms + HOUR) <= now;
  const count = times > 1 ? `<small class="ho-times">${esc(t("home.times", { p0: times }))}</small>` : "";
  return `<button type="button" class="btn ho-row ho-event is-${entry.kind}${item.rhythm ? " is-rhythm" : ""}${past ? " is-past" : ""}"${entry.kind === "event" ? "" : chipColor(entry.member)}` +
    ` data-home-event="${esc(item.id)}" data-home-date="${dateKey(new Date(item.at_ms))}"><time>${when}</time><b>${esc(item.title)}</b>${count}${mark}${lead}</button>`;
}

/** Today's schedule as one list: the core's every item of today (calendar, own events, routine runs), questions aside.
 * A routine due many times a day is one row with its count, as the calendar's rhythm bar (R-CAL-03). */
export function todaysSchedule(data: HomeOverview): { item: HomeItem; times: number }[] {
  const today = dateKey(new Date(data.generated_at_ms));
  const all = data.yesterday ? data.today.filter(item => item.kind !== "question")
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

function scheduleHTML(data: HomeOverview): string {
  const now = data.generated_at_ms, today = dateKey(new Date(now));
  const rows = todaysSchedule(data);
  // The core's every item of today, or (an older core) a few items a day and the day's count: what is not drawn is counted.
  const total = data.yesterday ? rows.length : Math.max(data.calendar_counts?.[today] ?? 0, rows.length);
  const shown = rows.slice(0, ROWS), rest = total - shown.length;
  const notice = googleNoticeHTML(data.calendar_google, { go: 'data-home-go="connections"', dismiss: "data-home-dismiss" });
  const body = rows.length
    ? shown.map(({ item, times }) => eventRowHTML(item, now, times)).join("") +
      (rest > 0 ? btn(esc(t("overview.moreEvents", { p0: rest })), "sm ho-more", ` data-home-go="calendar" data-home-date="${today}"`) : "")
    : `<p class="ho-empty">${esc(t("overview.noSchedule"))}</p>${btn(ico("plus") + esc(t("auto.create")), "sm ho-create", ` data-home-create="${today}"`)}`;
  return sectionHTML("schedule", t("home.schedule"), body + notice, iconButton("calendar", t("overview.calendar"), ' data-home-go="calendar"'));
}

function itemRowHTML(item: HomeItem, words?: string): string {
  const report = item.kind === "report";
  return `<button type="button" class="btn ho-row" data-home-item="${esc(item.id)}">${faceHTML(item, 28)}` +
    `<span class="ho-row-copy"><strong>${esc(report ? item.name : item.title)}</strong><span>${esc(words ?? (report ? item.summary : item.name))}</span></span>` +
    `<time datetime="${new Date(item.at_ms).toISOString()}">${esc(clock(item.at_ms))}</time></button>`;
}

/** Work that stopped short and needs the owner: a failed, interrupted or limited task or turn. */
const STOPPED: Record<string, Extract<MessageKey, `home.stop${string}`>> = { failed: "home.stopFailed", error: "home.stopFailed", interrupted: "home.stopInterrupted", limit: "home.stopLimit" };
const COUNT_KEYS = { work: "home.countWork", routines: "home.countRoutines", messages: "home.countMessages" } as const;

function pendingHTML(data: HomeOverview, members: readonly Member[]): string {
  const questions = data.today.filter(item => item.kind === "question");
  const stopped = (data.today_plan?.items ?? []).filter((item): item is HomeUnfinished => item.kind === "unfinished" && item.state in STOPPED)
    .map(item => {
      const who = members.find(m => m.id === item.member_id);
      const turn = item.id.startsWith("turn:") ? Number(item.id.slice(5)) : null;
      return { row: { id: item.id, kind: "question", title: item.title, summary: "", at_ms: item.at_ms, member_id: item.member_id, name: who?.name ?? "",
        avatar: who?.avatar ?? "", turn_id: turn, conversation_id: null, routine_id: null } satisfies HomeItem, words: t(STOPPED[item.state]) };
    });
  const open = [...questions.map(row => ({ row, words: undefined as string | undefined })), ...stopped, ...data.reports.map(row => ({ row, words: undefined }))];
  const shown = open.slice(0, ROWS), rest = questions.length + stopped.length + Math.max(data.counts.reports, data.reports.length) - shown.length;
  const body = open.length
    ? shown.map(({ row, words }) => itemRowHTML(row, words)).join("") + (rest > 0 ? `<p class="ho-count">${esc(t("home.moreItems", { p0: rest }))}</p>` : "")
    : `<p class="ho-empty">${ico("check")}${esc(t("overview.allClear"))}</p>`;
  return sectionHTML("pending", t("home.pending"), body);
}

/** When a routine runs next: its time today, else the weekday and time. */
function nextAt(at: number, now: number): string {
  return dateKey(new Date(at)) === dateKey(new Date(now)) ? clock(at)
    : `${new Date(at).toLocaleDateString(getLocale(), { weekday: "short" })} ${clock(at)}`;
}

function teamHTML(team: readonly Member[], data: HomeOverview): string {
  const details = new Map((data.members ?? []).map(m => [m.id, m]));
  const sorted = team.map((m, i) => ({ m, i, state: memberState(m) }))
    .sort((a, b) => ORDER.indexOf(a.state.kind) - ORDER.indexOf(b.state.kind) || a.i - b.i);
  const body = sorted.length
    ? sorted.slice(0, ROWS).map(({ m, state }) => {
        const more = details.get(m.id);
        // At work or waiting it says so in the core's words; free, it says what it did last, else what it is for.
        const words = state.kind === "needs" || state.kind === "busy" ? state.words
          : more?.current_or_last ? t("home.last", { p0: more.current_or_last }) : m.role?.trim() || state.words;
        const next = more?.next_routine;
        const when = next ? `<time class="ho-next" datetime="${new Date(next.at_ms).toISOString()}" aria-label="${esc(t("home.nextRoutine", { p0: next.title, p1: nextAt(next.at_ms, data.generated_at_ms) }))}">` +
          `${ico("repeat")}${esc(nextAt(next.at_ms, data.generated_at_ms))}</time>` : "";
        return `<button type="button" class="btn ho-row ho-member" data-home-member="${m.id}" data-state="${state.kind}">${memberFaceHTML(m, 28)}` +
          `<span class="ho-row-copy"><strong>${esc(m.name)}</strong><span>${esc(words)}</span></span>${when}</button>`;
      }).join("") +
      (sorted.length > ROWS ? `<p class="ho-count">${esc(t("home.moreMembers", { p0: sorted.length - ROWS }))}</p>` : "")
    : `<p class="ho-empty">${esc(t("home.teamEmpty"))}</p>`;
  return sectionHTML("team", t("members.title"), body);
}

/** A daily paragraph Raphael writes, or the plain reason it is not there; without a model, the way to choose one. */
function narrativeHTML(story: HomeNarrative): string {
  if (story.state === "ready" && story.narrative) return `<p class="ho-story">${esc(story.narrative)}</p>`;
  if (story.state === "pending") return `<p class="ho-story is-note">${esc(t("home.storyPending"))}</p>`;
  if (story.reason === "model_unavailable")
    return `<p class="ho-story is-note">${esc(t("home.storyNoModel"))}${btn(esc(t("home.chooseModel")), "sm ho-story-fix", ' data-home-go="models"')}</p>`;
  return `<p class="ho-story is-note">${esc(t("home.storyFailed"))}</p>`;
}

function yesterdayHTML(data: HomeOverview, members: readonly Member[]): string {
  const day = data.yesterday;
  if (!day) return "";
  const tally = (["work", "routines", "messages"] as const).map(kind =>
    `<span class="ho-num" data-kind="${kind}"><b>${day.counts[kind]}</b><small>${esc(t(COUNT_KEYS[kind]))}</small></span>`).join("");
  // Who did it: each member that finished something, its face and how much; a press opens its conversation.
  const who = day.members.map(group => ({ group, total: group.counts.work + group.counts.routines + group.counts.messages }))
    .filter(({ total }) => total > 0).sort((a, b) => b.total - a.total)
    .map(({ group, total }) => {
      const m = members.find(person => person.id === group.member_id) ?? { id: group.member_id, name: group.name };
      return `<button type="button" class="btn ho-who" data-home-member="${group.member_id}" aria-label="${esc(t("home.whoDid", { p0: group.name, p1: total }))}">${memberFaceHTML(m, 20)}<span>${total}</span></button>`;
    }).join("");
  return sectionHTML("yesterday", t("home.yesterday"), `<div class="ho-tally">${tally}${who ? `<span class="ho-whos">${who}</span>` : ""}</div>${narrativeHTML(day)}`);
}

/** The name a check is about: the core's, else the part of its id after the kind. */
const checkName = (check: HomeCheck): string => check.name?.trim() || (check.id === "memory" ? t("home.checkMemory") : check.id.slice(check.id.indexOf(":") + 1).split("/")[0]);
/** Where a check that is not well is fixed. */
const checkPlace = (check: HomeCheck): string => check.id.startsWith("connection:") ? "connections" : check.id === "memory" ? "" : "models";

function healthHTML(data: HomeOverview): string {
  const health = data.health;
  if (!health) return "";
  const bad = health.checks.filter(check => check.status !== "ok"), good = health.checks.filter(check => check.status === "ok");
  const rows = bad.map(check => {
    const place = checkPlace(check);
    return `<button type="button" class="btn ho-row ho-check" data-status="${check.status}"${place ? ` data-home-go="${place}"` : ""}><span class="ho-dot" aria-hidden="true"></span>` +
      `<span class="ho-row-copy"><strong>${esc(checkName(check))}</strong><span>${esc(check.detail ?? "")}</span></span></button>`;
  }).join("");
  const fine = good.length ? `<p class="ho-ok">${ico("check")}<span><b>${esc(t("home.checksOk", { p0: good.length }))}</b>` +
    `<small>${esc(good.map(checkName).join(t("home.listJoin")))}</small></span></p>` : "";
  const body = health.checks.length ? rows + fine : `<p class="ho-empty">${esc(t("home.checksNone"))}</p>`;
  return sectionHTML("checks", t("home.health"), body);
}

function sectionHTML(key: string, title: string, body: string, action = ""): string {
  return `<section class="ho-sec ho-${key}" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2>${action}</header><div class="ho-rows">${body}</div></section>`;
}

export function homeHTML(data: HomeOverview, members: readonly Member[] = []): string {
  const team = teamOf(members), report = buildReport(data.report, data.generated_at_ms);
  const date = new Date(data.generated_at_ms).toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "long" });
  // Only a report that needs fixing speaks here, with its one fix; a well budget is no news for a secretary. The main window
  // shows his words plainly: 《告。…》 stays on the desktop's captions (R-UI-42).
  const alert = report.action ? `<p class="ho-alert">${esc(plainReplies([report.text])[0] ?? report.text)}${iconButton(report.action.target === "retry" ? "refresh" : "info", report.action.label, ' data-home-go="report"')}</p>` : "";
  // Raphael's emblem, standing still (owner, 2026-11-07 night: no slime and no fly-in on Home), beside the greeting.
  // His line is the short word on today he wrote, else the team's health in one sentence.
  const plan = data.today_plan?.state === "ready" && data.today_plan.narrative ? data.today_plan.narrative : healthText(team);
  const hero = `<section class="ho-hero"><div class="ho-orb">${avatarHTML({ size: 96, avatar: null })}</div><div class="ho-hero-copy">` +
    `<p class="ho-date">${esc(date)}</p><h1 class="ho-greet">${esc(greeting(data.generated_at_ms))}</h1>` +
    `<p class="ho-health" role="status">${esc(plan)}</p>${alert}</div></section>`;
  return hero + `<div class="ho-board">${scheduleHTML(data)}${pendingHTML(data, members)}${teamHTML(team, data)}${yesterdayHTML(data, members)}${healthHTML(data)}</div>`;
}

export function createHome(app: AppContext): Page {
  const el = document.createElement("section");
  el.className = "page page-home";
  el.dataset.page = "home";
  el.hidden = true;
  let visible = false, generation = 0;
  let data: HomeOverview | null = null;
  let members: Member[] = [];
  let live: Promise<HomeOverview> | undefined;
  let liveAt = -Infinity;
  const poll = visibilityGate(() => void load(), () => visible);
  let timer: ReturnType<typeof setInterval> | undefined;
  // Drawn again on every refresh, but a refresh that changes nothing touches nothing.
  let paintedHTML = "";
  const paint = (): void => {
    if (!data) return;
    const html = homeHTML(data, members);
    if (html === paintedHTML) return;
    paintedHTML = html;
    patchHTML(el, html);
  };
  const sameData = (next: HomeOverview): boolean => data !== null && JSON.stringify(data) === JSON.stringify(next);
  /** `team`: read the members too. A turn alone leaves the team as it is: its activity comes as MemberActivity. */
  async function load(fromEvent = false, team = true): Promise<void> {
    const mine = ++generation;
    if (!data) el.innerHTML = loadingHTML();
    try {
      const read = () => api.homeOverview(false);
      const people = () => api.membersList(getLocale());
      const [next, list] = await Promise.all([
        fromEvent ? eventRead("home.overview:", read, app) : read(),
        // The sidebar reads the same list on the same events: one read serves both.
        !team ? null : (fromEvent ? eventRead(`members.list:${getLocale()}`, people, app) : people()).catch(() => null),
      ]);
      if (!visible || mine !== generation) return;
      if (list?.members) members = list.members;
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
    if (dismissing) { dismissOffer(dismissing.dataset.homeDismiss as GoogleCalendarState); paint(); return; }
    const person = at.closest<HTMLElement>('[data-home-member]');
    if (person) { openMemberThread(app, Number(person.dataset.homeMember)); return; }
    const target = at.closest<HTMLElement>("[data-home-item], [data-home-go], [data-home-event]");
    if (!target) return;
    if (target.dataset.homeEvent) {
      app.go('automations', `calendar:${target.dataset.homeDate}:${encodeURIComponent(target.dataset.homeEvent)}` as CalendarEventFocus); return;
    }
    const item = data && [...data.today, ...data.reports].find(item => item.id === target.dataset.homeItem);
    if (item) { openMemberThread(app, item.member_id, item.turn_id ?? undefined); return; }
    switch (target.dataset.homeGo) {
      case "reload": void load(); break;
      case "connections": app.go("settings", "connections"); break;
      case "models": app.go("settings", "models"); break;
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
  onAvatarChange(() => { if (visible) paint(); });
  onOwnerProfile(paint);
  // Settings retains Home behind its dialog. Translate cached data even while the page is inactive.
  onLocaleChange(paint);
  app.onEvent(event => {
    if (!visible) return;
    if (event.type === "MemberActivity") {
      // What a member does now changes its row and the health line at once, without a read.
      members = members.map(m => m.id !== event.member_id ? m : { ...m, activity: event.state,
        activity_label: event.label ?? (event.state === "idle" || event.state === "done" ? "" : m.activity_label) });
      paint();
      return;
    }
    if (["MembersChanged", "AgentQuestion", "AgentQuestionClosed", "ConversationsChanged"].includes(event.type)) void load(true);
    else if (["AgentTurn", "RoutinesChanged", "CalendarChanged", "SettingsChanged", "ConnectionsChanged", "HomeChanged"].includes(event.type)) void load(true, false);
  });
  app.cleared.on("conversation", () => { if (visible) void load(); });
  return { id: "home", el, show() { visible = true; void load(); clearInterval(timer); timer = setInterval(() => { poll.run(); }, 30_000); },
    hide() { visible = false; generation++; clearInterval(timer); } };
}
