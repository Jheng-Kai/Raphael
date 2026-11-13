// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { chartHTML, chartLabel, direction, mountChartHover, pieParts, shownLabels, statsHTML, ticks } from "./report-chart";
import type { ReportChart, ReportStats } from "./types";

const people = { colorOf: (id: number) => ({ 0: "#3DB5FF", 1: "#905AFB", 2: "#FC2C3E" } as Record<number, string>)[id] ?? "#777777" };
const status = (word: string, label?: string): string => `<span class="rp-st">${label ?? word}</span>`;
const drawn = (html: string): HTMLElement => { const box = document.createElement("div"); box.innerHTML = html; document.body.append(box); return box; };
afterEach(() => { document.body.innerHTML = ""; });

// The owner's Notion 「目前狀態」 (2026-11-14): tasks by status, each column by owner.
const projects: ReportChart = {
  kind: "chart", title: "專案狀態", type: "stacked", labels: ["待處理", "進行中", "等待回覆", "已完成", "已取消"], unit: "件",
  series: [{ name: "Claude", values: [4, 3, 6, 63, 0] }, { name: "Codex", values: [1, 2, 1, 17, 0] }, { name: "Jack", values: [5, 1, 14, 12, 0] }, { name: "拉斐爾", member_id: 0, values: [4, 0, 1, 0, 0] }],
};

test("an axis takes round steps, at most five, ending as near the values as a round number allows", () => {
  expect(ticks(0, 103)).toEqual([0, 25, 50, 75, 100, 125]);
  expect(ticks(98, 106)).toEqual([98, 100, 102, 104, 106]);
  expect(ticks(-12, 30)).toEqual([-20, -10, 0, 10, 20, 30]);
  expect(ticks(0.2, 0.9)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  expect(ticks(5, 5).length).toBeGreaterThan(1);
});

test("an axis writes large steps short, and whole when the short forms would repeat", () => {
  document.documentElement.lang = "zh-TW";
  const ticks = (values: number[]): string[] => [...drawn(chartHTML({ kind: "chart", type: "line", labels: values.map(String), series: [{ name: "a", values }, { name: "b", values }] }, 0, people)).querySelectorAll(".rc-tick")].map(tick => tick.textContent!);
  // Raphael's first live overview: 22,950 to 23,412 read 2.3萬 on every step.
  const taiex = ticks([22950, 23040, 23105, 23101, 23412]);
  expect(new Set(taiex).size).toBe(taiex.length);
  expect(taiex).toContain("23,000");
  expect(ticks([0, 12000, 31000])).toEqual(["0", "1萬", "2萬", "3萬", "4萬"]);
});

test("a long series writes evenly spaced labels along the bottom, its newest always, and a short one every label", () => {
  expect([...shownLabels(9, 5)]).toEqual([0, 2, 4, 6, 8]);
  expect([...shownLabels(4, 5)]).toEqual([0, 1, 2, 3]);
  expect([...shownLabels(10, 5)].sort((a, b) => a - b)).toEqual([0, 3, 6, 9]);
  // One that would stand right before the newest gives way to it.
  expect([...shownLabels(11, 5)].sort((a, b) => a - b)).toEqual([0, 3, 6, 10]);
});

test("a change goes the way its sign says", () => {
  expect(["+1.35%", "▲2", "-0.4", "−3", "▼1", "持平", "0"].map(direction)).toEqual(["up", "up", "down", "down", "down", "flat", "flat"]);
});

test("tiles stand in rows of equal length, a change with its arrow, recent values as a line, every word escaped", () => {
  const stats: ReportStats = { kind: "stats", tiles: [
    { name: "台北 <b>", value: "24", unit: "°C", note: "午後陣雨", trend: [19, 22, 25, 20] },
    { name: "降雨", value: "80", unit: "%", status: "waiting", label: "帶傘" },
    { name: "台股", value: "23,412", delta: "+1.35%" },
    { name: "待處理", value: "14", delta: "-2" },
    { name: "行程", value: "3" },
    { name: "例行", value: "11/12" },
  ] };
  const box = drawn(statsHTML(stats, status));
  const tiles = box.querySelector<HTMLElement>(".rs-tiles")!;
  expect(tiles.dataset.cols).toBe("3");
  expect(box.querySelectorAll(".rs-tile")).toHaveLength(6);
  expect(box.querySelector(".rs-name span")!.textContent).toBe("台北 <b>");
  expect(box.querySelector(".rs-spark path.rs-spark-l")!.getAttribute("d")).toMatch(/^M0 /);
  expect([...box.querySelectorAll<HTMLElement>(".rs-delta")].map(delta => delta.dataset.dir)).toEqual(["up", "down"]);
  expect(box.querySelectorAll(".rs-delta svg")).toHaveLength(0);
  expect(box.querySelector(".rp-st")!.textContent).toBe("帶傘");
  expect(drawn(statsHTML({ kind: "stats", tiles: stats.tiles.slice(0, 4) }, status)).querySelector<HTMLElement>(".rs-tiles")!.dataset.cols).toBe("4");
  expect(drawn(statsHTML(stats, status, true)).querySelector<HTMLElement>(".rs-tiles")!.dataset.cols).toBe("2");
});

test("stacked columns put each owner's part one on another, the total on top, in the chart colours in their order", () => {
  const box = drawn(chartHTML(projects, 3, people));
  const chart = box.querySelector<HTMLElement>(".rc")!;
  expect(chart.dataset.reportChart).toBe("3");
  expect([...box.querySelectorAll(".rc-cap")].map(cap => cap.textContent)).toEqual(["14", "6", "22", "92", "0"]);
  const done = box.querySelector('.rc-band[data-i="3"]')!;
  expect([...done.querySelectorAll<HTMLElement>(".rc-bar")].map(bar => bar.dataset.s)).toEqual(["1", "2", "3"]);
  expect(done.querySelectorAll(".rc-bar.is-top")).toHaveLength(1);
  expect(done.querySelector(".rc-bar:last-child")!.classList.contains("is-top")).toBe(true);
  // The parts stand on one another: each begins where the one under it ends.
  const bars = [...done.querySelectorAll<HTMLElement>(".rc-bar")].map(bar => ({ bottom: parseFloat(bar.style.bottom), height: parseFloat(bar.style.height) }));
  bars.slice(1).forEach((bar, index) => expect(bar.bottom).toBeCloseTo(bars[index]!.bottom + bars[index]!.height, 0));
  // Three owners are not members: Raphael takes the fourth chart colour, not his own blue beside the first.
  expect([...box.querySelectorAll<HTMLElement>(".rc-legend .rc-key")].map(key => [key.dataset.s, key.getAttribute("style")])).toEqual([["1", null], ["2", null], ["3", null], ["4", null]]);
  expect(box.querySelector(".rc-unit")!.textContent).toBe("件");
  // The plot is what a reader reaches: an image named with every value, focusable for the arrow keys.
  const plot = box.querySelector<HTMLElement>(".rc-plot")!;
  expect(plot.getAttribute("role")).toBe("img");
  expect(plot.tabIndex).toBe(0);
  expect(plot.getAttribute("aria-label")).toBe(chartLabel(projects));
  expect(chartLabel(projects)).toContain("等待回覆 Claude 6 件, Codex 1 件, Jack 14 件, 拉斐爾 1 件");
  // In a file nothing takes the focus.
  expect(drawn(chartHTML(projects, 3, people, true)).querySelector(".rc-plot")!.hasAttribute("tabindex")).toBe(false);
});

test("series that are all members wear each member's own colour", () => {
  const box = drawn(chartHTML({ kind: "chart", type: "bar", labels: ["本週"], series: [{ name: "拉斐爾", member_id: 0, values: [3] }, { name: "小晴", member_id: 1, values: [5] }] }, 0, people));
  expect([...box.querySelectorAll(".rc-legend .rc-key")].map(key => key.getAttribute("style"))).toEqual(["--c:#3DB5FF;", "--c:#905AFB;"]);
  expect(box.querySelector(".rc-bar")!.getAttribute("style")).toMatch(/^--c:#3DB5FF;bottom:/);
});

test("one series of columns writes every value and needs no axis; below zero a column hangs from the zero line", () => {
  const rain = drawn(chartHTML({ kind: "chart", type: "bar", labels: ["06", "08", "10"], series: [{ values: [10, 80, 20] }], unit: "%" }, 0, people));
  expect(rain.querySelector(".rc-y")).toBeNull();
  expect(rain.querySelector(".rc-frame")!.classList.contains("is-bare")).toBe(true);
  expect([...rain.querySelectorAll(".rc-cap")].map(cap => cap.textContent)).toEqual(["10", "80", "20"]);
  const change = drawn(chartHTML({ kind: "chart", type: "bar", labels: ["一", "二"], series: [{ name: "A", values: [5, -3] }, { name: "B", values: [2, 4] }] }, 0, people));
  expect(change.querySelector(".rc-y")).not.toBeNull();
  expect(change.querySelectorAll(".rc-bar.is-low")).toHaveLength(1);
  expect([...change.querySelectorAll(".rc-tick")].map(tick => tick.textContent)).toContain("0");
});

test("a line with a gap is drawn in two stretches, its last point a dot and, alone, its last value written", () => {
  const index: ReportChart = { kind: "chart", type: "line", labels: ["11/10", "11/11", "11/12", "11/13"], series: [{ name: "S&P 500", values: [100, null, 101.6, 101.2] }, { name: "台股", values: [100, 101, 102, 102.6] }] };
  const box = drawn(chartHTML(index, 0, people));
  expect(box.querySelectorAll(".rc-line")).toHaveLength(3);
  expect(box.querySelectorAll(".rc-dot")).toHaveLength(2);
  expect(box.querySelector(".rc-end")).toBeNull();
  expect(box.querySelector(".rc-svg")!.getAttribute("preserveAspectRatio")).toBe("none");
  const alone = drawn(chartHTML({ kind: "chart", type: "area", labels: ["06", "09", "12"], series: [{ values: [19, 24, 28] }], unit: "°C" }, 0, people));
  expect(alone.querySelectorAll(".rc-area")).toHaveLength(1);
  expect(alone.querySelector(".rc-end")!.textContent).toBe("28");
  // An area stands on zero.
  expect([...alone.querySelectorAll(".rc-tick")][0]!.textContent).toBe("0");
});

test("bars across give each name its total, their lengths following the totals", () => {
  const box = drawn(chartHTML({ kind: "chart", type: "hbar", labels: ["拉斐爾", "紫苑"], series: [{ name: "完成", values: [18, 7] }, { name: "進行中", values: [3, 1] }] }, 0, people));
  expect([...box.querySelectorAll(".rc-val")].map(value => value.textContent)).toEqual(["21", "8"]);
  const widths = [...box.querySelectorAll(".rc-track")].map(track => [...track.querySelectorAll<HTMLElement>(".rc-hb")].reduce((sum, bar) => sum + parseFloat(bar.style.width), 0));
  expect(widths[0]).toBeCloseTo(100, 0);
  expect(widths[1]).toBeCloseTo((8 / 21) * 100, 0);
});

test("a ring shows its whole in its middle and each part's share; past eight parts the rest is one", () => {
  const ring = drawn(chartHTML({ kind: "chart", type: "donut", labels: ["台股", "美股", "現金", "債券"], series: [{ values: [84, 70, 30, 16] }], unit: "萬元" }, 0, people));
  expect(ring.querySelectorAll(".rc-part")).toHaveLength(4);
  expect(ring.querySelector(".rc-mid b")!.textContent).toBe("200");
  expect(ring.querySelector(".rc-mid small")!.textContent).toBe("萬元");
  expect([...ring.querySelectorAll(".rc-ps")].map(share => share.textContent)).toEqual(["42%", "35%", "15%", "8%"]);
  const many: ReportChart = { kind: "chart", type: "pie", labels: Array.from({ length: 10 }, (_, index) => `第${index + 1}`), series: [{ values: Array.from({ length: 10 }, () => 1) }] };
  const parts = pieParts(many);
  expect(parts).toHaveLength(8);
  expect(parts[7]).toMatchObject({ label: "其他", value: 3, slot: 8 });
  // One part alone is a whole circle.
  const whole = drawn(chartHTML({ kind: "chart", type: "pie", labels: ["全部", "沒有"], series: [{ values: [5, 0] }] }, 0, people));
  expect(whole.querySelectorAll(".rc-part")).toHaveLength(1);
  expect(whole.querySelector(".rc-part")!.getAttribute("d")).toContain("A48 48 0 0 1");
});

test("the arrow keys on a chart show each label's values, and the box names a stack's total", () => {
  const box = drawn(chartHTML(projects, 0, people));
  mountChartHover(box, index => (index === 0 ? projects : null), () => people);
  const plot = box.querySelector<HTMLElement>(".rc-plot")!;
  plot.focus();
  plot.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  let tip = box.querySelector(".rc-tip")!;
  expect(tip.querySelector(".rc-tt")!.textContent).toBe("待處理");
  plot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  plot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  tip = box.querySelector(".rc-tip")!;
  expect(tip.querySelector(".rc-tt")!.textContent).toBe("等待回覆");
  expect([...tip.querySelectorAll(".rc-tv")].map(value => value.textContent)).toEqual(["6 件", "1 件", "14 件", "1 件", "22 件"]);
  expect(box.querySelector('.rc-band[data-i="2"]')!.classList.contains("is-on")).toBe(true);
  expect(box.querySelectorAll(".rc-tip")).toHaveLength(1);
  plot.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  expect(box.querySelector(".rc-tip")).toBeNull();
  expect(box.querySelector(".is-on")).toBeNull();
});
