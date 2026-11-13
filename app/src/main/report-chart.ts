// The figures and charts of a report page (core agent/report_page.py `_stats`, `_chart`), drawn in the app's own design.
// The owner's daily overview (2026-11-14: weather, schedule, investments, projects by status and owner, members, every
// kind of chart, as clean as Grok Bot's) is one report: tiles of figures with a little line of their recent values, lines
// and areas over time, columns side by side or stacked with their totals, bars across, and parts of one whole.
//
// Each is drawn from its values alone, at any width: the plot is laid out in percentages and its lines are a stretched SVG
// whose strokes keep their width (`vector-effect`), so the same markup serves the app at every size, both themes, and the
// file a report is shared as, where nothing runs (report-page.ts `reportFile`; the core takes only its elements). Series
// take the chart colours in a fixed order (--chart-1 to --chart-8, styles.css, checked for colour-blind readers in both
// themes), or their member's own colour; words keep the text colours, never a series'. Pointing at a chart in the app
// shows its values (`mountChartHover`): a line under the pointer with each series' value, or the column, bar or part.
import { t } from "./i18n";
import type { ReportChart, ReportSeries, ReportStats, ReportStatus, ReportTile } from "./types";
import { esc } from "./ui";

export interface ChartPeople { colorOf(id: number): string }
type StatusWord = (status: ReportStatus, label?: string) => string;

/** The chart colours, in their order: a ninth series never gets a colour of its own (the core allows eight). */
export const SLOTS = 8;
/** The stretched drawing of lines: its own units, never pixels. */
const VIEW_W = 1000, VIEW_H = 300;
/** The room a line keeps at its ends, of the plot's width, so its first and last points are not cut. */
const INSET = 0.02;
/** Labels along the bottom, at most: every second or third is left out on a longer series, as evenly as it goes. */
const X_LABELS = { half: 5, full: 9 } as const;
/** A pie shows its first seven parts and folds the rest into one, so no part repeats a colour. */
const PIE_PARTS = 7;

const lang = (): string | undefined => document.documentElement.lang || undefined;

/** A value as the window's language writes it; on an axis, a large one in its short form (1.2萬, 12K). */
export function figure(value: number, compact = false): string {
  const options: Intl.NumberFormatOptions = compact && Math.abs(value) >= 10_000
    ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1 };
  return new Intl.NumberFormat(lang(), options).format(value);
}

/** Round steps for an axis from `low` to `high` (1, 2, 2.5 or 5 of a power of ten), about `count` of them. */
export function ticks(low: number, high: number, most = 5): number[] {
  if (!(high > low)) high = low + (Math.abs(low) || 1);
  // The smallest round step that needs no more than `most` of them: the axis ends as near the data as a round number allows.
  const power = 10 ** Math.floor(Math.log10((high - low) / most));
  const steps = [1, 2, 2.5, 5, 10, 20].map(factor => factor * power);
  const count = (size: number): number => Math.ceil(high / size - 1e-9) - Math.floor(low / size + 1e-9);
  const step = steps.find(size => count(size) <= most) ?? steps[steps.length - 1]!;
  const first = Math.floor(low / step + 1e-9), last = Math.ceil(high / step - 1e-9);
  return Array.from({ length: last - first + 1 }, (_, index) => Number(((first + index) * step).toPrecision(12)));
}

const slotOf = (index: number): number => (index % SLOTS) + 1;
/** Paints a chart's series by its slot (`data-s`, so a shared file declares the colour too) or, when every series is a member,
 *  in each member's own colour: one member's colour among the chart colours could pass for one of them (Raphael's blue and
 *  the first). `style` is the mark's own place, kept in the same attribute. */
type Painter = (series: ReportSeries, index: number, style?: string) => string;
function painter(chart: ReportChart, people: ChartPeople): Painter {
  const members = chart.series.every(series => series.member_id !== undefined);
  return (series, index, style = "") => {
    const own = members && series.member_id !== undefined ? `--c:${esc(people.colorOf(series.member_id))};` : "";
    return ` data-s="${slotOf(index)}"` + (own || style ? ` style="${own}${style}"` : "");
  };
}
const nameOf = (chart: ReportChart, series: ReportSeries): string => series.name ?? chart.title ?? "";
const withUnit = (value: number, unit?: string): string => `${figure(value)}${unit ? ` ${unit}` : ""}`;

/** What a reader who cannot see the chart is told: its name, then each label with its values. */
export function chartLabel(chart: ReportChart): string {
  const several = chart.series.length > 1;
  const said = chart.labels.map((label, index) => `${label} ${chart.series.flatMap(series => {
    const value = series.values[index];
    return value === null || value === undefined ? [] : [`${several ? `${nameOf(chart, series)} ` : ""}${withUnit(value, chart.unit)}`];
  }).join(", ")}`).join("; ");
  const text = chart.title ? `${chart.title}: ${said}` : said;
  return text.length > 600 ? `${text.slice(0, 599)}…` : text;
}

/** The labels to write along the bottom: all of a short series, and evenly spaced ones of a long one, the last always. */
export function shownLabels(count: number, room: number): Set<number> {
  if (count <= room) return new Set(Array.from({ length: count }, (_, index) => index));
  const every = Math.ceil((count - 1) / (room - 1));
  const shown = new Set<number>();
  for (let index = 0; index < count; index += every) shown.add(index);
  // The last label is the newest; the one before it goes when they would stand too close.
  const before = Math.max(...shown);
  if (before !== count - 1) { if (count - 1 - before < every / 2) shown.delete(before); shown.add(count - 1); }
  return shown;
}

// ---------- tiles ----------

/** Which way a change goes, by its sign: "+1.35%" and "▲2" up, "-0.4" and "▼1" down, anything else level. */
export function direction(delta: string): "up" | "down" | "flat" {
  const first = delta.trim()[0] ?? "";
  return "+▲↑".includes(first) ? "up" : "-−▼↓".includes(first) ? "down" : "flat";
}


/** A little line of a tile's recent values, its last one marked. */
function sparkHTML(trend: number[]): string {
  const low = Math.min(...trend), high = Math.max(...trend), span = high - low || 1;
  const y = (value: number): number => 2 + (1 - (value - low) / span) * 20;
  const x = (index: number): number => (index / (trend.length - 1)) * 100;
  const d = trend.map((value, index) => `${index ? "L" : "M"}${round(x(index))} ${round(y(value))}`).join(" ");
  const last = trend[trend.length - 1]!;
  return `<span class="rs-spark" aria-hidden="true"><svg viewBox="0 0 100 24" preserveAspectRatio="none"><path class="rs-spark-a" d="${d} L100 24 L0 24 Z"/>` +
    `<path class="rs-spark-l" d="${d}"/></svg><span class="rs-spark-dot" style="top:${round((y(last) / 24) * 100)}%"></span></span>`;
}

function tileHTML(tile: ReportTile, status: StatusWord): string {
  const way = tile.delta ? direction(tile.delta) : "flat";
  // The arrow is a small filled triangle of the stylesheet's (report-page.css), before the change's own words.
  const delta = tile.delta ? `<span class="rs-delta" data-dir="${way}">${esc(tile.delta)}</span>` : "";
  return `<div class="rs-tile"><span class="rs-name"><span>${esc(tile.name)}</span>${tile.status ? status(tile.status, tile.label) : ""}</span>` +
    `<span class="rs-value"><b>${esc(tile.value)}</b>${tile.unit ? `<small>${esc(tile.unit)}</small>` : ""}</span>` +
    (delta || tile.note ? `<span class="rs-sub">${delta}${tile.note ? `<span class="rs-note">${esc(tile.note)}</span>` : ""}</span>` : "") +
    (tile.trend && tile.trend.length > 1 ? sparkHTML(tile.trend) : "") + `</div>`;
}

/** Figures as tiles, as many to a row as the page's width holds. */
export function statsHTML(section: ReportStats, status: StatusWord, half = false): string {
  // Rows of equal length: up to four tiles in one row, five or six in two rows of three; two to a row in a half section and
  // on a narrow page (report-page.css).
  const count = section.tiles.length, columns = Math.min(half ? 2 : 4, count <= 4 ? count : Math.ceil(count / 2));
  return `<div class="rs-tiles" data-cols="${columns}" style="--rs-cols:${columns}">${section.tiles.map(tile => tileHTML(tile, status)).join("")}</div>`;
}

// ---------- charts ----------

const round = (value: number): number => Math.round(value * 10) / 10;
const pct = (value: number): string => `${round(value * 100)}%`;

interface Scale { low: number; high: number; steps: number[]; at(value: number): number }
/** `headroom`: a value is written above the highest point (a column's total, a line's last value), so the axis goes a little higher. */
function scale(values: number[], fromZero: boolean, headroom = false): Scale {
  let low = Math.min(...values), high = Math.max(...values);
  if (fromZero) { low = Math.min(0, low); high = Math.max(0, high); }
  if (headroom && high > low) high += (high - low) * 0.12;
  const steps = ticks(low, high);
  const first = steps[0]!, last = steps[steps.length - 1]!;
  return { low: first, high: last, steps, at: value => (value - first) / (last - first || 1) };
}

/** Column `index` of `count`'s middle along a line's width, as a share of the plot. */
const lineX = (index: number, count: number): number => (count === 1 ? 0.5 : INSET + (index / (count - 1)) * (1 - 2 * INSET));

/** The value axis: its round steps, as hairlines across the plot and their numbers beside it. */
function axisHTML(axis: Scale): { y: string; grid: string; width: string } {
  // A large step in its short form (1萬, 2萬); written whole when the short forms would repeat (22,900 to 23,500 all read
  // 2.3萬 on Raphael's first live overview, 2026-11-14).
  const short = axis.steps.map(step => figure(step, true));
  const labels = new Set(short).size === short.length ? short : axis.steps.map(step => figure(step));
  const grid = axis.steps.map(step => `<span class="rc-grid${step === 0 ? " is-zero" : ""}" style="bottom:${pct(axis.at(step))}"></span>`).join("");
  const y = axis.steps.map((step, index) => `<span class="rc-tick" style="bottom:${pct(axis.at(step))}">${esc(labels[index]!)}</span>`).join("");
  // As wide as its longest number: a Chinese character takes two widths of a digit.
  const width = Math.max(...labels.map(label => [...label].reduce((sum, char) => sum + (/[⺀-￿]/.test(char) ? 2 : 1), 0)));
  return { y, grid, width: `${width + 0.5}ch` };
}

function xLabelsHTML(chart: ReportChart, at: (index: number) => number, room: number, edges: boolean): string {
  const shown = shownLabels(chart.labels.length, room);
  return chart.labels.map((label, index) => {
    if (!shown.has(index)) return "";
    // On a line the first and last stand inside the plot's ends rather than past them.
    const edge = !edges ? "" : chart.labels.length > 1 && index === 0 ? " is-first" : chart.labels.length > 1 && index === chart.labels.length - 1 ? " is-last" : "";
    return `<span class="rc-xl${edge}" style="left:${pct(at(index))}">${esc(label)}</span>`;
  }).join("");
}

function legendHTML(chart: ReportChart, people: ChartPeople): string {
  if (chart.series.length < 2) return "";
  const paint = painter(chart, people);
  return `<span class="rc-legend">${chart.series.map((series, index) =>
    `<span class="rc-li"><span class="rc-key"${paint(series, index)}></span>${esc(nameOf(chart, series))}</span>`).join("")}</span>`;
}

/** The plot of a line or an area: each series a stretched path, its last point a dot, and one series its last value. */
function linesHTML(chart: ReportChart, people: ChartPeople): { plot: string; axis: Scale } {
  const count = chart.labels.length;
  const values = chart.series.flatMap(series => series.values.filter((value): value is number => value !== null));
  const axis = scale(values, chart.type === "area", chart.series.length === 1);
  const y = (value: number): number => (1 - axis.at(value)) * VIEW_H;
  const base = y(Math.max(axis.low, Math.min(0, axis.high)));
  const paths: string[] = [], marks: string[] = [], paint = painter(chart, people);
  chart.series.forEach((series, index) => {
    // A gap (null) ends a stretch; the line goes on from the next value.
    const runs: [number, number][][] = [[]];
    series.values.forEach((value, at) => {
      if (value === null) { if (runs[runs.length - 1]!.length) runs.push([]); return; }
      runs[runs.length - 1]!.push([round(lineX(at, count) * VIEW_W), round(y(value))]);
    });
    const kept = runs.filter(run => run.length);
    const colour = paint(series, index);
    if (chart.type === "area") {
      paths.push(...kept.filter(run => run.length > 1).map(run =>
        `<path class="rc-area"${colour} d="M${run[0]![0]} ${round(base)} ${run.map(([x, value]) => `L${x} ${value}`).join(" ")} L${run[run.length - 1]![0]} ${round(base)} Z"/>`));
    }
    paths.push(...kept.map(run => `<path class="rc-line"${colour} d="${run.map(([x, value], at) => `${at ? "L" : "M"}${x} ${value}`).join(" ")}"/>`));
    const last = series.values.reduce<number | null>((found, value, at) => (value === null ? found : at), null);
    if (last === null) return;
    const left = pct(lineX(last, count)), top = pct(y(series.values[last]!) / VIEW_H);
    marks.push(`<span class="rc-dot"${colour}><span style="left:${left};top:${top}"></span></span>`);
    if (chart.series.length === 1) marks.push(`<span class="rc-end" style="left:${left};top:${top}">${esc(figure(series.values[last]!))}</span>`);
  });
  return { axis, plot: `<svg class="rc-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true">${paths.join("")}</svg>${marks.join("")}` };
}

/** The plot of columns: side by side for several series, one on another when they add up, each label's total on its top. */
function columnsHTML(chart: ReportChart, people: ChartPeople): { plot: string; axis: Scale; labelled: boolean } {
  const stacked = chart.type === "stacked", count = chart.labels.length;
  const numbers = (series: ReportSeries): number[] => series.values.map(value => value ?? 0);
  const totals = chart.labels.map((_, index) => chart.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0));
  // Every value is written on its column when there is one series and nothing below zero: no axis is needed then.
  const labelled = chart.series.length === 1 && totals.every(total => total >= 0);
  const axis = scale(stacked ? totals : chart.series.flatMap(numbers), true, stacked || labelled);
  const zero = axis.at(0), size = (value: number): number => Math.abs(value) / (axis.high - axis.low || 1), paint = painter(chart, people);
  const bands = chart.labels.map((_, index) => {
    let slots: string;
    if (stacked) {
      let below = 0;
      const parts = chart.series.map((series, at) => ({ series, at, value: series.values[index] ?? 0 })).filter(part => part.value > 0);
      slots = `<span class="rc-slot">${parts.map((part, step) => {
        const bottom = zero + size(below);
        below += part.value;
        return `<span class="rc-bar${step === parts.length - 1 ? " is-top" : ""}"${paint(part.series, part.at, `bottom:${pct(bottom)};height:${pct(size(part.value))}`)}></span>`;
      }).join("")}</span>`;
    } else {
      slots = chart.series.map((series, at) => {
        const value = series.values[index] ?? 0;
        const bottom = value >= 0 ? zero : zero - size(value);
        return `<span class="rc-slot">${value ? `<span class="rc-bar ${value >= 0 ? "is-top" : "is-low"}"${paint(series, at, `bottom:${pct(bottom)};height:${pct(size(value))}`)}></span>` : ""}</span>`;
      }).join("");
    }
    const cap = (stacked || labelled) && totals[index]! >= 0
      ? `<span class="rc-cap" style="bottom:${pct(zero + size(totals[index]!))}">${esc(figure(totals[index]!))}</span>` : "";
    return `<span class="rc-band" data-i="${index}" style="left:${pct(index / count)};width:${pct(1 / count)}"><span class="rc-grp">${slots}</span>${cap}</span>`;
  }).join("");
  return { axis, labelled, plot: `<span class="rc-base" style="bottom:${pct(zero)}"></span>${bands}` };
}

/** Bars across, one row a label: its name, its bar (the series one after another along it) and its total. */
function rowsHTML(chart: ReportChart, people: ChartPeople): string {
  const totals = chart.labels.map((_, index) => chart.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0));
  const most = Math.max(...totals) || 1, paint = painter(chart, people);
  return `<div class="rc-rows">${chart.labels.map((label, index) => {
    const parts = chart.series.map((series, at) => ({ series, at, value: series.values[index] ?? 0 })).filter(part => part.value > 0);
    return `<div class="rc-row" data-i="${index}"><span class="rc-name">${esc(label)}</span><span class="rc-track">` +
      parts.map((part, step) => `<span class="rc-hb${step === parts.length - 1 ? " is-top" : ""}"${paint(part.series, part.at, `width:${pct(part.value / most)}`)}></span>`).join("") +
      `</span><span class="rc-val">${esc(figure(totals[index]!))}</span></div>`;
  }).join("")}</div>`;
}

/** The parts of a pie: its first seven, then the rest as one. */
export function pieParts(chart: ReportChart): { label: string; value: number; slot: number; at: number[] }[] {
  const values = chart.series[0]!.values.map(value => value ?? 0);
  const parts = chart.labels.map((label, index) => ({ label, value: values[index]!, slot: slotOf(index), at: [index] }));
  if (parts.length <= PIE_PARTS + 1) return parts;
  const rest = parts.slice(PIE_PARTS);
  return [...parts.slice(0, PIE_PARTS), { label: t("page.chart.other"), value: rest.reduce((sum, part) => sum + part.value, 0), slot: SLOTS, at: rest.flatMap(part => part.at) }];
}

/** A pie, or a ring with the whole in its middle, and beside it each part's name, value and share. */
function pieHTML(chart: ReportChart): string {
  const parts = pieParts(chart), whole = parts.reduce((sum, part) => sum + part.value, 0);
  const inner = chart.type === "donut" ? 31 : 0, outer = 48;
  const point = (radius: number, turn: number): string => `${round(50 + radius * Math.sin(turn * 2 * Math.PI))} ${round(50 - radius * Math.cos(turn * 2 * Math.PI))}`;
  let from = 0;
  const slices = parts.map((part, index) => {
    if (!part.value) return "";
    const share = part.value / whole, to = from + share;
    // Clockwise (sweep 1) the arc ends at `b`, back the other way at `a`. A whole circle is two halves: an arc cannot
    // begin and end at one point.
    const arc = (radius: number, a: number, b: number, sweep: 0 | 1): string => {
      const end = point(radius, sweep ? b : a);
      if (b - a > 0.9999) return `A${radius} ${radius} 0 0 ${sweep} ${point(radius, (a + b) / 2)} A${radius} ${radius} 0 0 ${sweep} ${end}`;
      return `A${radius} ${radius} 0 ${b - a > 0.5 ? 1 : 0} ${sweep} ${end}`;
    };
    const d = inner
      ? `M${point(outer, from)} ${arc(outer, from, to, 1)} L${point(inner, to)} ${arc(inner, from, to, 0)} Z`
      : share > 0.9999 ? `M${point(outer, 0)} ${arc(outer, 0, 1, 1)} Z` : `M50 50 L${point(outer, from)} ${arc(outer, from, to, 1)} Z`;
    from = to;
    return `<path class="rc-part" data-i="${index}" data-s="${part.slot}" d="${d}"/>`;
  }).join("");
  const middle = inner ? `<span class="rc-mid"><b>${esc(figure(whole))}</b><small>${esc(chart.unit || t("page.chart.total"))}</small></span>` : "";
  const legend = parts.map((part, index) => `<li data-i="${index}"><span class="rc-key" data-s="${part.slot}"></span><span class="rc-pn">${esc(part.label)}</span>` +
    `<span class="rc-pv">${esc(figure(part.value))}</span><span class="rc-ps">${esc(new Intl.NumberFormat(lang(), { style: "percent", maximumFractionDigits: 0 }).format(part.value / whole))}</span></li>`).join("");
  return `<div class="rc-pie"><span class="rc-disc"><svg viewBox="0 0 100 100" aria-hidden="true">${slices}</svg>${middle}</span><ul class="rc-parts">${legend}</ul></div>`;
}

/**
 * A chart of a report. `index` is its section's, which the pointer's values are read from in the app; `file` draws it
 * for a shared file: the same drawing, with nothing to focus. `half`: it stands beside another (report-page.ts `halves`).
 */
export function chartHTML(chart: ReportChart, index: number, people: ChartPeople, file = false, half = chart.span === "half"): string {
  const room = half ? X_LABELS.half : X_LABELS.full;
  // The plot is what a reader reaches: its name says the chart's values; in the app it takes the focus, for the arrow keys.
  const focus = ` role="img" aria-label="${esc(chartLabel(chart))}"` + (file ? "" : ' tabindex="0"');
  const unit = chart.unit && chart.type !== "pie" && chart.type !== "donut" ? `<span class="rc-unit">${esc(chart.unit)}</span>` : "";
  const legend = chart.type === "pie" || chart.type === "donut" ? "" : legendHTML(chart, people);
  const head = unit || legend ? `<div class="rc-head">${unit}${legend}</div>` : "";
  const note = chart.note ? `<p class="rc-note">${esc(chart.note)}</p>` : "";
  let body: string;
  if (chart.type === "pie" || chart.type === "donut") body = `<div class="rc-plot rc-whole"${focus}>${pieHTML(chart)}</div>`;
  else if (chart.type === "hbar") body = `<div class="rc-plot rc-across"${focus}>${rowsHTML(chart, people)}</div>`;
  else {
    const lines = chart.type === "line" || chart.type === "area";
    const drawn = lines ? { ...linesHTML(chart, people), labelled: false } : columnsHTML(chart, people);
    const axis = drawn.labelled ? null : axisHTML(drawn.axis);
    const at = lines ? (spot: number) => lineX(spot, chart.labels.length) : (spot: number) => (spot + 0.5) / chart.labels.length;
    body = `<div class="rc-frame${axis ? "" : " is-bare"}" style="--rc-y:${axis?.width ?? "0px"}">` +
      (axis ? `<span class="rc-y" aria-hidden="true">${axis.y}</span>` : "") +
      `<div class="rc-plot rc-${lines ? "lines" : "columns"}"${focus}>${axis?.grid ?? ""}${drawn.plot}</div>` +
      `<span class="rc-x" aria-hidden="true">${xLabelsHTML(chart, at, room, lines)}</span></div>`;
  }
  return `<div class="rc" data-type="${chart.type}" data-report-chart="${index}">${head}${body}${note}</div>`;
}

// ---------- pointing at a chart ----------

/** The values under the pointer, in a floating box: the label, then each series' value with its colour, then the total. */
function tipHTML(chart: ReportChart, index: number, people: ChartPeople): string {
  if (chart.type === "pie" || chart.type === "donut") {
    const part = pieParts(chart)[index];
    if (!part) return "";
    const whole = pieParts(chart).reduce((sum, item) => sum + item.value, 0);
    return `<b class="rc-tt">${esc(part.label)}</b><span class="rc-tr"><span class="rc-key" data-s="${part.slot}"></span><span>${esc(withUnit(part.value, chart.unit))}</span>` +
      `<span class="rc-tv">${esc(new Intl.NumberFormat(lang(), { style: "percent", maximumFractionDigits: 1 }).format(part.value / (whole || 1)))}</span></span>`;
  }
  const rows = chart.series.map((series, at) => {
    const value = series.values[index];
    return `<span class="rc-tr"><span class="rc-key"${painter(chart, people)(series, at)}></span><span>${esc(nameOf(chart, series))}</span>` +
      `<span class="rc-tv">${value === null || value === undefined ? "–" : esc(withUnit(value, chart.unit))}</span></span>`;
  }).join("");
  const adds = chart.type === "stacked" || (chart.type === "hbar" && chart.series.length > 1);
  const total = adds ? `<span class="rc-tr is-total"><span></span><span>${esc(t("page.chart.total"))}</span><span class="rc-tv">${esc(withUnit(chart.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0), chart.unit))}</span></span>` : "";
  return `<b class="rc-tt">${esc(chart.labels[index] ?? "")}</b>${rows}${total}`;
}

/**
 * Pointing at, or moving with the arrow keys through, a chart in `root` shows its values: on a line the label nearest the
 * pointer, a hairline down the plot and each series' point there; on columns and bars the one under it; on a pie its part.
 * `chartOf(index)` gives the chart of a section.
 */
export function mountChartHover(root: HTMLElement, chartOf: (index: number) => ReportChart | null, people: () => ChartPeople): void {
  let tip: HTMLElement | null = null;
  const hide = (figureEl?: Element | null): void => {
    tip?.remove();
    tip = null;
    (figureEl ?? root).querySelectorAll(".is-on").forEach(item => item.classList.remove("is-on"));
    (figureEl ?? root).querySelectorAll(".rc-cross, .rc-hover").forEach(item => item.remove());
  };

  function show(box: HTMLElement, chart: ReportChart, index: number, near: { x: number; y: number } | null): void {
    const plot = box.querySelector<HTMLElement>(".rc-plot")!;
    hide(box);
    if (chart.type === "line" || chart.type === "area") {
      const left = pct(lineX(index, chart.labels.length));
      plot.insertAdjacentHTML("beforeend", `<span class="rc-cross" style="left:${left}"></span>`);
      // Each series' point at that label, where its stretched path passes.
      const values = chart.series.flatMap(series => series.values.filter((value): value is number => value !== null));
      const axis = scale(values, chart.type === "area", chart.series.length === 1);
      chart.series.forEach((series, at) => {
        const value = series.values[index];
        if (value === null || value === undefined) return;
        plot.insertAdjacentHTML("beforeend", `<span class="rc-dot rc-hover"${painter(chart, people())(series, at)}><span style="left:${left};top:${pct(1 - axis.at(value))}"></span></span>`);
      });
    } else {
      plot.querySelector(`[data-i="${index}"]`)?.classList.add("is-on");
      if (chart.type === "pie" || chart.type === "donut") plot.querySelector(`.rc-parts [data-i="${index}"]`)?.classList.add("is-on");
    }
    tip = document.createElement("div");
    tip.className = "rc-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.innerHTML = tipHTML(chart, index, people());
    box.append(tip);
    const frame = box.getBoundingClientRect(), area = plot.getBoundingClientRect();
    const anchorX = near ? near.x - frame.left : area.left - frame.left + (chart.type === "line" || chart.type === "area" ? lineX(index, chart.labels.length) : (index + 0.5) / chart.labels.length) * area.width;
    const anchorY = near ? near.y - frame.top : area.top - frame.top;
    const width = tip.offsetWidth, height = tip.offsetHeight;
    const left = Math.max(0, Math.min(frame.width - width, anchorX + 14));
    const top = anchorY - height - 10 >= 0 ? anchorY - height - 10 : anchorY + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  /** The label under a point of the plot. */
  function indexAt(box: HTMLElement, chart: ReportChart, event: PointerEvent): number | null {
    if (chart.type === "pie" || chart.type === "donut" || chart.type === "hbar") {
      const hit = (event.target as Element).closest<HTMLElement>("[data-i]");
      return hit ? Number(hit.dataset.i) : null;
    }
    const area = box.querySelector<HTMLElement>(".rc-plot")!.getBoundingClientRect();
    const share = (event.clientX - area.left) / (area.width || 1), count = chart.labels.length;
    if (chart.type === "line" || chart.type === "area") {
      return count === 1 ? 0 : Math.max(0, Math.min(count - 1, Math.round(((share - INSET) / (1 - 2 * INSET)) * (count - 1))));
    }
    return Math.max(0, Math.min(count - 1, Math.floor(share * count)));
  }

  const chartIn = (target: EventTarget | null): { box: HTMLElement; chart: ReportChart } | null => {
    const box = (target as Element | null)?.closest?.<HTMLElement>("[data-report-chart]");
    const chart = box ? chartOf(Number(box.dataset.reportChart)) : null;
    return box && chart ? { box, chart } : null;
  };
  const current = new WeakMap<HTMLElement, number>();

  root.addEventListener("pointermove", event => {
    const found = chartIn(event.target);
    if (!found || !(event.target as Element).closest(".rc-plot")) { if (tip) hide(); return; }
    const index = indexAt(found.box, found.chart, event);
    if (index === null) { hide(found.box); return; }
    current.set(found.box, index);
    show(found.box, found.chart, index, { x: event.clientX, y: event.clientY });
  });
  root.addEventListener("pointerleave", () => hide());
  root.addEventListener("focusin", event => {
    const found = chartIn(event.target);
    if (found && (event.target as Element).matches(".rc-plot")) show(found.box, found.chart, current.get(found.box) ?? 0, null);
  });
  root.addEventListener("focusout", event => { if (chartIn(event.target)) hide(); });
  root.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const found = chartIn(event.target);
    if (!found || !(event.target as Element).matches(".rc-plot")) return;
    event.preventDefault();
    const count = found.chart.type === "pie" || found.chart.type === "donut" ? pieParts(found.chart).length : found.chart.labels.length;
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const index = Math.max(0, Math.min(count - 1, (current.get(found.box) ?? 0) + step));
    current.set(found.box, index);
    show(found.box, found.chart, index, null);
  });
}
