// The landing view holds tasks, routines and conversations, the member's bots, its library and its computer. Everything
// the owner changes about a member lives on the member settings page (member-settings.ts), which the gear opens in the
// main area where the conversation is.

import { noticeHTML } from "./missing";
import "./messaging.css";
import { openRoutineView } from "./routine-view";
import { mountConversationList } from "./conversation-list";
import * as api from "./api";
import "./member-panel.css";
import { getLocale, t } from "./i18n";
import { openMemberAvatarMenu } from "./member-avatar-menu";
import {
  RAPHAEL_ID,
  faceHTML,
  routineSentenceHTML, routineStatus, stableMember,
} from "./members";
import type { AppContext, Member, MemberPatch, MembersList, Routine } from "./types";
import { esc, ico, iconButton, patchHTML, tg, toaster } from "./ui";
import { eventRead } from './event-read';
import { createAttachmentMedia } from "./attachment-media";
import { openMediaLightbox } from "./media-lightbox";
import { LIBRARY_LIMIT, panelLibraryHTML, readPanelWork, type LibraryFilter, type PanelWork } from './member-panel-work';
import { tabs } from './ui';
import { describeError } from "./format";
import { askInChat, askPending, onAskPending } from "./chat-ask";
import { type Messaging, type MessagingKind, chatChannelsHTML, createMemberChannel, createRaphaelChannel } from "./messaging";

export type DetailsTab = "details" | "library" | "computer";

export interface DetailsHost {
  app: AppContext;
  /** The member whose thread is open. */
  member(): Member;
  list(): MembersList | null;
  visible?(): boolean;
  /** Changes the member and reads the list again; false (with a toast) when the core refused. */
  update(id: number, patch: MemberPatch): Promise<boolean>;
  /** The × of the panel. */
  close(): void;
  /** The gear: the member settings page opens (or, when it is open, closes) in the main area. */
  openSettings?(): void;
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
  select(tab: DetailsTab): void;
  /** Reads the selected member's routines and work, and opens Details. */
  showMember(): void;
  refreshRoutines(): void;
  refreshResources(): void;
  /** The member stopped working: its bots may have been set up in the conversation, so their rows are read again. */
  refreshChannels(): void;
  /** Work moved: a task changed state, or a turn of the selected member changed (only files can follow from that). */
  refreshWork(cause: 'task' | 'turn'): void;
}

export function createDetails(host: DetailsHost): DetailsPanel {
  const el = document.createElement("aside");
  el.className = "mb-det";
  el.innerHTML =
    // The gear on the left edge and close on the right, apart: the gear opens the member's settings as
    // a page of its own in the main area. Sharing is done from the conversation's header.
    `<div class="mb-det-head" data-window-drag>${iconButton("gear", t("computer.settings"), ' data-det="gear"', "mb-tool")}<span class="mb-det-fill"></span>${iconButton("x", t("members.close"), ' data-det="close"', "mb-tool")}</div>` +
    `<div class="mb-det-scroll"><div class="mb-who"></div><div class="mb-tabs"></div><div class="mb-tab-body" role="tabpanel" id="member-panel-body"></div></div>`;
  const who = el.querySelector<HTMLElement>(".mb-who")!;
  const tabBar = el.querySelector<HTMLElement>(".mb-tabs")!;
  const body = el.querySelector<HTMLElement>(".mb-tab-body")!;
  const closeButton = el.querySelector<HTMLElement>('[data-det="close"]')!;
  const gearButton = el.querySelector<HTMLElement>('[data-det="gear"]')!;
  // The Library's pictures load as a chat's attachments do, when they scroll into view.
  const libraryMedia = createAttachmentMedia(el.querySelector<HTMLElement>(".mb-det-scroll")!, id => api.core("attachments.get", { id }));
  let drawn = "";

  let tab: DetailsTab = "details";
  let work: PanelWork | null = null, workFailed = false, workEpoch = 0;
  /** Which kind of deliverable the Library shows; back to 全部 for another member. */
  let libraryFilter: LibraryFilter = "all";
  async function loadWork(fromEvent = false): Promise<void> {
    const epoch = ++workEpoch, id = host.member().id, limit = LIBRARY_LIMIT;
    try {
      // A burst of turns reads the Library once, as the counts below do.
      const result = await (fromEvent ? eventRead(`members.panel:${id}:${limit}`, () => readPanelWork(id, limit), host.app) : readPanelWork(id, limit));
      if (epoch !== workEpoch || id !== host.member().id) return;
      work = {files: result?.files ?? [], has_more: result?.has_more ?? false}; workFailed = false;
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
  function select(page: DetailsTab): void {
    tab = page; draw();
    el.dispatchEvent(new CustomEvent('member-panel-tab', {bubbles:true}));
    if (page !== 'computer') void loadWork();
  }
  let routines: Routine[] | "loading" | "failed" = "loading";
  let routineLoads = 0;
  /** The member the panel was last drawn for. */
  let drawnFor: number | null = null;
  const conversationHost = document.createElement("div");
  let conversationMember: number | null = null;
  let conversationList: ReturnType<typeof mountConversationList> | null = null;
  /** Only Raphael has a choice of conversation: its main one and its quick questions. */
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
      memberId,
      onOpen(id) { host.openConversation?.(memberId, id); },
      current: () => host.conversationOf?.(memberId),
    });
  }

  // ---------- drawing ----------

  function whoHTML(member: Member): string {
    // A press on the face opens the picker (slimes, 生成) at once; under the pointer a pencil shows on the
    // face as on the owner's own photo in Settings, no words and no dialog in between.
    return `<span class="mb-panel-identity"><button type="button" class="btn mb-face-edit" data-det="avatar" data-k="det-face-edit" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("members.changeAvatar"))}">${faceHTML(member, 64)}<span class="mb-face-pencil" aria-hidden="true">${ico("pencil")}</span></button><b>${esc(member.name)}</b>${member.role ? `<small>${esc(member.role)}</small>` : ''}</span>`;
  }

  // A routine is its title and when it runs, with its own switch on the right
  // The row opens it to read (routine-view.ts).
  function routineRowHTML(routine: Routine): string {
    return (
      `<div class="mb-routine-row" data-k="routine-row:${routine.id}"><button type="button" class="btn mb-rt${routine.when ? " is-event" : ""}" data-det="routine-open" data-id="${routine.id}" data-routine="${routine.id}" data-k="routine:${routine.id}">` +
      `<span class="mb-rt-main"><b>${esc(routine.title)}</b><span>${routineSentenceHTML(routine)}</span>${routine.when || routine.last_error ? `<span>${esc(routineStatus(routine))}</span>` : ""}</span>` +
      `</button>${tg(routine.enabled, t("members.routineSwitch", { p0: routine.title }), ` data-det="routine-toggle" data-id="${routine.id}" data-k="routine-toggle:${routine.id}"`)}</div>`
    );
  }

  function routinesHTML(): string {
    // No plus: a routine is made by asking the member in the conversation, as the empty line says (owner, 2026-11-09).
    const head = `<div class="mb-dh"><span>${esc(t("members.routines"))}</span></div>`;
    if (routines === "loading") return head + `<span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span>`;
    if (routines === "failed") return head + noticeHTML("routines");
    // An empty list is one quiet line outside the tinted list, with a prompt to set a routine in chat.
    if (!routines.length) return head + `<p class="mp-empty">${esc(t("members.profile.noRoutines"))}</p>`;
    return head + `<div class="mb-rts">${routines.map(routineRowHTML).join("")}</div>`;
  }

  // 訊息平台: the member's own Telegram, Slack and Discord bots, Raphael's too (Settings no longer holds them). One that is
  // not set up is a row with 「設定」, which the member does with the owner in its conversation.
  const KINDS: readonly MessagingKind[] = ["telegram", "slack", "discord"];
  const channelHost = { visible: () => el.isConnected && !el.hidden && tab === "details", redraw: () => draw() };
  let channelsFor = -1;
  let channels: Record<MessagingKind, Messaging> | null = null;
  function channelsOf(memberId: number): Record<MessagingKind, Messaging> {
    if (channels && channelsFor === memberId) return channels;
    if (channels) for (const channel of Object.values(channels)) channel.reset();
    channelsFor = memberId;
    channels = Object.fromEntries(KINDS.map((kind) => [kind, memberId === RAPHAEL_ID ? createRaphaelChannel(channelHost, kind) : createMemberChannel(channelHost, () => memberId, kind)])) as Record<MessagingKind, Messaging>;
    return channels;
  }
  const channelViews = (memberId: number): (readonly [MessagingKind, ReturnType<Messaging["view"]>])[] => KINDS.map((kind) => [kind, channelsOf(memberId)[kind].view()] as const);
  function suggestHTML(): string {
    const id = host.member().id;
    return `<div class="mb-dh"><span>${esc(t("settings.paneMessaging"))}</span></div><div class="member-msg">${chatChannelsHTML(channelViews(id), (intent) => askPending(id, intent))}</div>`;
  }
  // A press the member is working on draws its button busy; the end of it frees the button (chat-ask.ts).
  onAskPending(() => { if (!el.hidden) draw(); });

  function draw(): void {
    if (el.hidden) return;
    const member = host.member();
    const sameMember = drawnFor === member.id;
    const focused = document.activeElement as HTMLElement | null;
    const face = faceHTML(member, 64).replace(/--slime-(?:delay|since):[^;"\s]+;?| data-slime-mounted="[\d.]+"/g, "");
    const signature = JSON.stringify([stableMember(member), face, host.list()?.groups, routines, work, workFailed, tab, libraryFilter, getLocale(), !!host.openConversation, host.conversationOf?.(member.id),
      // The bot cards redraw on their own state.
      tab === "details" ? channelViews(member.id).map(([kind, view]) => [kind, { ...view, token: "" }]) : null,
      (["setup-telegram", "setup-slack", "setup-discord"] as const).map((intent) => askPending(member.id, intent))]);
    if (drawn === signature) return;
    drawn = signature;
    el.dataset.detailsTab = tab;
    closeButton.setAttribute("aria-label", t("members.close"));
    closeButton.title = t("members.close");
    gearButton.title = t("computer.settings"); gearButton.setAttribute("aria-label", gearButton.title);
    el.setAttribute("aria-label", t("members.panel"));
    const scroll = el.querySelector<HTMLElement>(".mb-det-scroll")!;
    const scrollTop = scroll.scrollTop;
    const focusKey = focused && el.contains(focused) ? focused.closest<HTMLElement>("[data-k]")?.dataset.k : undefined;
    patchHTML(who, whoHTML(member));
    drawnFor = member.id;
    who.hidden = false;
    tabBar.hidden = false;
    body.hidden = tab === 'computer';
    patchHTML(tabBar, tabs(['details', 'library', 'computer'].map(id => ({id, label:t(({details:'members.panelTab.details', library:'members.panelTab.library', computer:'members.panelTab.computer'} as const)[id as DetailsTab]), attrs:` id="member-tab-${id}" data-det="tab" data-tab="${id}" aria-controls="${id === 'computer' ? 'member-computer-panel' : 'member-panel-body'}" tabindex="${tab === id ? 0 : -1}"`})), tab, {kind:'nav', plain:true, label:t('members.panel')}));
    body.setAttribute('aria-labelledby', `member-tab-${tab}`);
    if (tab === "details") {
      const chief = member.id === RAPHAEL_ID;
      if (!body.querySelector('.mb-panel-routines') || !!body.querySelector('[data-slot="conversations"]') !== chief) {
        conversationHost.remove();
        patchHTML(body, `<section class="mb-panel-routines" data-k="panel-routines"></section>` +
          (chief ? `<section><div class="mb-dh"><span data-panel-conversations-heading>${esc(t('members.panelConversations'))}</span></div><div data-slot="conversations" data-k="panel-conversations"></div></section>` : "") +
          `<section class="mb-panel-suggest" data-k="panel-suggest"></section>`);
      }
      // The skeleton is kept across draws, so its heading follows a language change here.
      const heading = body.querySelector<HTMLElement>('[data-panel-conversations-heading]');
      if (heading && heading.textContent !== t('members.panelConversations')) heading.textContent = t('members.panelConversations');
      patchHTML(body.querySelector('.mb-panel-routines')!, routinesHTML());
      const suggest = body.querySelector<HTMLElement>('.mb-panel-suggest');
      if (suggest) patchHTML(suggest, suggestHTML());
    } else if (tab === 'library') {
      conversationHost.remove(); patchHTML(body, panelLibraryHTML(work, workFailed, Date.now(), libraryFilter)); libraryMedia.sync();
    } else {
      conversationHost.remove(); patchHTML(body, '');
    }
    drawConversations();
    if (sameMember && focusKey) el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
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

  // ---------- input ----------

  el.addEventListener("click", (e) => {
    const target = e.target as Element;
    const filter = target.closest<HTMLElement>('[data-lib-filter]');
    if (filter) { libraryFilter = filter.dataset.libFilter as LibraryFilter; draw(); return; }
    const fileButton = target.closest<HTMLElement>('[data-panel-file]');
    if (fileButton) {
      // A deliverable opens as it was handed over: a picture large, a page at the reply that published it, a link in the
      // browser, an attachment or a delivered file with the computer's own program.
      const file = work?.files.find(file => file.id === fileButton.dataset.panelFile);
      const unavailable = (): void => { toaster.info(t('agent.fileUnavailable')); };
      const picture = fileButton.querySelector<HTMLImageElement>('img[src]');
      if (!file) return;
      if (file.kind === 'image' && picture) openMediaLightbox(fileButton, picture.src);
      else if (file.kind === 'page' && file.turn_id) host.openTurn?.(host.member().id, file.conversation_id ?? undefined, file.turn_id);
      else if (file.kind === 'link' && file.url) void api.openExternalUrl(file.url).catch(unavailable);
      else if (file.attachment_id) void api.openAttachment(file.attachment_id).catch(unavailable);
      else void api.openLibraryFile(host.member().id, file.id).catch(unavailable);
      return;
    }
    const channelKind = target.closest<HTMLElement>(".member-msg [data-msg-kind]")?.dataset.msgKind as MessagingKind | undefined;
    if (channelKind && !target.closest('[data-det="setup"]') && channelsOf(host.member().id)[channelKind]?.click(target)) return;
    const act = target.closest<HTMLElement>("[data-det]");
    if (!act || (act as HTMLButtonElement).disabled) return;
    const member = host.member();
    switch (act.dataset.det) {
      case "close":
        host.close();
        break;
      case "setup": askInChat(member.id, act.dataset.intent as api.AskIntent); break;
      case "gear": host.openSettings?.(); break;
      case "avatar":
        openMemberAvatarMenu(act, member, host.update);
        break;
      case "tab":
        if (['details', 'library', 'computer'].includes(act.dataset.tab!)) select(act.dataset.tab as DetailsTab);
        break;
      // A routine is read here and changed by its member in the conversation (owner, 2026-11-09).
      case "routine-open": {
        const routine = Array.isArray(routines) ? routines.find(row => row.id === Number(act.dataset.id)) : undefined;
        if (routine) openRoutineView(routine, host.list()?.members ?? [member]);
        break;
      }
      case "routine-toggle": {
        const routine = Array.isArray(routines) ? routines.find(row => row.id === Number(act.dataset.id)) : undefined;
        if (!routine) break;
        const enabled = !routine.enabled;
        routine.enabled = enabled;
        act.setAttribute("aria-checked", String(enabled));
        void api.routinesUpdate(routine.id, { enabled })
          .catch((error) => { routine.enabled = !enabled; toaster.info(describeError(error)); })
          .finally(() => void loadRoutines());
        break;
      }
    }
  });

  el.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (tabBar.contains(target) && target.matches('[role="tab"]') && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const pages = ['details','library','computer'] as const;
      const at = pages.indexOf(tab);
      select(pages[e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (at + (e.key === 'ArrowRight' ? 1 : 2)) % 3]);
      tabBar.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  });

  return {
    el,
    draw,
    overview() { select('details'); },
    select,
    refreshRoutines() { void loadRoutines(); },
    refreshChannels() { if (!el.hidden && tab === "details") for (const channel of Object.values(channelsOf(host.member().id))) void channel.load(); },
    refreshResources() { if (tab === 'details' || tab === 'library') void loadWork(true); },
    refreshWork(cause) { if (!el.hidden && (tab === 'library' || (cause === 'task' && tab === 'details'))) scheduleWork(); },
    showMember() {
      tab = "details";
      for (const channel of Object.values(channelsOf(host.member().id))) { channel.reset(); void channel.load(); }
      work = null; workFailed = false; libraryFilter = "all"; void loadWork();
      routines = "loading";
      draw();
      void loadRoutines();
    },
  };
}
