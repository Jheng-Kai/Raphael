import { visibilityGate } from "../window-visibility";
// Home is Raphael as a secretary (owner, 2026-11-07): his emblem and greeting in the middle, one line of the team's
// health, then today's schedule, what is still open and what each member is doing. No figures of spend or dictation.
import * as api from "../api";
import { eventRead } from '../event-read';
import { onAvatarChange } from "../avatar";
import { chipClock, chipColor, dismissOffer, googleMark, googleNoticeHTML, runMarkHTML, type CalendarPerson, type EntryKind } from "../calendar-view";
import type { GoogleCalendarState, HomeItem, HomeOverview } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
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
/** Rows a section shows; the rest is counted below them, so Home never scrolls inside. */
const ROWS = 4;
/** The day Raphael last flew in: once a day, on the first Home of that day. */
const ARRIVED_KEY = "raphael.home.arrived";

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

/** One line of today's schedule: its time, the calendar's colour as a tick, the title and who it is for. No box. */
function eventRowHTML(item: HomeItem, now: number): string {
  const entry = entryOf(item), mark = runMarkHTML(entry);
  // A rhythm is the calendar's quiet bar: its face and title, no time (R-CAL-03).
  const when = item.rhythm ? `<span class="ho-repeat" aria-hidden="true">${ico("repeat")}</span>` : esc(chipClock({ allDay: item.all_day === true, start: item.at_ms }));
  const lead = entry.kind === "event" ? googleMark() : entry.member ? memberFaceHTML(entry.member, 20) : "";
  const past = !mark && !item.all_day && (item.end_ms ?? item.at_ms + HOUR) <= now;
  return `<button type="button" class="btn ho-row ho-event is-${entry.kind}${item.rhythm ? " is-rhythm" : ""}${past ? " is-past" : ""}"${entry.kind === "event" ? "" : chipColor(entry.member)}` +
    ` data-home-event="${esc(item.id)}" data-home-date="${dateKey(new Date(item.at_ms))}"><time>${when}</time><b>${esc(item.title)}</b>${mark}${lead}</button>`;
}

function scheduleHTML(data: HomeOverview): string {
  const now = data.generated_at_ms, today = dateKey(new Date(now));
  const items = (data.calendar_items ?? data.calendar).filter(item => dateKey(new Date(item.at_ms)) === today)
    .sort((a, b) => Number(b.all_day === true) - Number(a.all_day === true) || a.at_ms - b.at_ms);
  // The core sends a few items a day and the day's count: what is not drawn is counted.
  const shown = items.slice(0, ROWS), rest = Math.max(data.calendar_counts?.[today] ?? 0, items.length) - shown.length;
  const notice = googleNoticeHTML(data.calendar_google, { go: 'data-home-go="connections"', dismiss: "data-home-dismiss" });
  const body = items.length
    ? shown.map(item => eventRowHTML(item, now)).join("") +
      (rest > 0 ? btn(esc(t("overview.moreEvents", { p0: rest })), "sm ho-more", ` data-home-go="calendar" data-home-date="${today}"`) : "")
    : `<p class="ho-empty">${esc(t("overview.noSchedule"))}</p>${btn(ico("plus") + esc(t("auto.create")), "sm ho-create", ` data-home-create="${today}"`)}`;
  return sectionHTML("schedule", t("home.schedule"), body + notice, iconButton("calendar", t("overview.calendar"), ' data-home-go="calendar"'));
}

function itemRowHTML(item: HomeItem): string {
  const report = item.kind === "report";
  return `<button type="button" class="btn ho-row" data-home-item="${esc(item.id)}">${faceHTML(item, 28)}` +
    `<span class="ho-row-copy"><strong>${esc(report ? item.name : item.title)}</strong><span>${esc(report ? item.summary : item.name)}</span></span>` +
    `<time datetime="${new Date(item.at_ms).toISOString()}">${esc(clock(item.at_ms))}</time></button>`;
}

function pendingHTML(data: HomeOverview): string {
  const open = [...data.today.filter(item => item.kind === "question"), ...data.reports];
  const shown = open.slice(0, ROWS), rest = data.today.filter(item => item.kind === "question").length + Math.max(data.counts.reports, data.reports.length) - shown.length;
  const body = open.length
    ? shown.map(itemRowHTML).join("") + (rest > 0 ? `<p class="ho-count">${esc(t("home.moreItems", { p0: rest }))}</p>` : "")
    : `<p class="ho-empty">${ico("check")}${esc(t("overview.allClear"))}</p>`;
  return sectionHTML("pending", t("home.pending"), body);
}

function teamHTML(team: readonly Member[]): string {
  const sorted = team.map((m, i) => ({ m, i, state: memberState(m) }))
    .sort((a, b) => ORDER.indexOf(a.state.kind) - ORDER.indexOf(b.state.kind) || a.i - b.i);
  const body = sorted.length
    ? sorted.slice(0, ROWS).map(({ m, state }) => `<button type="button" class="btn ho-row ho-member" data-home-member="${m.id}" data-state="${state.kind}">${memberFaceHTML(m, 28)}` +
        `<span class="ho-row-copy"><strong>${esc(m.name)}</strong><span>${esc(state.words)}</span></span></button>`).join("") +
      (sorted.length > ROWS ? `<p class="ho-count">${esc(t("home.moreMembers", { p0: sorted.length - ROWS }))}</p>` : "")
    : `<p class="ho-empty">${esc(t("home.teamEmpty"))}</p>`;
  return sectionHTML("team", t("members.title"), body);
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
  // Raphael as the first blue slime (owner, 2026-11-07): his emblem shows only in voice.
  const raphael = members.find(member => member.id === RAPHAEL_ID) ?? { id: RAPHAEL_ID, name: "" };
  const hero = `<section class="ho-hero"><div class="ho-orb">${memberFaceHTML(raphael, 128)}</div>` +
    `<h1 class="ho-greet">${esc(greeting(data.generated_at_ms))}</h1><p class="ho-date">${esc(date)}</p>` +
    `<p class="ho-health" role="status">${esc(healthText(team))}</p>${alert}</section>`;
  return hero + `<div class="ho-board">${scheduleHTML(data)}${pendingHTML(data)}${teamHTML(team)}</div>`;
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
  /** Raphael flies in from his corner once a day; the page drops the mark when his outer ring, the last of it, has gone. */
  const arrive = (): void => {
    const day = dateKey(new Date());
    let seen: string | null = null;
    try { seen = localStorage.getItem(ARRIVED_KEY); } catch { /* No storage: he flies in every time, which is harmless. */ }
    if (seen === day) return;
    try { localStorage.setItem(ARRIVED_KEY, day); } catch { /* As above. */ }
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) el.dataset.arrive = "";
  };
  el.addEventListener("animationend", event => {
    if (event.animationName === "ho-ring" && event.pseudoElement === "::after") delete el.dataset.arrive;
  });
  // Drawn again on every refresh, but the emblem stays the node it is while its picture is the same: a new <img> would start its turn over.
  let paintedHTML = "";
  /** Set by show(): the first paint of this showing flies him in if the day has not seen it yet. */
  let showing = false;
  const paint = (): void => {
    if (!data) return;
    const html = homeHTML(data, members);
    if (showing && visible) { showing = false; arrive(); }
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
    else if (["AgentTurn", "RoutinesChanged", "CalendarChanged", "SettingsChanged", "ConnectionsChanged"].includes(event.type)) void load(true, false);
  });
  app.cleared.on("conversation", () => { if (visible) void load(); });
  return { id: "home", el, show() { visible = true; showing = true; void load(); clearInterval(timer); timer = setInterval(() => { poll.run(); }, 30_000); },
    hide() { visible = false; generation++; clearInterval(timer); delete el.dataset.arrive; } };
}
