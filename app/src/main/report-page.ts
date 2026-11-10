// A report page a member shows (core agent/report_page.py), drawn here in the app's own design and theme. The owner
// asked for Grok Bot's Page (2026-11-09: 「grokbot 甚至可以在內部做報告 挺猛的」「還有這種圖 也挺好的」): a link card in the
// conversation that opens the page in the conversation's place, the composer staying below it. The page is a title,
// the time its data is from and the promise that it only states recorded facts, its contents, findings with coloured
// status words under a summary box, tables with tabs for their groups, and the team as boxes in each member's colour
// joined by labelled arrows. Everything in it is the member's plain text, escaped here: no markup or script of a model
// ever runs, so a report needs no frame (R-PAGE-01).
import "./report-page.css";
import * as api from "./api";
import { formatClock, formatDate } from "./format";
import { t } from "./i18n";
import { ownerName } from "./owner-avatar";
import type { Report, ReportEdge, ReportItem, ReportNode, ReportRow, ReportSection, ReportStatus } from "./types";
import { esc, ico, iconButton, tabs, toaster } from "./ui";

/** Who a member is on a report: its name and its colour, as the conversation's own roster has them now. */
export interface ReportPeople {
  nameOf(id: number): string;
  colorOf(id: number): string;
}

const STATUS_WORDS = {
  running: "page.status.running", done: "page.status.done", pending: "page.status.pending", waiting: "page.status.waiting",
  blocked: "page.status.blocked", paused: "page.status.paused", failed: "page.status.failed",
} as const satisfies Record<ReportStatus, string>;
/** The colour a status word takes: the theme's own good, waiting and error colours, or its third grey. */
const TONES: Record<ReportStatus, "ok" | "warn" | "err" | "muted"> = {
  running: "ok", done: "ok", pending: "warn", waiting: "warn", blocked: "err", failed: "err", paused: "muted",
};

const statusHTML = (status: ReportStatus, label?: string): string =>
  `<span class="rp-st" data-tone="${TONES[status]}">${esc(label || t(STATUS_WORDS[status]))}</span>`;

/** The time the report's data is from, in the window's language: 「資料截至 2026/11/10 09:30」. */
function subtitle(report: Report): string {
  const at = Date.parse(report.as_of);
  const facts = t("page.report.facts");
  return Number.isFinite(at) ? `${t("page.report.asOf", { p0: `${formatDate(at)} ${formatClock(at)}` })} · ${facts}` : facts;
}

function findingsHTML(section: Extract<ReportSection, { kind: "findings" }>): string {
  const statuses = section.items.some(item => item.status);
  const item = (entry: ReportItem): string => `<li>${statuses ? `<span class="rp-item-st">${entry.status ? statusHTML(entry.status, entry.label) : ""}</span>` : ""}` +
    `<div class="rp-item-t"><b>${esc(entry.title)}</b>${entry.text ? `<span>${esc(entry.text)}</span>` : ""}</div></li>`;
  return (section.callout ? `<div class="rp-callout">${ico("info")}<p>${esc(section.callout)}</p></div>` : "") +
    (section.items.length ? `<ul class="rp-items${statuses ? " has-status" : ""}">${section.items.map(item).join("")}</ul>` : "");
}

function tableHTML(section: Extract<ReportSection, { kind: "table" }>, people: ReportPeople): string {
  const groups = [...new Set(section.rows.flatMap(row => (row.group ? [row.group] : [])))];
  const statuses = section.rows.some(row => row.status);
  const columns = [...section.columns, ...(statuses ? [section.status_title || t("page.report.status")] : [])];
  // A tab per group, as Grok Bot's report has over its table; only where there is more than one group to choose.
  const filter = groups.length > 1 ? tabs([
    { id: "all", label: t("page.report.all"), count: section.rows.length, attrs: ' data-report-tab="all"' },
    ...groups.map((group, index) => ({ id: `g${index}`, label: group, count: section.rows.filter(row => row.group === group).length, attrs: ` data-report-tab="g${index}"` })),
  ], "all", { label: section.title || t("page.report.all"), kind: "nav", plain: true }) : "";
  // A cell's words are one piece, so a narrow page can set its column's name beside them.
  const cell = (row: ReportRow, value: string, index: number): string => {
    const dot = index === 0 && row.member_id !== undefined ? `<span class="rp-dot" style="--rp-c:${esc(people.colorOf(row.member_id))}"></span>` : "";
    return `<td data-col="${esc(columns[index] ?? "")}"><span>${dot}${esc(value)}</span></td>`;
  };
  const rows = section.rows.map(row => `<tr${row.group ? ` data-group="g${groups.indexOf(row.group)}"` : ""}>` +
    row.cells.map((value, index) => cell(row, value, index)).join("") +
    (statuses ? `<td data-col="${esc(columns[columns.length - 1]!)}"><span>${row.status ? statusHTML(row.status, row.label) : ""}</span></td>` : "") + `</tr>`).join("");
  return `<div class="rp-table-box">${filter}<table class="rp-table"><thead><tr>${columns.map(name => `<th scope="col">${esc(name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** What a team box says: a member by its current name, the owner by the owner's own, anyone else by the given name. */
function nodeName(node: ReportNode, people: ReportPeople): string {
  if (node.member_id !== undefined) return people.nameOf(node.member_id) || t("page.report.gone");
  return node.owner ? ownerName() : node.name ?? "";
}

function teamHTML(section: Extract<ReportSection, { kind: "team" }>, index: number, people: ReportPeople): string {
  const names = new Map(section.nodes.map(node => [node.id, nodeName(node, people)]));
  // Read aloud as the arrows say it: 「主人 → 拉斐爾：交辦」.
  const said = section.edges.map(edge => `${names.get(edge.from)} → ${names.get(edge.to)}${edge.label ? `: ${edge.label}` : ""}`).join("; ");
  const notes = section.notes?.length ? `<dl class="rp-notes">${section.notes.map(note => `<div><dt>${esc(note.label)}</dt><dd>${esc(note.text)}</dd></div>`).join("")}</dl>` : "";
  return `<div class="rp-team" data-report-team="${index}" role="img" aria-label="${esc(said || [...names.values()].join(", "))}"></div>${notes}`;
}

function sectionHTML(section: ReportSection, index: number, people: ReportPeople): string {
  const body = section.kind === "findings" ? findingsHTML(section)
    : section.kind === "table" ? tableHTML(section, people)
    : section.kind === "team" ? teamHTML(section, index, people)
    : section.text.split("\n").filter(line => line.trim()).map(line => `<p class="rp-p">${esc(line)}</p>`).join("");
  return `<section class="rp-sec" id="rp-s${index}" data-kind="${section.kind}">${section.title ? `<h2 class="rp-h2">${esc(section.title)}</h2>` : ""}${body}</section>`;
}

/** The whole page but its team diagrams, which are laid out once their width is known (`layoutTeam`). */
export function reportHTML(title: string, report: Report, people: ReportPeople): string {
  const titled = report.sections.flatMap((section, index) => (section.title ? [{ title: section.title, index }] : []));
  const contents = t("page.report.contents");
  const toc = titled.length > 1 ? `<nav class="rp-toc" aria-label="${esc(contents)}"><span class="rp-toc-h">${esc(contents)}</span>` +
    titled.map(entry => `<a href="#rp-s${entry.index}" data-report-goto="rp-s${entry.index}">${esc(entry.title)}</a>`).join("") + `</nav>` : "";
  return `<header class="rp-head"><h1 class="rp-title">${esc(title)}</h1><p class="rp-sub">${esc(subtitle(report))}</p></header>${toc}` +
    `<div class="rp-body">${report.sections.map((section, index) => sectionHTML(section, index, people)).join("")}</div>`;
}

// ---------- the team diagram ----------

export interface Box { id: string; x: number; y: number; w: number; h: number }
export interface Placed { box: Box; row: number }
export interface Line { from: string; to: string; points: [number, number][]; label?: { text: string; x: number; y: number; w: number } }
export interface TeamLayout { width: number; height: number; nodes: Placed[]; lines: Line[] }

// SIDE leaves a lane free beside the outer boxes, for an arrow that passes a row on the outside.
const NODE_W = 168, NODE_H = 56, GAP_X = 56, GAP_Y = 72, SIDE = 44, TRACK = 24, LABEL_H = 20, CLEAR = 10, LANE_PAD = 6, NARROW = 64;

/** Ranks by the longest way in from the top, after the arrows that close a circle are set aside (they then go up). */
function rankNodes(ids: string[], edges: readonly ReportEdge[]): Map<string, number> {
  const out = new Map(ids.map(id => [id, [] as { to: string; index: number }[]]));
  edges.forEach((edge, index) => out.get(edge.from)?.push({ to: edge.to, index }));
  const state = new Map<string, 1 | 2>(), back = new Set<number>();
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const { to, index } of out.get(id) ?? []) {
      if (state.get(to) === 1) back.add(index);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  ids.forEach(id => { if (!state.has(id)) visit(id); });
  const forward = edges.filter((_, index) => !back.has(index));
  const rank = new Map(ids.map(id => [id, 0]));
  // At most twelve boxes: relaxing as many times as there are boxes settles every longest way.
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const edge of forward) {
      const wanted = rank.get(edge.from)! + 1;
      if (wanted > rank.get(edge.to)!) { rank.set(edge.to, wanted); moved = true; }
    }
    if (!moved) break;
  }
  // A box nobody is joined to waits on the last row, out of the way of those who work together.
  const joined = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const last = Math.max(0, ...[...rank.entries()].filter(([id]) => joined.has(id)).map(([, value]) => value));
  for (const id of ids) if (joined.size && !joined.has(id)) rank.set(id, last);
  return rank;
}

/** Orders each rank by where its neighbours stand, twice down and up, so fewer arrows cross. */
function orderRanks(layers: string[][], edges: readonly ReportEdge[]): void {
  const place = (): Map<string, number> => new Map(layers.flatMap(layer => layer.map((id, index) => [id, index - (layer.length - 1) / 2] as const)));
  const sweep = (index: number, toward: "up" | "down"): void => {
    const at = place(), layer = layers[index]!;
    const near = (id: string): number[] => edges.flatMap(edge => {
      const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null;
      if (other === null || !at.has(other)) return [];
      const otherLayer = layers.findIndex(entry => entry.includes(other));
      return (toward === "down" ? otherLayer < index : otherLayer > index) ? [at.get(other)!] : [];
    });
    const weight = new Map(layer.map(id => {
      const values = near(id);
      return [id, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : at.get(id)!] as const;
    }));
    layer.sort((a, b) => weight.get(a)! - weight.get(b)!);
  };
  for (let round = 0; round < 2; round++) {
    for (let index = 1; index < layers.length; index++) sweep(index, "down");
    for (let index = layers.length - 2; index >= 0; index--) sweep(index, "up");
  }
}

/** One horizontal stretch of an arrow in a gap between rows, with the uprights it meets above and below it. */
interface Span { key: number; from: number; to: number; up: number[]; down: number[] }

/**
 * Gives each horizontal stretch in one gap a track. Where an upright of one stretch stands inside another stretch, the
 * other goes on the side it does not cross (above an upright that goes down, below one that goes up); stretches that do
 * not overlap share a track. Track 0 is the top one.
 */
function tracks(spans: Span[]): { of: Map<number, number>; count: number } {
  const lo = (span: Span): number => Math.min(span.from, span.to), hi = (span: Span): number => Math.max(span.from, span.to);
  const inside = (x: number, span: Span): boolean => x > lo(span) + 0.5 && x < hi(span) - 0.5;
  const above = new Map(spans.map(span => [span.key, new Set<number>()]));
  spans.forEach((a, index) => spans.slice(index + 1).forEach(b => {
    if (lo(a) > hi(b) + CLEAR || lo(b) > hi(a) + CLEAR) return;
    for (const [one, other] of [[a, b], [b, a]] as const) {
      if (other.up.some(x => inside(x, one))) above.get(one.key)!.add(other.key);
      if (other.down.some(x => inside(x, one))) above.get(other.key)!.add(one.key);
    }
  }));
  const of = new Map<number, number>(), left = [...spans];
  while (left.length) {
    // The next stretch has every stretch that must be above it placed; on a circle, the one with the fewest waiting.
    const waiting = (span: Span): number => [...above.get(span.key)!].filter(key => !of.has(key) && key !== span.key).length;
    left.sort((a, b) => waiting(a) - waiting(b) || lo(a) - lo(b));
    const span = left.shift()!;
    const floor = Math.max(-1, ...[...above.get(span.key)!].filter(key => of.has(key)).map(key => of.get(key)!)) + 1;
    let track = floor;
    while (spans.some(other => of.get(other.key) === track && lo(other) <= hi(span) + CLEAR && lo(span) <= hi(other) + CLEAR)) track++;
    of.set(span.key, track);
  }
  return { of, count: of.size ? Math.max(...of.values()) + 1 : 0 };
}

/**
 * Places the boxes in rows (wrapping a rank that is wider than `width`), each under those it works with in the rows
 * above, and draws each arrow at right angles: down out of the bottom of one box into the top of the next, up for an
 * arrow that closes a circle, side to side between neighbours in a row, and through a free lane past the rows an arrow
 * skips. `measure` gives a label's width in px.
 */
export function layoutTeam(nodes: readonly ReportNode[], edges: readonly ReportEdge[], width: number, measure: (text: string) => number): TeamLayout {
  const ids = nodes.map(node => node.id);
  const nodeW = width >= 2 * NODE_W + GAP_X + 2 * SIDE ? NODE_W : Math.max(120, Math.min(240, width - 2 * SIDE));
  const pitch = nodeW + GAP_X;
  const perRow = Math.max(1, Math.floor((width - 2 * SIDE + GAP_X) / pitch));
  const rank = rankNodes(ids, edges);
  const layers: string[][] = [];
  for (const id of ids) (layers[rank.get(id)!] ??= []).push(id);
  const ranks = layers.filter(Boolean);
  orderRanks(ranks, edges);
  const rows = ranks.flatMap(layer => Array.from({ length: Math.ceil(layer.length / perRow) }, (_, index) => layer.slice(index * perRow, (index + 1) * perRow)));
  const widest = Math.max(...rows.map(row => row.length * nodeW + (row.length - 1) * GAP_X));
  const total = widest + 2 * SIDE;
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => row.forEach(id => rowOf.set(id, index)));

  // A box stands under the boxes it works with in the rows above, its row kept in order and its boxes apart.
  const centre = new Map<string, number>();
  const least = SIDE + nodeW / 2, most = total - SIDE - nodeW / 2;
  rows.forEach((row, index) => {
    const start = (total - (row.length * nodeW + (row.length - 1) * GAP_X)) / 2 + nodeW / 2;
    const slots = row.map((_, place) => start + place * pitch);
    const xs = row.map((id, place) => {
      // Only those who hand it work count: an arrow it sends up to close a circle does not pull it aside.
      const near = edges.flatMap(edge => (edge.to === id ? [edge.from] : []))
        .filter(other => centre.has(other) && rowOf.get(other)! < index);
      return near.length ? near.reduce((sum, other) => sum + centre.get(other)!, 0) / near.length : slots[place]!;
    });
    for (let pass = 0; pass < 32; pass++) {
      let moved = false;
      for (let place = 0; place + 1 < xs.length; place++) {
        const short = pitch - (xs[place + 1]! - xs[place]!);
        if (short > 0.5) { xs[place]! -= short / 2; xs[place + 1]! += short / 2; moved = true; }
      }
      if (!moved) break;
    }
    const low = xs[0]!, high = xs[xs.length - 1]!;
    const shift = low < least ? least - low : high > most ? most - high : 0;
    const placed = xs.map(x => x + shift);
    const fits = placed[0]! >= least - 0.5 && placed[placed.length - 1]! <= most + 0.5;
    row.forEach((id, place) => centre.set(id, fits ? placed[place]! : slots[place]!));
  });
  const xOf = (id: string): number => centre.get(id)! - nodeW / 2;

  // An arrow that skips rows goes down (or up) a lane free of their boxes: in the middle of a gap between boxes or past
  // them, as near the straight way as there is, and apart from the other lanes.
  const lanes: number[] = [];
  const lane = (between: number[], near: number): number => {
    const blocks = between.flatMap(index => rows[index]!.map(id => [xOf(id) - CLEAR, xOf(id) + nodeW + CLEAR] as const)).sort((a, b) => a[0] - b[0]);
    const free: [number, number][] = [];
    let edge = SIDE / 2;
    for (const [from, to] of blocks) { if (from > edge) free.push([edge, from]); edge = Math.max(edge, to); }
    if (edge < total - SIDE / 2) free.push([edge, total - SIDE / 2]);
    // A narrow gap between boxes is crossed down its middle; a wide one as near the straight way as it allows.
    const candidates = free.filter(([from, to]) => to - from >= 2 * LANE_PAD).flatMap(([from, to]) => to - from < NARROW ? [(from + to) / 2]
      : [Math.min(to - LANE_PAD, Math.max(from + LANE_PAD, near)), (from + to) / 2, from + LANE_PAD, to - LANE_PAD]);
    const chosen = candidates.filter(x => lanes.every(other => Math.abs(other - x) >= CLEAR))
      .sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0] ?? total - SIDE / 2;
    lanes.push(chosen);
    return chosen;
  };
  const laneOf = new Map<number, number>();
  edges.forEach((edge, index) => {
    const from = rowOf.get(edge.from)!, to = rowOf.get(edge.to)!;
    if (Math.abs(from - to) < 2) return;
    const between = Array.from({ length: Math.abs(from - to) - 1 }, (_, n) => Math.min(from, to) + 1 + n);
    laneOf.set(index, lane(between, (centre.get(edge.from)! + centre.get(edge.to)!) / 2));
  });

  // The ends of each arrow on the sides of its boxes, spread along a side in the order of where each arrow turns to.
  type Side = "top" | "bottom";
  const ends: { edge: number; node: string; side: Side; toward: number }[] = [];
  const kinds = edges.map((edge, index) => {
    const from = rowOf.get(edge.from)!, to = rowOf.get(edge.to)!;
    const toward = (other: string): number => laneOf.get(index) ?? centre.get(other)!;
    if (from !== to) {
      const down = from < to;
      ends.push({ edge: index, node: edge.from, side: down ? "bottom" : "top", toward: toward(edge.to) },
                { edge: index, node: edge.to, side: down ? "top" : "bottom", toward: toward(edge.from) });
      return down ? "down" : "up";
    }
    const row = rows[from]!;
    if (Math.abs(row.indexOf(edge.from) - row.indexOf(edge.to)) === 1) return "beside";
    ends.push({ edge: index, node: edge.from, side: "bottom", toward: centre.get(edge.to)! }, { edge: index, node: edge.to, side: "bottom", toward: centre.get(edge.from)! });
    return "under";
  });
  const portX = new Map<string, number>();
  const sides = new Map<string, typeof ends>();
  for (const end of ends) {
    const key = `${end.node}:${end.side}`;
    if (!sides.has(key)) sides.set(key, []);
    sides.get(key)!.push(end);
  }
  for (const list of sides.values()) {
    list.sort((a, b) => a.toward - b.toward || a.edge - b.edge)
      .forEach((end, place) => portX.set(`${end.edge}:${end.node}:${end.side}`, xOf(end.node) + nodeW * (place + 1) / (list.length + 1)));
  }
  // A nearly straight arrow between two rows is drawn straight, with no little step in it.
  edges.forEach((edge, index) => {
    if ((kinds[index] !== "down" && kinds[index] !== "up") || laneOf.has(index)) return;
    const down = kinds[index] === "down";
    const a = `${index}:${edge.from}:${down ? "bottom" : "top"}`, b = `${index}:${edge.to}:${down ? "top" : "bottom"}`;
    const x = (portX.get(a)! + portX.get(b)!) / 2;
    const inside = (id: string): boolean => x >= xOf(id) + 12 && x <= xOf(id) + nodeW - 12;
    if (Math.abs(portX.get(a)! - portX.get(b)!) < 12 && inside(edge.from) && inside(edge.to)) { portX.set(a, x); portX.set(b, x); }
  });
  const port = (edge: number, node: string, side: Side): number => portX.get(`${edge}:${node}:${side}`)!;

  // Each arrow as its stretches along the gaps it crosses, with the uprights each stretch meets above and below.
  interface Plan { edge: number; start: Side | "side"; end: Side | "side"; spans: (Span & { gap: number })[] }
  const plans: Plan[] = edges.map((edge, index) => {
    const from = rowOf.get(edge.from)!, to = rowOf.get(edge.to)!, kind = kinds[index];
    if (kind === "beside") return { edge: index, start: "side", end: "side", spans: [] };
    if (kind === "under") {
      const a = port(index, edge.from, "bottom"), b = port(index, edge.to, "bottom");
      return { edge: index, start: "bottom", end: "bottom", spans: [{ gap: from, key: index * 2, from: a, to: b, up: [a, b], down: [] }] };
    }
    const down = kind === "down";
    const a = port(index, edge.from, down ? "bottom" : "top"), b = port(index, edge.to, down ? "top" : "bottom");
    const first = down ? from : from - 1, last = down ? to - 1 : to;
    // Going down, a stretch meets the way it came from above it; going up, below it.
    const span = (gap: number, step: number, x: number, y: number): Span & { gap: number } =>
      ({ gap, key: index * 2 + step, from: x, to: y, up: [down ? x : y], down: [down ? y : x] });
    const x = laneOf.get(index);
    const spans = x === undefined ? [span(first, 0, a, b)] : [span(first, 0, a, x), span(last, 1, x, b)];
    return { edge: index, start: down ? "bottom" : "top", end: down ? "top" : "bottom", spans };
  });
  const gapCount = rows.length;
  const settled = Array.from({ length: gapCount }, (_, gap) => tracks(plans.flatMap(plan => plan.spans.filter(span => span.gap === gap))));
  // A gap is as tall as its tracks need; the gap under the last row is there only when an arrow runs under that row.
  const gapHeight = settled.map((gap, index) => (index === gapCount - 1 ? (gap.count ? (gap.count + 1) * TRACK : 0) : Math.max(GAP_Y, (gap.count + 1) * TRACK)));
  const top: number[] = [];
  rows.forEach((_, index) => { top.push(index ? top[index - 1]! + NODE_H + gapHeight[index - 1]! : 0); });
  const trackY = (gap: number, key: number): number => {
    const { of, count } = settled[gap]!;
    return top[gap]! + NODE_H + gapHeight[gap]! * ((of.get(key) ?? 0) + 1) / (count + 1);
  };

  const box = (id: string): Box => ({ id, x: xOf(id), y: top[rowOf.get(id)!]!, w: nodeW, h: NODE_H });
  const lines: Line[] = plans.map(plan => {
    const edge = edges[plan.edge]!, a = box(edge.from), b = box(edge.to);
    if (plan.start === "side") {
      // Neighbours in a row: straight across; a pair joined both ways keeps its two arrows apart.
      const both = edges.some(other => other.from === edge.to && other.to === edge.from);
      const right = a.x < b.x, y = a.y + NODE_H / 2 + (both ? (right ? -6 : 6) : 0);
      return { from: edge.from, to: edge.to, points: [[right ? a.x + a.w : a.x, y], [right ? b.x : b.x + b.w, y]] };
    }
    const points: [number, number][] = [[plan.spans[0]!.from, plan.start === "bottom" ? a.y + a.h : a.y]];
    for (const span of plan.spans) {
      const y = trackY(span.gap, span.key);
      points.push([span.from, y], [span.to, y]);
    }
    points.push([plan.spans[plan.spans.length - 1]!.to, plan.end === "bottom" ? b.y + b.h : b.y]);
    return { from: edge.from, to: edge.to, points: points.filter((point, index) => index === 0 || point[0] !== points[index - 1]![0] || point[1] !== points[index - 1]![1]) };
  });

  // A label sits on its arrow's longest stretch that holds it, moved along it until it covers no box and no other label.
  const height = top[top.length - 1]! + NODE_H + gapHeight[gapCount - 1]!;
  const boxes = ids.map(box);
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const overlaps = (rect: { x: number; y: number; w: number; h: number }): number =>
    [...boxes.map(item => ({ x: item.x - 4, y: item.y - 4, w: item.w + 8, h: item.h + 8 })), ...taken].reduce((sum, other) => {
      const dx = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x), dy = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
      return sum + (dx > 0 && dy > 0 ? dx * dy : 0);
    }, 0);
  lines.forEach((line, index) => {
    const text = edges[index]!.label;
    if (!text) return;
    const w = Math.ceil(measure(text)) + 16;
    const stretches = line.points.slice(1).map((point, step) => [line.points[step]!, point] as const)
      .map(([p, q]) => ({ p, q, length: Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]), flat: p[1] === q[1] }))
      .sort((s, r) => Number(r.flat && r.length >= w + 12) - Number(s.flat && s.length >= w + 12) || r.length - s.length);
    let best: { x: number; y: number; cost: number } | null = null;
    for (const stretch of stretches.slice(0, 3)) {
      const steps = Math.max(0, Math.floor((stretch.length - (stretch.flat ? w : LABEL_H)) / 2 / 8));
      for (let n = 0; n <= steps * 2; n++) {
        const shift = (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 8;
        const x = (stretch.p[0] + stretch.q[0]) / 2 + (stretch.flat ? shift : 0), y = (stretch.p[1] + stretch.q[1]) / 2 + (stretch.flat ? 0 : shift);
        const cost = overlaps({ x: x - w / 2, y: y - LABEL_H / 2, w, h: LABEL_H });
        if (!best || cost < best.cost) best = { x, y, cost };
        if (!cost) break;
      }
      if (best && !best.cost) break;
    }
    if (best) {
      line.label = { text, x: best.x, y: best.y, w };
      taken.push({ x: best.x - w / 2, y: best.y - LABEL_H / 2, w, h: LABEL_H });
    }
  });
  return { width: total, height, nodes: ids.map(id => ({ box: box(id), row: rowOf.get(id)! })), lines };
}

let markers = 0;
/** A label's width in the label's own font, measured once per text; an estimate where there is no canvas (tests). */
const widths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null | undefined;
function measureLabel(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  if (measurer === undefined) {
    try { measurer = document.createElement("canvas").getContext("2d"); } catch { measurer = null; }
  }
  let width: number;
  if (measurer) { measurer.font = font; width = measurer.measureText(text).width; }
  else width = [...text].reduce((sum, char) => sum + (/[⺀-￿]/.test(char) ? 12 : 7), 0);
  widths.set(key, width);
  return width;
}

function teamDiagramHTML(section: Extract<ReportSection, { kind: "team" }>, width: number, people: ReportPeople, font: string): string {
  const layout = layoutTeam(section.nodes, section.edges, width, text => measureLabel(text, font));
  const byId = new Map(section.nodes.map(node => [node.id, node]));
  const marker = `rp-arrow-${++markers}`;
  const path = (line: Line): string => `M${line.points.map(([x, y]) => `${Math.round(x * 2) / 2} ${Math.round(y * 2) / 2}`).join(" L")}`;
  const lines = layout.lines.map(line => `<path d="${path(line)}" marker-end="url(#${marker})"/>`).join("");
  const boxes = layout.nodes.map(({ box }) => {
    const node = byId.get(box.id)!;
    const colour = node.member_id !== undefined ? people.colorOf(node.member_id) : "var(--text-3)";
    return `<div class="rp-node" data-node="${esc(box.id)}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;--rp-c:${esc(colour)}">` +
      `<b>${esc(nodeName(node, people))}</b>${node.note ? `<small>${esc(node.note)}</small>` : ""}</div>`;
  }).join("");
  const labels = layout.lines.flatMap(line => (line.label ? [`<span class="rp-lab" style="left:${line.label.x}px;top:${line.label.y}px">${esc(line.label.text)}</span>`] : [])).join("");
  return `<div class="rp-team-draw" style="width:${layout.width}px;height:${layout.height}px">` +
    `<svg class="rp-lines" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">` +
    `<defs><marker id="${marker}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z"/></marker></defs>${lines}</svg>` +
    `${boxes}${labels}</div>`;
}

// ---------- the page in the conversation's place ----------

export interface ReportView {
  /** Shows the report in the conversation's place; `from` gets the focus back when it closes. */
  open(pageId: string, from?: HTMLElement | null): Promise<void>;
  close(): void;
  /** The report on screen and its revision, if one is. */
  shown(): { id: string; rev: number } | null;
  /** The same report again, where the owner was reading it, after its member changed it. */
  refresh(): Promise<void>;
}

/**
 * The report view of one conversation (a member's or a group's): it takes the thread's place in `stage` (the thread
 * keeps its place and scroll under it) and leaves the composer where it is, so the owner can ask for changes.
 */
export function mountReportView(stage: HTMLElement, people: () => ReportPeople): ReportView {
  let view: HTMLElement | null = null;
  let current: { id: string; rev: number; report: Report } | null = null;
  let opener: HTMLElement | null = null;
  let generation = 0;
  let drawnWidth = 0;

  function layout(force = false): void {
    if (!view || !current) return;
    const width = view.querySelector<HTMLElement>(".rp-body")?.clientWidth ?? 0;
    if (!width || (!force && width === drawnWidth)) return;
    drawnWidth = width;
    const sample = view.querySelector<HTMLElement>(".rp-h2") ?? view;
    const font = `12px ${getComputedStyle(sample).fontFamily}`;
    for (const team of view.querySelectorAll<HTMLElement>("[data-report-team]")) {
      const section = current.report.sections[Number(team.dataset.reportTeam)];
      if (section?.kind === "team") team.innerHTML = teamDiagramHTML(section, Math.min(width, 760), people(), font);
    }
  }

  /** What scrolls: the page under the × (`.rp-scroll`), never the view around it. */
  const scroller = (): HTMLElement | null => view?.querySelector<HTMLElement>(":scope > .rp-scroll") ?? null;

  function element(): HTMLElement {
    if (view) return view;
    view = document.createElement("div");
    view.className = "rp-view";
    view.setAttribute("role", "region");
    view.hidden = true;
    stage.insertBefore(view, stage.querySelector(":scope > .ra-dock"));
    view.addEventListener("click", event => {
      const target = event.target as Element;
      if (target.closest("[data-report-act=close]")) { close(); return; }
      const goto = target.closest<HTMLAnchorElement>("[data-report-goto]");
      if (goto) {
        event.preventDefault();
        const section = view!.querySelector<HTMLElement>(`#${CSS.escape(goto.dataset.reportGoto!)}`);
        // The section's title lands where the page's own title stands at rest, clear of the fade.
        if (section) scroller()?.scrollTo({ top: section.offsetTop - 40, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        return;
      }
      const tab = target.closest<HTMLButtonElement>("[data-report-tab]");
      if (tab) {
        const box = tab.closest<HTMLElement>(".rp-table-box")!, wanted = tab.dataset.reportTab!;
        box.querySelectorAll<HTMLButtonElement>("[data-report-tab]").forEach(other => other.setAttribute("aria-selected", String(other === tab)));
        box.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach(row => { row.hidden = wanted !== "all" && row.dataset.group !== wanted; });
      }
    });
    new ResizeObserver(() => layout()).observe(view);
    return view;
  }

  async function show(id: string, keep: boolean): Promise<void> {
    const mine = ++generation;
    let opened;
    try {
      opened = await api.reportOpen(id);
    } catch {
      if (mine === generation) toaster.show(t("page.failed"));
      return;
    }
    if (mine !== generation || opened?.kind !== "report") return;
    const host = element(), place = keep ? scroller()?.scrollTop ?? 0 : 0;
    current = { id, rev: opened.rev, report: opened.report };
    host.setAttribute("aria-label", opened.title);
    host.innerHTML = `<div class="rp-scroll" tabindex="-1"><article class="rp-doc">${reportHTML(opened.title, opened.report, people())}</article></div>` +
      `<div class="rp-top">${iconButton("x", t("page.report.back"), ' data-report-act="close"', "rp-close")}</div>`;
    host.hidden = false;
    stage.classList.add("is-report");
    layout(true);
    const page = scroller()!;
    page.scrollTop = place;
    // The page takes the keys, so the arrows and Page Down read it.
    if (!keep) page.focus({ preventScroll: true });
  }

  function close(): void {
    generation++;
    if (!view || view.hidden) return;
    view.hidden = true;
    view.replaceChildren();
    stage.classList.remove("is-report");
    current = null;
    drawnWidth = 0;
    const back = opener;
    opener = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  return {
    async open(pageId, from) { opener = from ?? null; await show(pageId, false); },
    close,
    shown: () => (current ? { id: current.id, rev: current.rev } : null),
    async refresh() { if (current) await show(current.id, true); },
  };
}
