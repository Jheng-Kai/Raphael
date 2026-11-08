import * as api from "./api";
import { dayLabel } from "./format";
import { getLocale, t } from "./i18n";
import { esc, ico, tabs, type IconName } from "./ui";

// The member panel's Library: only what the member delivered, never
// the screenshots and scratch files of its work. Grouped by day, newest first: pictures as thumbnails, every other
// deliverable as a row with its kind's icon, its title and the time. A press opens it (`members.library`, brief 10).
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

const ICONS: Record<LibraryKind, IconName> = { document: "file", page: "globe", image: "image", video: "play", audio: "voice", archive: "folder", file: "file", link: "link" };
const clock = (at: number): string => new Date(at).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });

/** A picture: its thumbnail when it is a delivered attachment, else its icon on the tile. */
function pictureHTML(item: LibraryItem): string {
  const inner = item.attachment_id ? `<img data-attachment="${esc(item.attachment_id)}" alt="">` : `<span class="lib-tile-icon">${ico("image")}</span>`;
  return `<button type="button" class="btn lib-pic" data-panel-file="${esc(item.id)}" data-title="${esc(item.title)}" aria-label="${esc(item.title)}">${inner}</button>`;
}

function rowHTML(item: LibraryItem): string {
  return `<button type="button" class="btn lib-row" data-panel-file="${esc(item.id)}"><span class="lib-icon" data-kind="${item.kind}">${ico(ICONS[item.kind] ?? "file")}</span>` +
    `<span class="lib-title">${esc(item.title)}</span><time datetime="${new Date(item.at_ms).toISOString()}">${esc(clock(item.at_ms))}</time></button>`;
}

/** The Library's kinds of deliverable. */
export type LibraryFilter = "all" | "images" | "videos" | "files";
const FILTER_OF: Record<LibraryKind, Exclude<LibraryFilter, "all"> | null> = {
  image: "images", video: "videos", document: "files", page: "files", archive: "files", file: "files", audio: "files", link: null,
};
const FILTER_KEYS = { all: "members.libraryAll", images: "members.libraryImages", videos: "members.libraryVideos", files: "members.libraryFiles" } as const;

/** The filters worth a press: the kinds there are, and 全部, only when there is more than one kind. */
export function libraryFilters(files: readonly LibraryItem[]): LibraryFilter[] {
  const kinds = (["images", "videos", "files"] as const).filter(kind => files.some(item => FILTER_OF[item.kind] === kind));
  return kinds.length > 1 ? ["all", ...kinds] : [];
}

export function panelLibraryHTML(work: PanelWork | null, failed: boolean, now = Date.now(), filter: LibraryFilter = "all"): string {
  // A link is no deliverable: a member is asked for it again.
  const all = (work?.files ?? []).filter(item => FILTER_OF[item.kind] !== null);
  if (!all.length) return `<p class="mp-empty">${esc(t(failed ? "members.panelReadFailed" : work ? "members.panelNoFiles" : "common.loading"))}</p>`;
  const filters = libraryFilters(all), shown = filters.includes(filter) ? filter : "all";
  const files = shown === "all" ? all : all.filter(item => FILTER_OF[item.kind] === shown);
  const bar = filters.length ? `<div class="lib-filters">${tabs(filters.map(id => ({ id, label: t(FILTER_KEYS[id]), attrs: ` data-lib-filter="${id}"` })), shown, { label: t("members.panelTab.library"), kind: "filter" })}</div>` : "";
  const days = [...new Set(files.map(item => item.day))];
  return bar + days.map(day => {
    const items = files.filter(item => item.day === day);
    const pictures = items.filter(item => item.kind === "image"), others = items.filter(item => item.kind !== "image");
    return `<section class="lib-day" data-day="${esc(day)}"><div class="mb-dh">${esc(dayLabel(items[0]!.at_ms, now))}</div>` +
      (pictures.length ? `<div class="lib-pics">${pictures.map(pictureHTML).join("")}</div>` : "") +
      (others.length ? `<div class="lib-rows">${others.map(rowHTML).join("")}</div>` : "") + `</section>`;
  }).join("");
}
