// Home keeps four equal summaries and a small week calendar in the same places for every data state.
import * as api from "../api";
import { avatarHTML, onAvatarChange } from "../avatar";
import type { HomeItem, HomeOverview } from "../home-types";
import { getLocale, onLocaleChange, t } from "../i18n";
import { loadingHTML } from "../loading";
import { buildReport } from "../report";
import { durationParts, formatCount } from "../stats";
import { openMemberThread } from "../team-navigation";
import type { AppContext, Page } from "../types";
import { btn, esc, ico, iconButton } from "../ui";
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

function scheduleHTML(data: HomeOverview): string {
  const now = new Date(data.generated_at_ms);
  return `<section class="ho-calendar" aria-label="${esc(t("overview.calendar"))}">${blockTarget(t("overview.calendar"), "calendar")}<header><h2>${esc(t("overview.calendar"))}</h2>` +
    `<span class="ho-open" aria-hidden="true">${ico("right")}</span></header><div class="ho-week">` +
    Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now); day.setDate(now.getDate() + index);
      const events = data.calendar.filter(item => sameDay(item.at_ms, day.getTime()));
      const label = day.toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "long" });
      return `<span class="ho-day${index === 0 ? " is-today" : ""}"${index === 0 ? ' aria-current="date"' : ""} aria-label="${esc(label)}" title="${esc([label, ...events.map(item => item.title)].join("\n"))}">` +
        `<small>${esc(day.toLocaleDateString(getLocale(), { weekday: "short" }))}</small><b>${day.getDate()}</b><span class="ho-dots" aria-hidden="true">${events.slice(0, 3).map(() => "<i></i>").join("")}</span></span>`;
    }).join("") + `</div></section>`;
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

export function homeHTML(data: HomeOverview): string {
  const report = buildReport(data.report, data.generated_at_ms);
  // His emblem turns while the window allows motion (avatar.ts keeps it still otherwise); nothing sits right of his report but its fix.
  const date = new Date(data.generated_at_ms).toLocaleDateString(getLocale(), { month: "numeric", day: "numeric", weekday: "short" });
  const headline = report.text.split(/(?<=[。！？])(?=[^》])/u).map(phrase => `<span class="ho-phrase">${esc(phrase)}</span>`).join("");
  const hero = `<section class="ho-hero">${avatarHTML({ size: 72, avatar: null, loop: true })}<div class="ho-lead-copy"><p class="ho-date">${esc(date)}</p><h1 class="ho-said">${headline}</h1></div>` +
    (report.action ? iconButton(report.action.target === "retry" ? "refresh" : "info", report.action.label, ' data-home-go="report"') : "") + `</section>`;
  const pending = data.today.filter(item => item.kind !== "routine");
  const inbox = [...pending, ...data.reports].slice(0, 3);
  return hero + `<div class="ho-board">` +
    card("inbox", t("overview.needsYou"), "agent",
      inbox.length ? `<div class="ho-inbox-body">${inbox.map(item => rowsHTML([item], "", item.kind === "report")).join("")}</div>` : `<p class="ho-empty ho-all-clear">${ico("check")}${esc(t("overview.allClear"))}</p>`, pending.length+data.counts.reports) +
    card("spend ho-stat", t("overview.month"), "usage", spendHTML(data)) +
    card("allowance ho-stat", t("overview.allowance"), "usage", allowanceHTML(data)) +
    card("dictation ho-stat", t("nav.dictation"), "dictation", dictationHTML(data)) + `</div>` + scheduleHTML(data);
}

export function createHome(app: AppContext): Page {
  const el = document.createElement("section");
  el.className = "page page-home";
  el.dataset.page = "home";
  el.hidden = true;
  let visible = false, generation = 0;
  let data: HomeOverview | null = null;
  let live: Promise<HomeOverview> | undefined;
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
    el.querySelector(".ho-calendar")!.replaceWith(next.querySelector(".ho-calendar")!);
  };
  async function load(): Promise<void> {
    const mine = ++generation;
    if (!data) el.innerHTML = loadingHTML();
    try {
      const next = await api.homeOverview();
      if (!visible || mine !== generation) return;
      data = next;
      paint();
      // Local records paint first. One live read fills the same page without emitting changes.
      live ??= api.homeOverview(true).finally(() => { live = undefined; });
      const fresh = await live;
      if (!visible || mine !== generation) return;
      data = fresh;
      paint();
    } catch {
      if (!visible || mine !== generation) return;
      if (!data) el.innerHTML = `<p class="ho-empty" role="status">${esc(t("overview.error"))}</p><button type="button" class="btn" data-home-go="reload">${esc(t("overview.retry"))}</button>`;
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
