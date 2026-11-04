import { getLocale, t } from "./i18n";
import { esc, ico, iconBtn } from "./ui";

import { answerFormText, type AnswerForm } from "../shared/answer-forms";

function forecastDay(day: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(getLocale(), { month: "numeric", day: "numeric" }) : day;
}

function chartSVG(form: Extract<AnswerForm, { kind: "chart" }>): string {
  const values = form.series.flatMap(s => s.values), min = Math.min(0, ...values), max = Math.max(0, ...values);
  const range = max - min || 1, y = (v: number) => 200 - (v - min) / range * 168;
  const step = 480 / form.labels.length, x = (i: number) => 56 + step * (i + .5);
  let content = `<path class="chart-axis" d="M56 32V200H536M56 ${y(0)}H536"/>`;
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
  if (form.kind === "forecast") {
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    body = `<div class="forecast-days">${form.days.map(d => `<div class="forecast-day" title="${esc(d.day)}"${d.day === today ? ' aria-current="date"' : ""}><strong>${esc(d.day === today ? t("forms.today") : forecastDay(d.day))}</strong>${ico(/rain|雨|雪|snow/i.test(d.condition) ? "cloud" : /cloud|曇|雲|陰/i.test(d.condition) ? "cloud" : "sparkle")}<span>${esc(d.condition)}</span><span class="forecast-temperatures"><b>${esc(d.high)}</b><span>${esc(d.low)}</span></span></div>`).join("")}</div><p class="form-units">${esc(form.units)}</p>`;
  } else if (form.kind === "board") body = `<div class="board-columns">${form.columns.map(c => `<section class="board-column"><h4>${esc(c.title)}</h4>${c.cards.map(card => `<article class="board-card"><strong>${esc(card.title)}</strong>${card.line ? `<p>${esc(card.line)}</p>` : ""}${card.owner ? `<span>${esc(card.owner)}</span>` : ""}</article>`).join("")}</section>`).join("")}</div>`;
  else body = `<div class="chart-legend">${form.series.map((s, i) => `<span class="chart-key chart-key-${i}">${esc(s.name)}</span>`).join("")}<span>${esc(form.units)}</span></div>${chartSVG(form)}`;
  return `<section class="rich-block message-${form.kind}" data-source="${esc(source)}"><header class="rich-head"><span>${esc(title)}</span>${iconBtn("copy", t("chat.copySource"), ' data-rich-act="copy-source"')}</header>${body}</section>`;
}
