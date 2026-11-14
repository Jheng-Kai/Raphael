// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
import { mountPages, pageCardsHTML } from "./page-card";
import { t } from "./i18n";
import { mountPageView } from "./page-view";
import { FILE_POLICY, fileStyle, halves, layoutTeam, mountReportView, reportFile, reportHTML, themeWords, type TeamLayout } from "./report-page";
import type { AgentTurn, PageCard, Report, ReportEdge, ReportNode, ReportSection } from "./types";
import { ico } from "./ui";

const people = { nameOf: (id: number) => ({ 0: "拉斐爾", 1: "小晴", 2: "小森" } as Record<number, string>)[id] ?? "", colorOf: (id: number) => `var(--m${id})` };
const report: Report = {
  as_of: "2026-11-10T01:30:00Z",
  sections: [
    { kind: "findings", title: "重點發現", callout: "有 2 件在等你 <b>", items: [
      { title: "小森 · 時程", text: "等你說開始", status: "pending", label: "定稿待執行" },
      { title: "小晴 · 價格 <script>", status: "blocked" }] },
    { kind: "table", title: "總覽表", columns: ["成員", "負責"], rows: [
      { cells: ["小晴", "研究"], group: "專案工作", member_id: 1, status: "blocked" },
      { cells: ["小森", "進度"], group: "專案工作", member_id: 2, status: "running" },
      { cells: ["紫苑", "日文"], group: "語言學習" }] },
    { kind: "team", title: "分工與協作", nodes: [{ id: "o", owner: true }, { id: "r", member_id: 0, note: "分派" }, { id: "s", member_id: 2 }],
      edges: [{ from: "o", to: "r", label: "交辦" }, { from: "r", to: "s", label: "排進度" }, { from: "s", to: "o", label: "每週進度" }],
      notes: [{ label: "缺口", text: "客戶來信 <i>沒有人負責</i>" }] },
    { kind: "text", text: "沒有其他紀錄。" },
  ],
};
// A daily overview (owner, 2026-11-14): tiles, then every kind of chart, none of them given a span.
const dashboard: Report = {
  as_of: "2026-11-14T00:00:00Z",
  sections: [
    { kind: "stats", title: "今天", tiles: [{ name: "台中", value: "29", unit: "°C", trend: [21, 24, 29] }, { name: "台股", value: "23,412", delta: "+1.35%" }] },
    { kind: "chart", title: "氣溫", type: "area", labels: ["06", "12", "18"], series: [{ values: [21, null, 25] }], unit: "°C" },
    { kind: "chart", title: "降雨", type: "bar", labels: ["06", "12", "18"], series: [{ values: [10, 90, 60] }], unit: "%" },
    { kind: "chart", title: "專案", type: "stacked", labels: ["待處理", "已完成"], series: [{ name: "Claude", values: [4, 63] }, { name: "拉斐爾", member_id: 0, values: [4, 0] }] },
    { kind: "table", title: "行程", columns: ["時間", "行程"], rows: [{ cells: ["10:30", "週會"] }] },
    { kind: "chart", title: "走勢", type: "line", labels: ["11/12", "11/13"], series: [{ name: "台股", values: [100, 101] }, { name: "S&P", values: [100, 99] }] },
    { kind: "chart", title: "工作量", type: "hbar", labels: ["拉斐爾"], series: [{ values: [21] }] },
    { kind: "chart", title: "配置", type: "donut", labels: ["台股", "現金"], series: [{ values: [84, 30] }], unit: "萬元" },
    { kind: "chart", title: "比例", type: "pie", labels: ["是", "否"], series: [{ values: [1, 3] }] },
  ],
};
// A document-style report (owner, 2026-11-14, after Grok Bot's Tokyo list): a summary line, a note, a table with a dropdown, a column of
// figures and a column of links.
const document_: Report = {
  as_of: "2026-11-14T00:00:00Z",
  summary: "46 個景點 <b>、39 間餐廳，用篩選慢慢挑。",
  sections: [
    { kind: "callout", tone: "info", heading: "說明", text: "住在大塚。價格只列有來源支持的 <i>。" },
    { kind: "table", title: "景點／體驗", filter: "區域", columns: ["名稱", "區域", "價格", "連結"], rows: [
      { cells: ["淺草寺", "淺草", "—", { text: "地圖", url: "https://www.google.com/maps/search/?api=1&query=%E6%B7%BA%E8%8D%89%E5%AF%BA" }], group: "經典名勝" },
      { cells: ["晴空塔", "押上", "NT$ 700", { text: "官網", url: "https://www.tokyo-skytree.jp/cn_t/" }], group: "展望台" },
      { cells: ["明治神宮", "原宿", "免費", { text: "地圖", url: "https://www.google.com/maps/search/?api=1&query=Meiji+Jingu" }], group: "經典名勝" },
      { cells: ["表參道", "原宿", "1,200", { text: "地圖", url: "https://www.google.com/maps/search/?api=1&query=Omotesando" }], group: "街區" }] },
    { kind: "callout", tone: "warn", text: "營業時間出發前請再確認。" },
    { kind: "callout", tone: "ok", heading: "已排除", text: "牛肉餐廳。" },
  ],
};
const page: PageCard = { id: "r1", title: "團隊總覽報告", rev: 1, height: 320, source: "html", server: null, fallback: "", kind: "report" };
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { vi.spyOn(api, "reportOpen").mockResolvedValue({ kind: "report", title: "團隊總覽報告", rev: 1, report }); });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

test("a report says when its data is from, that it holds only recorded facts, and escapes every word", () => {
  const html = reportHTML("報告 <img src=x>", report, people);
  const doc = document.createElement("div");
  doc.innerHTML = html;
  expect(doc.querySelector("h1")!.textContent).toBe("報告 <img src=x>");
  expect(doc.querySelector(".rp-sub")!.textContent).toMatch(/^資料截至 \d{4}\/\d\d\/\d\d \d\d:\d\d · 只寫有紀錄的事實$/);
  expect(doc.querySelectorAll("script, img, b > script, i")).toHaveLength(0);
  expect(doc.querySelector(".rp-callout")!.textContent).toContain("有 2 件在等你 <b>");
});

test("the member's summary replaces the date and the promise of recorded facts, and stays one escaped line", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("東京", document_, people);
  const sub = doc.querySelector<HTMLElement>(".rp-sub")!;
  expect(sub.textContent).toBe("46 個景點 <b>、39 間餐廳，用篩選慢慢挑。");
  expect(sub.classList.contains("is-summary") && sub.querySelector("b") === null).toBe(true);
  expect(doc.textContent).not.toContain("只寫有紀錄的事實");
  // Without one, the page says what it always did.
  doc.innerHTML = reportHTML("東京", { ...document_, summary: undefined }, people);
  expect(doc.querySelector(".rp-sub")!.textContent).toMatch(/^資料截至 .* · 只寫有紀錄的事實$/);
  expect(doc.querySelector(".rp-sub")!.classList.contains("is-summary")).toBe(false);
});

test("the contents are a box with 「本頁內容」 over a list of the sections", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("報告", report, people);
  const box = doc.querySelector<HTMLElement>("nav.rp-toc")!;
  expect(box.getAttribute("aria-label")).toBe("本頁內容");
  expect(box.querySelector(".rp-toc-h")!.textContent).toBe("本頁內容");
  expect([...box.querySelectorAll("ul > li > a")].map(link => link.textContent)).toEqual(["重點發現", "總覽表", "分工與協作"]);
  expect(box.querySelector(".rp-toc-h")!.nextElementSibling!.tagName).toBe("UL");
});

test("a note is its tone's own icon, an optional heading and its words, escaped", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("東京", document_, people);
  const notes = [...doc.querySelectorAll<HTMLElement>(".rp-note")];
  expect(notes.map(note => note.dataset.tone)).toEqual(["info", "warn", "ok"]);
  expect(notes.map(note => note.querySelector("b")?.textContent ?? null)).toEqual(["說明", null, "已排除"]);
  expect(notes[0]!.querySelector("p")!.textContent).toBe("住在大塚。價格只列有來源支持的 <i>。");
  expect(notes[0]!.querySelector("i")).toBeNull();
  expect(new Set(notes.map(note => note.querySelector("svg")!.innerHTML)).size).toBe(3);
});

test("a column of figures is set at the right, and the names, a dash and words keep their side", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("東京", document_, people);
  // 價格 holds 「免費」, so it is not a column of figures.
  expect([...doc.querySelectorAll(".rp-table th")].map(th => th.hasAttribute("data-num"))).toEqual([false, false, false, false]);
  const table = document_.sections[1]!;
  if (table.kind !== "table") throw new Error("a table");
  const prices = ["—", "NT$ 700", "+3.5%", "1,200"];
  const figures: Report = { ...document_, sections: [{ ...table, rows: table.rows.map((row, at) => ({ ...row, cells: [row.cells[0]!, row.cells[1]!, prices[at]!, row.cells[3]!] })) }] };
  doc.innerHTML = reportHTML("東京", figures, people);
  expect([...doc.querySelectorAll(".rp-table th")].map(th => th.hasAttribute("data-num"))).toEqual([false, false, true, false]);
  expect([...doc.querySelectorAll("tbody tr")].map(row => row.children[2]!.hasAttribute("data-num"))).toEqual([true, true, true, true]);
  expect(doc.querySelectorAll("[data-num] a")).toHaveLength(0);
});

test("a link cell is a link to its https address, escaped, and it opens in the owner's browser, never in the window", async () => {
  const opened = vi.spyOn(api, "openExternalUrl").mockResolvedValue(undefined);
  vi.spyOn(api, "reportOpen").mockResolvedValue({ kind: "report", title: "東京", rev: 1, report: document_ });
  const { stage, thread } = conversation();
  thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  const view = stage.querySelector<HTMLElement>(".rp-view")!;
  const links = [...view.querySelectorAll<HTMLAnchorElement>("td a.rp-link")];
  expect(links.map(link => link.textContent)).toEqual(["地圖", "官網", "地圖", "地圖"]);
  expect(links[0]!.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=%E6%B7%BA%E8%8D%89%E5%AF%BA");
  expect(links.every(link => link.rel === "noopener noreferrer" && link.hasAttribute("data-report-link"))).toBe(true);
  const press = new MouseEvent("click", { bubbles: true, cancelable: true });
  links[1]!.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  expect(opened).toHaveBeenCalledExactlyOnceWith("https://www.tokyo-skytree.jp/cn_t/");
  // A link that cannot be opened says so.
  opened.mockRejectedValueOnce(new Error("no"));
  links[0]!.click();
  await flush();
  expect(lastToast()).toBe(t("page.failed"));
});

test("a dropdown over a column shows only the rows of the value chosen, with the tabs, and says so when none are left", async () => {
  vi.spyOn(api, "reportOpen").mockResolvedValue({ kind: "report", title: "東京", rev: 1, report: document_ });
  const { stage, thread } = conversation();
  thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  const view = stage.querySelector<HTMLElement>(".rp-view")!;
  const button = view.querySelector<HTMLButtonElement>("button.sel[data-report-filter]")!;
  expect(view.querySelector(".rp-filter-l")!.textContent).toBe("區域");
  expect(button.getAttribute("aria-label")).toBe("區域");
  expect(button.textContent).toBe("全部");
  const rows = (): boolean[] => [...view.querySelectorAll<HTMLTableRowElement>(".rp-table tbody tr:not(.rp-none)")].map(row => row.hidden === true);
  button.click();
  const choices = [...document.querySelectorAll<HTMLButtonElement>(".menu .menu-choice")];
  expect(choices.map(choice => choice.dataset.value)).toEqual(["", "淺草", "押上", "原宿"]);
  choices[3]!.click();
  expect(rows()).toEqual([true, true, false, false]);
  expect(button.textContent).toBe("原宿");
  // With a tab as well: 經典名勝 and 原宿 leave one row; 展望台 and 原宿 leave none, and the table says so.
  view.querySelector<HTMLButtonElement>('[data-report-tab="g0"]')!.click();
  expect(rows()).toEqual([true, true, false, true]);
  view.querySelector<HTMLButtonElement>('[data-report-tab="g1"]')!.click();
  expect(rows()).toEqual([true, true, true, true]);
  expect(view.querySelector(".rp-none td")!.textContent).toBe(t("conn.noMatch"));
  expect(view.querySelector(".rp-none td")!.getAttribute("colspan")).toBe("4");
  view.querySelector<HTMLButtonElement>('[data-report-tab="all"]')!.click();
  expect(rows()).toEqual([true, true, false, false]);
  expect(view.querySelector(".rp-none")).toBeNull();
  // 全部 brings every row back.
  button.click();
  document.querySelectorAll<HTMLButtonElement>(".menu .menu-choice")[0]!.click();
  expect(rows()).toEqual([false, false, false, false]);
});

test("a filter needs two values to be a choice, and a file, which runs nothing, has none", () => {
  const doc = document.createElement("div");
  const table = document_.sections[1]!;
  if (table.kind !== "table") throw new Error("a table");
  const one: Report = { ...document_, sections: [{ ...table, rows: [{ cells: ["a", "x", "1", "z"] }, { cells: ["b", "x", "2", "z"] }] }] };
  doc.innerHTML = reportHTML("東京", one, people);
  expect(doc.querySelector("[data-report-filter], .rp-filter")).toBeNull();
  doc.innerHTML = reportHTML("東京", document_, people, { font: "12px sans-serif" });
  expect(doc.querySelector("[data-report-filter], .rp-filter, button")).toBeNull();
  // Its links still go away to their https address.
  expect([...doc.querySelectorAll("td a")].map(link => link.getAttribute("href")!.startsWith("https://"))).toEqual([true, true, true, true]);
});

test("the contents list each titled section, and a section without a title stays out of it", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("報告", report, people);
  expect([...doc.querySelectorAll(".rp-toc a")].map(link => [link.textContent, link.getAttribute("href")])).toEqual(
    [["重點發現", "#rp-s0"], ["總覽表", "#rp-s1"], ["分工與協作", "#rp-s2"]]);
  doc.innerHTML = reportHTML("報告", { ...report, sections: [report.sections[3]!] }, people);
  expect(doc.querySelector(".rp-toc")).toBeNull();
});

test("a status is a word in its tone: the member's own word, else the window's word for it", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("報告", report, people);
  expect([...doc.querySelectorAll(".rp-items .rp-st")].map(word => [word.textContent, (word as HTMLElement).dataset.tone])).toEqual(
    [["定稿待執行", "warn"], ["卡住", "err"]]);
  expect([...doc.querySelectorAll(".rp-table .rp-st")].map(word => (word as HTMLElement).dataset.tone)).toEqual(["err", "ok"]);
});

test("a table gets tabs for its groups and a status column, and a member's row starts with its colour", () => {
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("報告", report, people);
  const tabs = [...doc.querySelectorAll<HTMLElement>(".rp-table-box [data-report-tab]")];
  expect(tabs.map(tab => tab.textContent)).toEqual(["全部3", "專案工作2", "語言學習1"]);
  expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  expect([...doc.querySelectorAll(".rp-table th")].map(th => th.textContent)).toEqual(["成員", "負責", "狀態"]);
  expect(doc.querySelector<HTMLElement>(".rp-table tbody tr .rp-dot")!.style.getPropertyValue("--rp-c")).toBe("var(--m1)");
  const one = { ...report, sections: [{ kind: "table" as const, columns: ["a"], rows: [{ cells: ["x"], group: "only" }] }] };
  doc.innerHTML = reportHTML("報告", one, people);
  expect(doc.querySelector(".tabs")).toBeNull();
});

// ---------- the team diagram ----------

const measure = (text: string): number => [...text].length * 12;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function checkLayout(layout: TeamLayout, nodes: readonly ReportNode[], edges: readonly ReportEdge[]): void {
  const boxes = layout.nodes.map(node => node.box);
  expect(boxes).toHaveLength(nodes.length);
  for (const [index, a] of boxes.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(layout.width);
    for (const b of boxes.slice(index + 1)) expect(overlap(a, b), `${a.id} and ${b.id}`).toBe(false);
  }
  const byId = new Map(boxes.map(box => [box.id, box]));
  const onEdge = (box: { x: number; y: number; w: number; h: number }, [x, y]: [number, number]): boolean =>
    ((y === box.y || y === box.y + box.h) && x >= box.x && x <= box.x + box.w) || ((x === box.x || x === box.x + box.w) && y >= box.y && y <= box.y + box.h);
  layout.lines.forEach((line, index) => {
    expect(line.from).toBe(edges[index]!.from);
    expect(onEdge(byId.get(line.from)!, line.points[0]!), `${line.from} start`).toBe(true);
    expect(onEdge(byId.get(line.to)!, line.points[line.points.length - 1]!), `${line.to} end`).toBe(true);
    // Right angles only: each stretch is level or upright.
    line.points.slice(1).forEach((point, step) => expect(point[0] === line.points[step]![0] || point[1] === line.points[step]![1]).toBe(true));
  });
  const labels = layout.lines.flatMap(line => (line.label ? [{ x: line.label.x - line.label.w / 2, y: line.label.y - 10, w: line.label.w, h: 20 }] : []));
  expect(labels).toHaveLength(edges.filter(edge => edge.label).length);
  for (const [index, label] of labels.entries()) {
    for (const box of boxes) expect(overlap(label, box), `label ${index} over ${box.id}`).toBe(false);
    for (const other of labels.slice(index + 1)) expect(overlap(label, other), `labels ${index}`).toBe(false);
  }
}

const team: ReportNode[] = [{ id: "o", owner: true }, { id: "r", member_id: 0 }, { id: "z", member_id: 3 }, { id: "q", member_id: 1 }, { id: "s", member_id: 2 }];
const flows: ReportEdge[] = [
  { from: "o", to: "r", label: "交辦" }, { from: "o", to: "z", label: "每日練習" }, { from: "r", to: "q", label: "研究題目" },
  { from: "r", to: "s", label: "排進度" }, { from: "q", to: "s", label: "整理好的資料" }, { from: "s", to: "o", label: "每週進度" },
];

test("the team is laid out in rows from who asks to who does, with no box or label over another", () => {
  const layout = layoutTeam(team, flows, 696, measure);
  checkLayout(layout, team, flows);
  const row = (id: string): number => layout.nodes.find(node => node.box.id === id)!.row;
  expect([row("o"), row("r"), row("z"), row("q"), row("s")]).toEqual([0, 1, 1, 2, 3]);
  // The arrow that closes the circle goes up, out of the top of its box into the bottom of the owner's.
  const back = layout.lines[5]!;
  expect(back.points[0]![1]).toBe(layout.nodes.find(node => node.box.id === "s")!.box.y);
});

/** Where one arrow's level stretch runs through another's upright, away from both their ends. */
function crossings(layout: TeamLayout): string[] {
  const stretches = layout.lines.flatMap((line, index) => line.points.slice(1).map((q, step) => ({ index, p: line.points[step]!, q })));
  const found: string[] = [];
  for (const level of stretches.filter(s => s.p[1] === s.q[1])) {
    for (const upright of stretches.filter(s => s.p[0] === s.q[0] && s.index !== level.index)) {
      const x = upright.p[0], y = level.p[1];
      const across = x > Math.min(level.p[0], level.q[0]) + 0.5 && x < Math.max(level.p[0], level.q[0]) - 0.5;
      const along = y > Math.min(upright.p[1], upright.q[1]) + 0.5 && y < Math.max(upright.p[1], upright.q[1]) - 0.5;
      if (across && along) found.push(`${layout.lines[level.index]!.from}>${layout.lines[level.index]!.to} x ${layout.lines[upright.index]!.from}>${layout.lines[upright.index]!.to}`);
    }
  }
  return found;
}

test("each box stands under those it works with, and the arrows of a small team never cross", () => {
  for (const width of [696, 900]) {
    const layout = layoutTeam(team, flows, width, measure);
    expect(crossings(layout), `${width}`).toEqual([]);
    const at = (id: string) => layout.nodes.find(node => node.box.id === id)!.box;
    // 小晴 has one colleague above it, 拉斐爾: it stands right under him.
    expect(at("q").x).toBe(at("r").x);
  }
});

test("a narrow page wraps a wide rank and keeps every box inside it", () => {
  const wide: ReportNode[] = [{ id: "o", owner: true }, ...[1, 2, 3, 4, 5].map(id => ({ id: `m${id}`, member_id: id }))];
  const fan: ReportEdge[] = [1, 2, 3, 4, 5].map(id => ({ from: "o", to: `m${id}`, label: `工作 ${id}` }));
  for (const width of [696, 420, 300]) {
    const layout = layoutTeam(wide, fan, width, measure);
    checkLayout(layout, wide, fan);
    expect(layout.width).toBeLessThanOrEqual(Math.max(width, 168 + 48));
  }
});

test("boxes nobody is joined to wait on the last row, and a team with no arrows is one row", () => {
  const layout = layoutTeam([...team, { id: "x", name: "客戶" }], flows, 900, measure);
  expect(layout.nodes.find(node => node.box.id === "x")!.row).toBe(3);
  const alone = layoutTeam(team, [], 1200, measure);
  expect(new Set(alone.nodes.map(node => node.row))).toEqual(new Set([0]));
  expect(alone.lines).toEqual([]);
});

// ---------- the page in the conversation's place ----------

/** A conversation pane as the app draws it: its header with the search at the top left and the member's share at the top right, and its stage. */
function conversation() {
  const pane = document.createElement("section");
  pane.className = "mb-chat";
  pane.innerHTML = `<div class="page-head mb-head"><span class="mb-head-l"><button type="button" class="btn icon" data-act="search"></button></span>` +
    `<div class="ra-tools"><button type="button" class="btn icon" data-act="share-member"></button></div></div>` +
    `<div class="ra-stage"><div class="ra-scroll"><ol class="thread"></ol></div><div class="ra-dock"><textarea></textarea></div></div>`;
  document.body.append(pane);
  const stage = pane.querySelector<HTMLElement>(".ra-stage")!;
  const thread = stage.querySelector<HTMLElement>(".thread")!;
  thread.innerHTML = `<li>${pageCardsHTML({ pages: [page] } as unknown as AgentTurn)}</li>`;
  const pages = mountPages(thread, { place: () => true, people: () => people });
  pages.sync();
  return { stage, thread, pages };
}

test("a report is a link card in the reply, with its icon, its title and 「頁面」, and no frame", () => {
  const { thread } = conversation();
  const link = thread.querySelector<HTMLButtonElement>("button.pg-link")!;
  expect(link.classList.contains("attachment-file")).toBe(true);
  expect(link.querySelector(".me-file-t")!.textContent).toBe("團隊總覽報告");
  expect(link.querySelector("small")!.textContent).toBe("頁面");
  expect(link.querySelector("svg.i")).not.toBeNull();
  expect(thread.querySelector("iframe, .pg-card")).toBeNull();
});

test("the link opens the report in the thread's place with the composer below, and the header's arrow brings the thread back", async () => {
  const { stage, thread } = conversation();
  const link = thread.querySelector<HTMLButtonElement>("button.pg-link")!;
  link.click();
  await flush();
  const view = stage.querySelector<HTMLElement>(".pgv")!;
  expect(api.reportOpen).toHaveBeenCalledWith("r1");
  expect(stage.classList.contains("is-page") && stage.dataset.pageKind === "report" && !view.hidden).toBe(true);
  expect(view.nextElementSibling!.classList.contains("ra-dock")).toBe(true);
  expect(view.querySelector("h1")!.textContent).toBe("團隊總覽報告");
  // The way back is the conversation header's, at its top left: no × over the page.
  const back = document.querySelector<HTMLButtonElement>(".mb-head-l > [data-page-back]")!;
  expect(back.hidden).toBe(false);
  expect(view.querySelector("[data-report-act=close], .rp-close")).toBeNull();
  back.click();
  expect(stage.classList.contains("is-page") || !view.hidden || !back.hidden).toBe(false);
  expect(document.activeElement).toBe(link);
});

test("a tab shows only its group's rows", async () => {
  const { stage, thread } = conversation();
  thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  const view = stage.querySelector<HTMLElement>(".rp-view")!;
  view.querySelector<HTMLButtonElement>('[data-report-tab="g1"]')!.click();
  expect([...view.querySelectorAll<HTMLTableRowElement>(".rp-table tbody tr")].map(row => row.hidden)).toEqual([true, true, false]);
  expect(view.querySelector('[data-report-tab="g1"]')!.getAttribute("aria-selected")).toBe("true");
  view.querySelector<HTMLButtonElement>('[data-report-tab="all"]')!.click();
  expect([...view.querySelectorAll<HTMLTableRowElement>(".rp-table tbody tr")].some(row => row.hidden)).toBe(false);
});

test("sending keeps the report open, a card that leaves the thread closes it, and a changed report is drawn again", async () => {
  const first = conversation();
  first.thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  vi.spyOn(api, "pagesViewing").mockResolvedValue({ viewing: "r1" });
  await first.pages.sent();
  expect(api.pagesViewing).toHaveBeenCalledWith("r1");
  expect(first.stage.classList.contains("is-page")).toBe(true);
  first.pages.close();
  expect(first.stage.classList.contains("is-page")).toBe(false);

  first.thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  vi.mocked(api.reportOpen).mockResolvedValue({ kind: "report", title: "團隊總覽報告（更新）", rev: 2, report });
  first.thread.innerHTML = `<li>${pageCardsHTML({ pages: [{ ...page, rev: 2 }] } as unknown as AgentTurn)}</li>`;
  await flush();
  await flush();
  expect(first.stage.querySelector(".rp-view h1")!.textContent).toBe("團隊總覽報告（更新）");
  first.thread.replaceChildren();
  await flush();
  expect(first.stage.classList.contains("is-page")).toBe(false);
});

test("a report that cannot open says so and leaves the thread where it is", async () => {
  vi.mocked(api.reportOpen).mockRejectedValue({ kind: "not_found" });
  const { stage, thread } = conversation();
  thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  expect(stage.classList.contains("is-page")).toBe(false);
  expect(document.querySelector(".toast")?.textContent ?? "").toContain("這個頁面打不開。");
});

// ---------- shared as a file ----------

const look = { style: "body{margin:0}", font: "12px sans-serif" };
const lastToast = (): string => [...document.querySelectorAll(".toast")].pop()?.textContent ?? "";

test("shared, a report is one file of the same drawing: its policy first, every word escaped, no tabs, the team drawn for each width", () => {
  const file = reportFile("報告 <img src=x>", report, people, look);
  expect(file.startsWith(`<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FILE_POLICY}">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>報告 &lt;img src=x&gt;</title><style>body{margin:0}</style></head>`)).toBe(true);
  expect(FILE_POLICY).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'");
  const doc = new DOMParser().parseFromString(file, "text/html");
  expect(doc.querySelector("article.rp-doc h1")!.textContent).toBe("報告 <img src=x>");
  expect(doc.querySelectorAll("script, img, i, iframe, button, [data-report-tab]")).toHaveLength(0);
  // Every row, as 「全部」 shows them, and the contents as links within the page.
  expect(doc.querySelectorAll(".rp-table tbody tr")).toHaveLength(3);
  expect([...doc.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(["#rp-s0", "#rp-s1", "#rp-s2"]);
  // The team drawn three times, widest first, each no wider than the column that shows it.
  const drawings = [...doc.querySelectorAll<HTMLElement>(".rp-team > .rp-team-at")];
  expect(drawings.map(drawing => drawing.dataset.at)).toEqual(["0", "1", "2"]);
  const widths = drawings.map(drawing => Number.parseFloat(drawing.querySelector<HTMLElement>(".rp-team-draw")!.style.width));
  [704, 480, 300].forEach((most, index) => expect(widths[index]).toBeLessThanOrEqual(most));
  for (const drawing of drawings) expect(drawing.querySelectorAll(".rp-node")).toHaveLength(3);
  expect(new Set(drawings.map(drawing => drawing.querySelector("marker")!.id)).size).toBe(3);
  expect(doc.querySelector(".rp-notes dd")!.textContent).toBe("客戶來信 <i>沒有人負責</i>");
});

test("every element and attribute of a file is one the core takes, under the same policy", () => {
  // The core writes a file only of this drawing (agent/report_page.py `checked_file`): a tag it does not know would
  // fail every share, so its lists are read here from its source.
  const core = readFileSync(resolve(import.meta.dirname, "../../../core/src/raphael_core/agent/report_page.py"), "utf8");
  const listed = (name: string): Set<string> => new Set(core.match(new RegExp(`${name} = frozenset\\(([\\s\\S]*?)\\.split\\(\\)\\)`))![1]!
    .match(/"[^"]*"/g)!.flatMap(part => part.slice(1, -1).split(/\s+/).filter(Boolean)));
  const tags = listed("_FILE_TAGS"), attributes = listed("_FILE_ATTRIBUTES");
  expect(tags.has("svg") && attributes.has("viewbox")).toBe(true);
  expect(core).toContain(`FILE_POLICY = "${FILE_POLICY}"`);
  // The team report and a daily overview with tiles and every kind of chart (R-PAGE-04).
  for (const shown of [report, dashboard, document_]) {
    const file = reportFile("報告", shown, people, look);
    expect(core).toContain(file.match(/<meta name="viewport"[^>]*>/)![0]);
    const drawn = [...new DOMParser().parseFromString(file, "text/html").body.querySelectorAll("*")];
    expect(drawn.map(element => element.tagName.toLowerCase()).filter(tag => !tags.has(tag))).toEqual([]);
    expect(drawn.flatMap(element => [...element.attributes].map(attribute => attribute.name.toLowerCase()))
      .filter(name => !attributes.has(name) && !/^data-[a-z0-9-]+$/.test(name))).toEqual([]);
    // A link goes within the page, or away to an https address a table's link cell names (R-PAGE-06).
    expect(drawn.flatMap(element => (element.hasAttribute("href") ? [element.getAttribute("href")!] : [])).every(href => href.startsWith("#") || href.startsWith("https://"))).toBe(true);
  }
  expect(reportFile("報告", dashboard, people, look)).toContain('class="rc-part"');
});

test("two half sections in a row stand side by side, and with no span anywhere two charts in a row do", () => {
  const chart = (labels: number, span?: "half"): ReportSection => ({ kind: "chart", type: "line", labels: Array.from({ length: labels }, (_, index) => `${index}`), series: [{ values: Array.from({ length: labels }, () => 1) }], ...(span ? { span } : {}) });
  const text: ReportSection = { kind: "text", text: "x" };
  expect([...halves([chart(5), chart(5), text, chart(5)])]).toEqual([0, 1]);
  expect([...halves([chart(5), chart(13), chart(5), chart(5)])]).toEqual([2, 3]);
  // A span given anywhere is the member's layout: only what it marks is paired, and a half alone takes the width.
  expect([...halves([chart(5), chart(5), { ...text, span: "half" }, chart(5, "half")])]).toEqual([2, 3]);
  expect([...halves([chart(5, "half"), text, chart(5, "half")])]).toEqual([]);
  const doc = document.createElement("div");
  doc.innerHTML = reportHTML("總覽", dashboard, people);
  expect([...doc.querySelectorAll<HTMLElement>('.rp-sec[data-span="half"]')].map(section => section.id)).toEqual(["rp-s1", "rp-s2", "rp-s5", "rp-s6", "rp-s7", "rp-s8"]);
  // Nine titles: the contents stand only beside the page, never above it.
  expect(doc.querySelector(".rp-toc")!.hasAttribute("data-many")).toBe(true);
  const short = document.createElement("div");
  short.innerHTML = reportHTML("報告", report, people);
  expect(short.querySelector(".rp-toc")!.hasAttribute("data-many")).toBe(false);
});

test("a file's style holds the theme's words its rules use, the dark ones on a dark screen alone, and never a tag", () => {
  const style = fileStyle({
    light: new Map([["--content", "#ffffff"], ["--ok", "var(--green)"], ["--green", "#15703f"], ["--never-used", "1px"]]),
    dark: new Map([["--content", "#0a0a0a"], ["--green", "#9fd7b5"]]),
  });
  expect(style.startsWith(":root{--content:#ffffff;--green:#15703f;--ok:var(--green);color-scheme:light}")).toBe(true);
  expect(style).toContain("@media screen and (prefers-color-scheme: dark){:root{--content:#0a0a0a;--green:#9fd7b5;color-scheme:dark}}");
  expect(style).not.toContain("--never-used");
  // The page's own rules come along, with one drawing of the team for each width, and the core refuses `<` in a style.
  expect(style).toContain('.rp-st[data-tone="ok"]');
  expect(style).toContain('@container (max-width: 703.98px){.rp-team-at[data-at="0"]{display:none}.rp-team-at[data-at="1"]{display:block}}');
  // A file has no conversation around it: its page takes a conversation's column itself.
  expect(style).toContain("--pa-colw:var(--layout-thread-max)");
  expect(style).not.toMatch(/[<]|\/\*/);
});

test("the theme's words are read from the window's own stylesheet: light, and what the dark theme changes", () => {
  const sheet = document.createElement("style");
  sheet.textContent = `:root { --content: #ffffff; --ui: "Inter", sans-serif; } :root[data-theme="dark"] { --content: #0a0a0a; } .rp-doc { --content: red; }`;
  document.head.append(sheet);
  try {
    const words = themeWords([sheet.sheet!]);
    expect(words.light.get("--content")).toBe("#ffffff");
    expect(words.light.get("--ui")).toContain("Inter");
    expect(words.dark.get("--content")).toBe("#0a0a0a");
    expect(words.dark.has("--ui")).toBe(false);
  } finally {
    sheet.remove();
  }
});

test("share saves the report on screen as a file, once a press, says where it went, and leaves the report open", async () => {
  const save = vi.spyOn(api, "reportSave").mockResolvedValue({ place: "downloads", folder: "Downloads" });
  const { stage, thread } = conversation();
  thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  const view = stage.querySelector<HTMLElement>(".rp-view")!;
  // Nothing floats over the report (owner, 2026-11-12: its place as Grok Bot's share): its one button stands first in the header's
  // tools at the top right, where the thread's share stands; its name is its only word, so its tooltip repeats nothing on screen.
  expect(view.querySelector("button.btn.icon, .rp-top, [data-report-act]")).toBeNull();
  const tools = document.querySelector<HTMLElement>(".mb-head > .ra-tools")!;
  const buttons = [...tools.querySelectorAll<HTMLButtonElement>(":scope > button.btn.icon[data-page-act]")];
  expect(buttons.map(button => [button.getAttribute("aria-label"), button.textContent])).toEqual([["存成檔案", ""]]);
  expect(tools.firstElementChild).toBe(buttons[0]);
  // It saves a file, so it is drawn as one with an arrow into it, never as the arrow out of a box that shares a member (owner, 2026-11-11).
  const drawn = (html: string): string[] => [...html.matchAll(/ d="([^"]+)"/g)].map(found => found[1]!);
  expect(drawn(buttons[0]!.innerHTML)).toEqual(drawn(ico("fileDown")));
  expect(drawn(ico("fileDown"))).not.toEqual(drawn(ico("share")));
  buttons[0]!.click();
  buttons[0]!.click();
  await flush();
  expect(save).toHaveBeenCalledTimes(1);
  const [id, file] = save.mock.calls[0]!;
  expect(id).toBe("r1");
  expect(file).toContain("<title>團隊總覽報告</title>");
  expect(file).toContain('class="rp-team-at"');
  expect(lastToast()).toBe("已存到「下載」");
  expect(stage.classList.contains("is-page") && view.isConnected && !stage.querySelector<HTMLElement>(".pgv")!.hidden).toBe(true);

  save.mockResolvedValue({ place: "output", folder: "Raphael 輸出" });
  buttons[0]!.click();
  await flush();
  expect(lastToast()).toBe("已存到「Raphael 輸出」");
  save.mockRejectedValue(new Error("[1005] The page is gone"));
  buttons[0]!.click();
  await flush();
  expect(lastToast()).toBe("檔案沒有存成，請再試一次。");
  expect(save).toHaveBeenCalledTimes(3);
  // Back on the thread the place is the thread's again: the report's button is gone, not hidden.
  document.querySelector<HTMLButtonElement>(".mb-head-l > [data-page-back]")!.click();
  expect(tools.querySelector("[data-page-act]")).toBeNull();
  expect([...tools.children].map(tool => (tool as HTMLElement).dataset.act)).toEqual(["share-member"]);
});

test("the view works as a plain stage too, with nothing of the thread's own", async () => {
  const stage = document.createElement("div");
  stage.innerHTML = `<div class="ra-dock"></div>`;
  document.body.append(stage);
  const view = mountReportView(mountPageView(stage), () => people);
  await view.open("r1");
  expect(view.shown()).toEqual({ id: "r1", rev: 1 });
  view.close();
  expect(view.shown()).toBeNull();
});
