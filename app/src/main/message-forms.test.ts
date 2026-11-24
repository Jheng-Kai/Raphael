// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { messagePlainText, parseMessageBlocks, replyContentHTML } from "./message-content";
import { parseAnswerForm } from "../shared/answer-forms";
import { getLocale } from "./i18n";
import { skyOf } from "./message-forms";

const examples = {
  forecast: { place: "Harbor", units: "°C", days: [{ day: "2026-11-01", condition: "Cloudy", high: 24, low: 18 }] },
  board: { columns: [{ title: "Ready", cards: [{ title: "Review draft", line: "Check dates", owner: "Alex" }] }] },
  chart: { type: "bar", title: "Visitors", units: "people", labels: ["Mon", "Tue"], series: [{ name: "Visits", values: [3, -2] }] },
};
const fence = (kind: string, data: unknown) => "```" + kind + "\n" + JSON.stringify(data) + "\n```";
for (const [kind, example] of Object.entries(examples)) {
  test(`${kind} renders a bounded card with the existing copy control`, () => {
    expect(parseAnswerForm(kind, JSON.stringify(example))?.kind).toBe(kind);
    const html = replyContentHTML(fence(kind, example));
    expect(html).toContain(`message-${kind}`);
    expect(html).toContain('data-rich-act="copy-source"');
    expect(html).not.toContain("<pre>");
    expect(messagePlainText(fence(kind, example), true)).not.toContain('{"');
  });
  test(`${kind} invalid, oversized and incomplete blocks remain escaped code`, () => {
    expect(parseAnswerForm(kind, JSON.stringify(example) + " ".repeat(24000))).toBeNull();
    for (const text of [fence(kind, {}), fence(kind, { ...example, extra: true }), "```" + kind + "\n" + JSON.stringify(example), fence(kind, { ...example, title: "x".repeat(20000) }), "```" + kind + "\n{\"place\":"]) {
      expect(replyContentHTML(text)).toContain("<pre>");
      expect(replyContentHTML(text)).not.toContain(`message-${kind}`);
    }
  });
  test(`${kind} is a quiet pending card while its fence is still arriving`, () => {
    const open = "```" + kind + "\n" + JSON.stringify(example).slice(0, 20);
    const html = replyContentHTML(open, "", true);
    expect(html).toContain("answer-form-pending");
    expect(html).not.toContain("<pre>");
    expect(html).not.toContain(JSON.stringify(example).slice(1, 12));
    expect(replyContentHTML(open)).toContain("<pre>");
    expect(replyContentHTML(fence(kind, {}), "", true)).toContain("<pre>");
  });
  test(`${kind} every text field is escaped without active HTML or remote content`, () => {
    const attack = '<img src="https://example.test/a" onerror="alert(1)"><script>x</script>';
    const poison = (value: unknown): unknown => typeof value === "string" ? attack : Array.isArray(value) ? value.map(poison) : typeof value === "object" && value ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, key === "type" ? v : poison(v)])) : value;
    const root = document.createElement("div"); root.innerHTML = replyContentHTML(fence(kind, poison(example)));
    expect(root.querySelector(`.message-${kind}`)).not.toBeNull();
    expect(root.querySelector("img,script,iframe,a,[onerror],[src]" )).toBeNull();
    expect(root.textContent).toContain(attack);
  });
}
test("all schema counts and numeric geometry are bounded", () => {
  const invalid = [
    ["forecast", { ...examples.forecast, days: Array(8).fill(examples.forecast.days[0]) }],
    ["forecast", { ...examples.forecast, days: [{ ...examples.forecast.days[0], high: "24" }] }],
    ["forecast", { ...examples.forecast, days: [{ ...examples.forecast.days[0], high: '<script>x</script>' }] }],
    ["forecast", { ...examples.forecast, days: [{ ...examples.forecast.days[0], low: '<img src="x">' }] }],
    ["board", { columns: Array(6).fill(examples.board.columns[0]) }],
    ["board", { columns: [{ title: "Ready", cards: Array(21).fill({ title: "Task" }) }] }],
    ["chart", { ...examples.chart, series: Array(3).fill(examples.chart.series[0]) }],
    ["chart", { ...examples.chart, labels: Array(25).fill("Day"), series: [{ name: "A", values: Array(25).fill(1) }] }],
    ["chart", { ...examples.chart, series: [{ name: "A", values: [1] }] }],
    ["chart", { ...examples.chart, series: [{ name: "A", values: [1e30, 1] }] }],
    ["chart", { ...examples.chart, type: '<script>x</script>' }],
    ["chart", { ...examples.chart, series: [{ name: "A", values: ['<script>x</script>', 1] }] }],
  ];
  for (const [kind, data] of invalid) expect(replyContentHTML(fence(String(kind), data))).toContain("<pre>");
});
test("line charts expose every number and keep stable markup on unchanged refresh", () => {
  const text = fence("chart", { ...examples.chart, type: "line" });
  const html = replyContentHTML(text);
  expect(html).toContain("<polyline");
  expect(html).toContain("<title>Visits · Mon: 3 people</title>");
  expect(replyContentHTML(text)).toBe(html);
  expect(parseMessageBlocks(text)).toHaveLength(1);
});

test("forecast marks today and retains the exact source for the shared copy control", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 12));
  try {
    const root = document.createElement("div"); root.innerHTML = replyContentHTML(fence("forecast", examples.forecast));
    expect(root.querySelector('[aria-current="date"]')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.rich-block')!.dataset.source).toBe(JSON.stringify(examples.forecast));
  } finally { vi.useRealTimers(); }
});

test("forecast days are named by their weekday, keeping the full date available", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 31, 12));
  try {
    const root = document.createElement("div"); root.innerHTML = replyContentHTML(fence("forecast", examples.forecast));
    const name = root.querySelector('.wx-day .wx-name')!.textContent!;
    expect(name).not.toMatch(/^\d{4}-/);
    expect(name).toBe(new Date("2026-11-01T12:00:00").toLocaleDateString(getLocale(), { weekday: "short" }));
    expect(root.querySelector<HTMLElement>('.wx-day')!.title).toContain("2026-11-01");
    // A form of days alone is the daily rows: no current conditions, no hours.
    expect(root.querySelector(".wx-now, .wx-hours")).toBeNull();
  } finally { vi.useRealTimers(); }
});

test("a full forecast draws now, the hours ahead, rain chances, the week's range bars and the source", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 15));
  try {
    const full = { place: "Taipei", units: "°C", source: "Open-Meteo", updated: "15:00",
      now: { temp: 24.4, condition: "Cloudy", feels: 23, humidity: 74, wind: "18 km/h" },
      hours: [{ time: "15:00", condition: "Cloudy", temp: 24 }, { time: "20:00", condition: "Light rain", temp: 23, rain: 40 }, { time: "22:00", condition: "Clear", temp: 22 }],
      days: [{ day: "2026-11-01", condition: "Rain", high: 26, low: 22, rain: 87 }, { day: "2026-11-02", condition: "Partly cloudy", high: 29, low: 17 }] };
    const root = document.createElement("div"); root.innerHTML = replyContentHTML(fence("forecast", full));
    expect(root.querySelector(".wx-temp")!.textContent).toBe("24°");
    expect(root.querySelector(".wx-now-words")!.textContent).toContain("Cloudy");
    expect(root.querySelectorAll(".wx-hour")).toHaveLength(3);
    expect(root.querySelector('.wx-hours[role="region"]')).not.toBeNull();
    // A rain chance stands under its glyph from 10%; a dry hour shows none.
    expect([...root.querySelectorAll(".wx-hour")].map(hour => hour.querySelector(".wx-rain")?.textContent ?? "")).toEqual(["", "40%", ""]);
    expect(root.querySelector('.wx-hour:nth-child(3) .wx-glyph')!.getAttribute("data-sky")).toBe("night");
    const [first, second] = [...root.querySelectorAll<HTMLElement>(".wx-range > i")];
    expect(first!.style.left).toBe("41.7%");
    expect(second!.style.left).toBe("0.0%");
    expect(second!.style.width).toBe("100.0%");
    expect(root.querySelector(".wx-foot")!.textContent).toContain("Open-Meteo");
  } finally { vi.useRealTimers(); }
});

test("the forecast's foot names its unit as a degree", () => {
  const foot = (units: string): string => {
    const root = document.createElement("div");
    root.innerHTML = replyContentHTML(fence("forecast", { place: "台中", units, source: "Open-Meteo", days: [{ day: "2026-11-24", condition: "小雨", high: 22, low: 15 }] }));
    return root.querySelector(".wx-foot")!.textContent!;
  };
  expect(foot("C")).toBe("°C · Open-Meteo");
  expect(foot("f")).toBe("°F · Open-Meteo");
  expect(foot("°C")).toBe("°C · Open-Meteo");
});

test("the sky of a condition is read in the languages a reply is written in", () => {
  expect(["Thunderstorm", "雷陣雨", "Snow", "小雪", "Light rain", "陣雨", "Fog", "霧", "Partly cloudy", "晴時多雲", "Overcast", "陰天", "Clear", "晴れ"].map(word => skyOf(word)))
    .toEqual(["storm", "storm", "snow", "snow", "rain", "rain", "fog", "fog", "partly", "partly", "cloud", "cloud", "clear", "clear"]);
  expect(skyOf("Clear", 22)).toBe("night");
});

test("the forecast form's optional parts are strict: a rain chance over 100 or an unknown key keeps it code", () => {
  const base = { place: "Harbor", units: "C", days: [{ day: "2026-11-01", condition: "Rain", high: 20, low: 15, rain: 60 }] };
  expect(parseAnswerForm("forecast", JSON.stringify({ ...base, now: { temp: 18, condition: "Rain", humidity: 90 }, hours: [{ time: "09:00", condition: "Rain", temp: 17, rain: 80 }], source: "Open-Meteo", updated: "08:00" }))).not.toBeNull();
  expect(parseAnswerForm("forecast", JSON.stringify({ ...base, days: [{ ...base.days[0], rain: 120 }] }))).toBeNull();
  expect(parseAnswerForm("forecast", JSON.stringify({ ...base, now: { temp: 18, condition: "Rain", uv: 3 } }))).toBeNull();
  expect(parseAnswerForm("forecast", JSON.stringify({ ...base, hours: [] }))).toBeNull();
});

test("a bar chart's legend is marked as bars, a line chart's is not", () => {
  const bar = replyContentHTML(fence("chart", examples.chart));
  expect(bar).toContain('class="chart-legend chart-legend-bar"');
  const line = replyContentHTML(fence("chart", { ...examples.chart, type: "line" }));
  expect(line).toContain('class="chart-legend"');
  expect(line).not.toContain("chart-legend-bar");
});
