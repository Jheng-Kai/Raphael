import { getLocale, t } from "./i18n";
import { esc, iconBtn } from "./ui";

import { answerFormText, type AnswerForm } from "../shared/answer-forms";

type Forecast = Extract<AnswerForm, { kind: "forecast" }>;

/** A day by its weekday (週六), or as written when it is not an ISO date. */
function forecastDay(day: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(getLocale(), { weekday: "short" }) : day;
}

/** The sky a condition names, in any language the model writes it in: the weather glyph drawn for it. */
export type Sky = "clear" | "night" | "partly" | "cloud" | "rain" | "storm" | "snow" | "fog";
export function skyOf(condition: string, hour?: number): Sky {
  const c = condition.toLowerCase();
  if (/thunder|storm|lightning|雷/.test(c)) return "storm";
  if (/snow|sleet|ice|雪|霰|冰/.test(c)) return "snow";
  if (/rain|drizzle|shower|雨/.test(c)) return "rain";
  if (/fog|mist|haze|smog|霧|霾|靄/.test(c)) return "fog";
  if (/partly|partial|mostly (?:sunny|clear)|few clouds|scattered|晴時|時晴|晴.*雲|雲.*晴|晴れ時々|晴れ一時/.test(c)) return "partly";
  if (/cloud|overcast|陰|雲|曇/.test(c)) return "cloud";
  if (/clear|sun|fair|晴/.test(c)) return hour !== undefined && (hour >= 18 || hour < 6) ? "night" : "clear";
  return "partly";
}

/** A cloud as wide as the glyph: a flat foot, a small bump at the left, the large one, and a bump at the right. */
const CLOUD = '<path class="wx-cloud" d="M6.4 20.2h11.4a4.7 4.7 0 0 0 .62-9.36A6.3 6.3 0 0 0 6.4 12.4a3.9 3.9 0 0 0 0 7.8z"/>';
const SMALL_CLOUD = `<g transform="translate(4.4 3.9) scale(.8)">${CLOUD}</g>`;
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315].map(a => `<line class="wx-ray" x1="12" y1="2.6" x2="12" y2="4.6" transform="rotate(${a} 12 12)"/>`).join("");
const GLYPHS: Record<Sky, string> = {
  clear: `<circle class="wx-sun" cx="12" cy="12" r="4.6"/>${RAYS}`,
  night: '<path class="wx-moon" d="M15.6 17.8A7 7 0 0 1 10.2 5a7.4 7.4 0 1 0 8.6 9.7 7 7 0 0 1-3.2 3.1z"/>',
  partly: `<g transform="translate(-3 -3) scale(.82)"><circle class="wx-sun" cx="12" cy="12" r="4.6"/>${RAYS}</g>${SMALL_CLOUD}`,
  cloud: CLOUD,
  rain: `<g transform="translate(1.2 -1.8) scale(.9)">${CLOUD}</g><path class="wx-drop" d="M8.6 19.6l-1 2.4M12.6 19.6l-1 2.4M16.6 19.6l-1 2.4"/>`,
  storm: `<g transform="translate(1.2 -1.8) scale(.9)">${CLOUD}</g><path class="wx-bolt" d="M13.2 15.8l-2.8 4.1h2.3l-1.3 3.4 3.7-4.8h-2.4l1.5-2.7z"/>`,
  snow: `<g transform="translate(1.2 -1.8) scale(.9)">${CLOUD}</g><g class="wx-flake"><circle cx="8.6" cy="20.6" r="1.05"/><circle cx="12.6" cy="22" r="1.05"/><circle cx="16.6" cy="20.6" r="1.05"/></g>`,
  fog: `<g transform="translate(1.2 -3) scale(.9)">${CLOUD}</g><path class="wx-mist" d="M4.5 18.8h15M7 21.6h10"/>`,
};
const glyph = (sky: Sky, size: "sm" | "lg" = "sm"): string =>
  `<svg class="wx-glyph wx-${size}" viewBox="0 0 24 24" aria-hidden="true" data-sky="${sky}">${GLYPHS[sky]}</svg>`;

/** A temperature as the card shows it: a whole number and a degree sign; the unit is said once, at the foot. */
const degrees = (value: number): string => `${Math.round(value)}°`;
/** A rain chance worth showing beside a glyph (Apple Weather shows it from 10%). */
const rainChance = (rain?: number): string => rain !== undefined && rain >= 10 ? `<small class="wx-rain">${Math.round(rain)}%</small>` : "";
/** The hour a time names, for the night glyph: 21:00, 9 PM, 晚上9點. */
function hourOf(time: string): number | undefined {
  const match = /(\d{1,2})(?::\d{2})?\s*(am|pm|AM|PM)?/.exec(time);
  if (!match) return undefined;
  const hour = Number(match[1]) % 12 + (/pm/i.test(match[2] ?? "") ? 12 : 0);
  return match[2] ? hour : Number(match[1]) % 24;
}
/** A temperature's colour on the range bar, from cold blue through green and amber to hot red, whatever the unit. */
function heat(value: number, units: string): string {
  const celsius = /f/i.test(units) && !/c/i.test(units) ? (value - 32) * 5 / 9 : value;
  const stops: [number, number][] = [[-5, 215], [5, 192], [12, 162], [18, 96], [24, 46], [30, 24], [36, 4]];
  const at = Math.max(stops[0]![0], Math.min(stops[stops.length - 1]![0], celsius));
  const i = Math.max(0, stops.findIndex(([t]) => t >= at) - 1), [t0, h0] = stops[i]!, [t1, h1] = stops[i + 1] ?? stops[i]!;
  return `hsl(${Math.round(h0 + (h1 - h0) * ((at - t0) / (t1 - t0 || 1)))} 78% 55%)`;
}

/**
 * The weather, as a weather app draws it: now (the glyph, the temperature large, the sky, feels like, high and low, wind
 * and humidity), the hours ahead in one row that scrolls, then one row a day with its rain chance and its low and high on
 * a bar of the week's range, and at the foot the unit, the source and when it was read. Every part but the days is
 * optional, so a form of days alone is the daily rows.
 */
function forecastHTML(form: Forecast): string {
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const first = form.days[0]!, current = form.now;
  const parts: string[] = [];
  if (current) {
    const todayRow = form.days.find(d => d.day === today) ?? first;
    const lines = [
      [current.feels === undefined ? "" : t("forms.feels", { p0: degrees(current.feels) }), t("forms.highLow", { p0: degrees(todayRow.high), p1: degrees(todayRow.low) })],
      [current.wind ? t("forms.wind", { p0: current.wind }) : "", current.humidity === undefined ? "" : t("forms.humidity", { p0: `${Math.round(current.humidity)}%` })],
    ].map(line => line.filter(Boolean).join(" · ")).filter(Boolean);
    parts.push(`<div class="wx-now">${glyph(skyOf(current.condition, now.getHours()), "lg")}<b class="wx-temp">${esc(degrees(current.temp))}</b>` +
      `<div class="wx-now-words"><strong>${esc(current.condition)}</strong>${lines.map(line => `<span>${esc(line)}</span>`).join("")}</div></div>`);
  }
  if (form.hours?.length) {
    const hours = form.hours.map(h => `<div class="wx-hour" title="${esc(h.condition)}"><span class="wx-when">${esc(h.time)}</span>` +
      `<span class="wx-sky">${glyph(skyOf(h.condition, hourOf(h.time)))}${rainChance(h.rain)}</span><b>${esc(degrees(h.temp))}</b></div>`).join("");
    parts.push(`<section class="wx-part"><h4>${esc(t("forms.hourly"))}</h4><div class="wx-hours" tabindex="0" role="region" aria-label="${esc(t("forms.hourly"))}">${hours}</div></section>`);
  }
  const low = Math.min(...form.days.map(d => d.low)), high = Math.max(...form.days.map(d => d.high)), span = high - low || 1;
  const days = form.days.map(d => {
    const left = (d.low - low) / span * 100, width = Math.max((d.high - d.low) / span * 100, 2);
    const bar = `<span class="wx-range" aria-hidden="true"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:linear-gradient(90deg, ${heat(d.low, form.units)}, ${heat(d.high, form.units)})"></i></span>`;
    return `<div class="wx-day"${d.day === today ? ' aria-current="date"' : ""} title="${esc(`${d.day} · ${d.condition}`)}">` +
      `<span class="wx-name">${esc(d.day === today ? t("forms.today") : forecastDay(d.day))}</span>` +
      `<span class="wx-sky">${glyph(skyOf(d.condition))}${rainChance(d.rain)}</span>` +
      `<span class="wx-low">${esc(degrees(d.low))}</span>${bar}<span class="wx-high">${esc(degrees(d.high))}</span></div>`;
  }).join("");
  parts.push(`<section class="wx-part"><h4>${esc(t("forms.daily"))}</h4><div class="wx-days">${days}</div></section>`);
  // A unit written as a letter (the weather tool's `C`) is named as a degree at the foot, as a weather app says it.
  const unit = /^[cf]$/i.test(form.units.trim()) ? `°${form.units.trim().toUpperCase()}` : form.units;
  const foot = [unit, form.source].filter(Boolean).join(" · ");
  parts.push(`<footer class="wx-foot"><span>${esc(foot)}</span>${form.updated ? `<span>${esc(t("forms.updated", { p0: form.updated }))}</span>` : ""}</footer>`);
  return parts.join("");
}

function chartSVG(form: Extract<AnswerForm, { kind: "chart" }>): string {
  const values = form.series.flatMap(s => s.values), min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1, y = (v: number) => 200 - (v - min) / range * 168;
  const step = 480 / form.labels.length, x = (i: number) => 56 + step * (i + .5);
  let content = (max > 0 ? `<path class="chart-grid" d="M56 ${y(max)}H536"/>` : "") + `<path class="chart-axis" d="M56 32V200H536M56 ${y(0)}H536"/>`;
  for (const value of [max, min]) content += `<text x="50" y="${y(value) + 4}" text-anchor="end">${esc(Number(value.toPrecision(4)))}</text>`;
  form.series.forEach((series, index) => {
    const cls = `chart-series chart-series-${index}`;
    if (form.type === "line") content += `<polyline class="${cls}" fill="none" points="${series.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>`;
    series.values.forEach((v, i) => {
      const title = `<title>${esc(`${series.name} · ${form.labels[i]}: ${v} ${form.units}`)}</title>`;
      if (form.type === "line") content += `<circle class="${cls}" cx="${x(i)}" cy="${y(v)}" r="4" tabindex="0">${title}</circle>`;
      else {
        const width = step * .72 / form.series.length;
        content += `<rect class="${cls}" x="${x(i) - step * .36 + index * width}" y="${Math.min(y(v), y(0))}" width="${Math.max(1, width - 2)}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="2" tabindex="0">${title}</rect>`;
      }
    });
  });
  form.labels.forEach((label, i) => {
    if (i % Math.ceil(form.labels.length / 6) === 0 || i === form.labels.length - 1) content += `<text x="${x(i)}" y="222" text-anchor="middle"><title>${esc(label)}</title>${esc(label.length > 10 ? label.slice(0, 9) + "…" : label)}</text>`;
  });
  return `<svg class="form-chart" viewBox="0 0 560 242" role="img" aria-label="${esc(answerFormText(form))}"><title>${esc(form.title)}</title>${content}</svg>`;
}

export function answerFormHTML(form: AnswerForm, source: string): string {
  const title = form.kind === "forecast" ? form.place : form.kind === "board" ? t("forms.board") : form.title;
  let body: string;
  if (form.kind === "forecast") body = forecastHTML(form);
  else if (form.kind === "board") body = `<div class="board-columns">${form.columns.map(c => `<section class="board-column"><h4>${esc(c.title)}</h4>${c.cards.map(card => `<article class="board-card"><strong>${esc(card.title)}</strong>${card.line ? `<p>${esc(card.line)}</p>` : ""}${card.owner ? `<span>${esc(card.owner)}</span>` : ""}</article>`).join("")}</section>`).join("")}</div>`;
  else body = `<div class="chart-legend${form.type === "bar" ? " chart-legend-bar" : ""}">${form.series.map((s, i) => `<span class="chart-key chart-key-${i}">${esc(s.name)}</span>`).join("")}<span>${esc(form.units)}</span></div>${chartSVG(form)}`;
  return `<section class="rich-block message-${form.kind}" data-source="${esc(source)}"><header class="rich-head"><span>${esc(title)}</span>${iconBtn("copy", t("chat.copySource"), ' data-rich-act="copy-source"')}</header>${body}</section>`;
}
