// Home: Raphael's emblem and report, today's schedule, what waits for the owner, the members'
// reports, and three charts (spend, allowances, dictation). Little text; each card opens its page.
import * as api from "../api";
import { avatarHTML, onAvatarChange } from "../avatar";
import type { HomeItem, HomeOverview } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
import { loadingHTML } from "../loading";
import { buildReport } from "../report";
import { durationParts, formatCount } from "../stats";
import { openMemberThread } from "../team-navigation";
import type { AppContext, Page } from "../types";
import { esc, ico, iconButton } from "../ui";
import "../home.css";

const money = (value: number): string => value.toFixed(2);
const clock = (at: number): string => new Date(at).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();
const unitHTML = (parts: [string, string][]): string => parts.map(([n, u]) => `${esc(n)}<small>${esc(u)}</small>`).join("");

function faceHTML(item: HomeItem, size: number): string {
  if (item.member_id === 0) return avatarHTML({ size });
  return item.avatar_url?.startsWith("data:image/") ? `<img class="ho-face" style="--face:${size}px" src="${esc(item.avatar_url)}" alt="">`
    : `<span class="ho-face ho-face-none" style="--face:${size}px">${ico("person")}</span>`;
}

function card(key: string, title: string, go: string, body: string, count?: number): string {
  return `<section class="ho-card ho-${key}"><header><h2>${esc(title)}${count ? `<span class="ho-count">${count}</span>` : ""}</h2>` +
    iconButton("right", t("overview.all"), ` data-home-go="${go}"`, "ho-open") + `</header>${body}</section>`;
}

/** Bars of one value a day, the last (today) in the accent. */
function barsSVG(values: number[], label: string): string {
  const max = Math.max(...values, 0) || 1, w = 8, gap = 4, h = 44;
  return `<svg class="ho-bars" viewBox="0 0 ${values.length * (w + gap) - gap} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">` +
    values.map((v, i) => { const bh = Math.max(2, (Math.max(0, v) / max) * h); return `<rect class="${i === values.length - 1 ? "is-today" : ""}" x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2"/>`; }).join("") + `</svg>`;
}

function scheduleHTML(data: HomeOverview): string {
  const now = data.generated_at_ms, items = data.calendar.filter(item => sameDay(item.at_ms, now));
  if (!items.length) return `<p class="ho-empty">${ico("calendar")}${esc(t("overview.noSchedule"))}</p>`;
  let nowShown = false;
  const rows = items.map(item => {
    const marker = !nowShown && item.at_ms > now ? (nowShown = true, `<div class="ho-now" aria-hidden="true"><time>${esc(clock(now))}</time></div>`) : "";
    return marker + `<button type="button" class="btn ho-slot${item.at_ms < now ? " is-past" : ""}${item.kind === "event" ? " is-event" : ""}" data-home-item="${esc(item.id)}">` +
      `<time datetime="${new Date(item.at_ms).toISOString()}">${esc(clock(item.at_ms))}</time><span class="ho-slot-title">${esc(item.title)}</span>` +
      (item.kind === "event" ? `<span class="ho-slot-source">${ico("calendar")}</span>` : faceHTML(item, 24)) + `</button>`;
  }).join("");
  return `<div class="ho-schedule">${rows}${nowShown ? "" : `<div class="ho-now" aria-hidden="true"><time>${esc(clock(now))}</time></div>`}</div>`;
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
    barsSVG(u.daily.slice(-14), t("overview.chart", { p0: u.daily.slice(-14).map(money).join(", ") })) + `</div>`;
}

function allowanceHTML(data: HomeOverview): string {
  const brains = data.usage.allowances.brains;
  const windows = brains.flatMap(brain => brain.windows.filter(w => w.remaining_percent !== null).map(window => ({brain, window, used:100-window.remaining_percent!}))).sort((a,b)=>b.used-a.used);
  const most = windows[0], next = windows[1];
  return `<div class="ho-big">${most ? `${most.used}%` : "—"}<small>${most ? esc(`${most.brain.name.replace(/\s+CLI$/, "")} ${t(`overview.${most.window.period}`)}`) : ""}</small></div>` +
    `<div class="ho-sub">${esc(next ? `${t(`overview.${next.window.period}`)} ${next.used}%` : t("overview.emptyAllowances"))}</div>` +
    `<div class="ho-chart ho-allowances">` + brains.map(brain => {
      const window = windows.find(w => w.brain === brain)?.window;
      const used = window?.remaining_percent == null ? null : 100-window.remaining_percent;
      const tip = window?.resets_at ? t("overview.reset", { p0: new Date(window.resets_at*1000).toLocaleString(getLocale(), { month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false }) }) : "";
      return `<div class="ho-meter-row" title="${esc(tip)}"><small>${esc(brain.name.replace(/\s+CLI$/, ""))}</small><span class="ho-meter"><i style="width:${used ?? 0}%"></i></span><b>${used === null ? "—" : `${used}%`}</b></div>`;
    }).join("") + `</div>`;
}

function dictationHTML(data: HomeOverview): string {
  const d = data.dictation;
  return `<div class="ho-big">${esc(formatCount(d.words))}<small>${esc(t("home.003"))}</small></div>` +
    `<div class="ho-sub">${esc(t("home.005"))} ${unitHTML(durationParts(d.time_saved_seconds))}</div><div class="ho-chart">` +
    barsSVG((d.daily ?? []).slice(-14), t("overview.wordsChart", { p0: (d.daily ?? []).slice(-14).join(", ") })) + `</div>`;
}

export function homeHTML(data: HomeOverview): string {
  const report = buildReport(data.report, data.generated_at_ms);
  // His emblem turns while the window allows motion (avatar.ts keeps it still otherwise); nothing sits right of his report but its fix.
  const date = new Date(data.generated_at_ms).toLocaleDateString(getLocale(), { month: "numeric", day: "numeric", weekday: "short" });
  const headline = report.text.split(/(?<=[。！？])(?=[^》])/u).map(phrase => `<span class="ho-phrase">${esc(phrase)}</span>`).join("");
  const hero = `<section class="ho-hero">${avatarHTML({ size: 72, avatar: null, loop: true })}<div class="ho-lead-copy"><p class="ho-date">${esc(date)}</p><h1 class="ho-said">${headline}</h1></div>` +
    (report.action ? iconButton(report.action.target === "retry" ? "refresh" : "info", report.action.label, ' data-home-go="report"') : "") + `</section>`;
  const pending = data.today.filter(item => item.kind !== "routine");
  return hero + `<div class="ho-board">` +
    card("today", t("overview.today"), "calendar", scheduleHTML(data)) +
    card("inbox", t("overview.needsYou"), "agent",
      `<section class="ho-pending ho-section"><h3>${esc(t("overview.pending"))}<span class="ho-count">${pending.length}</span></h3>${rowsHTML(pending, t("overview.nothing"), false)}</section>` +
      `<section class="ho-reports ho-section"><h3>${esc(t("overview.reports"))}<span class="ho-count">${data.counts.reports}</span></h3>${rowsHTML(data.reports, t("overview.noReports"), true)}</section>`, pending.length+data.counts.reports) +
    card("spend ho-stat", t("overview.month"), "usage", spendHTML(data)) +
    card("allowance ho-stat", t("overview.allowance"), "usage", allowanceHTML(data)) +
    card("dictation ho-stat", t("nav.dictation"), "dictation", dictationHTML(data)) + `</div>`;
}

export function createHome(app: AppContext): Page {
  const el = document.createElement("section");
  el.className = "page page-home";
  el.dataset.page = "home";
  el.hidden = true;
  let visible = false, generation = 0;
  let data: HomeOverview | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  // Drawn again on every refresh, but the emblem stays the node it is while its picture is the same: a new <img> would start its turn over.
  const paint = (): void => {
    if (!data) return;
    const html = homeHTML(data), emblem = el.querySelector<HTMLElement>(".ho-hero > .av");
    if (!emblem) { el.innerHTML = html; return; }
    const next = document.createElement("div");
    next.innerHTML = html;
    const fresh = next.querySelector<HTMLElement>(".ho-hero")!;
    if (fresh.querySelector(".av")?.outerHTML !== emblem.outerHTML) { el.innerHTML = html; return; }
    for (const child of [...emblem.parentElement!.children]) if (child !== emblem) child.remove();
    emblem.parentElement!.append(...[...fresh.children].filter(child => !child.matches(".av")));
    el.querySelector(".ho-board")!.replaceWith(next.querySelector(".ho-board")!);
  };
  async function load(): Promise<void> {
    const mine = ++generation;
    if (!data) el.innerHTML = loadingHTML();
    try {
      const next = await api.homeOverview();
      if (!visible || mine !== generation) return;
      data = next;
      paint();
    } catch {
      if (!visible || mine !== generation) return;
      el.innerHTML = `<p class="ho-empty" role="status">${esc(t("overview.error"))}</p><button type="button" class="btn" data-home-go="reload">${esc(t("overview.retry"))}</button>`;
    }
  }
  el.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-home-item], [data-home-go]");
    if (!target) return;
    const item = data && [...data.today, ...data.reports, ...data.calendar].find(item => item.id === target.dataset.homeItem);
    if (item) {
      if (item.kind === "routine" || item.kind === "event") app.go("automations");
      else openMemberThread(app, item.member_id, item.turn_id ?? undefined);
      return;
    }
    switch (target.dataset.homeGo) {
      case "reload": void load(); break;
      case "usage": app.go("settings", "usage"); break;
      case "dictation": app.go("dictation"); break;
      case "calendar": app.go("automations"); break;
      case "report":
        if (data && buildReport(data.report, data.generated_at_ms).action?.target === "retry") {
          void api.statusCheckOpenrouter().then(load, load);
        } else app.go("settings", data?.report.openrouter.state === "ok" ? "usage" : "models");
        break;
      default: app.go("agent");
    }
  });
  onAvatarChange(() => { if (visible) paint(); });
  // Settings retains Home behind its dialog. Translate cached data even while the page is inactive.
  onLocaleChange(paint);
  app.onEvent(event => {
    if (visible && ["AgentTurn", "MembersChanged", "RoutinesChanged", "SettingsChanged", "QuotaChanged", "AgentQuestion", "AgentQuestionClosed", "ConversationsChanged", "ConnectionsChanged"].includes(event.type)) void load();
  });
  app.cleared.on("dictation", () => { if (visible) void load(); });
  app.cleared.on("conversation", () => { if (visible) void load(); });
  return { id: "home", el, show() { visible = true; void load(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) void load(); }, 30_000); },
    hide() { visible = false; generation++; clearInterval(timer); } };
}
