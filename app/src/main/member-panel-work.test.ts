// @vitest-environment happy-dom
// The member panel's Library, as Grok Bot's: only what the member delivered, four chips always, the items grouped by
// recency and each group one card of one-line rows (a 20 px mark and the title).
import { expect, test } from "vitest";
import { panelLibraryHTML, type LibraryItem } from "./member-panel-work";

const NOW = new Date(2026, 10, 8, 15, 0).getTime();
const item = (id: string, kind: LibraryItem["kind"], title: string, at: number, more: Partial<LibraryItem> = {}): LibraryItem => {
  const d = new Date(at);
  return { id, kind, title, at_ms: at, day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, ...more };
};
const parse = (html: string): HTMLElement => { const host = document.createElement("div"); host.innerHTML = html; return host; };
const hour = 3_600_000;
const mixed = [
  item("attachment:a.png", "image", "Sketch.png", NOW - hour, { attachment_id: "a".repeat(32) + ".png" }),
  item("page:p", "page", "Weekly page", NOW - 2 * hour, { turn_id: 4 }),
  item("delivered-file:z", "archive", "Bundle.zip", NOW - 26 * hour),
  item("attachment:v.mp4", "video", "Run.mp4", NOW - 3 * 24 * hour),
  item("link:l", "link", "https://example.com/report", NOW - 27 * hour, { url: "https://example.com/report" }),
  item("delivered-file:old", "document", "Notes.md", NOW - 10 * 24 * hour),
];

test("groups by recency, newest first, each group one card of one-line rows: a mark and the title, nothing else", () => {
  const page = parse(panelLibraryHTML({ has_more: true, files: mixed }, false, NOW));
  const groups = [...page.querySelectorAll<HTMLElement>(".lib-group")];
  expect(groups.map(group => [group.dataset.group, group.querySelector(".mb-dh")!.textContent])).toEqual([["today", "今天"], ["yesterday", "昨天"], ["week", "過去一週"], ["older", "更早"]]);
  expect(groups.every(group => group.querySelectorAll(":scope > .lib-card").length === 1)).toBe(true);
  const rows = [...page.querySelectorAll<HTMLElement>(".lib-card > .lib-row")];
  expect(rows.map(row => [row.tagName, row.dataset.panelFile, row.querySelector<HTMLElement>(".lib-icon")!.dataset.kind, row.querySelector(".lib-title")!.textContent]))
    .toEqual([["BUTTON", "attachment:a.png", "image", "Sketch.png"], ["BUTTON", "page:p", "page", "Weekly page"], ["BUTTON", "delivered-file:z", "archive", "Bundle.zip"],
      ["BUTTON", "attachment:v.mp4", "video", "Run.mp4"], ["BUTTON", "delivered-file:old", "document", "Notes.md"]]);
  // A picture's mark is its own thumbnail (read back like a chat attachment's); every other mark is its kind's icon.
  expect(rows[0]!.querySelector<HTMLImageElement>(".lib-icon.lib-thumb > img")!.dataset.attachment).toBe("a".repeat(32) + ".png");
  expect(rows.slice(1).every(row => row.querySelector(".lib-icon > svg.i") && !row.querySelector("img, time"))).toBe(true);
  // Different kinds wear different marks.
  const marks = rows.slice(1).map(row => row.querySelector(".lib-icon")!.innerHTML);
  expect(new Set(marks).size).toBe(marks.length);
  // Never a 「顯示更多」, even when the core says there is more.
  expect(page.querySelector("[data-panel-more], .lib-more")).toBeNull();
  expect(page.querySelector(".team-file, .lib-pic, time")).toBeNull();
});

test("a group the data has nothing for is not drawn", () => {
  const page = parse(panelLibraryHTML({ has_more: false, files: [item("delivered-file:n", "document", "Notes.md", NOW - 8 * 24 * hour), item("page:p", "page", "Plan", NOW - 3 * hour), item("page:q", "page", "Older plan", NOW - 40 * 24 * hour)] }, false, NOW));
  expect([...page.querySelectorAll<HTMLElement>(".lib-group")].map(group => group.dataset.group)).toEqual(["today", "older"]);
  expect([...page.querySelectorAll(".lib-group[data-group=older] .lib-title")].map(title => title.textContent)).toEqual(["Notes.md", "Older plan"]);
});

test("links are never shown, and the four chips (全部, 頁面, 媒體, 檔案) narrow the list", () => {
  const all = parse(panelLibraryHTML({ files: mixed, has_more: false }, false, NOW));
  expect(all.textContent).not.toContain("example.com");
  expect([...all.querySelectorAll<HTMLElement>(".lib-filters [data-lib-filter]")].map(b => [b.textContent, b.dataset.libFilter, b.getAttribute("aria-pressed")]))
    .toEqual([["全部", "all", "true"], ["頁面", "pages", "false"], ["媒體", "media", "false"], ["檔案", "files", "false"]]);
  const ids = (filter: "pages" | "media" | "files") => [...parse(panelLibraryHTML({ files: mixed, has_more: false }, false, NOW, filter)).querySelectorAll<HTMLElement>("[data-panel-file]")].map(b => b.dataset.panelFile);
  expect(ids("pages")).toEqual(["page:p"]);
  expect(ids("media")).toEqual(["attachment:a.png", "attachment:v.mp4"]);
  expect(ids("files")).toEqual(["delivered-file:z", "delivered-file:old"]);
  const files = parse(panelLibraryHTML({ files: mixed, has_more: false }, false, NOW, "files"));
  expect([...files.querySelectorAll<HTMLElement>("[data-lib-filter]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.textContent)).toEqual(["檔案"]);
});

test("the four chips are always there, and a kind with nothing in it is one quiet line", () => {
  const chips = (html: string) => [...parse(html).querySelectorAll<HTMLElement>(".lib-filters [data-lib-filter]")].map(b => [b.textContent, b.dataset.libFilter]);
  const four = [["全部", "all"], ["頁面", "pages"], ["媒體", "media"], ["檔案", "files"]];
  // One kind alone (the owner's case), two kinds, links alone, nothing yet, loading and failed: always the same four, in order.
  for (const files of [[mixed[2]!, mixed[5]!], [mixed[0]!, mixed[2]!], [mixed[4]!], [], mixed]) expect(chips(panelLibraryHTML({ files, has_more: false }, false, NOW))).toEqual(four);
  expect(chips(panelLibraryHTML(null, false, NOW))).toEqual(four);
  expect(chips(panelLibraryHTML(null, true, NOW))).toEqual(four);
  // A chip of a kind the member has not delivered is one quiet line in the cards' place, never a blank and never the 全部 sentence.
  const filesOnly = { files: [mixed[2]!, mixed[5]!], has_more: false };
  for (const [filter, line] of [["pages", "還沒有頁面"], ["media", "還沒有媒體"]] as const) {
    const page = parse(panelLibraryHTML(filesOnly, false, NOW, filter));
    expect([...page.querySelectorAll(".mp-empty")].map(p => p.textContent)).toEqual([line]);
    expect(page.querySelector(".lib-group, .lib-card, [data-panel-file]")).toBeNull();
    expect(page.querySelector(".lib-filters + .mp-empty")).not.toBeNull();
    expect([...page.querySelectorAll<HTMLElement>("[data-lib-filter]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.libFilter)).toEqual([filter]);
  }
  expect(parse(panelLibraryHTML(filesOnly, false, NOW, "files")).querySelectorAll("[data-panel-file]").length).toBe(2);
  expect(parse(panelLibraryHTML({ files: [mixed[0]!], has_more: false }, false, NOW, "files")).querySelector(".mp-empty")!.textContent).toBe("還沒有檔案");
  // 全部 keeps its own sentence when there is nothing at all (links alone are nothing to show), and loading and failed keep theirs.
  for (const files of [[], [mixed[4]!]]) expect(parse(panelLibraryHTML({ files, has_more: false }, false, NOW)).querySelector(".mp-empty")!.textContent).toBe("還沒有檔案或頁面");
  expect(parse(panelLibraryHTML(null, true, NOW)).querySelector(".mp-empty")!.textContent).toBe("無法讀取，請再試一次");
  expect(parse(panelLibraryHTML(null, false, NOW)).querySelector(".mp-empty")!.textContent).not.toBe("");
  // Whatever the filter says, an unknown one falls back to 全部.
  expect(parse(panelLibraryHTML(filesOnly, false, NOW, "nothing" as never)).querySelectorAll("[data-panel-file]").length).toBe(2);
});

test("a delivered picture with no stored copy keeps its icon as the mark; an empty or failed Library says so in one line", () => {
  const mark = parse(panelLibraryHTML({ has_more: false, files: [item("delivered-file:shot", "image", "Shot.png", NOW)] }, false, NOW));
  expect(mark.querySelector(".lib-icon img")).toBeNull();
  expect(mark.querySelector(".lib-icon[data-kind=image] > svg.i")).not.toBeNull();
  expect(parse(panelLibraryHTML({ files: [], has_more: false }, false, NOW)).querySelector(".mp-empty")!.textContent).toBe("還沒有檔案或頁面");
  expect(parse(panelLibraryHTML(null, true, NOW)).querySelector(".mp-empty")).not.toBeNull();
});
