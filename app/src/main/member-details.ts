// The landing view holds tasks, routines and conversations. Identity and resources live
// behind the gear; fields being typed in survive live member updates.

import { noticeHTML } from "./missing";
import { openRoutineDialog } from "./routine-dialog";
import { mountConversationList } from "./conversation-list";
import * as api from "./api";
import { mountMemberResources } from "./member-profile-resources";
import "./member-panel.css";
import { changeRaphaelAvatar, resetRaphaelAvatar } from "./avatar-settings";
import { currentAvatar } from "./avatar";
import { getLocale, t } from "./i18n";
import { groupChoices, groupFromValue, groupValue, openAvatarPicker } from "./member-dialogs";
import { defaultSlimeAvatar } from "./slime";
import { createMemory } from "./memory-view";
import { memoryHTML } from "./memory-view";
import {
  INSTRUCTIONS_MAX,
  NAME_MAX,
  PERSONALITY_MAX,
  RAPHAEL_ID,
  ROLE_MAX,
  cleanName,
  faceHTML,
  isMemberNameTaken,
  routineSentenceHTML, routineStatus,
  sourceLabel,
} from "./members";
import type { AppContext, Member, MemberPatch, MembersList, Routine } from "./types";
import { esc, ico, iconButton, openMenu, patchHTML, sel, tg, toaster } from "./ui";
import { eventRead } from './event-read';
import { panelTasksHTML, panelLibraryHTML, readPanelWork, type PanelWork } from './member-panel-work';
import { tabs } from './ui';
import { openActions } from "./member-column";
import { routineRunState, testRoutine } from "./routine-run";

export type DetailsTab = "details" | "library" | "computer" | "settings" | "memory" | "skills" | "commands" | "voice";

export interface DetailsHost {
  app: AppContext;
  /** The member whose thread is open. */
  member(): Member;
  list(): MembersList | null;
  visible?(): boolean;
  /** Changes the member and reads the list again; false (with a toast) when the core refused. */
  update(id: number, patch: MemberPatch): Promise<boolean>;
  /** A picture of this PC for the member; then the list again. */
  /** The × of the panel. */
  close(): void;
  edit?(member: Member): void;
  hide?(member: Member): void;
  openConversation?(member: number, conversation: number): void;
  openTurn?(member: number, conversation: number | undefined, turn: number): void;
  /** The conversation open with this member, undefined for their default. */
  conversationOf?(member: number): number | undefined;
}

export interface DetailsPanel {
  readonly el: HTMLElement;
  /** Draws the panel again (the list changed, or the language). */
  draw(): void;
  overview(): void;
  select(tab: 'details' | 'library' | 'computer'): void;
  /** Reads the selected member's routines and memory, and opens Details. */
  showMember(): void;
  refreshRoutines(): void;
  refreshMemory(memberId: number, space?: "own" | "shared"): void;
  refreshResources(): void;
  /** Work moved: a task changed state, or a turn of the selected member changed (only files can follow from that). */
  refreshWork(cause: 'task' | 'turn'): void;
}

export function createDetails(host: DetailsHost): DetailsPanel {
  const el = document.createElement("aside");
  el.className = "mb-det";
  el.innerHTML =
    `<div class="mb-det-head">${iconButton("left", t("members.panelBack"), ' data-det="back" hidden', "mb-tool")}<span class="mb-det-fill"></span>${iconButton("gear", t("computer.settings"), ' data-det="gear"', "mb-tool")}${iconButton("x", t("members.close"), ' data-det="close"', "mb-tool")}</div>` +
    `<div class="mb-det-scroll"><div class="mb-who"></div><div class="mb-tabs"></div><div class="mb-tab-body" role="tabpanel" id="member-panel-body"></div></div>`;
  const who = el.querySelector<HTMLElement>(".mb-who")!;
  const tabBar = el.querySelector<HTMLElement>(".mb-tabs")!;
  const body = el.querySelector<HTMLElement>(".mb-tab-body")!;
  const closeButton = el.querySelector<HTMLElement>('[data-det="close"]')!;
  const backButton = el.querySelector<HTMLElement>('[data-det="back"]')!;
  let drawn = "";

  let tab: DetailsTab = "details";
  let work: PanelWork | null = null, workFailed = false, workEpoch = 0, fileLimit = 12;
  async function loadWork(fromEvent = false): Promise<void> {
    const epoch = ++workEpoch, id = host.member().id, limit = fileLimit;
    try {
      // A burst of turns reads the work list once, as the counts below do.
      const result = await (fromEvent ? eventRead(`members.panel:${id}:${limit}`, () => readPanelWork(id, limit), host.app) : readPanelWork(id, limit));
      if (epoch !== workEpoch || id !== host.member().id) return;
      work = {tasks: result?.tasks ?? [], files: result?.files ?? [], has_more: result?.has_more ?? false}; workFailed = false;
    } catch { if (epoch !== workEpoch || id !== host.member().id) return; workFailed = true; }
    draw();
  }
  // Events carry no owner for a task, so a busy team would read the list on every one: wait for a
  // quiet 1.5 s, and never longer than 5 s while work keeps moving.
  let workTimer: ReturnType<typeof setTimeout> | undefined, workSince = 0;
  function scheduleWork(): void {
    const now = performance.now();
    if (workTimer === undefined) workSince = now;
    else clearTimeout(workTimer);
    workTimer = setTimeout(() => { workTimer = undefined; if (!el.hidden) void loadWork(true); }, Math.min(1500, Math.max(0, workSince + 5000 - now)));
  }
  function select(page: 'details' | 'library' | 'computer'): void {
    tab = page; draw();
    el.dispatchEvent(new CustomEvent('member-panel-tab', {bubbles:true}));
    if (page !== 'computer') void loadWork();
  }
  let routines: Routine[] | "loading" | "failed" = "loading";
  let routineLoads = 0;
  /** The long fields that are open (個性, 指示): closed, each is one line. */
  const openFields = new Set<string>();
  /** The member the panel was last drawn for: its fields are drawn afresh when it changes. */
  let drawnFor: number | null = null;
  let counts = { skills: 0, commands: 0, memory: 0 };
  let countEpoch = 0, countsStale = false;
  let resources: ReturnType<typeof mountMemberResources> | null = null;
  let resourceKey = "";
  const conversationHost = document.createElement("div");
  let conversationMember: number | null = null;
  let conversationList: ReturnType<typeof mountConversationList> | null = null;
  function drawConversations(): void {
    const memberId = host.member().id;
    if (conversationMember !== memberId) {
      conversationList?.destroy(); conversationList = null; conversationMember = memberId;
    }
    const slot = body.querySelector<HTMLElement>('[data-slot="conversations"]');
    if (!slot || !host.openConversation) return;
    if (conversationHost.parentElement !== slot) slot.replaceChildren(conversationHost);
    if (!conversationList) conversationList = mountConversationList(conversationHost, {
      scope: host.app,
      active: () => host.visible?.() ?? true,
      memberId, collapseWhenEmpty: true, showHeading: false,
      onVisibility(visible) { const current = body.querySelector<HTMLElement>('[data-slot="conversations"]'); if (current && current.hidden !== !visible) current.hidden = !visible; },
      onOpen(id) { host.openConversation?.(memberId, id); },
      current: () => host.conversationOf?.(memberId),
    });
    slot.hidden = conversationHost.hidden;
  }
  async function loadCounts(fromEvent = false): Promise<void> {
    if (el.hidden) { countsStale = true; return; }
    const epoch = ++countEpoch, id = host.member().id;
    const result = await Promise.allSettled([
      fromEvent ? eventRead(`members.skills.list:${id}`,()=>api.core<{skills: unknown[]}>("members.skills.list", {member_id: id}),host.app) : api.core<{skills: unknown[]}>("members.skills.list", {member_id: id}),
      fromEvent ? eventRead(`members.commands.list:${id}`,()=>api.core<{commands: unknown[]}>("members.commands.list", {member_id: id}),host.app) : api.core<{commands: unknown[]}>("members.commands.list", {member_id: id}),
      fromEvent ? eventRead(`memory.get:${id}`,()=>api.core<{entries:number}>('memory.get',{member_id:id,space:'own'}),host.app) : api.core<{ entries: number }>("memory.get", { member_id: id, space: "own" }),
    ]);
    if (epoch !== countEpoch || id !== host.member().id) return;
    counts = {
      skills: result[0].status === "fulfilled" ? result[0].value?.skills?.length ?? 0 : 0,
      commands: result[1].status === "fulfilled" ? result[1].value?.commands?.length ?? 0 : 0,
      memory: result[2].status === "fulfilled" ? result[2].value?.entries ?? 0 : 0,
    };
    draw();
  }
  function pageRow(page: DetailsTab, label: string, icon: Parameters<typeof ico>[0], detail = ""): string {
    return `<button type="button" class="btn mb-panel-row" data-det="tab" data-tab="${page}" data-k="det-tab:${page}">${ico(icon)}<span>${esc(label)}</span><small>${esc(detail)}</small>${ico("right")}</button>`;
  }
  function pageRows(member: Member): string {
    return `<nav class="mb-panel-pages" aria-label="${esc(t("members.details"))}">` +
      `<div class="mb-panel-row mb-panel-preference"><span class="mb-panel-row-copy"><span>${esc(t("members.profile.draft"))}</span><small>${esc(t("members.profile.draftHint"))}</small></span>${tg(member.draft_first ?? true, t("members.profile.draft"), ' data-det="draft" data-k="det-draft"')}</div>` +
      pageRow("memory", t("mem.title"), "memory", t("members.panelNotes", {p0: counts.memory})) +
      pageRow("skills", t("members.panelSkills"), "sparkle", t("members.panelCount", {p0: counts.skills})) +
      pageRow("commands", t("members.panelCommands"), "steps", t("members.panelCount", {p0: counts.commands})) +
      pageRow("voice", t("members.panelVoice"), "voice") +
      (member.id === RAPHAEL_ID ? "" : `<button type="button" class="btn mb-panel-row" data-det="hide">${ico("eyeOff")}<span class="mb-panel-row-copy"><span>${esc(t("members.panelHide"))}</span><small>${esc(t("members.panelHideHint"))}</small></span></button>`) + `</nav>`;
  }

  const memoryHost = {
    visible: () => el.isConnected && !el.hidden && tab === "memory",
    redraw: () => draw(),
    memberId: () => host.member().id,
    ownerName: () => host.member().name,
  };
  const shared = createMemory({ ...memoryHost, space: "shared" });
  const own = createMemory({ ...memoryHost, space: "own" });
  const memories = [shared, own];

  // ---------- drawing ----------

  function whoHTML(member: Member): string {
    if (tab !== 'settings') return `<span class="mb-panel-identity">${faceHTML(member, 32)}<b>${esc(member.name)}${member.role ? ` <span>· ${esc(member.role)}</span>` : ''}</b></span>`;
    // The face is the button that changes its picture.
    const face =
      `<span class="mb-who-face"><button type="button" class="btn mb-avbtn" data-det="avatar" data-k="det-avatar" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("members.changeAvatar"))}" title="${esc(t("members.changeAvatar"))}">` +
      faceHTML(member, 64) +
      `</button></span>`;
    if (member.id === RAPHAEL_ID) return face + `<b class="mb-who-name">${esc(member.name)}</b>`;
    return (
      face +
      `<input class="mb-who-name mb-edit" id="mb-det-name" data-member="${member.id}" type="text" maxlength="${NAME_MAX}" value="${esc(member.name)}" aria-label="${esc(t("members.name"))}" autocomplete="off" spellcheck="false">` +
      `<input class="mb-who-role mb-edit" id="mb-det-role" data-member="${member.id}" type="text" maxlength="${ROLE_MAX}" value="${esc(member.role)}" placeholder="${esc(t("members.role"))}" aria-label="${esc(t("members.role"))}" autocomplete="off" spellcheck="false">`
    );
  }

  function routineRowHTML(routine: Routine): string {
    return (
      `<div class="mb-routine-row" data-k="routine-row:${routine.id}"><button type="button" class="btn mb-rt${routine.when ? " is-event" : ""}" data-det="routine-open" data-id="${routine.id}" data-routine="${routine.id}" data-k="routine:${routine.id}">` +
      `<span class="mb-rt-state${routine.enabled ? " is-on" : ""}" aria-label="${esc(t(routine.enabled ? "computer.routineOn" : "computer.routinePaused"))}">${ico(routine.enabled ? "clock" : "pause")}</span>` +
      `<span class="mb-rt-main"><b>${esc(routine.title)}</b><span>${routineSentenceHTML(routine)}</span>${routine.when || routine.last_error ? `<span>${esc(routineStatus(routine))}</span>` : ""}</span>` +
      `</button>${iconButton("more", t("members.more", {p0:routine.title}), ` data-det="routine-menu" data-id="${routine.id}" aria-haspopup="menu" aria-expanded="false"`, "row mb-tool")}</div>`
    );
  }

  function routinesHTML(): string {
    const head =
      `<div class="mb-dh"><span>${esc(t("members.routines"))}</span>` +
      iconButton("plus", t("members.routineAdd"), ` data-det="routine-add" data-k="routine-add"`, "row mb-tool") +
      `</div>`;
    if (routines === "loading") return head + `<span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span>`;
    if (routines === "failed") return head + noticeHTML("routines");
    const rows = routines.length ? routines.map(routineRowHTML).join("") : `<p class="mp-empty">${esc(t("members.profile.noRoutines"))}</p>`;
    return head + `<div class="mb-rts">${rows}</div>`;
  }

  /**
   * A long field, closed to its name and its first line (or 「未填寫」) behind a real button; open,
   * the box under it. Open while it is being typed in, so a redraw never closes it under the owner.
   */
  function foldHTML(id: string, label: string, value: string, box: string): string {
    const open = openFields.has(id);
    const peek = value.trim().split(/\r?\n/, 1)[0] || t("members.notSet");
    return `<section class="mb-field mb-fold-field">` +
      `<button type="button" class="btn mb-fold-head" data-det="fold" data-field="${id}" data-k="fold:${id}" aria-expanded="${open}" aria-controls="${id}-body">` +
      `<span class="mb-dh">${esc(label)}</span>${open ? "" : `<span class="mb-peek">${esc(peek)}</span>`}${ico("down")}</button>` +
      `<div class="mb-fold-body" id="${id}-body"${open ? "" : " hidden"}>${box}</div></section>`;
  }

  function detailsHTML(member: Member): string {
    if (member.id === RAPHAEL_ID) return pageRows(member);
    const list = host.list();
    const group = list?.groups.find((g) => g.id === member.group_id) ?? null;
    const sources = group?.sources ?? [];
    return (
      `<button type="button" class="btn mb-panel-row" data-det="edit">${ico("pencil")}<span>${esc(t("members.sideEdit"))}</span></button>` + foldHTML("mb-det-personality", t("members.personality"), member.personality ?? "",
        `<textarea id="mb-det-personality" data-member="${member.id}" class="mb-fin mb-ta" rows="3" maxlength="${PERSONALITY_MAX}" placeholder="${esc(t("members.personalityHint"))}">${esc(member.personality ?? "")}</textarea>`) +
      foldHTML("mb-det-instr", t("members.instructions"), member.instructions ?? "",
        `<textarea id="mb-det-instr" data-member="${member.id}" class="mb-fin mb-ta" rows="4" maxlength="${INSTRUCTIONS_MAX}">${esc(member.instructions ?? "")}</textarea>`) +
      `<section class="mb-field"><div class="mb-dh">${esc(t("members.group"))}</div>` +
      sel(groupChoices(list?.groups ?? []), groupValue(group ? group.id : null), t("members.group"), ' data-det="group" data-k="det-group"') +
      `</section>` +
      pageRows(member) +
      (sources.length
        ? `<section class="mb-field"><div class="mb-dh">${esc(t("members.sources"))}</div><div class="mb-chips">` +
          sources.map((source) => `<span class="mb-chip">${esc(sourceLabel(source))}</span>`).join("") +
          `</div></section>`
        : "")
    );
  }

  function draw(): void {
    if (el.hidden) return;
    if (countsStale) { countsStale = false; void loadCounts(); }
    const member = host.member();
    const sameMember = drawnFor === member.id;
    const focused = document.activeElement as HTMLElement | null;
    if (sameMember) for (const [id, value] of [['mb-det-name', member.name], ['mb-det-role', member.role], ['mb-det-personality', member.personality ?? ''], ['mb-det-instr', member.instructions ?? '']]) {
      const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
      if (field && field !== focused && field.value !== value) field.value = value;
    }
    const face = faceHTML(member, 64).replace(/--slime-(?:delay|since):[^;"\s]+;?| data-slime-mounted="[\d.]+"/g, "");
    const signature = JSON.stringify([member, face, host.list()?.groups, counts, routines, work, workFailed, tab, [...openFields], getLocale(), !!host.openConversation, host.conversationOf?.(member.id), tab === "memory" ? memories.map(list => list.view()) : null]);
    if (drawn === signature) return;
    drawn = signature;
    el.dataset.detailsTab = tab;
    closeButton.setAttribute("aria-label", t("members.close"));
    closeButton.title = t("members.close");
    backButton.hidden = ['details', 'library', 'computer'].includes(tab);
    backButton.title = t('members.panelBack'); backButton.setAttribute('aria-label', backButton.title);
    const gear = el.querySelector<HTMLElement>('[data-det="gear"]')!;
    gear.title = t("computer.settings"); gear.setAttribute("aria-label", gear.title);
    el.setAttribute("aria-label", t("members.panel"));
    const typingIn = focused && el.contains(focused) && (focused.matches("input, textarea") ? focused.id : null);
    const scroll = el.querySelector<HTMLElement>(".mb-det-scroll")!;
    const scrollTop = scroll.scrollTop;
    const textField = typingIn ? focused as HTMLInputElement | HTMLTextAreaElement : null;
    const selection = textField && typeof textField.selectionStart === "number"
      ? [textField.selectionStart, textField.selectionEnd!, textField.selectionDirection] as const : null;
    const focusKey = focused && el.contains(focused) ? focused.closest<HTMLElement>("[data-k]")?.dataset.k : undefined;
    // the name and role are drawn afresh for another member, and left alone while they are typed in
    if (!sameMember || !(typingIn === "mb-det-name" || typingIn === "mb-det-role")) {
      if (!sameMember && (typingIn === "mb-det-name" || typingIn === "mb-det-role")) {
        void saveField(focused as HTMLInputElement, true);
      }
      patchHTML(who, whoHTML(member));
    } else {
      const av = who.querySelector<HTMLElement>(".mb-avbtn");
      if (av) patchHTML(av, faceHTML(member, 64));
    }
    // A focused field keeps its draft; the other field can still change remotely.
    for (const [id, value] of [["mb-det-name", member.name], ["mb-det-role", member.role]]) {
      const input = who.querySelector<HTMLInputElement>(`#${id}`);
      if (input && (!sameMember || id !== typingIn) && input.value !== value) input.value = value;
    }
    drawnFor = member.id;
    who.hidden = false;
    const mainTab = ['details', 'library', 'computer'].includes(tab);
    tabBar.hidden = !mainTab;
    body.hidden = tab === 'computer';
    patchHTML(tabBar, tabs(['details', 'library', 'computer'].map(id => ({id, label:t(({details:'members.panelTab.details', library:'members.panelTab.library', computer:'members.panelTab.computer'} as const)[id as 'details' | 'library' | 'computer']), attrs:` id="member-tab-${id}" data-det="tab" data-tab="${id}" aria-controls="${id === 'computer' ? 'member-computer-panel' : 'member-panel-body'}" tabindex="${tab === id ? 0 : -1}"`})), tab, {kind:'nav', plain:true, fill:true, label:t('members.panel')}));
    body.setAttribute('aria-labelledby', `member-tab-${tab}`);
    const typingText = typingIn === "mb-det-instr" || typingIn === "mb-det-personality";
    const kept = typingText ? (focused as HTMLElement).closest<HTMLElement>("section") : null;
    if (sameMember && kept && kept.parentElement === body && tab === "settings") {
      // Blur saves the box being typed in, so keep its section alive while the other fields update.
      const at = Array.from(body.children).indexOf(kept);
      const next = document.createElement("div");
      next.innerHTML = detailsHTML(member);
      const fresh = Array.from(next.children);
      for (const child of Array.from(body.children)) if (child !== kept) child.remove();
      kept.before(...fresh.slice(0, at));
      kept.after(...fresh.slice(at + 1));
      drawConversations();
      if (scroll.scrollTop !== scrollTop) scroll.scrollTop = scrollTop;
      return;
    }
    if (typingText) void saveField(focused as HTMLTextAreaElement, true);
    const resourceTab = tab === "skills" || tab === "commands" || tab === "voice" ? tab : null;
    const nextResourceKey = resourceTab ? `${member.id}:${resourceTab}` + (resourceTab === "voice" ? `:${member.voice}:${member.read_aloud}:${member.notify}` : "") : "";
    if (resourceKey !== nextResourceKey) { resources?.destroy(); resources = null; resourceKey = nextResourceKey; }
    if (resourceTab) {
      if (!resources) {
        body.replaceChildren();
        resources = mountMemberResources(body, {memberId: member.id, scope: host.app, tab: resourceTab, member, standalone: true, changed: () => void loadCounts()});
      }
    } else {
      if (tab === "details") {
        if (!body.querySelector('.mb-panel-routines')) patchHTML(body, `<section class="mb-panel-tasks" data-k="panel-tasks"></section><section class="mb-panel-routines" data-k="panel-routines"></section><section><div class="mb-dh">${esc(t('members.panelConversations'))}</div><div data-slot="conversations" data-k="panel-conversations"></div></section>`);
        patchHTML(body.querySelector('.mb-panel-tasks')!, panelTasksHTML(work, workFailed));
        patchHTML(body.querySelector('.mb-panel-routines')!, routinesHTML());
      } else if (tab === 'library') {
        conversationHost.remove(); patchHTML(body, panelLibraryHTML(work, workFailed));
      } else if (tab === 'computer') {
        conversationHost.remove(); patchHTML(body, '');
      } else {
        conversationHost.remove();
        patchHTML(body, tab === "settings" ? detailsHTML(member) : memoryHTML(shared.view()) + memoryHTML(own.view()));
      }
    }
    drawConversations();
    if (sameMember && typingIn && typingIn !== "mb-det-name" && typingIn !== "mb-det-role") el.querySelector<HTMLElement>(`#${CSS.escape(typingIn)}`)?.focus({ preventScroll: true });
    else if (sameMember && focusKey) el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    if (sameMember && selection && typingIn) {
      const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(typingIn)}`);
      field?.setSelectionRange(selection[0], selection[1], selection[2] ?? undefined);
    }
    if (sameMember && scroll.scrollTop !== scrollTop) scroll.scrollTop = scrollTop;
  }

  // ---------- routines ----------

  async function loadRoutines(): Promise<void> {
    if (el.hidden) return;
    const mine = ++routineLoads;
    const id = host.member().id;
    try {
      const { routines: read } = await api.routinesList(id);
      if (mine !== routineLoads || id !== host.member().id) return;
      routines = read;
    } catch {
      if (mine !== routineLoads || id !== host.member().id) return;
      if (!Array.isArray(routines)) routines = "failed";
    }
    draw();
  }

  // ---------- the picture, the name and the role ----------

  function avatarMenu(anchor: HTMLElement): void {
    const member = host.member();
    if (member.id === RAPHAEL_ID) {
      openAvatarPicker(anchor, {
        onComputer: () => void changeRaphaelAvatar(),
        more: currentAvatar() !== null ? [{ label: t("settings.avatarReset"), run: () => void resetRaphaelAvatar() }] : [],
      });
      return;
    }
    openAvatarPicker(anchor, {
      slimes: true,
      current: member.avatar || defaultSlimeAvatar(member.id),
      onSlime: (avatar) => void host.update(member.id, { avatar }),
    });
  }

  async function saveField(input: HTMLInputElement | HTMLTextAreaElement, replacing = false): Promise<void> {
    if (input.dataset.saved === "1") return;
    const memberId = input.dataset.member !== undefined ? Number(input.dataset.member) : host.member().id;
    const member = host.list()?.members.find((m) => m.id === memberId) ?? (host.member().id === memberId ? host.member() : null);
    if (!member || member.id === RAPHAEL_ID) return;
    if (replacing || !input.isConnected) input.dataset.saved = "1";
    if (input.id === "mb-det-name") {
      const value = cleanName(input.value);
      if (value === member.name) {
        input.value = member.name;
        return;
      }
      const others = (host.list()?.members ?? []).filter((other) => other.id !== member.id).map((other) => other.name);
      const taken = value !== "" && isMemberNameTaken(value, others);
      if (value === "" || taken) {
        if (taken) toaster.info(t("members.nameTaken", { p0: value }));
        input.value = member.name;
        return;
      }
      input.value = value;
      await host.update(member.id, { name: value });
    } else if (input.id === "mb-det-role") {
      const value = cleanName(input.value);
      input.value = value;
      if (value !== member.role) await host.update(member.id, { role: value });
    } else if (input.id === "mb-det-personality") {
      const value = input.value.trim();
      if (value !== (member.personality ?? "").trim()) await host.update(member.id, { personality: value });
    } else if (input.id === "mb-det-instr") {
      const value = input.value.trim();
      if (value !== (member.instructions ?? "").trim()) await host.update(member.id, { instructions: value });
    }
  }

  // ---------- input ----------

  el.addEventListener("click", (e) => {
    const target = e.target as Element;
    const taskButton = target.closest<HTMLElement>('[data-panel-task],[data-panel-task-menu]');
    if (taskButton) {
      const task = work?.tasks.find(task => task.id === Number(taskButton.dataset.panelTask ?? taskButton.dataset.panelTaskMenu));
      if (!task) return;
      if (taskButton.hasAttribute('data-panel-task')) { if (task.turn_id) host.openTurn?.(host.member().id, task.conversation_id ?? undefined, task.turn_id); }
      else {
        const member = host.member().id;
        openMenu(taskButton, [], '', () => {}, undefined, [{label:t(['queued','running','waiting','waiting_owner','blocked'].includes(task.state) ? 'agent.stop' : 'members.panelRerun'), run() {
          if (member !== host.member().id) return;
          void (['queued','running','waiting','waiting_owner','blocked'].includes(task.state) ? api.workerCancel(task.id) : api.workerRerun(task.id)).then(() => loadWork()).catch(() => toaster.info(t('members.panelReadFailed')));
        }}]);
      }
      return;
    }
    if (target.closest('[data-panel-more]')) { fileLimit = Math.min(100, fileLimit + 12); void loadWork(); return; }
    const fileButton = target.closest<HTMLElement>('[data-panel-file]');
    if (fileButton) {
      const file = work?.files.find(file => file.id === fileButton.dataset.panelFile);
      if (file?.kind === 'page' && file.turn_id) host.openTurn?.(host.member().id, file.conversation_id, file.turn_id);
      else if (file?.path) void api.openTeamFile(file.path).catch(() => toaster.info(t('agent.fileUnavailable')));
      return;
    }
    if (memories.some((list) => list.click(target))) return;
    const act = target.closest<HTMLElement>("[data-det]");
    if (!act || (act as HTMLButtonElement).disabled) return;
    const member = host.member();
    switch (act.dataset.det) {
      case "close":
        host.close();
        break;
      case "edit": host.edit?.(member); break;
      case "draft": void host.update(member.id, { draft_first: !(member.draft_first ?? true) }); break;
      case "gear": tab = "settings"; draw(); break;
      case "back": tab = tab === "settings" ? "details" : "settings"; draw(); break;
      case "hide": host.hide?.(member); break;
      case "avatar":
        avatarMenu(act);
        break;
      case "fold": {
        const field = act.dataset.field ?? "";
        const opening = !openFields.has(field);
        if (opening) openFields.add(field); else openFields.delete(field);
        draw();
        if (opening) el.querySelector<HTMLTextAreaElement>(`#${CSS.escape(field)}`)?.focus({ preventScroll: true });
        break;
      }
      case "tab":
        if (['details', 'library', 'computer'].includes(act.dataset.tab!)) { select(act.dataset.tab as 'details' | 'library' | 'computer'); break; }
        tab = act.dataset.tab as DetailsTab;
        if (tab === "memory") for (const list of memories) void list.load();
        draw();
        break;
      case "group":
        openMenu(act, groupChoices(host.list()?.groups ?? []), groupValue(member.group_id), (value) => {
          const groupId = groupFromValue(value);
          if (groupId !== member.group_id) void host.update(member.id, { group_id: groupId });
        });
        break;
      case "routine-add":
        openRoutineDialog({ members: host.list()?.members ?? [host.member()], memberId: member.id, onSaved: () => void loadRoutines() });
        break;
      case "routine-open": {
        const routine = Array.isArray(routines) ? routines.find(row => row.id === Number(act.dataset.id)) : undefined;
        if (routine) openRoutineDialog({ members: host.list()?.members ?? [member], routine, onSaved: () => void loadRoutines(), onDeleted: () => void loadRoutines() });
        break;
      }
      case "routine-menu": {
        const routine = Array.isArray(routines) ? routines.find(row => row.id === Number(act.dataset.id)) : undefined;
        if (routine) openActions(act, [{id:"test",label:t(routineRunState(routine.id).running ? "routine.testing" : "routine.test"),icon:"play"},{id:"edit",label:t("members.profile.editResource"),icon:"pencil"}], choice => {
          openRoutineDialog({members:host.list()?.members ?? [member],routine,onSaved:()=>void loadRoutines(),onDeleted:()=>void loadRoutines()});
          if (choice === "test") void testRoutine(routine.id);
        });
        break;
      }
    }
  });

  el.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    for (const list of memories) if (list.input(target)) break;
  });
  el.addEventListener("keydown", (e) => {
    if (memories.some((list) => list.key(e))) return;
    const target = e.target as HTMLElement;
    if (tabBar.contains(target) && target.matches('[role="tab"]') && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const pages = ['details','library','computer'] as const;
      const at = pages.indexOf(tab as typeof pages[number]);
      select(pages[e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (at + (e.key === 'ArrowRight' ? 1 : 2)) % 3]);
      tabBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); return;
    }
    if (e.key === "Enter" && !e.isComposing && target instanceof HTMLInputElement && (target.id === "mb-det-name" || target.id === "mb-det-role")) {
      e.preventDefault();
      target.blur();
    } else if (e.key === "Escape" && target instanceof HTMLInputElement && (target.id === "mb-det-name" || target.id === "mb-det-role")) {
      e.preventDefault();
      e.stopPropagation();
      const member = host.member();
      target.value = target.id === "mb-det-name" ? member.name : member.role;
      target.blur();
    }
  });
  el.addEventListener("focusout", (e) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (["mb-det-name", "mb-det-role", "mb-det-personality", "mb-det-instr"].includes(target.id)) void saveField(target);
    }
  });

  return {
    el,
    draw,
    overview() { select('details'); },
    select,
    refreshRoutines() { void loadRoutines(); },
    refreshResources() { void loadCounts(true); void resources?.refresh(true); if (tab === 'details' || tab === 'library') void loadWork(true); },
    refreshWork(cause) { if (!el.hidden && (tab === 'library' || (cause === 'task' && tab === 'details'))) scheduleWork(); },
    refreshMemory(memberId, space) {
      if (el.hidden) return;
      if (memberId === host.member().id) {
        const id=memberId;
        void eventRead(`memory.get:${id}`,()=>api.core<{entries:number}>('memory.get',{member_id:id,space:'own'}),host.app).then(result=>{if(id===host.member().id){counts.memory=result.entries;draw();}}).catch(()=>{});
      }
      if (!memoryHost.visible()) return;
      if (space !== "own") void shared.load();
      if (space !== "shared" && memberId === host.member().id) void own.load();
    },
    showMember() {
      tab = "details";
      work = null; workFailed = false; fileLimit = 12; void loadWork();
      counts = {skills: 0, commands: 0, memory: 0};
      void loadCounts();
      routines = "loading";
      for (const list of memories) list.reset();
      draw();
      void loadRoutines();
    },
  };
}
