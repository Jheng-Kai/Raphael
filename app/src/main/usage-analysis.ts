// Settings › 用量 › 分析: what a period of 7 or 30 days cost and was used for, from the core's `usage.analytics`
// (core brain/usage.py; costs from the spend ledger only). Four sections, each a heading, a line of what it counts and
// one card: 花費紀錄 (the period's total, a stacked bar a day, a legend with each line's share, by purpose, model or
// provider), 誰花最多 (everyone's replies, cost and most used model, five rows then 顯示更多, which folds back with 顯示較少),
// 工具使用 and 訊息 (a line a day per tool or per model / source, with their counts). Every chart answers the pointer: a day
// under it says its date and each line's value there in a small tip of the app's own, its bar lit or a guide on the lines,
// and the arrow keys read the days of a focused chart (`bindUsageReadings`). A section with nothing in the period says so
// in one quiet line: no empty chart, and never a raw key (`__other__` reads 其他, a model reads as the app names models
// elsewhere). What is drawn here is pure: settings.ts keeps the state through `createUsageAnalysis` and draws the tab.

import "./usage-analysis.css";
import { formatUsd } from "./format";
import { getLocale, t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { faceHTML, RAPHAEL_ID } from "./members";
import type { MembersList } from "./types";
import { type Choice, btn, esc, sel, tabs } from "./ui";
import type { UsageAnalytics, UsageBreakdown, UsageRange, UsageSeries } from "./usage-analytics-types";

export type CostGroup = "purpose" | "model" | "provider";
export type MessageGroup = "model" | "source";
/** A member's face as the list draws it, by id. */
export type Face = { id: number; name: string; avatar?: string | null; avatar_url?: string | null };

export interface UsageAnalysisView {
  range: UsageRange;
  group: CostGroup;
  messages: MessageGroup;
  /** 顯示更多 was pressed (and not 顯示較少 after it): every row of 誰花最多, not the first five. */
  allPeople: boolean;
  /** The period's reading: null while the first one is out, "failed" when none could be had. */
  data: UsageAnalytics | null | "failed";
  /** The members' faces and names, by id, as the list gives them (empty while it is not read). */
  people: ReadonlyMap<number, Face>;
}

/** How a model id reads in words (model-picker.ts `modelDisplayName`, with the catalogue Settings holds). */
export interface UsageAnalysisNames { model(id: string): string }

const tr = t as unknown as (key: MessageKey) => string;
const PURPOSES: Record<string, MessageKey> = {
  agent: "usage.agent", cleanup: "usage.cleanup", stt: "usage.stt", memory: "usage.memory",
  image: "media.image", video: "media.video", vision: "services.vision",
};
const TOOLS: Record<string, MessageKey> = {
  computer: "usage.computer", web_search: "services.search", web_read: "services.read", routines: "usage.routines",
  ask_member: "usage.askOthers", memory: "usage.memory", files: "usage.files", other: "usage.other",
};
const SOURCES: Record<string, MessageKey> = {
  app: "usage.typed", voice: "usage.voice", overlay: "usage.overlay", connector: "usage.connector", greeting: "usage.greeting",
  reaction: "usage.reaction", member: "usage.between", room: "usage.group", routine: "usage.routines", worker: "usage.background",
};
/** Messaging apps keep their own names in every language. */
const BRANDS: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
const MOST_PEOPLE = 5;

/** The words of one line of a breakdown, in the window's language. */
export function seriesLabel(kind: CostGroup | MessageGroup | "tool", series: Pick<UsageSeries, "key" | "label">, names: UsageAnalysisNames): string {
  const { key } = series;
  if (key === "__other__") return t("usage.other");
  if (key === "unknown" || !key) return t("usage.unknown");
  if (kind === "purpose") return PURPOSES[key] ? tr(PURPOSES[key]) : t("usage.other");
  if (kind === "model") return names.model(key) || t("usage.unknown");
  // The core names each provider (a deleted one keeps its id: it reads as the id it had).
  if (kind === "provider") return series.label || key;
  if (kind === "tool") return key.startsWith("connection:") ? series.label || key.slice("connection:".length) : TOOLS[key] ? tr(TOOLS[key]) : t("usage.other");
  return BRANDS[key] ?? (SOURCES[key] ? tr(SOURCES[key]) : t("usage.other"));
}

/** A local calendar day `YYYY-MM-DD` as a short date: 11/15. */
export function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(getLocale(), { month: "numeric", day: "numeric" }).format(new Date(year, month - 1, date));
}

const count = (n: number): string => new Intl.NumberFormat(getLocale()).format(n);

/** The top of a scale at or above `max`: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 of its power of ten. */
export function scaleTop(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * power >= max * (1 - 1e-9)) ?? 10;
  return step * power;
}

/** Which days have their date under the chart: the first, the middle and the last of a week; every seventh of a month and the last. */
const labelled = (n: number, i: number): boolean => i === n - 1 || (n <= 7 ? i === 0 || i === Math.floor((n - 1) / 2) : i % 7 === 0 && n - 1 - i >= 3);

/** The colour slot of a line: the chart colours in order (styles.css --chart-1…), 其他 in a quiet grey. */
const slot = (series: UsageSeries, i: number): string => (series.key === "__other__" ? "other" : String(i + 1));

const heading = (title: string, controls = ""): string =>
  `<h2>${esc(title)}</h2>` + (controls ? `<div class="ua-controls">${controls}</div>` : "");
const emptyLine = (text: string): string => `<p class="ua-line">${esc(text)}</p>`;

/** A day's values, one a line, in words, for the reading of the day under the pointer (`readingAt`). */
const json = (values: string[]): string => esc(JSON.stringify(values));

/** The legend under a chart: each line's colour, its name and what it adds up to. */
const legendHTML = (series: UsageSeries[], label: (s: UsageSeries) => string, value: (s: UsageSeries) => string): string =>
  `<ul class="ua-legend">${series.map((s, i) => `<li data-s="${slot(s, i)}"><i aria-hidden="true"></i><span class="ua-lname">${esc(label(s))}</span><strong class="num">${esc(value(s))}</strong></li>`).join("")}</ul>`;

/** 花費紀錄: the period's total, a stacked bar a day on a scale with two lines, and each line's share. */
function costHTML(v: UsageAnalysisView, data: UsageAnalytics, names: UsageAnalysisNames): string {
  const breakdown: UsageBreakdown = data.cost_by[v.group];
  const days = data.days;
  const totals = days.map((_, i) => breakdown.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const top = scaleTop(Math.max(...totals));
  const label = (s: UsageSeries): string => seriesLabel(v.group, s, names);
  const bars = days.map((day, i) => {
    const height = totals[i] > 0 ? Math.max(1, (totals[i] / top) * 100) : 0;
    const parts = totals[i] > 0 ? breakdown.series.map((s, k) => (s.values[i] ?? 0) > 0 ? `<i data-s="${slot(s, k)}" style="height:${((s.values[i] / totals[i]) * 100).toFixed(2)}%"></i>` : "").join("") : "";
    // What the day says under the pointer: its date, its total and what each line of the legend cost that day.
    return `<span class="ua-day" style="height:${height.toFixed(2)}%" data-day="${esc(shortDay(day))}" data-total="${esc(formatUsd(totals[i]))}"` +
      ` data-v="${json(breakdown.series.map((s) => formatUsd(s.values[i] ?? 0)))}">${parts}</span>`;
  }).join("");
  const ticks = days.map((day, i) => `<span>${labelled(days.length, i) ? esc(shortDay(day)) : ""}</span>`).join("");
  return `<div class="ua-card" data-ua-card="cost">` +
    `<div class="ua-sum"><span>${esc(t("usage.periodSpent", { p0: shortDay(days[0]), p1: shortDay(days[days.length - 1]) }))}</span><strong class="num">${esc(formatUsd(breakdown.total))}</strong></div>` +
    `<div class="ua-plot" role="img" aria-label="${esc(t("usage.costChart"))}" tabindex="0" data-ua-read="cost" data-k="ua-read-cost">` +
    `<div class="ua-y" aria-hidden="true"><span>${esc(formatUsd(top))}</span><span>${esc(formatUsd(top / 2))}</span><span>${esc(formatUsd(0))}</span></div>` +
    `<div class="ua-area"><div class="ua-bars" data-n="${days.length}" style="--n:${days.length}">${bars}</div>` +
    `<div class="ua-x" aria-hidden="true" style="--n:${days.length}">${ticks}</div></div></div>` +
    legendHTML(breakdown.series, label, (s) => `${Math.round(s.share * 100)}%`) + `</div>`;
}

/** 誰花最多: everyone who replied in the period, the one who cost most first. */
function peopleHTML(v: UsageAnalysisView, data: UsageAnalytics, names: UsageAnalysisNames): string {
  const people = [...data.members].sort((a, b) => b.cost_usd - a.cost_usd || b.turns - a.turns || a.id - b.id);
  if (!people.length) return emptyLine(t("usage.noReplies"));
  const shown = v.allPeople ? people : people.slice(0, MOST_PEOPLE);
  const rows = shown.map((person) => {
    const known = v.people.get(person.id);
    const name = known?.name || (person.id === RAPHAEL_ID ? t("agent.title") : person.name);
    const model = person.models[0]?.model;
    return `<tr data-ua-person="${person.id}"><th scope="row"><span class="ua-who">${faceHTML(known ?? { id: person.id, name }, 22)}<span>${esc(name)}</span></span></th>` +
      `<td class="num">${esc(count(person.turns))}</td><td class="num">${esc(formatUsd(person.cost_usd))}</td>` +
      `<td class="ua-model">${model ? esc(seriesLabel("model", { key: model, label: model }, names)) : ""}</td></tr>`;
  }).join("");
  // One toggle: 顯示更多 shows everyone, then the same button says 顯示較少 and folds the table to five again.
  const toggle = people.length > MOST_PEOPLE
    ? btn(esc(t(v.allPeople ? "usage.less" : "usage.more")), "sm ua-more", ` data-ua-more data-k="ua-more" aria-expanded="${v.allPeople}" aria-controls="ua-people"`) : "";
  return `<div class="ua-card ua-table-card"><table class="ua-table" id="ua-people"><thead><tr>` +
    `<th scope="col">${esc(t("usage.colName"))}</th><th scope="col" class="num">${esc(t("usage.colReplies"))}</th>` +
    `<th scope="col" class="num">${esc(t("usage.colCost"))}</th><th scope="col">${esc(t("usage.colModel"))}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>` + toggle;
}

/** A line a day for each line of a breakdown, on one scale, with the first and last day under it. `value` says a day's
 *  count of a line in words, for the reading of the day under the pointer. */
function linesHTML(breakdown: UsageBreakdown, days: string[], label: string, key: string, value: (n: number) => string): string {
  const top = scaleTop(Math.max(...breakdown.series.flatMap((s) => s.values)));
  const x = (i: number): string => (days.length > 1 ? (i / (days.length - 1)) * 600 : 300).toFixed(1);
  const y = (n: number): string => (156 - (n / top) * 148).toFixed(1);
  const lines = breakdown.series.map((s, k) => `<polyline data-s="${slot(s, k)}" data-v="${json(s.values.map(value))}" points="${s.values.map((n, i) => `${x(i)},${y(n)}`).join(" ")}"></polyline>`).join("");
  return `<div class="ua-linebox" role="img" aria-label="${esc(label)}" tabindex="0" data-ua-read="lines" data-k="ua-read-${key}" data-days="${json(days.map(shortDay))}">` +
    `<svg class="ua-lines" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">` +
    `<line class="ua-grid" x1="0" y1="8" x2="600" y2="8"></line><line class="ua-grid" x1="0" y1="82" x2="600" y2="82"></line>` +
    `<line class="ua-base" x1="0" y1="156" x2="600" y2="156"></line>${lines}</svg></div>` +
    `<div class="ua-ends" aria-hidden="true"><span>${esc(shortDay(days[0]))}</span><span>${esc(shortDay(days[days.length - 1]))}</span></div>`;
}

/** 工具使用: every tool call of the period, a line a day per kind of tool. */
function toolsHTML(data: UsageAnalytics, names: UsageAnalysisNames): string {
  if (!data.tools.total) return emptyLine(t("usage.noTools"));
  const calls = (n: number): string => t("usage.calls", { p0: count(n) });
  return `<div class="ua-card" data-ua-card="tools"><div class="ua-sum"><span>${esc(t("usage.toolCalls"))}</span><strong class="num">${esc(count(data.tools.total))}</strong></div>` +
    linesHTML(data.tools, data.days, t("usage.toolsChart"), "tools", calls) +
    legendHTML(data.tools.series, (s) => seriesLabel("tool", s, names), (s) => calls(s.total)) + `</div>`;
}

/** 訊息: the replies of the period, a line a day per model or per where the message came from. */
function messagesHTML(v: UsageAnalysisView, data: UsageAnalytics, names: UsageAnalysisNames): string {
  const breakdown = data.messages_by[v.messages];
  if (!breakdown.total) return emptyLine(t("usage.noMessages"));
  const messages = (n: number): string => t("usage.messages", { p0: count(n) });
  return `<div class="ua-card" data-ua-card="messages"><div class="ua-sum"><span>${esc(t("usage.messagesTitle"))}</span><strong class="num">${esc(count(breakdown.total))}</strong></div>` +
    linesHTML(breakdown, data.days, t("usage.messagesChart"), "messages", messages) +
    legendHTML(breakdown.series, (s) => seriesLabel(v.messages, s, names), (s) => messages(s.total)) + `</div>`;
}

/** The choices of 花費紀錄's 分類 dropdown. No per-member series is kept a day, so there is no 依成員. */
export const COST_GROUPS = (): Choice[] => [
  { value: "purpose", label: t("usage.byPurpose") },
  { value: "model", label: t("usage.byModel") },
  { value: "provider", label: t("usage.byProvider") },
];

/** The whole 分析 tab. The period's control leads it: it chooses the period of every section. */
export function usageAnalysisHTML(v: UsageAnalysisView, names: UsageAnalysisNames): string {
  const data = typeof v.data === "object" ? v.data : null;
  const range = tabs([
    { id: "7d", label: t("usage.days7"), attrs: ' data-ua-range="7d"' },
    { id: "30d", label: t("usage.days30"), attrs: ' data-ua-range="30d"' },
  ], v.range, { label: t("usage.range"), kind: "filter" });
  const spent = data !== null && data.cost_by[v.group].total > 0;
  const cost = `<section class="sgroup ua" data-ua-section="cost">` +
    heading(t("usage.costTitle"), range + (spent ? sel(COST_GROUPS(), v.group, t("usage.groupBy"), ' data-k="ua-group"') : "")) +
    (v.data === null ? `<p class="ua-line" role="status">${esc(t("usage.loading"))}</p>` : v.data === "failed" ? emptyLine(t("usage.failed")) : spent ? costHTML(v, v.data, names) : emptyLine(t("usage.noSpend"))) +
    `</section>`;
  if (data === null) return cost;
  const sources = tabs([
    { id: "model", label: t("usage.byModel"), attrs: ' data-ua-messages="model"' },
    { id: "source", label: t("usage.bySource"), attrs: ' data-ua-messages="source"' },
  ], v.messages, { label: t("usage.messagesGroup"), kind: "filter" });
  return cost +
    `<section class="sgroup ua" data-ua-section="people">${heading(t("usage.whoTitle"))}${peopleHTML(v, data, names)}</section>` +
    `<section class="sgroup ua" data-ua-section="tools">${heading(t("usage.toolsTitle"))}${toolsHTML(data, names)}</section>` +
    `<section class="sgroup ua" data-ua-section="messages">${heading(t("usage.messagesTitle"), data.messages_by.model.total || data.messages_by.source.total ? sources : "")}${messagesHTML(v, data, names)}</section>`;
}

export interface UsageAnalysisApi {
  usageAnalytics(range: UsageRange): Promise<UsageAnalytics>;
  /** The members' faces and names; without it a face is the id's own colour and Raphael is named in the window's language. */
  membersList?(): Promise<MembersList>;
}

export interface UsageAnalysis {
  view(): UsageAnalysisView;
  /** Reads the period that is chosen; what was last known for it stays on the page until the answer comes. */
  load(): Promise<void>;
  /** A press on the tab: a period, 訊息's grouping or 顯示更多 / 顯示較少. True when it was one of them. */
  click(target: Element): boolean;
  /** The menu of 花費紀錄's 分類 dropdown (`data-k="ua-group"`). */
  menuFor(k: string): { choices: Choice[]; current: string; pick(value: string): void } | null;
}

/** The state of the tab: the period, the groupings, the readings of each period and the faces. */
export function createUsageAnalysis(o: { api: UsageAnalysisApi; redraw(): void }): UsageAnalysis {
  let range: UsageRange = "7d", group: CostGroup = "purpose", messages: MessageGroup = "model", allPeople = false;
  const readings = new Map<UsageRange, UsageAnalytics | "failed">();
  let people: ReadonlyMap<number, Face> = new Map();
  let asked = 0;
  async function load(): Promise<void> {
    const mine = ++asked, period = range;
    // A call that throws at once (a core too old to know it) is a failed reading like any other.
    const [reading, team] = await Promise.allSettled([Promise.resolve().then(() => o.api.usageAnalytics(period)),
      Promise.resolve().then(() => o.api.membersList ? o.api.membersList() : Promise.reject(new Error("no list")))]);
    const before = JSON.stringify([readings.get(period) ?? null, [...people.entries()]]);
    if (team.status === "fulfilled") people = new Map(team.value.members.map((m) => [m.id, { id: m.id, name: m.name, avatar: m.avatar, avatar_url: m.avatar_url }]));
    // A reading that fails keeps what was last known for the period, and says so only when nothing was.
    if (reading.status === "fulfilled") readings.set(period, reading.value);
    else if (!readings.has(period)) readings.set(period, "failed");
    if (mine === asked && JSON.stringify([readings.get(period) ?? null, [...people.entries()]]) !== before) o.redraw();
  }
  return {
    view: () => ({ range, group, messages, allPeople, data: readings.get(range) ?? null, people }),
    load,
    click(target) {
      const period = target.closest<HTMLElement>("[data-ua-range]")?.dataset.uaRange;
      if (period === "7d" || period === "30d") {
        if (period !== range) { range = period; allPeople = false; o.redraw(); void load(); }
        return true;
      }
      const by = target.closest<HTMLElement>("[data-ua-messages]")?.dataset.uaMessages;
      if (by === "model" || by === "source") {
        if (by !== messages) { messages = by; o.redraw(); }
        return true;
      }
      // 顯示更多 and 顯示較少 are one button; the page gives the focus back to it by its `data-k` once it is drawn again.
      if (target.closest("[data-ua-more]")) { allPeople = !allPeople; o.redraw(); return true; }
      return false;
    },
    menuFor(k) {
      if (k !== "ua-group") return null;
      return { choices: COST_GROUPS(), current: group, pick: (value) => {
        if ((value === "purpose" || value === "model" || value === "provider") && value !== group) { group = value; o.redraw(); }
      } };
    },
  };
}

// ---------- the reading of the day under the pointer ----------

/** What a chart says of one day: its date, its total (花費紀錄's), and each line of its legend with its value that day. */
export interface DayReading { day: string; total: string; rows: { slot: string; name: string; value: string }[] }

const parsed = (text: string | null | undefined): string[] => { try { return JSON.parse(text ?? "[]") as string[]; } catch { return []; } };
/** How many days a chart (`[data-ua-read]`) draws. */
const daysOf = (chart: HTMLElement): number =>
  chart.dataset.uaRead === "cost" ? chart.querySelectorAll(".ua-day").length : parsed(chart.dataset.days).length;

/** What the chart `chart` (`[data-ua-read]`) says of its day `i`, from what it drew: null for a day it does not have. */
export function readingAt(chart: HTMLElement, i: number): DayReading | null {
  const legend = [...(chart.closest(".ua-card")?.querySelectorAll<HTMLElement>(".ua-legend > li") ?? [])]
    .map((item) => ({ slot: item.dataset.s ?? "", name: item.querySelector(".ua-lname")?.textContent ?? "" }));
  if (chart.dataset.uaRead === "cost") {
    const bar = chart.querySelectorAll<HTMLElement>(".ua-day")[i];
    if (!bar) return null;
    const values = parsed(bar.dataset.v);
    return { day: bar.dataset.day ?? "", total: bar.dataset.total ?? "", rows: legend.map((line, k) => ({ ...line, value: values[k] ?? "" })) };
  }
  const day = parsed(chart.dataset.days)[i];
  if (day === undefined) return null;
  const lines = [...chart.querySelectorAll("polyline")];
  return { day, total: "", rows: legend.map((line, k) => ({ ...line, value: parsed(lines[k]?.getAttribute("data-v"))[i] ?? "" })) };
}

/** The day under the pointer at `x` across a chart `width` wide from `left`: a bar's column, or the nearest point of a line. */
export function dayAt(kind: "cost" | "lines", x: number, left: number, width: number, days: number): number {
  if (days <= 1 || width <= 0) return 0;
  const at = kind === "cost" ? Math.floor(((x - left) / width) * days) : Math.round(((x - left) / width) * (days - 1));
  return Math.max(0, Math.min(days - 1, at));
}

/** The tip's words: the date and the day's total, then each line's colour, name and value that day. */
export const readingHTML = (r: DayReading): string =>
  `<div class="ua-tip-day"><span>${esc(r.day)}</span>${r.total ? `<strong class="num">${esc(r.total)}</strong>` : ""}</div>` +
  `<ul>${r.rows.map((row) => `<li data-s="${esc(row.slot)}"><i aria-hidden="true"></i><span>${esc(row.name)}</span><strong class="num">${esc(row.value)}</strong></li>`).join("")}</ul>`;

/**
 * Every chart of 分析 answers the pointer (inside `root`, the settings dialog, which the tab is drawn into again and again):
 * the day under it says its date and each line's value there in a small tip of the app's own beside it, its bar lit (the
 * others dimmed) or, on the lines, a guide and a dot on each line. A chart reached with Tab reads its last day, and the
 * arrow keys, Home and End move the day. Nothing moves but the tip; leaving the chart, or the page scrolling, puts it away.
 */
export function bindUsageReadings(root: HTMLElement): void {
  const tip = document.createElement("div");
  tip.className = "message-tooltip ua-tip";
  tip.id = "ua-reading";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  root.append(tip);
  let chart: HTMLElement | null = null;
  let at = -1;
  function unmark(): void {
    if (!chart) return;
    chart.classList.remove("is-reading");
    chart.querySelectorAll(".ua-day.is-on").forEach((bar) => bar.classList.remove("is-on"));
    chart.querySelectorAll(".ua-guide, .ua-dot").forEach((mark) => mark.remove());
  }
  function hide(): void {
    unmark();
    chart?.removeAttribute("aria-describedby");
    chart = null;
    at = -1;
    tip.hidden = true;
  }
  /** Lights the day `i`: its bar, or a guide across the lines with a dot on each. */
  function mark(target: HTMLElement, i: number): void {
    target.classList.add("is-reading");
    if (target.dataset.uaRead === "cost") { target.querySelectorAll(".ua-day")[i]?.classList.add("is-on"); return; }
    const days = daysOf(target), guide = document.createElement("i");
    guide.className = "ua-guide";
    guide.setAttribute("aria-hidden", "true");
    guide.style.left = `${days > 1 ? (i / (days - 1)) * 100 : 50}%`;
    target.append(guide);
    for (const line of target.querySelectorAll("polyline")) {
      const [x, y] = (line.getAttribute("points") ?? "").split(" ")[i]?.split(",").map(Number) ?? [];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dot = document.createElement("i");
      dot.className = "ua-dot";
      dot.dataset.s = line.getAttribute("data-s") ?? "";
      dot.setAttribute("aria-hidden", "true");
      dot.style.left = `${((x / 600) * 100).toFixed(2)}%`;
      dot.style.top = `${((y / 160) * 100).toFixed(2)}%`;
      target.append(dot);
    }
  }
  /** Beside the day, at the top of the plot: to the right of its bar (or of the guide), or to its left where the window ends. */
  function place(target: HTMLElement, i: number): void {
    const cost = target.dataset.uaRead === "cost";
    const area = (cost ? target.querySelector<HTMLElement>(".ua-bars") ?? target : target).getBoundingClientRect();
    const days = daysOf(target), bar = cost ? target.querySelectorAll<HTMLElement>(".ua-day")[i]?.getBoundingClientRect() : null;
    const at = area.left + (days > 1 ? i / (days - 1) : 0.5) * area.width;
    const [from, to] = bar ? [bar.left, bar.right] : [at, at];
    const size = tip.getBoundingClientRect();
    const right = to + 10, left = from - 10 - size.width;
    tip.style.left = `${Math.max(8, right + size.width <= window.innerWidth - 8 ? right : left)}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - size.height - 8, area.top))}px`;
  }
  function show(target: HTMLElement, i: number, keys: boolean): void {
    if (target === chart && i === at && !tip.hidden) return;
    const reading = readingAt(target, i);
    if (!reading) { hide(); return; }
    if (target !== chart) hide();
    unmark();
    chart = target;
    at = i;
    mark(target, i);
    tip.innerHTML = readingHTML(reading);
    // Said aloud when the keys move the day, not at every move of the pointer.
    tip.setAttribute("aria-live", keys ? "polite" : "off");
    target.setAttribute("aria-describedby", tip.id);
    tip.hidden = false;
    place(target, i);
  }
  const chartOf = (node: EventTarget | null): HTMLElement | null => (node instanceof Element ? node.closest<HTMLElement>("[data-ua-read]") : null);
  root.addEventListener("pointermove", (event) => {
    const target = chartOf(event.target);
    if (!target) return;
    const kind = target.dataset.uaRead === "cost" ? "cost" : "lines";
    const area = (kind === "cost" ? target.querySelector<HTMLElement>(".ua-bars") ?? target : target).getBoundingClientRect();
    show(target, dayAt(kind, event.clientX, area.left, area.width, daysOf(target)), false);
  });
  root.addEventListener("pointerout", (event) => {
    if (!chart || chart.contains(event.relatedTarget as Node | null)) return;
    // A chart that has the keyboard's focus keeps its reading.
    if (document.activeElement === chart && chart.matches(":focus-visible")) return;
    hide();
  });
  root.addEventListener("focusin", (event) => {
    const target = chartOf(event.target);
    if (target && target === event.target && target.matches(":focus-visible")) show(target, daysOf(target) - 1, true);
  });
  root.addEventListener("focusout", (event) => { if (chart && event.target === chart) hide(); });
  root.addEventListener("keydown", (event) => {
    const target = chartOf(event.target);
    if (!target || target !== event.target) return;
    const days = daysOf(target), from = target === chart ? at : days - 1;
    const next = event.key === "ArrowLeft" ? from - 1 : event.key === "ArrowRight" ? from + 1 : event.key === "Home" ? 0 : event.key === "End" ? days - 1 : null;
    if (next === null) return;
    event.preventDefault();
    show(target, Math.max(0, Math.min(days - 1, next)), true);
  });
  root.addEventListener("scroll", hide, true);
  // The tab drawn again leaves the chart that was read: its tip goes with it.
  new MutationObserver(() => { if (chart && !chart.isConnected) hide(); }).observe(root, { childList: true, subtree: true });
}
