import { openRoomThread } from "./room-thread";
import { carryMessageMetadata, mountMessageMetadata, reactionControlHTML, reactionRowHTML, memoActionHTML, memoTranscriptHTML } from "./message-metadata";
import { roomBoardHTML, roomReportHTML } from "./room-meeting";
import { openMemberThread } from "./team-navigation";
import { wholeLinks } from "./composer-links";
import { readDraftWords, writeDraftWords } from "./composer-drafts";
import { carryInlineSetup } from "./connection-setup";
import { patchThread } from "./thread-diff";
import { sameWire, ThreadRenderCache } from "./thread-render";
import { mountTranscriptWindow, TranscriptWindow } from "./transcript-window";
// Group chat entry points share the global sidebar and the conversation header.
import { mountConversationFind } from "./conversation-find";
import * as api from "./api";
import { eventRead } from './event-read';
import { visibilityGate } from "./window-visibility";
import { onAvatarChange } from "./avatar";
import { ownerFaceHTML } from "./owner-avatar";
import { describeError, formatClock } from "./format";
import { getLocale, onLocaleChange, t } from "./i18n";
import { askGroupName, confirmDelete, openDialog } from "./member-dialogs";
import { openActions } from "./member-column";
import { createChatComposer } from "./chat-composer";
import { messageHTML, messagePlainText, replyContentHTML } from "./message-content";
import { mountRichContent, preserveRichScroll, richScrollFollows, releaseRichScroll } from "./message-rich";
import { mountConversationScroll } from "./conversation-scroll";
import { messageExpandHTML, measureMessagePreviews, messagePreviewMeasure } from "./message-preview";
import { plainReplies, replyBody, replyMessages } from "../shared/anime";
import { bindComposerMentions, mentionTargets } from "./team-mentions";
import { createAttachmentMedia } from "./attachment-media";
import { mountStageDrop } from "./attachments";
import { openMediaLightbox } from "./media-lightbox";
import { createBackgroundQuestions } from "./background-questions";
import { conversationCardsHTML, filesHTML, latestProgress, livePresenceHTML, messageActionsHTML, updateLiveTimes, waitsAtCard } from "./timeline";
import { mountConversationCardActions } from "./conversation-card-actions";
import { answerOwnerPage, mountOwnerQuestions } from "./owner-questions";
import { mountPendingQuestions } from "./pending-questions";
import { composioAction, composioText } from "./composio-result";
import { mountTaskResults } from "./task-result";
import { mountPages } from "./page-card";
import { carryTyped } from "./secret-card";
import { carryMail } from "./mail-card";
import { plainLine, primaryFirst, primaryIdOf, memberRole, faceHTML } from "./members";
import { NAME, eventLineHTML } from "./event-line";
import { handoffGroupHTML } from "./handoff-line";
import type { WireAttachment, HandoffView } from "./types";
import type { AppContext, MembersList, Room, RoomMessage, RoomExchange, MainEvent } from "./types";
import { btn, closeMenu, copyButton, esc, ico, iconButton, openMenu, openPopover, patchHTML, sel, toaster } from "./ui";
import "./automations.css";

/** Why a member's room reply never came, by the core's reason for its blocked intent. */
const BLOCKED = {
  owner: "rooms.blockedOwner", cost: "rooms.blockedCost", revoked: "rooms.blockedRevoked", restart: "rooms.blockedRestart",
  worker: "rooms.blockedWorker", source_unavailable: "rooms.blockedSource", cli_rate_limited: "rooms.blockedRateLimited",
  cli_quota: "rooms.blockedQuota", cli_login: "rooms.blockedLogin", cli_missing: "rooms.blockedLogin", cli_busy: "rooms.blockedBusy",
  cli_error: "rooms.blockedWorker",
} as const;

let context: AppContext | undefined;
const listeners = new Set<(event?: MainEvent) => void>();
export function configureRooms(app: AppContext): void {
  context = app;
  document.addEventListener("click", event => {
    const link = (event.target as Element).closest<HTMLElement>("[data-meeting-room]");
    if (link) void openGroupChat(Number(link.dataset.meetingRoom));
  });
  app.onEvent(event => { if (["RoomsChanged", "MembersChanged", "ConnectionsChanged", "WorkerChanged", "AgentTurn", "CoreReady"].includes(event.type)) for (const listener of listeners) listener(event); });
}
let selectedRoom: number | null = null;
export const currentRoomId = (): number | null => selectedRoom;
export function clearRoomSelection(): void { selectedRoom = null; changed(); }
const changed = (): void => { for (const listener of listeners) listener(); };
const responderChoices = (list: MembersList, selected: Set<number>) => [
  { value: "auto", label: t("rooms.autoResponder") },
  ...primaryFirst(list.members, primaryIdOf(list)).filter(m => selected.has(m.id)).map(m => ({ value: `member:${m.id}`, label: m.name })),
  { value: "everyone", label: t("team.everyone") },
];
const responderField = (list: MembersList, selected: Set<number>, value: string) => `<div class="au-field"><span>${esc(t("rooms.responder"))}</span><span data-responder>${sel(responderChoices(list,selected),value,t("rooms.responder"),' data-dlg="responder"')}</span></div>`;

export async function openRoomsMenu(anchor: HTMLElement): Promise<void> {
  try {
    const { rooms } = await api.roomsList();
    openMenu(anchor, rooms.map(room => ({ value: String(room.id), label: room.name })), "", value => void openGroupChat(Number(value)), undefined, [
      { label: t("rooms.new"), icon: "plus", run: () => { closeMenu(); void openNewGroupChat(); } },
    ]);
  } catch (error) { toaster.info(describeError(error)); }
}

export async function openNewGroupChat(opts: { onCreated?(room: Room): void } = {}): Promise<void> {
  try {
    const list = await api.membersList(getLocale());
    let group = "none", saving = false, responder = "auto";
    const creationRequestId = crypto.randomUUID();
    const selected = new Set<number>([primaryIdOf(list)]);
    const choices = [{ value: "none", label: t("members.ungrouped") }, ...list.groups.map(g => ({ value: String(g.id), label: g.name }))];
    const dialog = openDialog({ title: t("rooms.new"), cls: "au-group-dialog", body:
      `<label class="au-field"><span>${esc(t("rooms.name"))}</span><input id="room-name" class="mb-fin" maxlength="24" autocomplete="off" value="${esc(list.members.find(m=>m.id===primaryIdOf(list))?.name??"Raphael")}" placeholder="${esc(t("rooms.namePlaceholder"))}" aria-label="${esc(t("rooms.name"))}"></label>` +
      `<div class="au-field"><span>${esc(t("rooms.group"))}</span>${sel(choices, group, t("rooms.group"), ' data-dlg="group"')}</div>` +
      `<section class="au-field"><span>${esc(t("rooms.members"))}</span><div class="au-members au-room-members">${primaryFirst(list.members, primaryIdOf(list)).map(m => btn(faceHTML(m,30)+`<span>${esc(m.name)}</span><span data-check>${m.id===primaryIdOf(list)?ico("check"):""}</span>`, "", ` data-dlg="member" data-member="${m.id}" aria-pressed="${m.id===primaryIdOf(list)}"${m.id===primaryIdOf(list)?" disabled":""}`)).join("")}</div></section>` + `<div class="room-picked" data-picked>${primaryFirst(list.members, primaryIdOf(list)).filter(m=>selected.has(m.id)).map(m=>`<span>${esc(m.name)}</span>`).join("")}</div>` + responderField(list,selected,responder),
      actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("rooms.create")), attrs: ' data-dlg="create"' } }, canClose: () => !saving,
      onEnter: () => void save(), onAct(act, target) {
        if (act === "cancel") dialog.close();
        else if (act === "member") { const id=Number(target.dataset.member);if(id===primaryIdOf(list))return;if(selected.has(id))selected.delete(id);else {if(selected.size>=6){toaster.info(t("rooms.memberCount"));return;}selected.add(id);}target.setAttribute("aria-pressed",String(selected.has(id)));target.querySelector("[data-check]")!.innerHTML=selected.has(id)?ico("check"):"";if(responder===`member:${id}`&&!selected.has(id))responder="auto";dialog.el.querySelector('[data-responder]')!.innerHTML=sel(responderChoices(list,selected),responder,t("rooms.responder"),' data-dlg="responder"');dialog.el.querySelector('[data-picked]')!.innerHTML=primaryFirst(list.members, primaryIdOf(list)).filter(m=>selected.has(m.id)).map(m=>`<span>${esc(m.name)}</span>`).join("");if(!nameEdited)nameInput.value=list.members.filter(m=>selected.has(m.id)).map(m=>m.name).join(" · ").slice(0,24); }
        else if (act === "create") void save();
        else if (act === "group") openMenu(target, choices, group, value => { group = value; target.querySelector("span")!.textContent = choices.find(c => c.value === value)!.label; });
        else if (act === "responder") { const choices=responderChoices(list,selected);openMenu(target,choices,responder,value=>{responder=value;target.querySelector('span')!.textContent=choices.find(c=>c.value===value)!.label;}); }
      },
    });
    const nameInput=dialog.el.querySelector<HTMLInputElement>("#room-name")!;
    let nameEdited=false;
    nameInput.addEventListener("input",()=>{nameEdited=true;});
    async function save(): Promise<void> {
      if (saving) return;
      const name = dialog.el.querySelector<HTMLInputElement>("#room-name")!.value.trim();
      const member_ids = [...selected];
      if (!name || member_ids.length<2 || member_ids.length>6) { toaster.info(t("rooms.memberCount")); return; }
      saving = true; dialog.el.querySelector<HTMLButtonElement>('[data-dlg="create"]')!.disabled = true;
      try { const { room } = await api.roomsCreate({ name, member_ids, group_id: group === "none" ? null : Number(group), default_responder:responder, request_id:creationRequestId }); dialog.close(); changed(); opts.onCreated?.(room); void openGroupChat(room.id); }
      catch (error) { toaster.info(describeError(error)); }
      finally { saving = false; const b = dialog.el.querySelector<HTMLButtonElement>('[data-dlg="create"]'); if (b) b.disabled = false; }
    }
  } catch (error) { toaster.info(describeError(error)); }
}

/** Up to four actual member faces share a square grid everywhere. */
export function roomAvatarHTML(room: Pick<Room, "member_ids">, list: MembersList, size = 40): string {
  const members = room.member_ids.map(id => list.members.find(m => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m).slice(0, 4);
  return `<span class="room-avatar" data-faces="${members.length}" style="--av:${size}px" aria-hidden="true">${members.map(member => faceHTML(member, size)).join("")}</span>`;
}

export async function openGroupChat(roomId: number): Promise<void> {
  selectedRoom = roomId; changed();
  context?.go("agent");
  window.dispatchEvent(new CustomEvent("raphael:open-room", { detail: { roomId } }));
}

async function editRoomMembers(room: Room, saved: () => void): Promise<void> {
  try {
    const list = await api.membersList(getLocale()), selected = new Set([primaryIdOf(list),...room.member_ids]);
    let saving = false, responder = room.default_responder ?? "auto";
    const dialog = openDialog({ title: t("rooms.members"), cls: "au-group-dialog",
      body: `<div class="au-members">${primaryFirst(list.members, primaryIdOf(list)).map(m => btn(faceHTML(m,30) + `<span>${esc(m.name)}</span><span data-check>${selected.has(m.id) ? ico("check") : ""}</span>`, "", ` data-dlg="member" data-member="${m.id}" aria-pressed="${selected.has(m.id)}"${m.id===primaryIdOf(list)?" disabled":""}`)).join("")}</div>` + responderField(list,selected,responder),
      actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("members.save")), attrs: ' data-dlg="save"' } },
      canClose: () => !saving,
      onAct(act, target) {
        if (act === "cancel") dialog.close();
        else if (act === "member") {
          const id = Number(target.dataset.member);
          if(id===primaryIdOf(list))return;
          if (selected.has(id)) selected.delete(id); else { if(selected.size>=6){toaster.info(t("rooms.memberCount"));return;}selected.add(id); }
          target.setAttribute("aria-pressed", String(selected.has(id)));
          target.querySelector('[data-check]')!.innerHTML = selected.has(id) ? ico("check") : "";
          if(responder===`member:${id}`&&!selected.has(id))responder="auto";
          dialog.el.querySelector('[data-responder]')!.innerHTML=sel(responderChoices(list,selected),responder,t("rooms.responder"),' data-dlg="responder"');
        } else if (act === "responder") {
          const choices=responderChoices(list,selected);openMenu(target,choices,responder,value=>{responder=value;target.querySelector('span')!.textContent=choices.find(c=>c.value===value)!.label;});
        } else if (act === "save" && !saving) {
          if (selected.size<2||selected.size>6) { toaster.info(t("rooms.memberCount")); return; }
          saving = true;
          void api.roomsUpdate(room.id, { member_ids: [...selected], default_responder:responder }).then(() => {
            dialog.close(); changed(); saved();
          }).catch(error => toaster.info(describeError(error))).finally(() => { saving = false; });
        }
      },
    });
  } catch (error) { toaster.info(describeError(error)); }
}

async function editRoomRoles(room: Room, saved: () => void): Promise<void> {
  try {
    const list = await api.membersList(getLocale()), roles = { ...room.roles };
    const choices = [{ value: "participant", label: t("rooms.participant") }, { value: "moderator", label: t("rooms.moderator") },
      { value: "pro", label: t("rooms.pro") }, { value: "con", label: t("rooms.con") }];
    let saving = false;
    const dialog = openDialog({ title: t("rooms.roles"), cls: "au-group-dialog",
      body: primaryFirst(room.member_ids.map(id => ({ id })), primaryIdOf(list)).map(({ id }) => `<div class="au-field"><span>${esc(list.members.find(m => m.id === id)?.name ?? "")}</span>${sel(choices, roles[id] ?? "participant", t("rooms.roles"), ` data-dlg="role" data-member="${id}"`)}</div>`).join(""),
      actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("members.save")), attrs: ' data-dlg="save"' } },
      canClose: () => !saving,
      onAct(action, target) {
        if (action === "cancel") dialog.close();
        else if (action === "role") openMenu(target, choices, roles[target.dataset.member!] ?? "participant", value => {
          if (value === "moderator") {
            for (const id of Object.keys(roles)) if (roles[id] === "moderator") {
              roles[id] = "participant";
              const field = dialog.el.querySelector(`[data-member="${id}"] span`);
              if (field) field.textContent = t("rooms.participant");
            }
          }
          roles[target.dataset.member!] = value;
          target.querySelector("span")!.textContent = choices.find(c => c.value === value)!.label;
        });
        else if (action === "save" && !saving) {
          saving = true;
          void api.roomsUpdate(room.id, { roles }).then(() => { dialog.close(); changed(); saved(); })
            .catch(error => toaster.info(describeError(error))).finally(() => { saving = false; });
        }
      },
    });
  } catch (error) { toaster.info(describeError(error)); }
}

function roomActions(anchor: HTMLElement, room: Room, saved: () => void = () => {}, deleted: () => void = () => {}): void {
  openActions(anchor, [
    { id: "pin", label: t(room.pinned ? "members.sideUnpin" : "members.sidePin"), icon: "pin" },
    { id: "hide", label: room.hidden ? t("sidebar.show") : t("members.sideHide"), icon: "eyeOff" },
    { id: "rename", label: t("members.rename"), icon: "pencil" },
    ...(!room.is_team ? [{ id: "members", label: t("rooms.members"), icon: "grid" as const }] : []),
    { id: "roles", label: t("rooms.roles"), icon: "grid" },
    { id: "delete", label: t("members.delete"), icon: "trash" },
  ], action => {
    if (action === "pin" || action === "hide") { void api.roomsUpdate(room.id, action === "pin" ? { pinned: !room.pinned } : { hidden: !room.hidden }).then(() => { changed(); saved(); }).catch(error => toaster.info(describeError(error))); }
    else if (action === "roles") void editRoomRoles(room, saved);
    else if (action === "members") void editRoomMembers(room, saved);
    else if (action === "rename") void askGroupName(t("members.rename"), room.name, t("members.name")).then(async name => {
      if (name) { await api.roomsUpdate(room.id, { name }); changed(); saved(); }
    }).catch(error => toaster.info(describeError(error)));
    else void confirmDelete(room.name).then(async yes => {
      if (yes) { await api.roomsDelete(room.id); window.dispatchEvent(new CustomEvent("room-deleted",{detail:room.id})); deleted(); changed(); toaster.info(t("members.deleted",{p0:room.name})); }
    }).catch(error => toaster.info(describeError(error)));
  });
}

/** A room occupies the member conversation pane; creation and management alone use dialogs. */
export function createRoomPane(_app: AppContext, onClose: () => void, onRender: () => void = () => {}) {
  const el=document.createElement("section");el.className="mb-chat au-room-pane";el.hidden=true;
  el.innerHTML=`<header class="page-head mb-head"><span class="room-picker"></span><div class="au-room-heading"></div><div class="ra-tools">${iconButton("search",t("agent.search"), ' data-room-search')}${iconButton("more",t("members.more",{p0:t("rooms.title")}), ' data-room-menu')}</div></header><div class="ra-find" hidden></div><div class="ra-stage"><div class="ra-scroll"><div class="ra-col"><div class="ra-older"></div><ol class="thread au-room-thread"></ol></div></div><div class="ra-dock"></div></div>`;
  const thread=el.querySelector<HTMLElement>(".thread")!,scroll=el.querySelector<HTMLElement>(".ra-scroll")!,older=el.querySelector<HTMLElement>(".ra-older")!;
  let room:Room|undefined,list:MembersList={members:[],groups:[]},messages:RoomMessage[]=[],generation=0,opened=false,canOlder=false,loadingOlder=false;
  // Navigation identity remains available while the complete room is loading.
  let roomId: number | undefined;
  let closeSideThread: (() => void) | undefined;
  let sideOpening = false;
  let pendingQuestions: { room: number; questions: import("./types").OwnerQuestion[] } | undefined;
  const failedRequests = new Map<string, string>();
  const deliveries = new Map<number, Promise<void>>();
  let exchange:RoomExchange|null|undefined,replyTo:RoomMessage|undefined,stopping=false;
  let handoffs: HandoffView[] = [];
  let decisions: import("./types").RoomDecision[] = [];
  const drawn = new WeakMap<Element, string>();
  let newestMessage = 0, drewOnce = false, refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let rosterDirty = true;
  let snapshot: unknown;
  const drafts=new Map<number,{text:string;files:WireAttachment[];quote?:RoomMessage;pageId?:string}>();
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  function saveRoomDraft(): void {
    clearTimeout(draftTimer);
    if (roomId === undefined) return;
    const value = {...composer.snapshot(), quote: replyTo};
    if (value.text || value.files.length || value.quote) drafts.set(roomId, value); else drafts.delete(roomId);
    writeDraftWords(`room:${roomId}`, {text:wholeLinks(value.text), pageId:value.pageId, quote:value.quote ? {id:value.quote.id,member_id:value.quote.member_id,text:value.quote.text} : undefined});
  }
  function deliveredDraft(id: number, text: string, files: WireAttachment[], quoteId?: number): void {
    const draft = drafts.get(id);
    if (draft) {
      if (wholeLinks(draft.text).trim() === text) draft.text = "";
      draft.files = draft.files.filter(file => !files.includes(file));
      if (draft.quote?.id === quoteId) draft.quote = undefined;
      if (!draft.text && !draft.files.length && !draft.quote) drafts.delete(id);
    }
    const remaining = drafts.get(id);
    writeDraftWords(`room:${id}`, remaining && {text:wholeLinks(remaining.text),quote:remaining.quote,pageId:remaining.pageId});
  }
  function forgetRoomDraft(id: number): void {
    if (roomId === id) { roomId = undefined; close(); }
    drafts.delete(id); writeDraftWords(`room:${id}`);
  }
  window.addEventListener("pagehide", saveRoomDraft);
  const expandedMessages = new Set<number>();
  const renderedMessages = new ThreadRenderCache();
  const roomWindow = new TranscriptWindow();
  const windowMount = mountTranscriptWindow(scroll, thread, roomWindow, { draw, older: loadRoomEarlier, canOlder: () => canOlder && !loadingOlder });
  mountConversationScroll(scroll);
  mountRichContent(scroll);
  mountMessageMetadata(thread, control => {
    const message = messages.find(item => item.id === Number(control.closest<HTMLElement>("[data-room-message]")?.dataset.roomMessage));
    return message && roomId ? { reactions: message.reactions ?? [], react: (emoji, active) => api.core("rooms.react", { room_id: roomId, message_id: message.id, emoji, active }),
      memo: message.turn?.voice_memo ? memo_action => api.core("agent.speak", { room_id: roomId, thread_id: message.thread_id, turn_id: message.turn_id, member_id: message.member_id, memo_action }) : undefined } : null;
  }, () => { void refresh(); }, error => toaster.info(describeError(error)));
  mountOwnerQuestions(thread, () => { void refresh(); });
  const floatingQuestions = mountPendingQuestions(thread, scroll, () => refresh(), () => pendingQuestions && pendingQuestions.room === roomId ? pendingQuestions.questions : [], async turn => {
    let message = messages.find(message => message.turn_id === turn || message.turn?.id === turn);
    const current = roomId;
    while (!message && canOlder && !loadingOlder) {
      const before = messages[0]?.id; await loadRoomEarlier();
      if (roomId !== current) return;
      message = messages.find(message => message.turn_id === turn || message.turn?.id === turn);
      if (messages[0]?.id === before) break;
    }
    if (message) {
      releaseRichScroll(scroll);
      if (roomWindow.focus(`message:${message.id}`)) draw();
    }
  });
  const meetingRow = document.createElement("div"); meetingRow.className = "pending-questions room-meeting-row"; meetingRow.hidden = true;
  scroll.parentElement!.prepend(meetingRow);
  meetingRow.innerHTML = btn(`${ico("chat")}<span class="pending-question-title"></span>${ico("down")}`, "sm pending-question", ' aria-haspopup="dialog" aria-expanded="false" data-room-board-toggle');
  let meetingPanel: HTMLElement | undefined;
  meetingRow.addEventListener("click", () => {
    if (meetingPanel?.isConnected) { closeMenu(); return; }
    meetingPanel = openPopover(meetingRow.querySelector("button")!, boardHTML(), {
      className: "menu room-meeting-board", role: "dialog", label: t("rooms.board"), onClose: () => { meetingPanel = undefined; },
    });
    meetingPanel.focus();
  });
  const resultCards = new WeakMap<HTMLElement, { sync(): void }>();
  mountConversationCardActions(thread, () => _app.go("settings", "connections"));
  const pagesHost = mountPages(thread, { place: (id, text) => composer.placePageText(id, text) });
  const measureAllMessages = messagePreviewMeasure(thread);
  const messageResize = typeof ResizeObserver === "function" ? new ResizeObserver(measureAllMessages) : null;
  messageResize?.observe(thread);
  const finder = mountConversationFind({button:el.querySelector('[data-room-search]')!,bar:el.querySelector('.ra-find')!,thread,scroll,
    records: () => roomWindow.before || roomWindow.after ? messages.map(message => ({ key: `message:${message.id}`, texts: message.member_id === null ? [messagePlainText(message.text)] : plainReplies(replyMessages(message.text)).map(text => messagePlainText(text, true, composioAction(message.turn))) })) : undefined,
    reveal: key => { releaseRichScroll(scroll); if (roomWindow.focus(key)) draw(); }, load:async current=>{
    const id=roomId;if(!id)return;
    let before:number|undefined;
    const all:RoomMessage[]=[];
    for(;;){
      const result=await api.roomMessages(id,before);
      if(!current()||!opened||roomId!==id)return;
      all.push(...result.messages);
      const next=result.messages[0]?.id;
      if(result.messages.length<100||next===before)break;
      before=next;
    }
    const height=scroll.scrollHeight,top=scroll.scrollTop;
    messages=[...new Map([...all,...messages].map(message=>[message.id,message])).values()].sort((a,b)=>a.id-b.id);canOlder=false;draw();
    scroll.scrollTop=top+scroll.scrollHeight-height;
  }});
  const sendingRooms=new Set<number>(),pendingStops=new Set<number>();
  const composer=createChatComposer({stopTask:stopRoom,placeholder:()=>t("rooms.message"),answerPage:(id,text)=>!replyTo && answerOwnerPage(thread,id,text,()=>{void refresh();}),transcriptTarget(){const id=roomId;return text=>{if(roomId===id){composer.input.value+=(composer.input.value?" ":"")+text;composer.seedDictation(text);}else if(id){const draft=drafts.get(id)??{text:"",files:[]};draft.text+=(draft.text?" ":"")+text;drafts.set(id,draft);writeDraftWords(`room:${id}`,{text:draft.text,quote:draft.quote,pageId:draft.pageId});}};},async send(text,files){
    if (!roomId) return;
    const id = roomId, sentQuote = replyTo?.id, key = JSON.stringify([id,text,files,sentQuote]);
    const requestId = failedRequests.get(key) ?? crypto.randomUUID();
    failedRequests.delete(key);
    const previous = deliveries.get(id) ?? Promise.resolve();
    const delivery = previous.catch(() => {}).then(async () => {
      await api.roomSend(id,text,requestId,getLocale(),files,sentQuote);
      if (pendingStops.delete(id)) await api.roomStop(id);
    });
    deliveries.set(id, delivery); sendingRooms.add(id);
    if (replyTo?.id === sentQuote) replyTo = undefined;
    draw();
    try { await delivery; }
    catch (error) {
      failedRequests.set(key, requestId);
      if (roomId !== id) {
        const draft = drafts.get(id) ?? {text:"",files:[]};
        const restored = {...draft, text:[draft.text,text].filter(Boolean).join("\n\n"), files:[...draft.files,...files]};
        drafts.set(id, restored);
        writeDraftWords(`room:${id}`, {text:restored.text,quote:restored.quote});
      }
      throw error;
    } finally {
      if (deliveries.get(id) === delivery) { deliveries.delete(id); sendingRooms.delete(id); pendingStops.delete(id); }
      if (roomId === id) draw();
    }
    deliveredDraft(id,text,files,sentQuote);
    if (roomId === id) await refresh();
    changed();
  }});
  const mentions = bindComposerMentions(composer.input, () => ({ list, allowed: room?.member_ids }));
  composer.input.addEventListener("input", () => { clearTimeout(draftTimer); draftTimer=setTimeout(saveRoomDraft,300); });
  composer.input.id="room-message";el.querySelector('.ra-dock')!.append(composer.el);
  const drop = mountStageDrop(el.querySelector<HTMLElement>('.ra-stage')!, () => composer.el, list => composer.addFiles(list));
  const attachmentMedia = createAttachmentMedia(el, id => api.core("attachments.get", { id }));
  composer.el.querySelector('.cmp-quote')!.addEventListener('click',e=>{if((e.target as Element).closest('[data-room-act="cancel-reply"]')){replyTo=undefined;draw();composer.input.focus();}});
  const status=document.createElement('div');status.className="au-room-controls";el.querySelector('.ra-dock')!.prepend(status);
  // A member's question waits here, where the talk is, not on that member's page.
  const questions = createBackgroundQuestions({
    memberId: () => 0, roomId: () => roomId, manageLocal: () => _app.go("settings", "safety"),
    asker: q => { const who = person(q?.member_id ?? null); return who ? { face: faceHTML(who, 22), name: who.name } : { face: "", name: "" }; },
    changed: () => { changed(); scroll.scrollTop = scroll.scrollHeight; },
  });
  const questionSlot = document.createElement("div"); questionSlot.className = "ra-bgq"; questionSlot.append(questions.element); status.after(questionSlot);
  const person=(id:number|null)=>list.members.find(m=>m.id===id);
  const boardHTML = (): string => roomBoardHTML(handoffs, decisions, (id, name) => faceHTML(person(id) ?? {id, name}, 28));
  const roomStamp = (): unknown => [list, room, exchange, messages.slice(), handoffs.slice(), decisions.slice(), replyTo, sendingRooms.has(roomId!), stopping, loadingOlder];
  function draw():void {
    if(!room)return;
    const follows = !drewOnce || (!roomWindow.after && richScrollFollows(scroll));
    snapshot = roomStamp();
    patchHTML(el.querySelector('.au-room-heading')!,`<b>${esc(room.is_team ? t("rooms.team") : room.name)}</b><div class="au-room-faces">${primaryFirst(room.member_ids.map(id => ({ id })), primaryIdOf(list)).map(({ id })=>{const m=person(id);return m?`<span class="au-room-participant" data-tooltip="${esc(memberRole(m)?`${m.name} · ${memberRole(m)}`:m.name)}">${faceHTML(m,24)}${id===primaryIdOf(list)?`<span class="au-room-crown" role="img" aria-label="${esc(t("rooms.chief"))}">${ico("crown")}</span>`:""}</span>`:"";}).join("")}</div>`);
    const active=exchange&&["queued","running"].includes(exchange.state);
    composer.setTaskState(active || handoffs.some(task=>["queued","running","waiting"].includes(task.state)) ? "running" : sendingRooms.has(room.id) ? "ack" : "idle");
    let statusHTML=room.membership_state==="needs_adjustment"?btn(esc(t("rooms.adjustMembers")),"sm",' data-room-act="members"'):"";
    const quote=composer.el.querySelector<HTMLElement>('.cmp-quote')!;quote.hidden=!replyTo;
    patchHTML(quote, replyTo?`<span>${esc(t("rooms.replyTo",{p0:person(replyTo.member_id)?.name??t("members.title")}))}</span>${iconButton("x",t("common.cancel"),' data-room-act="cancel-reply"')}`:"");
    if (exchange?.routing?.fallback) statusHTML += `<span role="status">${esc(t("rooms.routingFallback"))}</span>`;
    patchHTML(status, statusHTML);
    patchHTML(older, canOlder?btn(esc(t("rooms.older")),"sm",` data-room-act="older"${loadingOlder?" disabled":""}`):"");
    meetingRow.hidden = !handoffs.length && !decisions.length;
    meetingRow.querySelector('.pending-question-title')!.textContent = t("rooms.boardCount", {p0:handoffs.length,p1:decisions.length});
    if (meetingPanel?.isConnected) {
      if (meetingRow.hidden) closeMenu(); else patchHTML(meetingPanel, boardHTML());
    }
    const faceOf=(id:number,name:string)=>faceHTML(person(id)??{id,name},20);
    // A reply that never came stands where its exchange stopped: after its last message, before its wrap-up.
    const blocked=(exchange?.reply_intents??[]).filter(intent=>intent.state==="blocked").flatMap(intent=>{
      const anchor=messages.filter(m=>(m.origin_message_id??m.id)===intent.origin_message_id&&m.kind!=="wrapup").pop();
      return anchor?[{created:anchor.created,order:1,intent}]:[];
    });
    const entries=[...messages.map(message=>({created:message.created,order:0,message})),...handoffs.filter(task=>!messages.some(message=>message.report?.task_id===task.task_id)).map(task=>({created:task.created_at_ms,order:0,task})),...blocked]
      .sort((a,b)=>a.created-b.created||a.order-b.order);
    const addressable=mentionTargets(list);
    const presentation = JSON.stringify([getLocale(), list.members.map(member => [member.id, member.name, member.avatar])]);
    const entryKey = (entry: typeof entries[number]): string => "message" in entry ? `message:${entry.message.id}` : "task" in entry ? `task:${entry.task.task_id ?? entry.task.work_turn_id}` : `intent:${entry.intent.id}`;
    const mounted = roomWindow.select(entries, entryKey, follows && !finder.isOpen());
    windowMount.sync();
    const grouped = mounted.flatMap<{ entry: typeof entries[number]; tasks: HandoffView[] }>((entry, index) => {
      if (!("task" in entry)) return [{ entry, tasks: [] as HandoffView[] }];
      if (index && "task" in mounted[index - 1]) return [];
      const tasks: HandoffView[] = [];
      for (let i = index; i < mounted.length && "task" in mounted[i]; i++) tasks.push((mounted[i] as { task: HandoffView }).task);
      return [{ entry, tasks }];
    });
    preserveRichScroll(scroll, () => { const wanted = entries.length ? grouped.map(({ entry, tasks }) => ({
      key: "message" in entry ? `message:${entry.message.id}` : "task" in entry ? `task:${entry.task.task_id ?? entry.task.work_turn_id}` : `intent:${entry.intent.id}`,
      turnId: "message" in entry ? entry.message.id : undefined,
      html: renderedMessages.line("message" in entry ? `message:${entry.message.id}` : "task" in entry ? `task:${entry.task.task_id ?? entry.task.work_turn_id}` : `intent:${entry.intent.id}`,
        "task" in entry ? tasks : entry, [presentation, addressable, "message" in entry && expandedMessages.has(entry.message.id),
          "message" in entry && entry.message.status === "running" ? person(entry.message.member_id)?.activity_label : ""], () => {
      if("intent" in entry){
        const intent=entry.intent,name=person(intent.recipient_id)?.name??intent.recipient_name;
        return `<li class="tn room-intent-blocked" role="status">${eventLineHTML(t("rooms.intentBlocked",{p0:NAME,p1:t(BLOCKED[intent.reason as keyof typeof BLOCKED]??"rooms.blockedWorker")}),faceOf(intent.recipient_id,name),name)}</li>`;
      }
      if("task" in entry){
        return `<li class="tn handoff-row">${handoffGroupHTML(tasks.map(task => {
          const source=messages.find(m=>m.turn_id===task.source_turn_id&&m.member_id===task.from_member_id&&m.kind!=="wrapup");
          return { task, face: faceOf(task.member_id,task.member_name), name: person(task.member_id)?.name,
            request: source && {author:person(source.member_id)?.name??"",text:source.text} };
        }))}</li>`;
      }
      const m=entry.message;
      if (m.kind === "report" && m.report) return `<li class="tn" data-room-message="${m.id}">${roomReportHTML(m)}</li>`;
      if(m.member_id!==null&&m.status==="running"&&!m.text.trim()&&(!m.turn||!waitsAtCard(m.turn))) {
        const member=person(m.member_id);
        return `<li class="tn au-room-thinking" data-room-message="${m.id}" role="status"><div class="ra-body"><b class="au-room-author">${esc(member?.name??t("members.title"))}</b>${livePresenceHTML({face:()=>member?faceHTML(member,28):"",activityLabel:member?.activity_label},m.turn?latestProgress(m.turn):undefined)}</div></li>`;
      }
      const member=person(m.member_id),owner=m.member_id===null,parts=owner?[m.text]:plainReplies(replyMessages(m.text)).map(text=>composioText(text,composioAction(m.turn))),words=parts.join("\n\n")||(owner?"":t(m.status==="error"?"auto.error":"auto.running"));
      const source=m.reply_reference;
      const reply=source?`<${source.unavailable ? 'span' : `button type="button" data-room-act="jump-reply" data-message="${source.message_id}"`} class="au-room-reply">${esc(source.unavailable?t("rooms.sourceMissing"):t("rooms.replyTo",{p0:source.author_kind==="owner"?t("rooms.owner"):person(source.author_member_id??null)?.name??t("rooms.sourceMissing")}))}</${source.unavailable ? 'span' : 'button'}>`:"";
      const actions= messageActionsHTML(m.created, false, undefined, false).replace('</div>',reactionControlHTML() + (m.turn?.voice_memo ? memoActionHTML(m.turn.voice_memo_state === "playing") : "") + iconButton("chat", t("rooms.thread"), ` data-room-act="thread" data-message="${m.id}"`).replace(" title=", " data-tooltip=") + (!owner?iconButton("reply",t("rooms.reply"),` data-room-act="reply" data-message="${m.id}"`).replace(" title="," data-tooltip="):"")+"</div>");
      const reactions = reactionRowHTML(m.reactions);
      const metadata = (m.turn?.voice_memo ? memoTranscriptHTML(m.text) : "") + (m.reply_count ? `<button type="button" class="btn sm room-thread-chip" data-room-act="thread" data-message="${m.id}">${esc(t("rooms.threadCount", { p0: m.reply_count }))}</button>` : "");
      const preview = ` data-expandable="true"`, expanded = expandedMessages.has(m.id) ? " is-expanded" : "";
      return `<li class="tn au-room-message${m.kind==="wrapup"?" au-room-wrapup":""}" data-room-message="${m.id}">${owner?`<div class="me">${ownerFaceHTML()}<div class="chat-message owner-message${expanded}"${preview}>${reply}${filesHTML(m.attachments)}${words?`<div class="bubble"><div class="message-text">${messageHTML(words, "", false, addressable)}</div>${messageExpandHTML(words, expandedMessages.has(m.id))}</div>`:""}${reactions}${actions}${metadata}</div></div>`:`<div class="ra"><span class="ra-face">${member?faceHTML(member,30):""}</span><div class="ra-body"><div class="au-room-meta"><b class="au-room-author">${esc(member?.name??t("members.title"))}</b>${reply}</div>${(parts.some(part=>part.trim())?parts:[words]).map((part,index)=>`<div class="chat-message" data-room-part="${index}">${replyContentHTML(part,"",m.status==="running")}${index===parts.length-1?reactions+actions+metadata:""}</div>`).join("")}${m.turn ? conversationCardsHTML(m.turn, m.member_id ? member?.name : t("agent.title")) : ""}</div></div>`}</li>`;
    }), })).filter(line => line.html) : [{ key: "empty", html: `<li class="au-empty">${esc(t("rooms.empty"))}</li>`, turnId: undefined }];
    renderedMessages.retain(new Set(grouped.map(({entry}) => entryKey(entry))));
    const changed = patchThread(thread, wanted, drawn, {
      arrives: line => drewOnce && line.turnId !== undefined && line.turnId > newestMessage,
      carry(node, made) {
        carryMessageMetadata(node, made);
        const restorePages = pagesHost.carry(node, made), restoreTyped = carryTyped(node, made), restoreMail = carryMail(node, made), restoreSetup = carryInlineSetup(node, made);
        return () => { node.before(made); restorePages(); restoreSetup(); node.remove(); restoreTyped(); restoreMail(); };
      },
    });
    newestMessage = Math.max(newestMessage, ...messages.map(message => message.id)); drewOnce = true;
    if (changed) {
    updateLiveTimes(thread);
    pagesHost.sync();
    for (const slot of thread.querySelectorAll<HTMLElement>("[data-task-result-slot]")) {
      const host = slot.parentElement!, owner = Number(slot.dataset.taskMember);
      let results = resultCards.get(host);
      if (!results) {
        results = mountTaskResults(host, () => owner, () => {
          window.dispatchEvent(new CustomEvent("raphael:open-member", { detail: { memberId: owner, files: true } }));
        });
        resultCards.set(host, results);
      }
      results.sync();
    }
    measureMessagePreviews(thread);
    attachmentMedia.sync();
    }
    composer.draw(); mentions.refresh(); });
    finder.refresh();
    onRender();
  }
  async function refresh(fromEvent=false, readRoom=true):Promise<void>{
    const mine=++generation,id=roomId;if(!opened||!id)return;
    const missing=():void=>{forgetRoomDraft(id);toaster.info(t("rooms.deleted"));};
    try{
      const peopleRead=()=>api.membersList(getLocale()), roomsRead=()=>api.roomsList();
      const [people,rooms]=await Promise.all([rosterDirty ? (fromEvent ? eventRead(`members.list:${getLocale()}`,peopleRead,context) : peopleRead()) : Promise.resolve(list),readRoom || !room ? (fromEvent ? eventRead('rooms.list',roomsRead,context) : roomsRead()) : Promise.resolve({rooms:[room]})]);
      if(mine!==generation||!opened)return;
      const found=rooms.rooms.find(r=>r.id===id);if(!found){missing();return;}
      const history=await (fromEvent ? eventRead(`rooms.messages:${id}`,()=>api.roomMessages(id),context) : api.roomMessages(id));if(mine!==generation||!opened)return;
      list=people;rosterDirty=false;room=found;exchange=history.exchange;
      pendingQuestions={room:id,questions:history.pending_questions??[]};floatingQuestions.sync();
      if (found.unread && !el.closest("[hidden]")) await api.roomsUpdate(id, { read: true, read_through: history.messages[history.messages.length - 1]?.id ?? 0 });
      if (mine!==generation||!opened) return;
      handoffs=history.handoffs??[]; decisions=history.decisions??[];
      const first=history.messages[0]?.id??Infinity;messages=[...messages.filter(m=>m.id<first),...history.messages];
      const next = roomStamp();
      if (!sameWire(next, snapshot)) { snapshot = next; draw(); }
    }catch(error){
      if(!opened||mine!==generation)return;
      // Deletion may race the history request after the first roster read.
      try{const rooms=await api.roomsList();if(!opened||mine!==generation)return;if(!rooms.rooms.some(r=>r.id===id)){missing();return;}}catch{/* Keep the original failure when existence cannot be checked. */}
      if(opened&&mine===generation)toaster.info(describeError(error));
    }
  }
  async function stopRoom():Promise<void>{if(!room||stopping)return;stopping=true;const id=room.id;if(sendingRooms.has(id))pendingStops.add(id);try{await api.roomStop(id);await refresh();}finally{stopping=false;}}
  async function loadRoomEarlier(): Promise<void> {
    if (loadingOlder || !room || !messages.length) return;
    loadingOlder = true; draw(); const id = room.id, mine = generation;
    try {
      const result = await api.roomMessages(id, messages[0]!.id);
      if (mine !== generation || !opened) return;
      canOlder = result.messages.length === 100;
      messages = [...new Map([...result.messages, ...messages].map(message => [message.id, message])).values()].sort((a,b) => a.id-b.id);
    } catch (error) { toaster.info(describeError(error)); }
    finally { loadingOlder = false; if (opened) draw(); }
  }
  function close():void{if(!opened)return;closeSideThread?.();closeSideThread=undefined;if(meetingPanel?.isConnected)closeMenu();finder.close(false);saveRoomDraft();composer.stopVoice();drop.reset();attachmentMedia.reset();questions.reset();opened=false;roomId=undefined;generation++;clearTimeout(refreshTimer);refreshTimer=undefined;el.hidden=true;composer.setTaskState("idle");clearRoomSelection();onClose();}
  el.querySelector('[data-room-menu]')!.addEventListener('click',e=>{if(room)roomActions(e.currentTarget as HTMLElement,room,()=>void refresh(),close);});
  el.addEventListener('click',e=>{const target=(e.target as Element).closest<HTMLElement>('[data-room-act],[data-act]');if(!target)return;const act=target.dataset.roomAct??target.dataset.act;if(["turn","copy-message","copy-code","attachment-open","attachment-image","older"].includes(act??""))e.stopPropagation();
    if(act==="private-work") openMemberThread(_app,Number(target.dataset.member),Number(target.dataset.turn));
    else if(act==="members"&&room)void editRoomMembers(room,()=>void refresh());
    else if(act==="expand-message") {
      e.stopPropagation();
      const id = Number(target.closest<HTMLElement>('[data-room-message]')?.dataset.roomMessage), expanded = !expandedMessages.has(id);
      if (expanded) expandedMessages.add(id); else expandedMessages.delete(id);
      target.closest('.chat-message')?.classList.toggle('is-expanded', expanded);
      target.setAttribute('aria-expanded', String(expanded));
      target.textContent = t(expanded ? "chat.showLess" : "chat.showAll");
      measureAllMessages();
    }
    else if(act==="stop"&&room&&!stopping){stopping=true;const id=room.id;draw();void api.roomStop(id).then(()=>refresh()).catch(error=>toaster.info(describeError(error))).finally(()=>{stopping=false;if(opened)draw();});}
    else if(act==="thread" && roomId && !sideOpening){
      sideOpening = true;
      const current = roomId, message = Number(target.dataset.message);
      closeSideThread?.(); closeSideThread = undefined;
      void openRoomThread(el, _app, current, message, list, () => { if (opened) void refresh(); }).then(close => {
        if (!opened || current !== roomId) close(); else closeSideThread = close;
      }).catch(error => toaster.info(describeError(error))).finally(() => { sideOpening = false; });
    }
    else if(act==="reply"){replyTo=messages.find(m=>m.id===Number(target.dataset.message));draw();composer.input.focus();}
    else if(act==="jump-reply") void (async () => {
      const id = Number(target.dataset.message), current = roomId;
      while (!messages.some(message => message.id === id) && canOlder && !loadingOlder) {
        const before = messages[0]?.id; await loadRoomEarlier();
        if (roomId !== current) return;
        if (messages[0]?.id === before) break;
      }
      releaseRichScroll(scroll);
      if (roomWindow.focus(`message:${id}`)) { draw(); thread.querySelector<HTMLElement>(`[data-room-message="${id}"]`)?.scrollIntoView({block:"center"}); }
    })();
    else if(act==="cancel-reply"){replyTo=undefined;draw();composer.input.focus();}
    else if(act==="copy-message"){const m=messages.find(m=>m.id===Number(target.closest<HTMLElement>('[data-room-message]')?.dataset.roomMessage));if(m)void copyButton(target, messagePlainText(m.member_id===null?m.text:plainReplies(replyMessages(m.text)).join("\n\n"),m.member_id!==null)).catch(error=>toaster.info(describeError(error)));}
    else if(act==="copy-code")void copyButton(target, target.closest('.message-code')?.querySelector('code')?.textContent??"").catch(error=>toaster.info(describeError(error)));
    else if(act==="attachment-image"){const src=attachmentMedia.source(target);if(src)openMediaLightbox(target,src);}
    else if(act==="attachment-open")void api.openAttachment(target.dataset.id??"").catch(()=>toaster.info(t("agent.fileUnavailable")));
    else if(act==="artifact-open")void api.openTeamFile(`task-artifact:${target.dataset.task}:${target.dataset.evidence}`).catch(()=>toaster.info(t("agent.fileUnavailable")));
    else if(act==="team-file-open")void api.openTeamFile(target.dataset.path??"").catch(()=>toaster.info(t("agent.fileUnavailable")));
    else if(act==="older") void loadRoomEarlier().then(() => { if (messages[0] && roomWindow.focus(`message:${messages[0].id}`)) draw(); });
  });
  window.addEventListener("room-deleted",event=>{forgetRoomDraft((event as CustomEvent<number>).detail);});
  const listener=(event?: MainEvent):void=>{
    if (!opened || !el.isConnected) return;
    if (!event || event.type === "MembersChanged" || ["CoreReady"].includes(event.type)) rosterDirty = true;
    if (event?.type === "RoomsChanged" && event.room_id !== undefined && event.room_id !== roomId) return;
    if (event?.type === "WorkerChanged" && !handoffs.some(task => task.task_id === event.task_id) && !messages.some(message => message.turn?.task?.id === event.task_id)) return;
    if (event?.type === "AgentTurn" && !messages.some(message => message.turn_id === event.turn_id) && !room?.member_ids.includes(event.member_id ?? 0)) return;
    if (event?.type !== "WorkerChanged") { void refresh(true,!event || event.type==='RoomsChanged' || ['CoreReady'].includes(event.type)); void questions.load(); return; }
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(true,false); if (!event || event.type !== "WorkerChanged" || event.state === "waiting") void questions.load(); }, 300);
  };listeners.add(listener);onLocaleChange(()=>{if(opened)draw();});
  onAvatarChange(()=>{if(opened && el.isConnected)draw();});
  return {el,close,refresh,async open(id:number){
    closeSideThread?.(); closeSideThread = undefined;
    if (meetingPanel?.isConnected) closeMenu();
    meetingRow.hidden = true;
    decisions = [];
    finder.close(false);
    saveRoomDraft();
    attachmentMedia.reset();questions.reset();
    roomWindow.reset(); renderedMessages.clear();
    opened=true;generation++;rosterDirty=true;snapshot="";newestMessage=0;drewOnce=false;roomId=id;room=undefined;messages=[];handoffs=[];exchange=undefined;replyTo=undefined;stopping=false;canOlder=false;
    el.querySelector('.au-room-heading')!.replaceChildren();thread.replaceChildren();older.replaceChildren();status.replaceChildren();
    composer.setTaskState("idle");const draft=drafts.get(id)??readDraftWords<RoomMessage>(`room:${id}`);replyTo=draft?.quote;composer.setDraft(draft?.text??"",drafts.get(id)?.files??[],draft?.pageId);el.hidden=false;
    await refresh();void questions.load();
    if(opened&&roomId===id&&room){canOlder=messages.length===100;draw();scroll.scrollTop=scroll.scrollHeight;composer.input.focus();}
  },get active(){return opened;}};
}

export function createRoomsSection(active: () => boolean = () => true): HTMLElement {
  const el = document.createElement("section"); el.className = "au-rooms-section";
  let rooms: Room[] = [], list: MembersList = { members: [], groups: [] }, generation = 0;
  let drawnSelection: number | null = null, drawnRows = "";
  let rosterDirty = true, timer: ReturnType<typeof setTimeout> | undefined;
  let loaded = false, retry = 0;
  const retryDelays = [100, 250, 500, 1000, 2000];
  const draw = (): void => {
    drawnSelection = active() ? selectedRoom : null;
    // Groups are the owner's own; a former team room stays only for the conversation it already holds.
    const html = rooms
      .filter(room => (!room.is_team || room.last_at) && !room.hidden)
      .map(room => {
        const date = new Date(room.last_at ?? NaN), name = room.is_team ? t("rooms.team") : room.name;
        return `<div class="au-room-row"><button type="button" class="nav mb-row" data-room="${room.id}" aria-current="${active() && selectedRoom === room.id}">${roomAvatarHTML(room,list,40)}<span class="mb-row-main"><span class="mb-row-t"><b>${esc(name)}</b>${room.pinned ? ico("pin") : ""}${Number.isFinite(date.getTime()) ? `<time class="mb-row-time" datetime="${date.toISOString()}">${formatClock(date.getTime())}</time>` : ""}</span><span class="mb-row-p${room.waiting ? " is-wait" : ""}">${esc(room.waiting ? t("members.waitingShort") : ((room.preview && room.preview_member_id !== undefined ? `${room.preview_member_id === null ? t("rooms.owner") : list?.members.find(m => m.id === room.preview_member_id)?.name ?? t("members.title")}：` : "") + plainLine(replyBody(room.preview ?? ""))))}</span></span>${room.waiting ? `<span class="mb-dot is-wait" role="img" aria-label="${esc(t("members.waitingShort"))}"></span>` : room.unread ? `<span class="mb-dot is-unread" role="img" aria-label="${esc(t("members.unread"))}"></span>` : ""}</button>${room.id ? iconButton("more", t("members.more",{p0:name}), ` data-room-more="${room.id}" aria-haspopup="menu" aria-expanded="false"`, "au-room-more") : ""}</div>`;
      }).join("");
    const rows = html.replace(/--slime-(?:delay|since):-?[\d.]+ms;?| data-slime-mounted="[\d.]+"/g, "");
    if (rows === drawnRows) return;
    drawnRows = rows;
    patchHTML(el, html);
  };
  const load = async (fromEvent=false, readRooms=true): Promise<void> => {
    clearTimeout(timer); timer = undefined;
    readRooms ||= !loaded;
    const mine = ++generation;
    try {
      const roomRead=()=>api.roomsList(), peopleRead=()=>api.membersList(getLocale());
      const [result, people] = await Promise.all([readRooms ? (fromEvent ? eventRead('rooms.list',roomRead,context) : roomRead()) : Promise.resolve({rooms}), rosterDirty ? (fromEvent ? eventRead(`members.list:${getLocale()}`,peopleRead,context) : peopleRead()) : Promise.resolve(list)]);
      if (mine !== generation) return; rooms = result.rooms; list = people; rosterDirty = false; loaded = true; draw();
    }
    catch {
      // Startup cannot depend on one ready event. Stop retrying after the first successful snapshot, even if empty.
      if (mine !== generation || loaded || !el.isConnected) return;
      const delay = retryDelays[Math.min(retry++, retryDelays.length - 1)];
      timer = setTimeout(() => { timer = undefined; if (el.isConnected) void load(); }, delay);
    }
  };
  visibilityGate(() => { rosterDirty = true; void load(); }, () => el.isConnected);
  listeners.add(event => {
    if(!el.isConnected)return;
    if(event?.type==='WorkerChanged' || event?.type==='AgentTurn')return;
    if (!event || event.type === "MembersChanged" || ["CoreReady"].includes(event.type)) rosterDirty = true;
    clearTimeout(timer); timer = undefined; void load(true,!event || event.type==='RoomsChanged' || ['CoreReady'].includes(event.type));
  }); onLocaleChange(() => { draw(); void load(); });
  // The member column draws on every page change: the row of the open room follows it.
  el.addEventListener("sidebar-draw", () => { if (drawnSelection !== (active() ? selectedRoom : null)) draw(); });
  onAvatarChange(()=>{if(el.isConnected)draw();});
  el.addEventListener("click", e => {
    const target = (e.target as Element).closest<HTMLElement>("[data-room], [data-room-new], [data-room-more]");
    if (!target) return;
    if (target.hasAttribute("data-room-new")) void openNewGroupChat();
    else if (target.dataset.room) void openGroupChat(Number(target.dataset.room));
    else { const room = rooms.find(r => r.id === Number(target.dataset.roomMore)); if (room) roomActions(target,room); }
  });
  draw(); void load(); return el;
}
