// Home keeps four equal summaries and a month calendar in the same places for every data state.
import * as api from "../api";
import { avatarHTML, onAvatarChange } from "../avatar";
import { chipHTML, dismissOffer, googleNoticeHTML, type CalendarEntry, type EntryKind } from "../calendar-view";
import type { GoogleCalendarState, HomeItem, HomeOverview } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
import { loadingHTML } from "../loading";
import { buildReport } from "../report";
import { durationParts, formatCount } from "../stats";
import { dateKey, monthDays, monthLabel } from "../schedule-picker";
import { dayName } from "../members";
import { onOwnerProfile } from "../owner-avatar";
import { openMemberThread } from "../team-navigation";
import type { AppContext, CalendarCreate, CalendarDate, CalendarEventFocus, CalendarWeek, Page } from "../types";
import { faceHTML as memberFaceHTML } from "../members";
import { btn, esc, ico, iconButton } from "../ui";
import "../home.css";

const money = (value: number): string => value.toFixed(2);
const clock = (at: number): string => new Date(at).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
const unitHTML = (parts: [string, string][]): string => parts.map(([n, u]) => `${esc(n)}<small>${esc(u)}</small>`).join("");

const faceHTML = (item: HomeItem, size: number): string => memberFaceHTML({ id: item.member_id, name: item.name, avatar: item.avatar }, size);

function card(key: string, title: string, go: string, body: string, count?: number): string {
  return `<section class="ho-card ho-${key}">${blockTarget(title, go)}<header><h2>${esc(title)}${count ? `<span class="ho-count">${count}</span>` : ""}</h2>` +
    `<span class="ho-open" aria-hidden="true">${ico("right")}</span></header>${body}</section>`;
}

function blockTarget(title: string, go: string): string {
  return btn("", "ho-target", ` data-home-go="${go}" aria-label="${esc(title)}"`);
}

/** Bars of one value a day, the last (today) in the accent. */
function barsSVG(values: number[], label: string): string {
  if (!values.some(value => value > 0)) return "";
  const max = Math.max(...values, 0) || 1, w = 8, gap = 4, h = 44;
  return `<svg class="ho-bars" viewBox="0 0 ${values.length * (w + gap) - gap} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
    values.map((v, i) => { const bh = Math.max(2, (Math.max(0, v) / max) * h); return `<rect class="${i === values.length - 1 ? "is-today" : ""}" x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2"/>`; }).join("") + `</svg>`;
}

/** A calendar item as the chip of the Calendar page draws it. */
function chipOf(item: HomeItem): Pick<CalendarEntry, "kind" | "title" | "allDay" | "start" | "member"> {
  const kind: EntryKind = item.kind === "own" ? "own" : item.kind === "routine" ? "routine" : "event";
  const by = kind === "routine" ? item.member_id : item.added_by;
  const member = kind !== "event" && typeof by === "number" && item.name ? { id: by, name: item.name, avatar: item.avatar } : undefined;
  return { kind, title: item.title, allDay: item.all_day === true, start: item.at_ms, member };
}

function scheduleHTML(data: HomeOverview, month = new Date(data.generated_at_ms), selected = dateKey(new Date(data.generated_at_ms))): string {
  const today = dateKey(new Date(data.generated_at_ms)), items = data.calendar_items ?? data.calendar;
  const byDay = new Map<string, HomeItem[]>();
  for (const item of items) {
    const key = dateKey(new Date(item.at_ms)), day = byDay.get(key) ?? [];
    day.push(item); byDay.set(key, day);
  }
  const count = (key: string): number => data.calendar_counts?.[key] ?? byDay.get(key)?.length ?? 0;
  const marked = new Set(data.calendar_days ?? [...byDay.keys()]);
  const weekday = new Intl.DateTimeFormat(getLocale(), { weekday: "narrow" });
  const eventTarget = (item: HomeItem): string => ` data-home-event="${esc(item.id)}" data-home-date="${dateKey(new Date(item.at_ms))}"`;
  const more = (key: string, total: number, limit: number, className: string): string => total > limit
    ? btn(esc(t("overview.moreEvents", { p0: total - limit })), className, ` data-home-go="calendar" data-home-date="${key}"`) : "";
  const days = monthDays(month).map(day => {
    const key = dateKey(day), events = byDay.get(key) ?? [], label = day.toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "long" });
    return `<div class="ho-day${key === today ? " is-today" : ""}${key === selected ? " is-selected" : ""}${day.getMonth() === month.getMonth() ? "" : " ho-other-month"}"${key === today ? ' aria-current="date"' : ""}>` +
      btn(`<b>${day.getDate()}</b><span class="ho-dots" aria-hidden="true">${marked.has(key) ? "<i></i>" : ""}</span>`, "ho-date-btn",
        ` data-home-select="${key}" aria-pressed="${key === selected}" aria-label="${esc(label)}"`) +
      `<div class="ho-day-events">${events.slice(0, 3).map(item => chipHTML(chipOf(item), "ho-event-chip is-line", eventTarget(item), { clock: !item.all_day })).join("")}` +
      more(key, count(key), 2, "ho-more ho-more-two") + more(key, count(key), 3, "ho-more ho-more-three") + `</div></div>`;
  }).join("");
  const chosen = byDay.get(selected) ?? [], chosenLabel = new Date(`${selected}T00:00:00`).toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "short" });
  const create = (cls: string): string => btn(ico("plus") + esc(t("auto.create")), `sm ho-create ${cls}`, ` data-home-create="${selected}"`);
  const agenda = `<aside class="ho-agenda" data-selected-day="${selected}"><h3>${esc(chosenLabel)}</h3>` +
    (chosen.length ? chosen.slice(0, 3).map(item => chipHTML(chipOf(item), "ho-agenda-row is-line", eventTarget(item), { face: 20 })).join("") + more(selected, count(selected), 3, "ho-agenda-more")
      : `<p class="ho-day-empty">${esc(t("overview.emptyDay"))}</p>${create("ho-create-day")}`) + `</aside>`;
  const notice = googleNoticeHTML(data.calendar_google, { go: 'data-home-go="connections"', dismiss: "data-home-dismiss" });
  return `<div class="ho-calendar-frame"><section class="ho-calendar" aria-label="${esc(t("overview.calendar"))}" data-month="${dateKey(month).slice(0, 7)}">${blockTarget(t("overview.calendar"), "calendar")}<header><h2>${esc(monthLabel(month))}</h2><div class="ho-calendar-note">${notice}${items.length ? "" : create("ho-create-month")}</div>` +
    `<div class="ho-month-actions">${iconButton("left", t("auto.monthPrevious"), ' data-home-month="-1"')}${iconButton("right", t("auto.monthNext"), ' data-home-month="1"')}${btn(esc(t("auto.today")), "sm ho-today", ' data-home-today')}</div></header>` +
    `<div class="ho-calendar-body"><div class="ho-month">${[1, 2, 3, 4, 5, 6, 0].map(n => `<span class="ho-weekday" title="${esc(dayName(n))}">${esc(weekday.format(new Date(2024, 0, 7 + n)))}</span>`).join("")}${days}</div>${agenda}</div></section></div>`;
}

function rowsHTML(items: HomeItem[], empty: string, report: boolean): string {
  if (!items.length) return `<p class="ho-empty">${ico("check")}${esc(empty)}</p>`;
  return items.slice(0, 4).map(item => `<button type="button" class="btn ho-row" data-home-item="${esc(item.id)}">${faceHTML(item, 28)}` +
    `<span class="ho-row-copy"><strong>${esc(report ? item.name : item.title)}</strong><span>${esc(report ? item.summary : item.name)}</span></span>` +
    `<time datetime="${new Date(item.at_ms).toISOString()}">${esc(clock(item.at_ms))}</time></button>`).join("");
}

function spendHTML(data: HomeOverview): string {
  const u = data.usage, share = Math.round(Math.max(0, Math.min(100, u.limit_usd > 0 ? u.month_usd / u.limit_usd * 100 : 0)));
  return `<div class="ho-big">US$ ${money(u.month_usd)}<small>/ ${money(u.limit_usd)}</small></div>` +
    `<div class="ho-sub">${esc(t("overview.used", { p0: share }))}</div><div class="ho-chart">` +
    (barsSVG(u.daily.slice(-14), t("overview.chart", { p0: u.daily.slice(-14).map(money).join(", ") })) || `<p class="ho-empty">${esc(t("overview.noSpend"))}</p>`) + `</div>`;
}

function allowanceHTML(data: HomeOverview): string {
  const brains = data.usage.allowances.brains;
  const windows = brains.flatMap(brain => brain.windows.filter(w => w.remaining_percent !== null).map(window => ({brain, window, used:100-window.remaining_percent!}))).sort((a,b)=>b.used-a.used);
  const most = windows[0], next = windows[1];
  return (most ? `<div class="ho-big">${most.used}%<small>${esc(`${most.brain.name.replace(/\s+CLI$/, "")} ${t(`overview.${most.window.period}`)}`)}</small></div>` : `<p class="ho-empty ho-allowance-empty">${ico("info")}${esc(t("overview.emptyAllowances"))}</p>`) +
    (next ? `<div class="ho-sub">${esc(`${t(`overview.${next.window.period}`)} ${next.used}%`)}</div>` : "") +
    `<div class="ho-chart ho-allowances">` + brains.map(brain => {
      const window = windows.find(w => w.brain === brain)?.window;
      const used = window?.remaining_percent == null ? null : 100-window.remaining_percent;
      const tip = window?.resets_at ? t("overview.reset", { p0: new Date(window.resets_at*1000).toLocaleString(getLocale(), { month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false }) }) : "";
      return `<div class="ho-meter-row${used === null ? " is-unknown" : ""}" title="${esc(tip)}"><small>${esc(brain.name.replace(/\s+CLI$/, ""))}</small>` +
        (used === null ? `<b>${esc(t("overview.unknown"))}</b>` : `<span class="ho-meter"><i style="width:${used}%"></i></span><b>${used}%</b>`) + `</div>`;
    }).join("") + `</div>`;
}

function dictationHTML(data: HomeOverview): string {
  const d = data.dictation;
  return `<div class="ho-big">${esc(formatCount(d.words))}<small>${esc(t("home.003"))}</small></div>` +
    `<div class="ho-sub">${esc(t("home.005"))} ${unitHTML(durationParts(d.time_saved_seconds))}</div><div class="ho-chart">` +
    (barsSVG((d.daily ?? []).slice(-14), t("overview.wordsChart", { p0: (d.daily ?? []).slice(-14).join(", ") })) || `<p class="ho-empty">${esc(t("overview.noDictation"))}</p>`) + `</div>`;
}

export function homeHTML(data: HomeOverview, month?: Date, selected?: string): string {
  const report = buildReport(data.report, data.generated_at_ms);
  // His emblem turns while the window allows motion (avatar.ts keeps it still otherwise); nothing sits right of his report but its fix.
  const date = new Date(data.generated_at_ms).toLocaleDateString(getLocale(), { month: "numeric", day: "numeric", weekday: "short" });
  const headline = report.text.split(/(?<=[。！？])(?=[^》])/u).map(phrase => `<span class="ho-phrase">${esc(phrase)}</span>`).join("");
  const hero = `<section class="ho-hero">${avatarHTML({ size: 128, avatar: null, loop: true })}<div class="ho-lead-copy"><p class="ho-date">${esc(date)}</p><h1 class="ho-said">${headline}</h1></div>` +
    (report.action ? iconButton(report.action.target === "retry" ? "refresh" : "info", report.action.label, ' data-home-go="report"') : "") + `</section>`;
  const pending = data.today.filter(item => item.kind !== "routine");
  const inbox = [...pending, ...data.reports].slice(0, 3);
  return hero + `<div class="ho-board">` +
    card("inbox", t("overview.needsYou"), "agent",
      inbox.length ? `<div class="ho-inbox-body">${inbox.map(item => rowsHTML([item], "", item.kind === "report")).join("")}</div>` : `<p class="ho-empty ho-all-clear">${ico("check")}${esc(t("overview.allClear"))}</p>`, pending.length+data.counts.reports) +
    card("spend ho-stat", t("overview.month"), "usage", spendHTML(data)) +
    card("allowance ho-stat", t("overview.allowance"), "usage", allowanceHTML(data)) +
    card("dictation ho-stat", t("nav.dictation"), "dictation", dictationHTML(data)) + `</div>` + scheduleHTML(data, month, selected);
}

export function createHome(app: AppContext): Page {
  const el = document.createElement("section");
  el.className = "page page-home";
  el.dataset.page = "home";
  el.hidden = true;
  let visible = false, generation = 0;
  let data: HomeOverview | null = null;
  let month: Date | undefined, selected: string | undefined;
  let live: Promise<HomeOverview> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let slide: { direction: number; started: number } | undefined;
  // Drawn again on every refresh, but the emblem stays the node it is while its picture is the same: a new <img> would start its turn over.
  const paint = (): void => {
    if (!data) return;
    const html = homeHTML(data, month, selected), emblem = el.querySelector<HTMLElement>(".ho-hero > .av");
    if (!emblem) { el.innerHTML = html; return; }
    const next = document.createElement("div");
    next.innerHTML = html;
    const fresh = next.querySelector<HTMLElement>(".ho-hero")!;
    if (fresh.querySelector(".av")?.outerHTML !== emblem.outerHTML) { el.innerHTML = html; return; }
    for (const child of [...emblem.parentElement!.children]) if (child !== emblem) child.remove();
    emblem.parentElement!.append(...[...fresh.children].filter(child => !child.matches(".av")));
    el.querySelector(".ho-board")!.replaceWith(next.querySelector(".ho-board")!);
    el.querySelector(".ho-calendar-frame")!.replaceWith(next.querySelector(".ho-calendar-frame")!);
    const elapsed = slide ? performance.now() - slide.started : 160;
    if (slide && elapsed < 160 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = el.querySelector('.ho-month')?.animate?.(
        [{ transform: `translateX(${slide.direction * 16}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 160, easing: 'ease-out' });
      if (animation) animation.currentTime = elapsed;
    }
  };
  async function load(): Promise<void> {
    const mine = ++generation;
    if (!data) el.innerHTML = loadingHTML();
    try {
      const requestedMonth = month ? dateKey(month).slice(0, 7) : undefined;
      const next = await api.homeOverview(false, requestedMonth);
      if (!visible || mine !== generation) return;
      data = next;
      paint();
      // Local records paint first. One live read fills the same page without emitting changes.
      if (!live) {
        const pending = api.homeOverview(true, requestedMonth);
        live = pending;
        const clear = (): void => { if (live === pending) live = undefined; };
        void pending.then(clear, clear);
      }
      const fresh = await live;
      if (!visible || mine !== generation) return;
      data = fresh;
      paint();
    } catch {
      if (!visible || mine !== generation) return;
      if (!data) el.innerHTML = `<p class="ho-empty" role="status">${esc(t("overview.error"))}</p><button type="button" class="btn" data-home-go="reload">${esc(t("overview.retry"))}</button>`;
    }
  }
  function moveMonth(direction: number): void {
    if (!data) return;
    const current = month ?? new Date(data.generated_at_ms);
    month = new Date(current.getFullYear(), current.getMonth() + direction, 1);
    selected = dateKey(month);
    live = undefined;
    data = { ...data, calendar_days: [], calendar_items: [], calendar_counts: {} };
    const focused = el.querySelector<HTMLElement>('[data-home-month]:focus')?.dataset.homeMonth;
    slide = { direction, started: performance.now() };
    paint();
    if (focused) el.querySelector<HTMLElement>(`[data-home-month="${focused}"]`)?.focus();
    void load();
  }
  /** The block itself opens the calendar in its usual view, on the day this block shows. */
  const openWeek = (): void => app.go("automations", `calendar-week:${selected ?? dateKey(new Date(data!.generated_at_ms))}` as CalendarWeek);
  let wheelDistance = 0, wheelAt = 0, swipedAt = -1000;
  el.addEventListener("wheel", event => {
    if (!(event.target as Element).closest('.ho-calendar') || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = performance.now();
    if (now - swipedAt < 400) return;
    if (now - wheelAt > 160) wheelDistance = 0;
    wheelAt = now; wheelDistance += event.deltaX;
    if (Math.abs(wheelDistance) < 60) return;
    moveMonth(wheelDistance > 0 ? 1 : -1); wheelDistance = 0; swipedAt = now;
  }, { passive: false });
  let touch: { id: number; x: number; y: number } | undefined;
  el.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch" && (event.target as Element).closest('.ho-calendar')) touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  el.addEventListener("pointerup", event => {
    if (!touch || event.pointerId !== touch.id) return;
    const dx = event.clientX - touch.x, dy = event.clientY - touch.y; touch = undefined;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) { moveMonth(dx < 0 ? 1 : -1); swipedAt = performance.now(); }
  });
  el.addEventListener("pointercancel", () => { touch = undefined; });
  el.addEventListener("click", event => {
    if (performance.now() - swipedAt < 400 && (event.target as Element).closest('.ho-calendar')) { event.preventDefault(); return; }
    const navigation = (event.target as Element).closest<HTMLElement>('[data-home-month]');
    if (navigation) { moveMonth(Number(navigation.dataset.homeMonth)); return; }
    const todayButton = (event.target as Element).closest('[data-home-today]');
    if (todayButton && data) {
      const focused = document.activeElement === todayButton;
      month = new Date(data.generated_at_ms); selected = dateKey(month); live = undefined; paint();
      if (focused) el.querySelector<HTMLElement>('[data-home-today]')?.focus({ preventScroll: true });
      void load(); return;
    }
    const dateButton = (event.target as Element).closest<HTMLElement>('[data-home-select]');
    if (dateButton) { app.go('automations', dateButton.dataset.homeSelect as CalendarDate); return; }
    const creating = (event.target as Element).closest<HTMLElement>('[data-home-create]');
    if (creating) { app.go('automations', `calendar-new:${creating.dataset.homeCreate}` as CalendarCreate); return; }
    const dismissing = (event.target as Element).closest<HTMLElement>('[data-home-dismiss]');
    if (dismissing) { dismissOffer(dismissing.dataset.homeDismiss as GoogleCalendarState); paint(); return; }
    const target = (event.target as Element).closest<HTMLElement>("[data-home-item], [data-home-go], [data-home-event]");
    if (!target) {
      if ((event.target as Element).closest(".ho-calendar") && data) openWeek();
      return;
    }
    if (target.dataset.homeEvent) {
      app.go('automations', `calendar:${target.dataset.homeDate}:${encodeURIComponent(target.dataset.homeEvent)}` as CalendarEventFocus); return;
    }
    const item = data && [...data.today, ...data.reports, ...data.calendar].find(item => item.id === target.dataset.homeItem);
    if (item) {
      if (item.kind === "routine" || item.kind === "event") app.go("automations");
      else openMemberThread(app, item.member_id, item.turn_id ?? undefined);
      return;
    }
    switch (target.dataset.homeGo) {
      case "reload": void load(); break;
      case "usage": app.go("settings", "usage"); break;
      case "connections": app.go("settings", "connections"); break;
      case "dictation": app.go("dictation"); break;
      case "calendar":
        if (target.dataset.homeDate) app.go("automations", target.dataset.homeDate as CalendarDate);
        else openWeek();
        break;
      case "report":
        if (data && buildReport(data.report, data.generated_at_ms).action?.target === "retry") {
          void api.statusCheckOpenrouter().then(load, load);
        } else app.go("settings", data?.report.openrouter.state === "ok" ? "usage" : "models");
        break;
      default: app.go("agent");
    }
  });
  onAvatarChange(() => { if (visible) paint(); });
  onOwnerProfile(paint);
  // Settings retains Home behind its dialog. Translate cached data even while the page is inactive.
  onLocaleChange(paint);
  app.onEvent(event => {
    if (visible && ["AgentTurn", "MembersChanged", "RoutinesChanged", "CalendarChanged", "SettingsChanged", "QuotaChanged", "AgentQuestion", "AgentQuestionClosed", "ConversationsChanged", "ConnectionsChanged"].includes(event.type)) void load();
  });
  app.cleared.on("dictation", () => { if (visible) void load(); });
  app.cleared.on("conversation", () => { if (visible) void load(); });
  return { id: "home", el, show() { visible = true; void load(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) void load(); }, 30_000); },
    hide() { visible = false; generation++; clearInterval(timer); } };
}
