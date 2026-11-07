// The member column puts the primary contact first, followed by member groups and ungrouped members.
// Raphael keeps his emblem even when the primary contact takes the first conversation slot.
//
// A row's borderless 「more」 that shows under the pointer, or a right click on the row (context-menu.ts), opens the row menu
// (`memberMenu`); a group header's gives 「重新命名」, 「看的地方」 and 「刪除」. What they do is the host's
// (members-shell.ts): the column only draws and says what was asked.
//
// `columnHTML` draws the list from a snapshot (pure, so its rules can be tested without a browser);
// `createMemberColumn` keeps the search and the folded groups and hands the clicks over.

import { createRoomsSection, openNewGroupChat } from "./group-chats";
import { t } from "./i18n";
import { createMessageSearch } from "./message-search";
import { type MemberSection, faceHTML, memberMatches, memberSections, memberDisplayList, memberRole, previewOf, primaryIdOf, raphaelOf } from "./members";
import type { Member, MembersList } from "./types";
import { closeMenu, esc, ico, iconButton, openPopover } from "./ui";

/** What the column is drawn from. */
export interface ColumnView {
  list: MembersList | null;
  /** The member whose thread is open. */
  current: number;
  /** Whether the conversation page is visible. */
  active?: boolean;
  /** The last message of each member's thread, as far as it is known. */
  previews: ReadonlyMap<number, string>;
  /** The groups folded away, by id. */
  folded: ReadonlySet<number>;
  /** The folders that start closed and are open now: only the hidden one, for as long as the owner keeps it open. */
  unfolded?: ReadonlySet<number>;
  /** The members that were not there at the last drawing: their rows fade in. */
  fresh: ReadonlySet<number>;
}

const memberDot = (member: Member): string => member.waiting
  ? `<span class="mb-dot is-wait" role="img" aria-label="${esc(t("members.waitingShort"))}"></span>`
  : member.unread
    ? `<span class="mb-dot is-unread" role="img" aria-label="${esc(t("members.unread"))}"></span>`
    : "";

/** A pinned member leaves the rows for the top of the list: a larger face centered above the name. */
function pinnedTileHTML(member: Member, v: ColumnView, top: boolean): string {
  const role = memberRole(member);
  return (
    `<div class="mb-item" data-member-item="${member.id}"${member.id ? ' draggable="true"' : ""}>` +
    `<button type="button" class="nav mb-row mb-tile${top ? " mb-chief" : ""}" data-member="${member.id}" aria-current="${v.active !== false && member.id === v.current}" data-k="member:${member.id}" aria-label="${esc(role ? `${member.name} · ${role}` : member.name)}">` +
    faceHTML(member, 64) + `<b>${esc(member.name)}</b>${memberDot(member)}</button>` +
    iconButton("more", t("members.more", { p0: member.name }), ` data-member-more="${member.id}" aria-haspopup="menu" aria-expanded="false" data-k="member-more:${member.id}"`, "mb-more") +
    `</div>`
  );
}

/** A member's row, as Grok Bot's: its picture, name, last line and dot, with no time (R-UI-77); then its protected member
 *  actions. */
export function memberRowHTML(member: Member, v: Pick<ColumnView, "current" | "active" | "previews" | "fresh"> & { list?: ColumnView["list"] }): string {
  const preview = previewOf(member, v.previews.get(member.id));
  const dot = memberDot(member);
  return (
    `<div class="mb-item${v.fresh.has(member.id) ? " is-new" : ""}" data-member-item="${member.id}"${member.id ? ' draggable="true"' : ""}>` +
    `<button type="button" class="nav mb-row" data-member="${member.id}" aria-current="${v.active !== false && member.id === v.current}" data-k="member:${member.id}">` +
    faceHTML(member, 40) +
    `<span class="mb-row-main"><span class="mb-row-t"><b>${esc(member.name)}</b></span>` +
    (preview.text ? `<span class="mb-row-p${preview.waiting ? " is-wait" : ""}">${esc(preview.text)}</span>` : "") +
    `</span>${dot}</button>` +
    iconButton("more", t("members.more", { p0: member.name }), ` data-member-more="${member.id}" aria-haspopup="menu" aria-expanded="false" data-k="member-more:${member.id}"`, "mb-more") +
    `</div>`
  );
}

/** A group's header and its members; 未分組 has no menu. */
function sectionHTML(section: MemberSection, v: ColumnView): string {
  const group = section.group;
  const id = group ? String(group.id) : "none";
  const name = group ? group.name : t("members.ungrouped");
  const open = !(group && v.folded.has(group.id));
  return (
    `<section class="mb-sec"${group ? ' draggable="true"' : ""} data-group="${id}" data-open="${open}">` +
    (group ? `<div class="mb-ghead"><span class="mb-gname">${esc(name)}</span>` +
    (group
      ? iconButton("more", t("members.more", { p0: name }), ` data-group-more="${id}" aria-haspopup="menu" aria-expanded="false" data-k="group-more:${id}"`, "mb-more")
      : "") +
    iconButton("down", t("members.toggleGroup", { p0: name }), ` data-group-fold="${id}" aria-expanded="${open}" data-k="group-fold:${id}"`, "mb-fold") +
    `</div>` : "") +
    `<div class="mb-gbody"${open ? "" : " inert"}><div class="mb-gclip">${section.members.map((member) => memberRowHTML(member, v)).join("")}</div></div>` +
    `</section>`
  );
}

/** The folder id the hidden section folds by: no group has it. */
export const HIDDEN_SECTION = -1;

/**
 * As Grok Bot's Hidden Bots (owner, 2026-11-06): the members taken off the list sit in one more folder at its end, with
 * the hidden group chats, which group-chats.ts puts in its `[data-hidden-rooms]`. Empty, it does not show. It starts closed
 * (owner, 2026-11-07): hidden stays hidden until the owner presses its header.
 */
function hiddenSectionHTML(hidden: readonly Member[], v: ColumnView): string {
  const open = v.unfolded?.has(HIDDEN_SECTION) === true, name = t("members.hiddenSection");
  return `<section class="mb-sec mb-hidden" data-group="hidden" data-open="${open}"${hidden.length ? "" : " data-empty"}>` +
    `<div class="mb-ghead"><span class="mb-gname">${esc(name)}</span>` +
    iconButton("down", t("members.toggleGroup", { p0: name }), ` data-group-fold="${HIDDEN_SECTION}" aria-expanded="${open}" data-k="group-fold:hidden"`, "mb-fold") +
    `</div><div class="mb-gbody"${open ? "" : " inert"}><div class="mb-gclip">${hidden.map((member) => memberRowHTML(member, v)).join("")}` +
    `<div class="mb-hidden-rooms" data-hidden-rooms></div></div></div></section>`;
}

/** The list: the pinned tiles, the primary, then groups and ungrouped members, then the hidden ones. */
export function columnHTML(v: ColumnView): string {
  const all = memberDisplayList(v.list), top = all.members[0];
  const pinned = all.members.filter(m => m.pinned && (m.id === top.id || !m.hidden));
  const sections = memberSections({ ...all, members: all.members.filter(m => !m.pinned) }, "", top.id);
  const chief = memberRowHTML(top, v).replace('class="nav mb-row"', 'class="nav mb-row mb-chief"');
  const hidden = (v.list?.members ?? []).filter(m => m.hidden && m.id !== top.id);
  return (pinned.length ? `<div class="mb-pinned" data-count="${Math.min(pinned.length, 3)}">${pinned.map(m => pinnedTileHTML(m, v, m.id === top.id)).join("")}</div>` : "") + (top.pinned ? "" : chief) + sections.map((section) => sectionHTML(section, v)).join("") + hiddenSectionHTML(hidden, v);
}

export interface ColumnHost {
  openMessage?(member: number, conversation: number, turn: number): void;
  view(): Omit<ColumnView, "folded" | "unfolded">;
  /** Opens the thread of member `id`. */
  select(id: number): void;
  newMember(groupId: number | null): void;
  newGroup(): void;
  newGroupChat?(): void;
  memberAction?(id: number, action: string): void;
  /** 移到分組 chose a group for member `id` (null: 未分組). */
  moveMember(id: number, groupId: number | null, anchor: HTMLElement): void;
  deleteMember(id: number): void;
  renameGroup(id: number): void;
  editSources(id: number): void;
  deleteGroup(id: number): void;
  dropMember?(id: number, groupId: number | null, beforeId?: number): Promise<void>;
  /** Moves folder `id` before `beforeId`, or to the end for null. */
  reorderGroup?(id: number, beforeId: number | null): Promise<void>;
}

export interface MemberColumn {
  readonly el: HTMLElement;
  draw(): void;
  /** The search card: members and what is found in the messages, from the search button, Ctrl+Shift+F or the palette. */
  openSearch(anchor: HTMLElement): void;
  menu(id: number, anchor: HTMLElement): void;
}

export interface ActionItem { id: string; label: string; icon?: Parameters<typeof ico>[0]; submenu?: boolean }
/** A hairline between groups of items, as Grok Bot's row menu has. */
export const SEP = "-";

/** A menu of plain items under `anchor`; `onPick` gets the chosen item's `id`. */
/** `lead` is a row above the items, such as a message's reactions; its buttons carry `data-lead`. */
export function openActions(anchor: HTMLElement, items: readonly (ActionItem | typeof SEP)[], onPick: (id: string, row: HTMLElement) => void,
  lead?: { html: string; onPick(value: string): void }): void {
  const el = openPopover(
    anchor,
    (lead?.html ?? "") + items
      .map(
        (item) => item === SEP ? `<div class="menu-sep" role="separator"></div>` :
          `<button type="button" role="menuitem"${item.icon === "trash" ? ' class="danger"' : ""} tabindex="-1" data-pick="${esc(item.id)}"${item.submenu ? ' aria-haspopup="menu" aria-expanded="false"' : ""}>` +
          `<span class="ck">${item.icon ? ico(item.icon) : ""}</span><span class="mt">${esc(item.label)}</span>${item.submenu ? ico("right") : ""}</button>`,
      )
      .join(""),
    { className: "menu mb-menu", role: "menu", label: anchor.getAttribute("aria-label") ?? undefined },
  );
  el.addEventListener("click", (e) => {
    const led = lead && (e.target as Element).closest<HTMLElement>("[data-lead]");
    if (led) { closeMenu(); anchor.focus({ preventScroll: true }); lead.onPick(led.dataset.lead ?? ""); return; }
    const pick = (e.target as Element).closest<HTMLElement>("[data-pick]");
    if (!pick) return;
    const id = pick.dataset.pick ?? "";
    if (!pick.hasAttribute("aria-haspopup")) {
      closeMenu();
      anchor.focus({ preventScroll: true });
    }
    onPick(id, pick);
  });
  el.querySelector<HTMLElement>("button")?.focus();
}

/**
 * A row's menu, grouped as Grok Bot's (owner, 2026-11-06): 釘選, 移到分組, 標為未讀 | 編輯 | 分享為範本 | 隱藏, 刪除.
 * The primary sits in the top slot instead of a group and is not deleted from here: its menu ends with 換成其他成員.
 */
export function memberMenu(id: number, anchor: HTMLElement, host: Pick<ColumnHost, "view" | "moveMember" | "deleteMember" | "memberAction">): void {
  const list = host.view().list;
  const member = list?.members.find(m => m.id === id);
  const primary = primaryIdOf(list) === id;
  const pin: ActionItem = { id: "pin", label: t(member?.pinned ? "members.sideUnpin" : "members.sidePin"), icon: "pin" };
  const replace: ActionItem = { id: "primary", label: t("members.sideReplacePrimary"), icon: "up" };
  // Raphael is not a member row the owner can edit: pinning is all there is to do to him here, and handing on the primary when it is his.
  if (id === 0) return openActions(anchor, primary ? [pin, SEP, replace] : [pin], pick => host.memberAction?.(id, pick));
  const unread: ActionItem = { id: "unread", label: t("members.sideUnread"), icon: "chat" };
  const tail: (ActionItem | typeof SEP)[] = [
    SEP, { id: "edit", label: t("members.sideEdit"), icon: "pencil" },
    SEP, { id: "export-template", label: t("template.export"), icon: "download" },
    SEP, member?.hidden ? { id: "hide", label: t("members.sideUnhide"), icon: "eye" } : { id: "hide", label: t("members.sideHide"), icon: "eyeOff" },
  ];
  openActions(anchor, primary ? [pin, unread, ...tail, replace] : [
    pin, { id: "move", label: t("members.moveTo"), icon: "folder", submenu: true }, unread,
    ...tail, { id: "delete", label: t("members.sideDelete"), icon: "trash" },
  ], (pick, row) => {
    if (pick === "move") host.moveMember(id, null, row);
    else if (pick === "delete") host.deleteMember(id);
    else host.memberAction?.(id, pick);
  });
}

export function createMemberColumn(host: ColumnHost): MemberColumn {
  const el = document.createElement("aside");
  el.className = "mb-col";
  // Search and plus side by side at the top, as Grok Bot's (owner, 2026-11-06): search opens a card in the middle of the
  // window instead of a field standing in the list.
  el.innerHTML =
    `<div class="mb-top">${iconButton("search", t("chat.searchAll"), ' data-col="search" aria-haspopup="dialog"', "mb-tool")}` +
    `${iconButton("plus", t("members.add"), ' data-col="add" aria-haspopup="menu" aria-expanded="false"', "mb-tool")}</div>` +
    `<nav class="mb-scroll"><div class="mb-list"></div></nav>`;
  const rooms = createRoomsSection(() => host.view().active !== false);
  el.querySelector(".mb-scroll")!.append(rooms);
  const searchButton = el.querySelector<HTMLElement>('[data-col="search"]')!;
  const addButton = el.querySelector<HTMLElement>('[data-col="add"]')!;
  const list = el.querySelector<HTMLElement>(".mb-list")!;
  const nav = el.querySelector<HTMLElement>(".mb-scroll")!;
  const folded = new Set<number>();
  /** The hidden folder is closed at every start; pressing its header opens it for this session only. */
  const unfolded = new Set<number>();
  try { for (const id of JSON.parse(localStorage.getItem("raphael.sidebar.folders") ?? "[]")) if (Number.isInteger(id) && id !== HIDDEN_SECTION) folded.add(id); } catch { /* Keep folders open when storage is unavailable. */ }
  const search = createMessageSearch(list, {
    name: id => (id === 0 ? raphaelOf(host.view().list) : host.view().list?.members.find(member => member.id === id))?.name ?? "",
    face: id => {
      const members = host.view().list;
      const member = id === 0 ? raphaelOf(members) : members?.members.find(member => member.id === id);
      return member ? faceHTML(member, 34) : "";
    },
    open: (member, conversation, turn) => host.openMessage?.(member, conversation, turn),
  });

  function draw(): void {
    nav.setAttribute("aria-label", t("members.title"));
    addButton.setAttribute("aria-label", t("members.add"));
    addButton.title = t("members.add");
    searchButton.setAttribute("aria-label", t("chat.searchAll"));
    searchButton.title = t("chat.searchAll");
    const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-k]");
    const key = focusKey && list.contains(focusKey) ? focusKey.dataset.k : undefined;
    search.draw("", columnHTML({ ...host.view(), folded, unfolded }));
    rooms.dispatchEvent(new Event("sidebar-draw"));
    const focused = key ? list.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`) : null;
    if (focused && focused !== document.activeElement) focused.focus({ preventScroll: true });
  }

  function groupMenu(id: number, anchor: HTMLElement): void {
    openActions(
      anchor,
      [
        { id: "rename", label: t("members.rename"), icon: "pencil" },
        { id: "sources", label: t("members.sources"), icon: "link" },
        { id: "delete", label: t("members.delete"), icon: "trash" },
      ],
      (pick) => {
        if (pick === "rename") host.renameGroup(id);
        else if (pick === "sources") host.editSources(id);
        else host.deleteGroup(id);
      },
    );
  }

  let suppressFold = false;
  el.addEventListener("pointerdown", () => { suppressFold = false; });
  addButton.addEventListener('click', () => {
      openActions(
        addButton,
        [
          { id: "member", label: t("members.newMember") + "  Ctrl+N", icon: "plus" },
          { id: "group", label: t("members.newGroup"), icon: "folder" },
          { id: "group-chat", label: t("members.sideNewGroupChat"), icon: "chat" },
          { id: "member-store", label: t("store.title"), icon: "plus" },
        ],
        pick => {
          if (pick === "member") host.newMember(null);
          else if (pick === "member-store") window.dispatchEvent(new Event("raphael:member-store"));
          else if (pick === "group") host.newGroup();
          else if (host.newGroupChat) host.newGroupChat();
          else void openNewGroupChat();
        },
      );
  });
  el.addEventListener("click", (e) => {
    const target = e.target as Element;
    const more = target.closest<HTMLElement>("[data-member-more]");
    if (more) return memberMenu(Number(more.dataset.memberMore), more, host);
    const groupMore = target.closest<HTMLElement>("[data-group-more]");
    if (groupMore) return groupMenu(Number(groupMore.dataset.groupMore), groupMore);
    const heading = target.closest<HTMLElement>(".mb-ghead");
    const fold = heading?.querySelector<HTMLElement>("[data-group-fold]");
    if (fold) {
      if (suppressFold) { suppressFold = false; if (e.detail !== 0) return; }
      const value = fold.dataset.groupFold!;
      if (value === "none") return;
      const id = Number(value);
      let open: boolean;
      if (id === HIDDEN_SECTION) {
        // Closed unless the owner opened it in this session; never stored.
        if (unfolded.has(id)) unfolded.delete(id);
        else unfolded.add(id);
        open = unfolded.has(id);
      } else {
        if (folded.has(id)) folded.delete(id);
        else folded.add(id);
        try { localStorage.setItem("raphael.sidebar.folders", JSON.stringify([...folded])); } catch { /* Keep the current session choice. */ }
        open = !folded.has(id);
      }
      // the group folds where it is: its body slides, nothing else is drawn again
      const section = fold.closest<HTMLElement>(".mb-sec")!;
      section.dataset.open = String(open);
      fold.setAttribute("aria-expanded", String(open));
      section.querySelector(".mb-gbody")?.toggleAttribute("inert", !open);
      return;
    }
    const row = target.closest<HTMLElement>("[data-member]");
    if (row) host.select(Number(row.dataset.member));
  });

  searchButton.addEventListener("click", () => openSearch(searchButton));

  // Dragging a member or a folder shows one line where it will land, between two rows, as Grok Bot's list does (owner,
  // 2026-11-07): no box around a folder, and no see-through copy of the row over the others, only the row itself dimmed.
  let drag: { kind: "member" | "group"; id: number; source: HTMLElement } | null = null;
  let landing: { group: HTMLElement; before: number | null } | null = null;
  const line = document.createElement("div");
  line.className = "mb-drop-line";
  line.hidden = true;
  line.setAttribute("aria-hidden", "true");
  const blank = typeof Image === "undefined" ? null : Object.assign(new Image(), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });
  const showLine = (y: number, box: DOMRect): void => {
    if (!line.isConnected) el.append(line);
    Object.assign(line.style, { top: `${Math.round(y - 1)}px`, left: `${Math.round(box.left + 8)}px`, width: `${Math.round(box.width - 16)}px` });
    line.hidden = false;
  };
  const clearDrop = (): void => { line.hidden = true; landing = null; };
  /** Where the dragged row lands for a pointer at `y`, and the line that says so. */
  function landingAt(target: Element, y: number): { group: HTMLElement; before: number | null; lineY: number; box: DOMRect } | null {
    if (!drag) return null;
    if (drag.kind === "member") {
      const group = target.closest<HTMLElement>(".mb-sec[data-group]");
      if (!group) return null;
      const rows = [...group.querySelectorAll<HTMLElement>("[data-member-item]")].filter(row => Number(row.dataset.memberItem) !== drag!.id && row.getBoundingClientRect().height > 0);
      const box = group.getBoundingClientRect();
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (y < r.top + r.height / 2) return { group, before: Number(row.dataset.memberItem), lineY: r.top, box };
      }
      const last = rows[rows.length - 1]?.getBoundingClientRect();
      return { group, before: null, lineY: last ? last.bottom : (group.querySelector(".mb-gh")?.getBoundingClientRect().bottom ?? box.top), box };
    }
    const groups = [...el.querySelectorAll<HTMLElement>('.mb-sec[data-group]:not([data-group="none"])')].filter(g => Number(g.dataset.group) !== drag!.id);
    if (!groups.length || !target.closest(".mb-sec[data-group]")) return null;
    for (const group of groups) {
      const r = group.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { group, before: Number(group.dataset.group), lineY: r.top, box: r };
    }
    const last = groups[groups.length - 1];
    const r = last.getBoundingClientRect();
    return { group: last, before: null, lineY: r.bottom, box: r };
  }
  el.addEventListener("dragstart", event => {
    const target = event.target as Element;
    const item = target.closest<HTMLElement>("[data-member-item]");
    const group = target.closest<HTMLElement>(".mb-sec[data-group]");
    drag = item && Number(item.dataset.memberItem) ? { kind: "member", id: Number(item.dataset.memberItem), source: item } : group && group.dataset.group !== "none" ? { kind: "group", id: Number(group.dataset.group), source: group } : null;
    if (!drag) { event.preventDefault(); return; }
    suppressFold = true;
    event.stopPropagation(); event.dataTransfer?.setData(`application/x-raphael-${drag.kind}`, String(drag.id));
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; if (blank) event.dataTransfer.setDragImage(blank, 0, 0); }
    drag.source.classList.add("is-dragged");
  });
  el.addEventListener("dragover", event => {
    const next = landingAt(event.target as Element, event.clientY);
    if (!next) { clearDrop(); return; }
    event.preventDefault();
    landing = { group: next.group, before: next.before };
    showLine(next.lineY, next.box);
  });
  const endDrag = (): void => { drag?.source.classList.remove("is-dragged"); drag = null; clearDrop(); };
  el.addEventListener("dragend", endDrag);
  el.addEventListener("drop", event => {
    const computed = landingAt(event.target as Element, event.clientY);
    const moving = drag, at = landing ?? (computed && { group: computed.group, before: computed.before });
    endDrag();
    if (!moving || !at) return;
    event.preventDefault();
    if (moving.kind === "member") void host.dropMember?.(moving.id, at.group.dataset.group === "none" ? null : Number(at.group.dataset.group), at.before ?? undefined);
    else if (at.before !== moving.id) void host.reorderGroup?.(moving.id, at.before);
  });

  /** Every member the search can reach, as two-line rows (face, name, last message), filtered by the words typed. */
  function searchRowsHTML(words: string): string {
    const view = host.view();
    const members = memberDisplayList(view.list).members.filter((m, index) => (index === 0 || !m.hidden) && memberMatches(m, words));
    if (!members.length) return `<p class="mb-none">${esc(t("members.noMatch"))}</p>`;
    return members.map(m => `<button type="button" class="nav side-search-row" data-member="${m.id}">${faceHTML(m, 28)}` +
      `<span class="side-search-main"><b>${esc(m.name)}</b><span>${esc(previewOf(m, view.previews.get(m.id)).text)}</span></span></button>`).join("");
  }

  /**
   * Grok Bot's search (owner, 2026-11-06): a card in the middle of the window with the field, every member as a two-line
   * row, what the words find in the messages, and 新增成員 at its foot. Enter takes the first row; the arrows walk them.
   */
  function openSearch(anchor: HTMLElement): void {
    if (document.querySelector(".side-search")) { closeMenu(); return; }
    const width = (): number => Math.min(560, innerWidth - 24);
    const panel = openPopover(anchor,
      `<label class="side-search-field">${ico("search")}<input type="search" class="side-search-input" autocomplete="off" spellcheck="false" maxlength="40"></label>` +
      `<div class="side-search-rows"></div>` +
      `<button type="button" class="nav side-search-new" data-search-new>${ico("plus")}<span>${esc(t("members.newMember"))}</span></button>`,
      {
        className: "menu side-search", role: "dialog", label: t("chat.searchAll"),
        anchorRect: () => new DOMRect((innerWidth - width()) / 2, Math.min(Math.max(48, innerHeight * 0.26), 280), width(), 0),
        onKey: event => {
          if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return false;
          panel.querySelector<HTMLButtonElement>(".side-search-rows button")?.click();
          return true;
        },
      });
    const input = panel.querySelector<HTMLInputElement>("input")!;
    input.placeholder = t("chat.searchAll"); input.setAttribute("aria-label", t("chat.searchAll"));
    const rows = panel.querySelector<HTMLElement>(".side-search-rows")!;
    // What is chosen here takes the whole window: a drawer behind the card has no use any more.
    const leave = (): void => { closeMenu(); window.dispatchEvent(new Event("raphael:close-sidebar")); };
    const lookup = createMessageSearch(rows, {
      name: id => (id === 0 ? raphaelOf(host.view().list) : host.view().list?.members.find(member => member.id === id))?.name ?? "",
      face: id => {
        const member = id === 0 ? raphaelOf(host.view().list) : host.view().list?.members.find(member => member.id === id);
        return member ? faceHTML(member, 28) : "";
      },
      open: (member, conversation, turn) => { leave(); host.openMessage?.(member, conversation, turn); },
    });
    const redraw = (): void => lookup.draw(input.value, searchRowsHTML(input.value));
    input.addEventListener("input", redraw);
    panel.addEventListener("click", event => {
      const target = event.target as Element;
      if (target.closest("[data-search-new]")) { leave(); host.newMember(null); return; }
      const member = target.closest<HTMLElement>("[data-member]")?.dataset.member;
      if (member !== undefined) { leave(); host.select(Number(member)); }
    });
    redraw(); input.focus();
  }
  return { el, draw, openSearch, menu: (id, anchor) => memberMenu(id, anchor, host) };
}
