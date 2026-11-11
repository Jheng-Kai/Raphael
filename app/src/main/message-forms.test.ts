// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { messagePlainText, parseMessageBlocks, replyContentHTML } from "./message-content";
import { parseAnswerForm } from "../shared/answer-forms";

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

test("forecast dates omit the year in the column but keep the full date available", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 31, 12));
  try {
    const root = document.createElement("div"); root.innerHTML = replyContentHTML(fence("forecast", examples.forecast));
    expect(root.querySelector('.forecast-day > strong')!.textContent).toBe("11/1");
    expect(root.querySelector<HTMLElement>('.forecast-day')!.title).toBe("2026-11-01");
  } finally { vi.useRealTimers(); }
});

test("a bar chart's legend is marked as bars, a line chart's is not", () => {
  const bar = replyContentHTML(fence("chart", examples.chart));
  expect(bar).toContain('class="chart-legend chart-legend-bar"');
  const line = replyContentHTML(fence("chart", { ...examples.chart, type: "line" }));
  expect(line).toContain('class="chart-legend"');
  expect(line).not.toContain("chart-legend-bar");
});
