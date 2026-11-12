import * as api from "./api";
import { dayNumber } from "./format";
import { t } from "./i18n";
import { esc, ico, tabs, type IconName } from "./ui";

// The member panel's Library, as Grok Bot's: only what the member delivered, never the screenshots and scratch files of
// its work. Four chips (全部 / 頁面 / 媒體 / 檔案, only the kinds there are), then the items grouped by recency, each
// group one rounded card of one-line rows: a 20 px mark (a picture's own thumbnail, else its kind's icon) and the title.
// A press opens it (`members.library`, brief 10).
export type LibraryKind = "document" | "page" | "image" | "video" | "audio" | "archive" | "file" | "link";
export interface LibraryItem {
  id: string;
  title: string;
  name?: string;
  kind: LibraryKind;
  mime?: string;
  at_ms: number;
  /** The day it was delivered, `YYYY-MM-DD` in the core's time zone. */
  day: string;
  turn_id?: number | null;
  conversation_id?: number | null;
  /** A delivered attachment's stored id (its picture loads like a chat attachment's). */
  attachment_id?: string;
  url?: string;
}
export interface PanelWork { files: LibraryItem[]; has_more: boolean }
/** Everything the member delivered at once (the core's bound): sorted and filtered here, never paged by a 「顯示更多」. */
export const LIBRARY_LIMIT = 100;
export const readPanelWork = (member: number, limit = LIBRARY_LIMIT): Promise<PanelWork> => api.core("members.library", { member_id: member, limit });

const ICONS: Record<LibraryKind, IconName> = { document: "fileText", page: "report", image: "image", video: "play", audio: "voice", archive: "fileArchive", file: "file", link: "link" };

/** A 20 px mark: a delivered picture's own thumbnail (loaded like a chat attachment's), else the icon of its kind. */
function markHTML(item: LibraryItem): string {
  if (item.kind === "image" && item.attachment_id) return `<span class="lib-icon lib-thumb" data-kind="image"><img data-attachment="${esc(item.attachment_id)}" alt=""></span>`;
  return `<span class="lib-icon" data-kind="${item.kind}">${ico(ICONS[item.kind] ?? "file")}</span>`;
}

function rowHTML(item: LibraryItem): string {
  return `<button type="button" class="btn lib-row" data-panel-file="${esc(item.id)}">${markHTML(item)}<span class="lib-title">${esc(item.title)}</span></button>`;
}

/** The Library's chips: 頁面 pages, 媒體 pictures, videos and audio, 檔案 documents, archives and other files. */
export type LibraryFilter = "all" | "pages" | "media" | "files";
const FILTER_OF: Record<LibraryKind, Exclude<LibraryFilter, "all"> | null> = {
  page: "pages", image: "media", video: "media", audio: "media", document: "files", archive: "files", file: "files", link: null,
};
const FILTER_KEYS = { all: "members.libraryAll", pages: "members.libraryPages", media: "members.libraryMedia", files: "members.libraryFiles" } as const;

/** The chips worth a press: the kinds there are, and 全部, only when there is more than one kind. */
export function libraryFilters(files: readonly LibraryItem[]): LibraryFilter[] {
  const kinds = (["pages", "media", "files"] as const).filter(kind => files.some(item => FILTER_OF[item.kind] === kind));
  return kinds.length > 1 ? ["all", ...kinds] : [];
}

/** Recency groups, newest first: today, yesterday, the rest of the past week, older. */
const GROUPS = [
  { id: "today", label: () => t("format.001") },
  { id: "yesterday", label: () => t("format.002") },
  { id: "week", label: () => t("members.libraryWeek") },
  { id: "older", label: () => t("members.libraryOlder") },
] as const;
function groupOf(at: number, now: number): (typeof GROUPS)[number]["id"] {
  const days = dayNumber(now) - dayNumber(at);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? "week" : "older";
}

export function panelLibraryHTML(work: PanelWork | null, failed: boolean, now = Date.now(), filter: LibraryFilter = "all"): string {
  // A link is no deliverable: a member is asked for it again.
  const all = (work?.files ?? []).filter(item => FILTER_OF[item.kind] !== null);
  if (!all.length) return `<p class="mp-empty">${esc(t(failed ? "members.panelReadFailed" : work ? "members.panelNoFiles" : "common.loading"))}</p>`;
  const filters = libraryFilters(all), shown = filters.includes(filter) ? filter : "all";
  const files = (shown === "all" ? all : all.filter(item => FILTER_OF[item.kind] === shown)).sort((a, b) => b.at_ms - a.at_ms);
  const bar = filters.length ? `<div class="lib-filters">${tabs(filters.map(id => ({ id, label: t(FILTER_KEYS[id]), attrs: ` data-lib-filter="${id}"` })), shown, { label: t("members.panelTab.library"), kind: "filter" })}</div>` : "";
  return bar + GROUPS.map(group => {
    const items = files.filter(item => groupOf(item.at_ms, now) === group.id);
    return items.length ? `<section class="lib-group" data-group="${group.id}"><div class="mb-dh">${esc(group.label())}</div><div class="lib-card">${items.map(rowHTML).join("")}</div></section>` : "";
  }).join("");
}
