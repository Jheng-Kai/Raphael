// The member column puts the primary contact first, followed by member groups and ungrouped members.
// Raphael keeps his emblem even when the primary contact takes the first conversation slot.
//
// A row's borderless 「more」 that shows under the pointer, or a right click on the row (context-menu.ts), gives 「設為主要」 (the
// primary contact, shown in the top slot), 「移到分組 ▸」 and 「刪除」; a group header's gives 「重新命名」, 「看的地方」 and 「刪除」. What they do is the host's
// (members-shell.ts): the column only draws and says what was asked.
//
// `columnHTML` draws the list from a snapshot (pure, so its rules can be tested without a browser);
// `createMemberColumn` keeps the search and the folded groups and hands the clicks over.

import { createRoomsSection, openNewGroupChat } from "./group-chats";
import { t } from "./i18n";
import { formatClock } from "./format";
import { createMessageSearch } from "./message-search";
import { type MemberSection, faceHTML, memberMatches, memberSections, memberDisplayList, memberRole, previewOf, raphaelOf } from "./members";
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
  query: string;
  /** The groups folded away, by id. */
  folded: ReadonlySet<number>;
  /** The members that were not there at the last drawing: their rows fade in. */
  fresh: ReadonlySet<number>;
}

/** A member's row: its picture, name, role, preview and dot; then its protected member actions. */
export function memberRowHTML(member: Member, v: Pick<ColumnView, "current" | "active" | "previews" | "fresh"> & { list?: ColumnView["list"] }, primary = false): string {
  const chief = member.id === 0;
  const lastAt = new Date(member.last_at ?? NaN);
  const preview = previewOf(member, v.previews.get(member.id));
  const dot = member.waiting
    ? `<span class="mb-dot is-wait" role="img" aria-label="${esc(t("members.waitingShort"))}"></span>`
    : member.unread
      ? `<span class="mb-dot is-unread" role="img" aria-label="${esc(t("members.unread"))}"></span>`
      : "";
  return (
    `<div class="mb-item${v.fresh.has(member.id) ? " is-new" : ""}" data-member-item="${member.id}"${member.id ? ' draggable="true"' : ""}>` +
    `<button type="button" class="nav mb-row" data-member="${member.id}" aria-current="${v.active !== false && member.id === v.current}" data-k="member:${member.id}">` +
    faceHTML(member, 48) + (primary ? `<span class="mb-star" aria-hidden="true">${ico("star")}</span>` : "") +
    `<span class="mb-row-main"><span class="mb-row-t"><b>${esc(member.name)}</b>${member.pinned ? `<span class="mb-pin" aria-label="${esc(t("members.sidePinned"))}">${ico("pin")}</span>` : ""}${memberRole(member) ? `<i>${esc(memberRole(member))}</i>` : ""}` +
    (Number.isFinite(lastAt.getTime()) ? `<time class="mb-row-time" datetime="${lastAt.toISOString()}">${formatClock(lastAt.getTime())}</time>` : "") + `</span>` +
    (preview.text ? `<span class="mb-row-p${preview.waiting ? " is-wait" : ""}">${esc(preview.text)}</span>` : "") +
    `</span>${dot}</button>` +
    (chief ? "" : iconButton("more", t("members.more", { p0: member.name }), ` data-member-more="${member.id}" aria-haspopup="menu" aria-expanded="false" data-k="member-more:${member.id}"`, "mb-more")) +
    `</div>`
  );
}

/** A group's header and its members; 未分組 has no menu. */
function sectionHTML(section: MemberSection, v: ColumnView): string {
  const group = section.group;
  const id = group ? String(group.id) : "none";
  const name = group ? group.name : t("members.ungrouped");
  const open = !(group && v.folded.has(group.id)) || v.query.trim() !== "";
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

/** The list under the search: the primary, groups and ungrouped members, or an empty result. */
export function columnHTML(v: ColumnView): string {
  const all = memberDisplayList(v.list), top = all.members[0];
  const pinned = all.members.filter(m => m.id !== top.id && m.pinned && !m.hidden && memberMatches(m, v.query));
  const sections = memberSections({ ...all, members: all.members.filter(m => !m.pinned) }, v.query, top.id);
  const searching = v.query.trim() !== "";
  const chief = memberRowHTML(top, v, true).replace('class="nav mb-row"', 'class="nav mb-row mb-chief"');
  const showChief = !searching || memberMatches(top, v.query);
  return (showChief ? chief : "") + (pinned.length ? `<div class="mb-pinned">${pinned.map(m => memberRowHTML(m, v)).join("")}</div>` : "") + sections.map((section) => sectionHTML(section, v)).join("") + (searching && !showChief && sections.length === 0 && pinned.length === 0 ? `<p class="mb-none">${esc(t("members.noMatch"))}</p>` : "");
}

export interface ColumnHost {
  openMessage?(member: number, conversation: number, turn: number): void;
  view(): Omit<ColumnView, "query" | "folded">;
  /** Opens the thread of member `id`. */
  select(id: number): void;
  newMember(groupId: number | null): void;
  newGroup(): void;
  newConversation?(): void;
  newGroupChat?(): void;
  memberAction?(id: number, action: string): void;
  /** 移到分組 chose a group for member `id` (null: 未分組). */
  moveMember(id: number, groupId: number | null, anchor: HTMLElement): void;
  deleteMember(id: number): void;
  renameGroup(id: number): void;
  editSources(id: number): void;
  deleteGroup(id: number): void;
  dropMember?(id: number, groupId: number | null, beforeId?: number): Promise<void>;
  reorderGroup?(id: number, beforeId: number): Promise<void>;
}

export interface MemberColumn {
  readonly el: HTMLElement;
  draw(): void;
  /** The same cross-conversation search, available when the column is hidden on narrow windows. */
  openSearch(anchor: HTMLElement): void;
  /** The search's words now. */
  query(): string;
  menu(id: number, anchor: HTMLElement): void;
}

/** A menu of plain items under `anchor`; `onPick` gets the chosen item's `id`. */
export function openActions(anchor: HTMLElement, items: readonly { id: string; label: string; icon?: Parameters<typeof ico>[0]; sub?: boolean }[], onPick: (id: string) => void): void {
  const el = openPopover(
    anchor,
    items
      .map(
        (item) =>
          `<button type="button" role="menuitem"${item.icon === "trash" ? ' class="danger"' : ""} tabindex="-1" data-pick="${esc(item.id)}"${item.sub ? ' aria-haspopup="menu"' : ""}>` +
          `<span class="ck">${item.icon ? ico(item.icon) : ""}</span><span class="mt">${esc(item.label)}</span>${item.sub ? ico("right") : ""}</button>`,
      )
      .join(""),
    { className: "menu mb-menu", role: "menu", label: anchor.getAttribute("aria-label") ?? undefined },
  );
  el.addEventListener("click", (e) => {
    const pick = (e.target as Element).closest<HTMLElement>("[data-pick]");
    if (!pick) return;
    const id = pick.dataset.pick ?? "";
    // a submenu opens in the place of this one, from the same button
    if (!pick.hasAttribute("aria-haspopup")) {
      closeMenu();
      anchor.focus({ preventScroll: true });
    }
    onPick(id);
  });
  el.querySelector<HTMLElement>("button")?.focus();
}

export function memberMenu(id: number, anchor: HTMLElement, host: Pick<ColumnHost, "view" | "moveMember" | "deleteMember" | "memberAction">): void {
  const member = host.view().list?.members.find(m => m.id === id);
  openActions(anchor, [
    { id: "pin", label: t(member?.pinned ? "members.sideUnpin" : "members.sidePin"), icon: "pin" },
    { id: "move", label: t("members.moveTo"), icon: "folder", sub: true },
    { id: "primary", label: t("members.sidePrimary"), icon: "up" },
    { id: "unread", label: t("members.sideUnread"), icon: "chat" },
    { id: "read-all", label: t("members.sideReadAll"), icon: "check" },
    { id: "edit", label: t("members.sideEdit"), icon: "pencil" },
    { id: "duplicate", label: t("members.sideDuplicate"), icon: "copy" },
    { id: "clear", label: t("members.sideClear"), icon: "trash" },
    { id: "hide", label: t("members.sideHide"), icon: "eyeOff" },
    { id: "delete", label: t("members.sideDelete"), icon: "trash" },
  ], pick => {
    if (pick === "move") host.moveMember(id, null, anchor);
    else if (pick === "delete") host.deleteMember(id);
    else host.memberAction?.(id, pick);
  });
}

export function createMemberColumn(host: ColumnHost): MemberColumn {
  const el = document.createElement("aside");
  el.className = "mb-col";
  el.innerHTML =
    `<div class="mb-top"><label class="mb-find" hidden>${ico("search")}<input type="search" class="mb-find-input" autocomplete="off" spellcheck="false" maxlength="40"></label>` +
    iconButton("search", t("chat.searchAll"), ' data-col="search" aria-expanded="false"', "mb-tool") +
    iconButton("plus", t("members.add"), ' data-col="add" aria-haspopup="menu" aria-expanded="false"', "mb-tool") + `</div>` +
    `<nav class="mb-scroll"><div class="mb-list"></div></nav>`;
  const rooms = createRoomsSection(() => host.view().active !== false);
  el.querySelector(".mb-scroll")!.append(rooms);
  const findInput = el.querySelector<HTMLInputElement>(".mb-find-input")!;
  const addButton = el.querySelector<HTMLElement>('[data-col="add"]')!;
  const searchButton = el.querySelector<HTMLButtonElement>('[data-col="search"]')!;
  const find = el.querySelector<HTMLElement>('.mb-find')!;
  const list = el.querySelector<HTMLElement>(".mb-list")!;
  const nav = el.querySelector<HTMLElement>(".mb-scroll")!;
  let query = "";
  const folded = new Set<number>();
  try { for (const id of JSON.parse(localStorage.getItem("raphael.sidebar.folders") ?? "[]")) if (Number.isInteger(id)) folded.add(id); } catch { /* Keep folders open when storage is unavailable. */ }
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
    findInput.placeholder = t("chat.searchAll");
    findInput.setAttribute("aria-label", t("chat.searchAll"));
    searchButton.title = t("chat.searchAll"); searchButton.setAttribute("aria-label", t("chat.searchAll"));
    const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-k]");
    const key = focusKey && list.contains(focusKey) ? focusKey.dataset.k : undefined;
    search.draw(query, columnHTML({ ...host.view(), query, folded }));
    rooms.dispatchEvent(new CustomEvent("sidebar-search", { detail: query }));
    if (key) list.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
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

  // Header controls retain their listeners when the sidebar places them beside the brand.
  searchButton.addEventListener('click', () => {
    find.hidden = !find.hidden; searchButton.setAttribute('aria-expanded', String(!find.hidden));
    if (!find.hidden) findInput.focus();
    else { query = ''; findInput.value = ''; draw(); }
  });
  addButton.addEventListener('click', () => {
      openActions(
        addButton,
        [
          { id: "conversation", label: t("members.sideNewConversation"), icon: "chat" },
          { id: "member", label: t("members.newMember") + "  Ctrl+N", icon: "plus" },
          { id: "group", label: t("members.newGroup"), icon: "folder" },
          { id: "group-chat", label: t("members.sideNewGroupChat"), icon: "chat" },
        ],
        pick => {
          if (pick === "member") host.newMember(null);
          else if (pick === "conversation") host.newConversation?.();
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
    const fold = target.closest<HTMLElement>("[data-group-fold]");
    if (fold) {
      const value = fold.dataset.groupFold!;
      if (value === "none" || query.trim() !== "") return;
      const id = Number(value);
      if (folded.has(id)) folded.delete(id);
      else folded.add(id);
      try { localStorage.setItem("raphael.sidebar.folders", JSON.stringify([...folded])); } catch { /* Keep the current session choice. */ }
      // the group folds where it is: its body slides, nothing else is drawn again
      const section = fold.closest<HTMLElement>(".mb-sec")!;
      const open = !folded.has(id);
      section.dataset.open = String(open);
      fold.setAttribute("aria-expanded", String(open));
      section.querySelector(".mb-gbody")?.toggleAttribute("inert", !open);
      return;
    }
    const row = target.closest<HTMLElement>("[data-member]");
    if (row) host.select(Number(row.dataset.member));
  });

  findInput.addEventListener("input", () => {
    query = findInput.value;
    draw();
  });
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      query = ""; findInput.value = ""; draw();
    }
  });

  let drag: { kind: "member" | "group"; id: number } | null = null;
  el.addEventListener("dragstart", event => {
    const target = event.target as Element;
    const item = target.closest<HTMLElement>("[data-member-item]");
    const group = target.closest<HTMLElement>(".mb-sec[data-group]");
    drag = item && Number(item.dataset.memberItem) ? { kind: "member", id: Number(item.dataset.memberItem) } : group && group.dataset.group !== "none" ? { kind: "group", id: Number(group.dataset.group) } : null;
    if (!drag) { event.preventDefault(); return; }
    event.stopPropagation(); event.dataTransfer?.setData(`application/x-raphael-${drag.kind}`, String(drag.id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  const clearDrop = (): void => { el.querySelectorAll(".is-drop-target").forEach(node => node.classList.remove("is-drop-target")); };
  el.addEventListener("dragover", event => {
    const group = (event.target as Element).closest<HTMLElement>(".mb-sec[data-group]");
    if (!drag || !group || (drag.kind === "group" && group.dataset.group === "none")) return;
    event.preventDefault(); clearDrop(); group.classList.add("is-drop-target");
  });
  el.addEventListener("dragend", () => { drag = null; clearDrop(); });
  el.addEventListener("drop", event => {
    const group = (event.target as Element).closest<HTMLElement>(".mb-sec[data-group]");
    const moving = drag; drag = null; clearDrop();
    if (!moving || !group) return;
    event.preventDefault();
    const target = group.dataset.group === "none" ? null : Number(group.dataset.group);
    const before = (event.target as Element).closest<HTMLElement>("[data-member-item]")?.dataset.memberItem;
    if (moving.kind === "member") void host.dropMember?.(moving.id, target, before === undefined ? undefined : Number(before));
    else if (target !== null && target !== moving.id) void host.reorderGroup?.(moving.id, target);
  });

  function openSearch(anchor: HTMLElement): void {
    const panel = openPopover(anchor, '<div class="conversation-tools"><input type="search"></div><div class="conversation-rows page-agent"></div>', { className: "menu conversation-search", role: "dialog", label: t("chat.searchAll") });
    const input = panel.querySelector<HTMLInputElement>("input")!;
    input.placeholder = t("chat.searchAll"); input.setAttribute("aria-label", t("chat.searchAll"));
    const results = panel.querySelector<HTMLElement>(".conversation-rows")!;
    const lookup = createMessageSearch(results, {
      name: id => (id === 0 ? raphaelOf(host.view().list) : host.view().list?.members.find(member => member.id === id))?.name ?? "",
      face: id => {
        const member = id === 0 ? raphaelOf(host.view().list) : host.view().list?.members.find(member => member.id === id);
        return member ? faceHTML(member, 34) : "";
      },
      open: (member, conversation, turn) => { closeMenu(); host.openMessage?.(member, conversation, turn); },
    });
    const redraw = (): void => lookup.draw(input.value, columnHTML({ ...host.view(), query: input.value, folded }));
    input.addEventListener("input", redraw);
    results.addEventListener("click", event => {
      const member = (event.target as Element).closest<HTMLElement>("[data-member]")?.dataset.member;
      if (member !== undefined) { closeMenu(); host.select(Number(member)); }
    });
    redraw(); input.focus();
  }
  return { el, draw, openSearch, query: () => query, menu: (id, anchor) => memberMenu(id, anchor, host) };
}
