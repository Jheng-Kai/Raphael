// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
import { mountPages, pageCardsHTML } from "./page-card";
import { layoutTeam, mountReportView, reportHTML, type TeamLayout } from "./report-page";
import type { AgentTurn, PageCard, Report, ReportEdge, ReportNode } from "./types";

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

function conversation() {
  const stage = document.createElement("div");
  stage.className = "ra-stage";
  stage.innerHTML = `<div class="ra-scroll"><ol class="thread"></ol></div><div class="ra-dock"><textarea></textarea></div>`;
  document.body.append(stage);
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

test("the link opens the report in the thread's place with the composer below, and the × brings the thread back", async () => {
  const { stage, thread } = conversation();
  const link = thread.querySelector<HTMLButtonElement>("button.pg-link")!;
  link.click();
  await flush();
  const view = stage.querySelector<HTMLElement>(".rp-view")!;
  expect(api.reportOpen).toHaveBeenCalledWith("r1");
  expect(stage.classList.contains("is-report") && !view.hidden).toBe(true);
  expect(view.nextElementSibling!.classList.contains("ra-dock")).toBe(true);
  expect(view.querySelector("h1")!.textContent).toBe("團隊總覽報告");
  view.querySelector<HTMLButtonElement>("[data-report-act=close]")!.click();
  expect(stage.classList.contains("is-report") || !view.hidden).toBe(false);
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

test("sending closes the report, a card that leaves the thread closes it, and a changed report is drawn again", async () => {
  const first = conversation();
  first.thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  first.pages.closeReport();
  expect(first.stage.classList.contains("is-report")).toBe(false);

  first.thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  vi.mocked(api.reportOpen).mockResolvedValue({ kind: "report", title: "團隊總覽報告（更新）", rev: 2, report });
  first.thread.innerHTML = `<li>${pageCardsHTML({ pages: [{ ...page, rev: 2 }] } as unknown as AgentTurn)}</li>`;
  await flush();
  await flush();
  expect(first.stage.querySelector(".rp-view h1")!.textContent).toBe("團隊總覽報告（更新）");
  first.thread.replaceChildren();
  await flush();
  expect(first.stage.classList.contains("is-report")).toBe(false);
});

test("a report that cannot open says so and leaves the thread where it is", async () => {
  vi.mocked(api.reportOpen).mockRejectedValue({ kind: "not_found" });
  const { stage, thread } = conversation();
  thread.querySelector<HTMLButtonElement>("button.pg-link")!.click();
  await flush();
  expect(stage.classList.contains("is-report")).toBe(false);
  expect(document.querySelector(".toast")?.textContent ?? "").toContain("這個頁面打不開。");
});

test("the view works as a plain stage too, with nothing of the thread's own", async () => {
  const stage = document.createElement("div");
  stage.innerHTML = `<div class="ra-dock"></div>`;
  document.body.append(stage);
  const view = mountReportView(stage, () => people);
  await view.open("r1");
  expect(view.shown()).toEqual({ id: "r1", rev: 1 });
  view.close();
  expect(view.shown()).toBeNull();
});
