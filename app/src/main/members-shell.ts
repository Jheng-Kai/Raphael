// The members of the 拉斐爾 page, put together: the list the core keeps (`members.list`), the column
// on the left (member-column.ts), the details panel on the right (member-details.ts), the dialogs
// (member-dialogs.ts) and the member identity used by the stacked conversation title.
// The main window mounts this column globally; below 860 px it opens in the same sidebar drawer.
//
// A new member of a group with places to look comes with the routine the core offers
// (「每天早上的進度」): the owner is asked, and only 「加入」 makes it.
//
// The page (pages/agent.ts) holds the conversation; this holds who it is with. When the owner picks
// another member, `onSelect` tells the page, which loads that member's thread. A thread the owner
// reads is told to the core (`members.read`), so that its row loses its dot.
//
// What the core cannot answer (a core from before the members, or one that is starting again)
// leaves Raphael alone in the column: the page works as it did before.

import * as api from "./api";
import { settleAsks } from "./chat-ask";
import { shortcut, openCommandPalette, type Command } from "./shortcuts";
import { eventRead } from './event-read';
import { describeError } from "./format";
import { currentRoomId, openNewGroupChat, openRoomsMenu } from "./group-chats";
import { getLocale, onLocaleChange, t } from "./i18n";
import type { MentionField } from "./mention-field";
import type { MentionTarget } from "./mention-text";
import { bindComposerMentions, mentionTargets } from "./team-mentions";
import { createMemberActions } from "./member-actions";
import { createMemberColumn } from "./member-column";
import { createDetails } from "./member-details";
import { createMemberSettings, type MemberSettings } from "./member-settings";
import { mountEdge, savedWidth, saveWidth } from "./edge-drag";

/** The details panel's widths (px): Grok Bot's opens at about 453 and drags to about 685; narrower than PANEL_CLOSE it closes. */
const PANEL_MIN = 300, PANEL_MAX = 720, PANEL_CLOSE = 240;
const PANEL_KEY = "raphael.panel.width";
import {
  askGroupName,
  confirmDelete,
  editSources,
  offerRoutine,
} from "./member-dialogs";
import { openMemberCreator } from "./member-creator";
import { RAPHAEL_ID, faceHTML, memberOf, orderedMembers, memberRole, raphaelOf } from "./members";
import { memberColor, nameAccent } from "./owner-bubble";
import { followSlimeRoster, setSlimeState } from "./slime";
import type { AppContext, MainEvent, Member, MemberGroup, MemberPatch, MembersList } from "./types";
import { type Choice, closeMenu, esc, ico, leave, openMenu, patchHTML, toaster } from "./ui";

/** Below this width details start closed to leave a readable conversation column. */
export const DETAILS_COLUMN_MIN_PX = 1440;
/** Events that come together (a task's step and its turn) read the list once. */
const REFRESH_DELAY_MS = 300;

export interface MembersHost {
  onOpenConversation?(member: number, conversation: number, turn?: number): void;
  /** The conversation open with this member, undefined for their default. */
  conversationOf?(member: number): number | undefined;
  app: AppContext;
  /** The owner chose another member's thread. */
  onSelect(id: number, sameThread?: boolean): void;
  /** The list of members changed (a name or picture was updated). */
  onUpdate?(): void;
  onReadThread?(member: Member): void;
  /** Whether the page is on screen now (a thread read only then). */
  visible(): boolean;
  focusHeader?(): void;
  onDetailsChange?(open: boolean): void;
}

export interface MembersShell {
  /** The member column. */
  readonly column: HTMLElement;
  /** The details panel. */
  readonly details: HTMLElement;
  /** The open member's settings page, which takes the conversation's place while it is open. */
  readonly settings: MemberSettings;
  /** Opens the settings page of the open member; the details panel folds away while it is open. */
  openSettings(): void;
  /** Leaves the settings page for the conversation and puts the details panel back as it was. */
  closeSettings(): void;
  computer(): void;
  /** The narrow windows' dropdown of members, for the left of the chat's top row. */
  readonly picker: HTMLElement;
  /** The pill with the open member, for the middle of the chat's top row. */
  readonly pill: HTMLElement;
  /** The id of the open member: 0 is Raphael. */
  current(): number;
  /** The name of member `id`, as the list has it (Raphael's for 0). */
  nameOf(id: number): string;
  /** The face of member `id` at `size` px (Raphael's bare emblem for 0); none for a member the list does not have. */
  faceOf(id: number, size: number): string;
  /** The colour member `id`'s name takes where members talk (owner-bubble.ts `nameAccent`). */
  accentOf(id: number): string;
  /** Member `id`'s own colour, its slime's (Raphael's blue for 0): what stands for it on a report. */
  colorOf(id: number): string;
  /** The open member, as the list has it. */
  member(): Member;
  /** Existing groups sorted by position. */
  groups(): readonly MemberGroup[];
  /** The mention menu and chips of a composer's field, following the team as the list has it. */
  bindMentions(input: HTMLTextAreaElement): void;
  /** What the words of a message may address, for the chips of the owner's bubbles. */
  mentionTargets(): readonly MentionTarget[];
  /** Opens the thread of member `id`. */
  select(id: number): void;
  /** Reads the list (and what the column and the panel need with it) again. */
  load(): Promise<void>;
  /** Local navigation changed which destination is selected. */
  show(): void;
  /** A turn was written or a task moved: the list is read again a moment later. */
  changed(delay?: number): void;
  follow(event: MainEvent): void;
  refreshRoutines(memberId: number): void;
  /** Whether the details panel is open. */
  detailsOpen(): boolean;
  setDetails(open: boolean, overview?: boolean): void;
  /** The page went off screen. */
  hide(): void;
}

export function createMembers(host: MembersHost): MembersShell {
  let list: MembersList | null = null;
  const fields = new Set<MentionField>();
  let current = RAPHAEL_ID;
  const previews = new Map<number, string>();
  let known: Set<number> | null = null;
  let fresh = new Set<number>();
  let loads = 0;
  let listJSON = "";
  let viewing: number | null | undefined;
  let refreshDue = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let open = typeof innerWidth === "number" ? innerWidth >= DETAILS_COLUMN_MIN_PX : true;
  /** Whether the details panel was open when the settings page folded it away; null while the page is closed. */
  let panelBeforeSettings: boolean | null = null;
  let stopLeaving: (() => void) | null = null;
  let panelRead = false;
  let refreshOnShow = false;

  const member = (): Member => memberOf(list, current) ?? raphaelOf(list);

  // ---------- the parts ----------

  const { memberAction, moveMember, deleteMember } = createMemberActions({
    list: () => list, current: () => current, select, load, update,
    deleted: id => previews.delete(id),
  });

  const column = createMemberColumn({
    openMessage: (member, conversation, turn) => host.onOpenConversation?.(member, conversation, turn),
    view: () => ({ list, active: host.visible(), current: currentRoomId() === null ? current : -1, previews, fresh }),
    select: (id) => select(id),
    newMember: (groupId) => newMember(groupId),
    newGroup: () => void newGroup(),
    newGroupChat: () => void openNewGroupChat(),
    memberAction: (id, action) => void memberAction(id, action),
    moveMember: (id, _group, anchor) => moveMember(id, anchor),
    deleteMember: (id) => void deleteMember(id),
    renameGroup: (id) => void renameGroup(id),
    editSources: (id) => void sources(id),
    deleteGroup: (id) => void deleteGroup(id),
    async dropMember(id, groupId, beforeId) {
      const peers = (list?.members ?? []).filter(m => m.id !== id && m.id !== 0 && m.group_id === groupId).sort((a, b) => a.position - b.position);
      const at = beforeId === undefined ? peers.length : peers.findIndex(m => m.id === beforeId);
      const moving = list?.members.find(m => m.id === id); if (!moving) return;
      peers.splice(at < 0 ? peers.length : at, 0, moving);
      await groupChange(async () => { for (const [position, m] of peers.entries()) await api.membersUpdate(m.id, { group_id: groupId, position }); });
    },
    async reorderGroup(id, beforeId) {
      const groups = [...(list?.groups ?? [])].sort((a, b) => a.position - b.position);
      const moving = groups.find(g => g.id === id); if (!moving) return;
      const next = groups.filter(g => g.id !== id);
      const at = beforeId === null ? -1 : next.findIndex(g => g.id === beforeId);
      next.splice(at < 0 ? next.length : at, 0, moving);
      await groupChange(async () => { for (const [position, group] of next.entries()) await api.groupsUpdate(group.id, { position }); });
    },
  });

  const details = createDetails({
    visible: host.visible,
    app: host.app,
    member,
    list: () => list,
    update,
    close: () => setDetails(false),
    // The gear: the member's settings page in the main area, or, when it is open, back to the conversation.
    openSettings: () => { if (settings.isOpen()) host.app.go("agent"); else host.app.go("agent", `member-settings:${current}`); },
    openConversation: host.onOpenConversation ? (member, conversation) => host.onOpenConversation!(member, conversation) : undefined,
    conversationOf: member => host.conversationOf?.(member),
    openTurn: (member, conversation, turn) => host.onOpenConversation?.(member, conversation!, turn),
  });

  // The member settings page: where the conversation is, over it, while it is open.
  const settings: MemberSettings = createMemberSettings({
    app: host.app,
    member,
    list: () => list,
    update,
    refreshList: () => void load(),
    back: () => host.app.go("agent"),
  });

  // As Grok Bot's: the panel's left edge drags it wider or narrower, and dragged narrower than it can be it closes; the
  // header's name opens it again at the width it had. There is no button for it (owner, 2026-11-06).
  let panelWidth = savedWidth(PANEL_KEY, PANEL_MIN, PANEL_MAX);
  const panelEdge = document.createElement("div");
  panelEdge.className = "det-edge";
  details.el.prepend(panelEdge);
  const placePanel = (): void => {
    const page = details.el.parentElement;
    if (panelWidth === null) page?.style.removeProperty("--pa-det");
    else page?.style.setProperty("--pa-det", `${panelWidth}px`);
  };
  mountEdge(panelEdge, {
    label: t("nav.panelWidth"),
    grow: -1,
    widthAt: x => details.el.getBoundingClientRect().right - x,
    width: () => details.el.getBoundingClientRect().width,
    resize: next => {
      if (next < PANEL_CLOSE) { setDetails(false); return false; }
      panelWidth = Math.round(Math.min(PANEL_MAX, innerWidth * 0.6, Math.max(PANEL_MIN, next)));
      placePanel();
    },
    done: () => saveWidth(PANEL_KEY, panelWidth),
    toggle: () => setDetails(false),
  });

  const pill = document.createElement("span");
  pill.className = "mb-pill";
  pill.dataset.shell = "pill";
  const picker = document.createElement("button");
  picker.type = "button";
  picker.className = "sel mb-pick";
  picker.setAttribute("aria-haspopup", "menu");
  picker.setAttribute("aria-expanded", "false");

  /** The pill and the narrow dropdown, for the open member. */
  function drawHead(): void {
    const m = member();
    // As Grok Bot's header pill: the face and name, and a › that slides in under the pointer (the pill opens the panel).
    patchHTML(pill, faceHTML(m, 22, { cls: "mb-pill-face" }) + `<span class="mb-pill-t">${esc(m.name)}</span><span class="mb-pill-go" aria-hidden="true">${ico("right")}</span>`);
    const waiting = list?.members.some((other) => other.id !== current && (other.waiting || other.unread)) ?? false;
    patchHTML(picker, `<span>${esc(m.name)}</span>${waiting ? `<i class="mb-dot is-wait" aria-hidden="true"></i>` : ""}${ico("down")}`);
    picker.setAttribute("aria-label", `${t("members.pick")}: ${m.name}`);
  }

  function drawAll(): void {
    column.draw();
    details.draw();
    settings.draw();
    drawHead();
    // The panel joins its page after the shell is made; its width follows it there.
    placePanel();
  }

  // ---------- reading ----------

  async function load(fromEvent = false): Promise<void> {
    const mine = ++loads;
    // the panel reads Raphael's routines the first time the page is on screen, not when the app starts
    if (!panelRead) {
      panelRead = true;
      details.showMember();
    } else if (refreshOnShow) {
      details.refreshRoutines();
    }
    refreshOnShow = false;
    let read: MembersList;
    try {
      const fetch = () => api.membersList(getLocale());
      read = await (fromEvent ? eventRead(`members.list:${getLocale()}`,fetch,host.app) : Promise.resolve().then(fetch));
      if (!read || !Array.isArray(read.members) || !Array.isArray(read.groups)) throw new Error("no members");
    } catch {
      if (mine !== loads) return;
      // A core without the members: Raphael alone, as before them.
      if (list === null) drawAll();
      return;
    }
    if (mine !== loads) return;
    const json = JSON.stringify(read);
    if (json === listJSON) {
      void readThread();
      if (host.visible()) tellViewing(current);
      return;
    }
    listJSON = json;
    const ids = new Set(read.members.map((m) => m.id));
    fresh = known === null ? new Set() : new Set([...ids].filter((id) => !known!.has(id)));
    followSlimeRoster(read.members);
    for (const id of fresh) setSlimeState(id, "arriving");
    known = ids;
    list = read;
    previews.clear();
    for (const m of read.members) previews.set(m.id, m.preview ?? "");
    for (const field of fields) field.refresh();
    if (current !== RAPHAEL_ID && !ids.has(current)) {
      current = RAPHAEL_ID;
      host.onSelect(current);
      toaster.info(t("common.deleted"));
      details.showMember();
    }
    drawAll();
    host.onUpdate?.();
    void readThread();
    if (host.visible()) tellViewing(current);
  }

  /** The open thread is read: the core forgets that it was unread. */
  async function readThread(): Promise<void> {
    const m = member();
    if (host.visible() && currentRoomId() === null) host.onReadThread?.(m);
    if (!host.visible() || !m.unread) return;
    if (list) list = { ...list, members: list.members.map((other) => (other.id === m.id ? { ...other, unread: false, unread_from: null } : other)) };
    column.draw();
    if (m.id === RAPHAEL_ID) return;
    try {
      await api.membersRead(m.id);
    } catch {
      // it stays marked; the next list says so
    }
  }

  /** Tells the core which thread is on screen (null: none), so that what arrives there is no news. */
  function tellViewing(id: number | null): void {
    if (viewing === id) return;
    viewing = id;
    void Promise.resolve()
      .then(() => api.membersViewing(id))
      .catch(() => {});
  }

  function changed(delay = REFRESH_DELAY_MS): void {
    const due = Date.now() + delay;
    if (refreshTimer !== null && refreshDue <= due) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshDue = due;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void load(true);
    }, delay);
  }

  // ---------- choosing ----------

  function select(id: number): void {
    // Another member (or the same one, from the sidebar) leaves the settings page for the conversation.
    panelBeforeSettings = null;
    settings.close();
    if (!host.visible()) host.app.go("agent");
    if (id === current) {
      if (currentRoomId() !== null) { host.onSelect(id, true); drawAll(); void readThread(); }
      // Reopening the same conversation preserves its details state.
      return;
    }
    current = id;
    fresh = new Set();
    host.onSelect(id);
    details.showMember();
    drawAll();
    if (host.visible()) tellViewing(id);
    void readThread();
  }

  function setDetails(next: boolean, overview = false): void {
    if (next === open) { if (next && overview) details.overview(); return; }
    open = next;
    host.onDetailsChange?.(open);
    const page = details.el.parentElement;
    stopLeaving?.();
    stopLeaving = null;
    if (next) {
      details.el.hidden = false;
      placePanel();
      page?.setAttribute("data-det", "open");
      details.el.classList.remove("is-in");
      void details.el.offsetWidth;
      details.el.classList.add("is-in");
      details.overview();
      details.refreshRoutines();
      if (document.documentElement.hasAttribute("data-keys")) details.el.querySelector<HTMLElement>('[data-det="close"]')?.focus({ preventScroll: true });
    } else {
      details.el.classList.remove("is-in");
      stopLeaving = leave(details.el, 160, () => {
        details.el.hidden = true;
        page?.removeAttribute("data-det");
        stopLeaving = null;
      });
      if (host.focusHeader) host.focusHeader();
      else picker.focus({ preventScroll: true });
    }
    drawHead();
  }

  picker.addEventListener("click", () => {
    const people: Choice[] = orderedMembers(list).map((m) => ({
      value: String(m.id),
      label: m.name,
      ...(memberRole(m) ? { detail: memberRole(m) } : {}),
      ...(m.waiting ? { tag: t("members.waitingShort") } : m.unread ? { tag: t("members.unread") } : {}),
    }));
    openMenu(picker, people, String(current), (value) => select(Number(value)), undefined, [
      { label: t("chat.searchAll"), icon: "search", run: () => column.openSearch(picker) },
      { label: t("rooms.title"), icon: "chat", run: () => { closeMenu(); void openRoomsMenu(picker); } },
      {
        label: t("members.newMember"),
        icon: "plus",
        run: () => {
          closeMenu();
          picker.focus({ preventScroll: true });
          newMember(null);
        },
      },
    ]);
  });

  // ---------- changing ----------

  async function update(id: number, patch: MemberPatch): Promise<boolean> {
    try {
      await api.membersUpdate(id, patch);
    } catch (err) {
      toaster.info(describeError(err));
      await load();
      return false;
    }
    await load();
    return true;
  }

  function newMember(groupId: number | null, store = false): void {
    window.dispatchEvent(new Event("raphael:close-sidebar"));
    openMemberCreator({
      store,
      groupId,
      taken: (list?.members ?? []).map((m) => m.name),
      async create(made) {
        let answer: Awaited<ReturnType<typeof api.membersCreate>>;
        try {
          answer = await api.membersCreate({ ...made, ui_language: getLocale() });
        } catch (err) {
          toaster.info(describeError(err));
          return null;
        }
        const id = answer.member.id;
        toaster.info(t("members.created", { p0: made.name }));
        await load();
        select(id);
        // the routine the core offers goes in only with the owner's 加入, once the maker is gone
        const offer = answer.routine_offer;
        if (offer) {
          setTimeout(async () => {
            if (!(await offerRoutine(offer))) return;
            try {
              await api.routinesCreate({ member_id: id, ...offer });
            } catch (err) {
              toaster.info(describeError(err));
            }
            if (current === id) details.showMember();
          }, 0);
        }
        return answer.member;
      },
    });
  }

  const command = (id: string): void => {
    if (id === "search") column.openSearch(picker);
    else if (id === "sidebar") window.dispatchEvent(new Event("raphael:toggle-sidebar"));
    else if (id === "new") newMember(null);
    else if (id.startsWith("member:")) { const member = orderedMembers(list)[Number(id.slice(7)) - 1]; if (member) select(member.id); }
    else if (host.visible()) window.dispatchEvent(new CustomEvent("raphael:conversation-shortcut", { detail: id }));
  };
  window.addEventListener("keydown", event => {
    const id = shortcut(event);
    if (!id) return;
    if (["find", "previous", "next", "new"].includes(id) && !host.visible()) return;
    event.preventDefault();
    if (id !== "palette") { command(id); return; }
    const commands: Command[] = [
      { id: "search", label: t("chat.searchAll"), keys: "Ctrl+Shift+F", run: () => command("search") },
      { id: "sidebar", label: t("shortcuts.sidebar"), keys: "Ctrl+B", run: () => command("sidebar") },
      { id: "home", label: t("nav.home"), run: () => host.app.go("home") },
      { id: "settings", label: t("nav.settings"), run: () => host.app.go("settings", "general") },
      ...orderedMembers(list).map((member, index) => ({ id: "person:" + member.id, label: member.name, keys: index < 9 ? "Ctrl+" + (index + 1) : undefined, run: () => select(member.id) })),
    ];
    if (host.visible()) commands.unshift(
      { id: "find", label: t("agent.search"), keys: "Ctrl+F", run: () => command("find") },
      { id: "previous", label: t("shortcuts.previous"), keys: "Alt+↑", run: () => command("previous") },
      { id: "next", label: t("shortcuts.next"), keys: "Alt+↓", run: () => command("next") },
      { id: "new", label: t("members.newMember"), keys: "Ctrl+N", run: () => command("new") },
    );
    openCommandPalette(picker, commands);
  });
  // Report real owner interaction, rather than background refreshes, at most once a minute.
  let lastActivity = 0;
  const ownerActivity = (): void => {
    if (document.hidden || Date.now() - lastActivity < 60_000) return;
    lastActivity = Date.now();
    void api.core("members.viewing", { activity_only: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => {});
  };
  window.addEventListener("pointerdown", ownerActivity);
  window.addEventListener("keydown", ownerActivity);

  /** Runs a change of the groups, says why it failed if it did, and reads the list again. */
  async function groupChange(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (err) {
      toaster.info(describeError(err));
    }
    await load();
  }

  async function newGroup(): Promise<void> {
    const name = await askGroupName(t("members.newGroup"));
    if (name !== null) await groupChange(() => api.groupsCreate(name));
  }

  async function renameGroup(id: number): Promise<void> {
    const group = list?.groups.find((g) => g.id === id);
    if (!group) return;
    const name = await askGroupName(t("members.rename"), group.name);
    if (name !== null && name !== group.name) await groupChange(() => api.groupsUpdate(id, { name }));
  }

  async function sources(id: number): Promise<void> {
    const group = list?.groups.find((g) => g.id === id);
    if (!group) return;
    const next = await editSources(group);
    if (next !== null) await groupChange(() => api.groupsUpdate(id, { sources: next }));
  }

  async function deleteGroup(id: number): Promise<void> {
    const group = list?.groups.find((g) => g.id === id);
    if (!group || !(await confirmDelete(group.name))) return;
    await groupChange(() => api.groupsDelete(id));
  }

  window.addEventListener("raphael:new-member", () => newMember(null));
  window.addEventListener("raphael:member-store", () => newMember(null, true));
  onLocaleChange(() => { drawAll(); });
  // A group chat comes where the conversation is: the settings page gives way to it.
  window.addEventListener("raphael:open-room", () => { panelBeforeSettings = null; settings.close(); });
  details.el.hidden = !open;
  drawAll();

  return {
    column: column.el,
    details: details.el,
    settings,
    // The settings page takes the room: the details panel folds away while it is open, at every width, and comes back
    // as it was when the page is left for the conversation.
    openSettings() {
      if (!settings.isOpen()) panelBeforeSettings = open;
      setDetails(false);
      settings.open();
    },
    closeSettings() {
      const wasOpen = settings.isOpen(), restore = panelBeforeSettings;
      panelBeforeSettings = null;
      settings.close();
      if (wasOpen && restore) setDetails(true);
    },
    computer() { setDetails(true); details.select('computer'); },
    picker,
    pill,
    current: () => current,
    nameOf: (id) => memberOf(list, id)?.name ?? "",
    groups: () => [...(list?.groups ?? [])].sort((a, b) => a.position - b.position),
    bindMentions: input => { fields.add(bindComposerMentions(input, () => ({ list }))); },
    mentionTargets: () => (list ? mentionTargets(list) : []),
    faceOf(id, size) {
      const found = memberOf(list, id);
      return found ? faceHTML(found, size, { cls: "sys-face" }) : "";
    },
    accentOf: id => nameAccent(memberOf(list, id) ?? { id }),
    colorOf: id => memberColor(memberOf(list, id) ?? { id }),
    member,
    select,
    load,
    show: () => column.draw(),
    changed,
    detailsOpen: () => open,
    setDetails,
    refreshRoutines(memberId) {
      if (host.visible() && memberId === current) details.refreshRoutines();
    },
    follow(event) {
      const restarted = ["CoreReady"].includes(event.type);
      if (restarted) { listJSON = ""; viewing = undefined; }
      if (restarted || event.type === "MembersChanged" || event.type === "ConnectionsChanged") {
        if (refreshTimer !== null) clearTimeout(refreshTimer);
        refreshTimer = null;
        void load(true);
        details.refreshResources();
        settings.refresh();
      } else if (event.type === "RoutinesChanged" && event.member_id === current) {
        details.refreshRoutines();
      } else if (event.type === "MemoryChanged") {
        settings.refreshMemory(event.member_id, event.space);
      } else if (event.type === "MemberActivity") {
        setSlimeState(event.member_id, event.state, event.label);
        // A press of a panel button ends when the member stops; the bot it set up shows at once (owner, 2026-11-07).
        settleAsks(event.member_id, event.state);
        if (event.member_id === current && open && ["idle", "done", "error", "waiting", "blocked"].includes(event.state)) details.refreshChannels();
      } else if (event.type === 'AgentTurn' && (event.member_id ?? 0) === current && open) {
        // Skills, commands and memory change through their own events; a streaming turn can only add files.
        details.refreshWork('turn');
      } else if (event.type === 'WorkerChanged' && open) {
        details.refreshWork('task');
      }
    },
    hide() {
      refreshOnShow = true;
      column.draw();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
      tellViewing(null);
    },
  };
}
