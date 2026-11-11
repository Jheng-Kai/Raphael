// @vitest-environment happy-dom
// The member panel's Library: only what the member delivered, by day, pictures as thumbnails and every other
// deliverable a row with its kind's icon, title and time.
import { expect, test } from "vitest";
import { panelLibraryHTML, type LibraryItem } from "./member-panel-work";

const NOW = new Date(2026, 10, 8, 15, 0).getTime();
const item = (id: string, kind: LibraryItem["kind"], title: string, at: number, more: Partial<LibraryItem> = {}): LibraryItem => {
  const d = new Date(at);
  return { id, kind, title, at_ms: at, day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, ...more };
};
const parse = (html: string): HTMLElement => { const host = document.createElement("div"); host.innerHTML = html; return host; };

test("groups by day, newest first, with pictures as thumbnails and the rest as rows with their kind's icon, title and time", () => {
  const hour = 3_600_000;
  const page = parse(panelLibraryHTML({ has_more: true, files: [
    item("attachment:a.png", "image", "Sketch.png", NOW - hour, { attachment_id: "a".repeat(32) + ".png" }),
    item("page:p", "page", "Weekly page", NOW - 2 * hour, { turn_id: 4 }),
    item("delivered-file:z", "archive", "Bundle.zip", NOW - 26 * hour),
    item("link:l", "link", "https://example.com/report", NOW - 27 * hour, { url: "https://example.com/report" }),
    item("delivered-file:old", "document", "Notes.md", NOW - 10 * 24 * hour),
  ] }, false, NOW));
  const days = [...page.querySelectorAll(".lib-day")];
  expect(days.map(day => day.querySelector(".mb-dh")!.textContent)).toEqual(["今天", "昨天", "10 月 29 日"]);
  const picture = days[0]!.querySelector<HTMLElement>(".lib-pics .lib-pic")!;
  expect([picture.tagName, picture.dataset.panelFile, picture.querySelector("img")!.dataset.attachment]).toEqual(["BUTTON", "attachment:a.png", "a".repeat(32) + ".png"]);
  expect([...page.querySelectorAll<HTMLElement>(".lib-row")].map(row => [row.dataset.panelFile, row.querySelector<HTMLElement>(".lib-icon")!.dataset.kind, row.querySelector(".lib-title")!.textContent, row.querySelector("time")!.textContent]))
    .toEqual([["page:p", "page", "Weekly page", "13:00"], ["delivered-file:z", "archive", "Bundle.zip", "13:00"], ["delivered-file:old", "document", "Notes.md", "15:00"]]);
  // Never a 「顯示更多」, even when the core says there is more.
  expect(page.querySelector("[data-panel-more], .lib-more")).toBeNull();
  expect(page.querySelector(".team-file")).toBeNull();
});

test("links are never shown, and the kinds there are become one filter that narrows the list", () => {
  const files = [
    item("attachment:a.png", "image", "Shot.png", NOW, { attachment_id: "a".repeat(32) + ".png" }),
    item("attachment:v.mp4", "video", "Run.mp4", NOW - 1000),
    item("delivered-file:n", "document", "Notes.md", NOW - 2000),
    item("link:l", "link", "查看執行結果", NOW - 3000, { url: "https://example.com" }),
  ];
  const all = parse(panelLibraryHTML({ files, has_more: false }, false, NOW));
  expect(all.textContent).not.toContain("查看執行結果");
  expect([...all.querySelectorAll<HTMLElement>(".lib-filters [data-lib-filter]")].map(b => [b.textContent, b.getAttribute("aria-pressed")]))
    .toEqual([["全部", "true"], ["圖片", "false"], ["影片", "false"], ["檔案", "false"]]);
  const images = parse(panelLibraryHTML({ files, has_more: false }, false, NOW, "images"));
  expect([...images.querySelectorAll<HTMLElement>("[data-panel-file]")].map(b => b.dataset.panelFile)).toEqual(["attachment:a.png"]);
  // One kind alone needs no filter; links alone are nothing to show.
  expect(parse(panelLibraryHTML({ files: [files[2]!], has_more: false }, false, NOW)).querySelector(".lib-filters")).toBeNull();
  expect(parse(panelLibraryHTML({ files: [files[3]!], has_more: false }, false, NOW)).textContent).toBe("還沒有檔案或頁面");
});

test("a delivered picture with no stored copy keeps a tile with its icon; an empty or failed Library says so in one line", () => {
  const tile = parse(panelLibraryHTML({ has_more: false, files: [item("delivered-file:shot", "image", "Shot.png", NOW)] }, false, NOW));
  expect(tile.querySelector(".lib-pic img")).toBeNull();
  expect(tile.querySelector(".lib-pic .lib-tile-icon")).not.toBeNull();
  expect(parse(panelLibraryHTML({ files: [], has_more: false }, false, NOW)).textContent).toBe("還沒有檔案或頁面");
  expect(parse(panelLibraryHTML(null, true, NOW)).querySelector(".mp-empty")).not.toBeNull();
});
