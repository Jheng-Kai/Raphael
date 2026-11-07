import { visibilityGate, windowVisible } from "../window-visibility";
import { readDraftWords, writeDraftWords } from "../composer-drafts";
import { cardDisclosureHTML, cardFailure, cardHTML, cardPromptText } from "../card";
import { mountTaskResults } from "../task-result";
import { patchThread, threadLineIdentity } from "../thread-diff";
import { sameWire, ThreadRenderCache } from "../thread-render";
import { mountTranscriptWindow, TranscriptWindow } from "../transcript-window";
import { composioAction } from "../composio-result";
// 拉斐爾: the one conversation with Raphael (`agent.history.list`), oldest at the top and newest at
// the bottom, under the days it was had, whether it was said to the emblem, sent from a chat app or
// typed here. Scrolling up brings the earlier turns; the page follows the newest only while it is
// read to the end. A turn written or completed (`AgentTurn`) and a background task that took a step
// (`WorkerChanged`) bring the newest turns again, and a task under way can be stopped here.
//
// The composer accepts any file type through the picker, clipboard or thread drop target.
// Up to four files share a 100 MB budget; each file may be up to 50 MB. Media thumbnails and
// file cards show in the tray before sending, and stored copies remain available in history.
// The field asks Raphael in writing
// (`agent_ask_text`, Enter sends, Shift+Enter starts a new line) and Raphael's face is the voice
// button, which does what the question key does (the same `window_hotkey` path) and flies up while
// he listens (voice-mode.ts). When he asks a YES/NO question, a gold card takes the composer's
// place: it is the overlay's question again (`AgentQuestion`), and answering either one answers
// both. With no turn at all the page is Raphael alone, the composer under him. A background task
// that waits for the owner's yes shows its question where the thread ends, as a gold card of its own
// (background-questions.ts), answered here only.
//
// Raphael's own settings (the question key, the weather city) are the 拉斐爾 tab of Settings, which
// the gear button at the top opens; Telegram is in its 訊息平台 tab.
//
// The page is also where the members are (members-shell.ts): the member column on the left, the
// details panel on the right, and the centred pill over the chat. Each member has one thread, as
// Raphael has: picking a member loads its turns (`agent.history.list {member_id}`), and the composer
// asks it (`agent_ask_text {memberId}`). Every thread reads like colleagues talking: answers and
// questions are plain words, Raphael's 《prefix。》 included only on the desktop overlay. A member's
// composer says 「傳訊息給 <name>」 and shares Raphael's emblem voice button, and the gold card
// shows in the thread whose member asked. While the page is on screen the main sidebar is an icon rail (main.ts). Above the composer
// is the slot of the thread's questions from the background (background-mount.ts). A member's
// thread is its own: the search looks in it alone, and no turn of another thread shows in it but
// the closed line of what a colleague asked it (exchange-line.ts).

import { noticeHTML } from "../missing";
import { conversationTitle, conversationChange, newestConversation, type ConversationInfo } from "../conversation-list";
import { eventRead } from '../event-read';
import { cancelGesture } from "../../shared/cancel-gesture";
import { openActions } from "../member-column";
import { mountConversationFind } from "../conversation-find";
import { openRoutineDialog } from "../routine-dialog";
import { createAttachmentMedia } from "../attachment-media";
import { ATTACH_MAX, FILE_MAX_BYTES, TOTAL_MAX_BYTES, attachmentLimit, readComposerFile, attachRefusal, base64Of, bindFilePaste, draftFileHTML, fileMime, fileKind, mountStageDrop } from "../attachments";
import { closeMediaLightbox, openMediaLightbox } from "../media-lightbox";
import { wholeLinks } from "../composer-links";
import { mountSlashMenu } from "../slash-menu";
import { getLocale, onLocaleChange, t } from "../i18n";

import { plainReplies } from "../../shared/anime";
import * as api from "../api";
import { createLinkPreviews, type LinkPreview } from "../link-previews";
import { messagePlainText } from "../message-content";
import { mountRichContent, preserveRichScroll, richScrollFollows, followRichScroll, releaseRichScroll } from "../message-rich";
import { mountConversationScroll } from "../conversation-scroll";
import { openUnread, unreadLine } from "../unread-divider";
import { measureMessagePreviews, messagePreviewMeasure } from "../message-preview";
import { messageTooltip } from "../message-tooltip";
import { quoteHTML, selectionQuote } from "../message-quote";
import { ReplyPacing } from "../reply-pacing";
import { avatarHTML, currentAvatar, onAvatarChange } from "../avatar";
import "../background-questions.css";
import type { BackgroundQuestions } from "../background-questions";
import { RAPHAEL_ID, faceHTML, memberPlaceholder } from "../members";
import { createMembers } from "../members-shell";
import { createDraftPanel, hasDrafts } from "../member-draft";
import { mountBackgroundQuestions } from "../background-mount";
import { mountVoiceChat, voiceCallCardHTML, foldCallTurns } from "../voice-chat";
import { TYPED, VOICE, exchangeTurn, mergeTurns, oldestId, refreshTurns, sourceOf, threadItems, visibleTurn } from "../conversation";
import { carryTyped } from "../secret-card";
import { carryInlineSetup, mountInlineConnectionSetup } from "../connection-setup";
import { carryMail } from "../mail-card";
import { mountPages } from "../page-card";
import { menuReactionsHTML, mountMessageMetadata } from "../message-metadata";
import { MORE_EMOJI, openEmojiPicker } from "../emoji-picker";
import { mountMailActions } from "../mail-actions";
import { mountGreeting } from "../member-greeting";
import { answerOwnerPage, mountOwnerQuestions } from "../owner-questions";
import { mountPendingQuestions } from "../pending-questions";
import { approvalCopy, permissionFor } from "../permission-card";
import { memberAccent, memberColor, ownerBubble } from "../owner-bubble";
import { openPeerChat, type PeerChatView } from "../peer-chat";
import { exchangeView } from "../exchange-line";
import { dayLabel, describeError } from "../format";
import { loadingHTML } from "../loading";
import {
  type TimelineState,
  type TurnLook,
  dayHTML,
  emptyTimelineState,
  forgetReruns,
  updateLiveTimes,
  hasWorkerTask,
  isLive,
  markSeen,
  noteTaskEnds,
  pendingTurnHTML,
  latestProgress,
  livePresenceHTML,
  parseMediaPayload,
  requestRerun,
  requestStop,
  safeHttpUrl,
  safeMediaSrc,
  stepsOpen,
  turnHTML,
  wantsRefresh,
} from "../timeline";
import type { PageArgument, AgentQuestion, AgentTurn, AppContext, GroupDraft, MemberDraft, MessageQuote, OwnerQuestion, Page, TurnAttachment, WireAttachment } from "../types";
import { copyButton, esc, ico, iconButton, patchHTML, toaster } from "../ui";
import { createRoomPane } from "../group-chats";
import { bindActionMode, bindPageComposer, composerHTML, drawTaskSlot } from "../chat-composer";
import { mountComposerBrain } from "../composer-brain";
import { bindComposerHistory } from "../composer-history";
import { bindComposerLearning, learnComposerCorrections } from "../composer-learning";
import type { DictationBaseline } from "../composer-learning";
import { createProblemNotice } from "../problem-notice";
import { VoiceMode } from "../voice-mode";
import { mountDesktopViewer } from "../desktop-viewer";
import "../agent.css";
import "../members.css";

/** How many turns one load brings. */
const PAGE_SIZE = 50;
/** Within this many px of the bottom, the conversation counts as read to the end and follows new turns. */
const BOTTOM_SLACK_PX = 80;
/** Within this many px of the top, the earlier turns are loaded. */
/** Events that come together (a task's step and its turn) bring the turns once. */
const REFRESH_DELAY_MS = 150;
/** The most a typed question may hold (the app's own limit is the same). */
export const TYPED_MAX_CHARS = 100_000;
/** A question said aloud whose turn never comes (the core went away) stops waiting after this long. */
const HEARING_MAX_MS = 120_000;
/** The voice button sent the key, and the app did not start listening within this long: the picture comes back down. */
const LISTEN_WAIT_MS = 1500;

/**
 * The question as the card keeps it: what the app sent, with the strictness it really has. A
 * question with the third answer (letting Raphael operate an app) is always T2, never held.
 */
export function openQuestion(q: AgentQuestion): AgentQuestion {
  const always = typeof q.always === "string" && q.always !== "" ? q.always : undefined;
  return { ...q, always, tier: always ? "T2" : q.tier };
}

/**
 * What the card's buttons say: the question's own words for the two plain answers when it brings
 * them, else the page's Allow and Deny; `always`
 * is the third button's label, null when the question has two answers.
 */
export function askLabels(q: AgentQuestion | null): { yes: string; no: string; always: string | null } {
  const always = q?.always ? q.always : null;
  return {
    // A third answer keeps the core's explicit choices; ordinary approvals use the shared permission words.
    yes: (always !== null && q?.yes) || t("local.allow"),
    no: (always !== null && q?.no) || t("perm.deny"),
    always,
  };
}

/** The words of the empty page: the overlay's greeting to a question, without its last stop. */
export const greetingLine = (): string => t("agent.greet");

/**
 * The question's words stay separate from all file types. Null when there is nothing to send or
 * it is too long. With files attached, no words is a question too: "", interpreted by the core.
 */
export function typedQuestion(words: string, withFiles = false): string | null {
  const text = words.trim();
  if ((text === "" && !withFiles) || text.length > TYPED_MAX_CHARS) return null;
  return text;
}

// ---------- attachments ----------
export { ATTACH_MAX, FILE_MAX_BYTES, TOTAL_MAX_BYTES, attachRefusal, base64Of };
export const IMAGE_MAX_BYTES = FILE_MAX_BYTES;
export const PDF_MAX_BYTES = FILE_MAX_BYTES;
export const PDF_TYPE = "application/pdf";
/** An empty accept list leaves the picker open to every file type. */
export const PICKER_ACCEPT = "";
export const attachmentType = fileMime;
export const attachLimit = attachmentLimit;
/** A file attached to the next question, with its tray identity and byte count. */
export interface ComposerFile extends WireAttachment {
  id: number;
  size?: number;
}

/** The files as `agent.ask` takes them: name, type and bytes, nothing of the page's own. */
export const wireAttachments = (files: readonly ComposerFile[]): WireAttachment[] => files.map(({ name, mime, data, stored_id }) => ({ name, mime, data, ...(stored_id ? { stored_id } : {}) }));

/** Whether a key press in the composer sends: Enter alone, never while an input method composes. */
export const sendsOnEnter = (e: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">): boolean =>
  e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229;

/**
 * The words of a draft the page is handed when it opens (`app.go("agent", "draft:" + words)`, from
 * the 「試試看」 of a connected service), cut to what a question may hold; null for none.
 */
export function draftText(arg: PageArgument | undefined): string | null {
  if (typeof arg !== "string" || !arg.startsWith("draft:")) return null;
  return arg.slice("draft:".length).slice(0, TYPED_MAX_CHARS);
}

/** A turn typed here that the history does not have yet. */
interface Outgoing {
  key: string;
  requestId: string;
  /** The member whose thread it was typed in (0: Raphael's). */
  member: number;
  conversationId?: number;
  text: string;
  sentAt: number;
  /** Files it went with, including previews until their stored copies reach history. */
  files: TurnAttachment[];
  quote?: MessageQuote;
}

interface ComposerDraft {
  dictation?: DictationBaseline;
  pageId?: string;
  text: string;
  files: ComposerFile[];
  missing: TurnAttachment[];
  replacing?: number;
  quote?: MessageQuote;
}

export function createAgent(app: AppContext): Page & { sidebar: HTMLElement; loadSidebar(): Promise<void> } {
  const el = document.createElement("div");
  el.className = "page page-agent";
  el.dataset.page = "agent";
  el.hidden = true;
  el.innerHTML =
    `<section class="mb-chat">` +
    `<div class="page-head mb-head"><h1 class="mb-h1">${esc(t("agent.title"))}</h1><span class="mb-head-l">` +
    iconButton("search", t("agent.search"), ' data-act="search" aria-expanded="false" hidden', "ra-tool") +
    // Nothing at the right end, as Grok Bot's header (owner, 2026-11-06): the computer is a tab of the panel the name opens.
    `</span><span class="mb-head-c"></span><div class="ra-tools"></div></div>` +
    `<div class="ra-find" hidden></div>` +
    `<div class="ra-stage">` +
    `<div class="ra-scroll"><div class="ra-col"><div class="ra-older" hidden></div><ol class="thread"></ol><p class="ra-none" hidden></p></div></div>` +
    `<div class="ra-wait" hidden></div>` +
    `<div class="ra-empty" hidden><div class="ra-hero"></div><p class="ra-hi"></p><div class="ra-slot"></div></div>` +
    `<div class="ra-dock"></div>` +
    `</div>` +
    `</section>`;
  const heading = el.querySelector<HTMLElement>("h1")!;
  const searchButton = el.querySelector<HTMLElement>('[data-act="search"]')!;
  /** Whether the open member's computer is working now: a dot beside its name in the header says so. */
  let computerActive = false;
  const find = el.querySelector<HTMLElement>(".ra-find")!;

  const stage = el.querySelector<HTMLElement>(".ra-stage")!;
  const scroller = el.querySelector<HTMLElement>(".ra-scroll")!;
  const older = el.querySelector<HTMLElement>(".ra-older")!;
  const thread = el.querySelector<HTMLOListElement>(".thread")!;
  const none = el.querySelector<HTMLElement>(".ra-none")!;
  const wait = el.querySelector<HTMLElement>(".ra-wait")!;
  const empty = el.querySelector<HTMLElement>(".ra-empty")!;
  const hero = el.querySelector<HTMLElement>(".ra-hero")!;
  const hi = el.querySelector<HTMLElement>(".ra-hi")!;
  const slot = el.querySelector<HTMLElement>(".ra-slot")!;
  const dock = el.querySelector<HTMLElement>(".ra-dock")!;
  /** The open thread's questions from the background, above the composer wherever it is. */
  let waiting: BackgroundQuestions | null = null;
  const backgroundSlot = document.createElement("div");
  backgroundSlot.className = "ra-bgq";
  backgroundSlot.dataset.mount = "background-questions";

  // ---------- the members ----------

  let visible = false;
  let unreadFrom: number | null = null;
  let unreadCaptured = false;
  let openingThread = true;
  let composerBrain: ReturnType<typeof mountComposerBrain> | undefined;
  const chosenConversations = new Map<number, number>();
  const members = createMembers({
    app,
    onOpenConversation: (member, conversation, turn) => openConversation(member, conversation, turn),
    conversationOf: member => chosenConversations.get(member),
    visible: () => visible,
    onReadThread: member => {
      if (unreadCaptured) return;
      unreadCaptured = true;
      unreadFrom = member.unread_from ?? null;
      if (loadedThread) {
        if (unreadFrom !== null) {
          render();
          if (needsUnreadHistory()) { void load(true); return; }
        }
        finishOpening();
      }
    },
    focusHeader: () => conversationButton.focus({ preventScroll: true }),
    onDetailsChange: open => { conversationButton.setAttribute("aria-expanded", String(open)); queueMicrotask(() => open && visible && !roomPane.active ? desktop.show() : desktop.sync()); },
    onSelect: (_id, sameThread) => {
      app.go("agent");
      if (sameThread) { roomPane.close(); void load(false); focusComposer(); }
      else switchThread();
    },
    onUpdate: () => {
      composerBrain?.draw();
      drawComposer();
      drawDock();
      drawFaces();
      drawConversation();
      hi.textContent = emptyLine();
      draftPanel.redraw();
      if (visible && !scroller.hidden) drawThread();
    },
  });
  el.prepend(members.column);
  el.append(members.details);
  const desktop = mountDesktopViewer(members.details, () => members.current(), {
    timeline: el.querySelector<HTMLElement>(".thread")!, conversation: () => conversationId(),
    name: () => members.nameOf(members.current()),
    face: () => members.faceOf(members.current(), 22),
    closePanel: () => members.setDetails(false),
    openPanel: () => members.computer(), panelVisible: () => members.detailsOpen() && members.details.dataset.detailsTab === 'computer',
    status: active => {
      computerActive = active;
      const trigger = el.querySelector<HTMLElement>(".mb-chat .conversation-trigger");
      if (trigger) { trigger.classList.toggle("is-computer-active", active); drawConversation(); }
    },
    changed: () => { if (visible && !scroller.hidden) drawThread(); },
    trySkill: text => sendFromPage(text),
    stop: turnId => { const turn = turns.find(turn => turn.id === turnId); return turn?.task ? api.workerCancel(turn.task.id) : turn?.session_id ? api.agentStop(turn.session_id, memberId()) : Promise.resolve(); },
  });
  members.details.addEventListener('member-panel-tab', () => { if (visible && !roomPane.active) desktop.show(); desktop.sync(); });
  const detailsScrim = document.createElement("div");
  detailsScrim.className = "mb-det-scrim";
  detailsScrim.setAttribute("aria-hidden", "true");
  detailsScrim.addEventListener("click", () => members.setDetails(false));
  el.insertBefore(detailsScrim, members.details);
  if (members.detailsOpen()) el.dataset.det = "open";
  el.querySelector(".mb-head-l")!.append(members.picker);
  const head = document.createElement("div"); head.className = "conversation-head";
  const conversationButton = document.createElement("button");
  conversationButton.type = "button"; conversationButton.className = "btn conversation-trigger";
  members.details.id = "member-details";
  conversationButton.setAttribute("aria-controls", members.details.id);
  conversationButton.setAttribute("aria-expanded", String(members.detailsOpen()));
  const caption = document.createElement("span"); caption.className = "conversation-caption";
  conversationButton.append(members.pill, caption);
  head.append(conversationButton);
  el.querySelector(".mb-head-c")!.append(head);
  const conversationCache = new Map<number, ConversationInfo[]>();
  let targetTurn: number | undefined;
  const quotaHost = document.createElement("div"); quotaHost.className = "quota-chips";
  quotaHost.hidden = true;
  const problemNotice = createProblemNotice(app, () => { if (!problemNotice.el.hidden) composer.before(problemNotice.el); });
  let quotas: { provider: string; reset_at_ms: number | null }[] = [];
  let quotaTimer: ReturnType<typeof setTimeout> | undefined;
  const conversationId = (): number | undefined => chosenConversations.get(memberId());
  const belongs = (sent: Outgoing): boolean => sent.member === memberId() && sent.conversationId === conversationId();
  /** Where a typed question goes: its conversation, named as the quick one when it is (the core never defaults to it). */
  const destinationOf = (member: number, conversation: number | undefined): { conversationId?: number; destination?: "quick" } =>
    conversation === undefined ? {} : { conversationId: conversation,
      ...(conversationCache.get(member)?.find(c => c.id === conversation)?.kind === "quick" ? { destination: "quick" as const } : {}) };

  /** The header names only the member; Raphael's quick questions say so under it. */
  function drawConversation(): void {
    const selected = conversationCache.get(memberId())?.find(c => c.id === conversationId());
    const title = selected?.kind === "quick" ? conversationTitle(selected) : "";
    composerBrain?.draw();
    caption.textContent = title;
    caption.hidden = !title;
    const name = members.member().name;
    const working = computerActive ? ` · ${t("desktop.working")}` : "";
    conversationButton.setAttribute("aria-label", (title ? `${name}: ${title}` : name) + working); conversationButton.title = (title || name) + working;
    conversationButton.classList.toggle("is-computer-active", computerActive);
  }

  const conversationsDirty = new Set<number>();
  async function readConversations(member: number, fromEvent = false): Promise<void> {
    conversationsDirty.delete(member);
    try {
      const fetch = () => api.core<{ conversations: ConversationInfo[] }>("conversations.list", { member_id: member });
      const result = await (fromEvent ? eventRead(`conversations.list:${member}`,fetch,app) : fetch());
      if (!Array.isArray(result?.conversations)) return;
      const previous = conversationCache.get(member);
      const same = JSON.stringify(previous) === JSON.stringify(result.conversations);
      conversationCache.set(member, result.conversations);
      const chosen = chosenConversations.get(member);
      const available = new Set(result.conversations.map(c => c.id));
      const missing = new Set((previous ?? []).filter(c => !available.has(c.id)).map(c => c.id));
      if (chosen !== undefined && !available.has(chosen)) missing.add(chosen);
      for (const id of missing) {
        const removed = draftKey(member, id);
        discardComposerDraft(removed);
        if (composerKey === removed) { composerKey = "deleted"; clearTimeout(draftTimer); }
      }
      if (!result.conversations.some(c => c.id === chosen)) {
        const next = newestConversation(result.conversations);
        if (next) chosenConversations.set(member, next.id);
        else chosenConversations.delete(member);
      }
      if (member === memberId() && composerKey !== draftKey()) {
        saveComposerDraft();
        const transient = composerKey === `${member}:main` && chosen === undefined ? restored.get(composerKey) : undefined;
        if (transient && !restored.has(draftKey()) && !readDraftWords(`member:${draftKey()}`)) {
          restored.set(draftKey(), transient);
          discardComposerDraft(composerKey);
          writeDraftWords(`member:${draftKey()}`, { text: wholeLinks(transient.text), quote: transient.quote });
        }
        input.value = ""; files = []; missingFiles = []; replacing = undefined; composerQuote = undefined;
        loadComposerDraft(); drawQuote(); drawFile(); fit();
      }
      if (same && chosen === chosenConversations.get(member)) return;
      if (member === memberId()) drawConversation();
      window.dispatchEvent(new CustomEvent("conversation-opened", { detail: member }));
    } catch { /* A core that is restarting keeps the last selection until the next refresh. */ }
  }

  function openConversation(member: number, id: number, turnId?: number): void {
    const changed = memberId() !== member;
    if (!changed && !roomPane.active && conversationId() === id && turnId === undefined) return;
    chosenConversations.set(member, id); targetTurn = turnId;
    if (changed) members.select(member); else switchThread();
    drawConversation();
    window.dispatchEvent(new CustomEvent("conversation-opened", { detail: member }));
  }

  conversationButton.addEventListener("click", () => {
    members.setDetails(!members.detailsOpen());
  });
  window.addEventListener("conversations-changed", (event) => {
    const member = (event as CustomEvent<number>).detail;
    if (!visible) { conversationsDirty.add(member); return; }
    const old = conversationId();
    void readConversations(member,true).then(() => {
      if (visible && member === memberId() && old !== conversationId()) switchThread();
    });
  });

  function drawQuotas(): void {
    clearTimeout(quotaTimer);
    const now = Date.now(); quotas = quotas.filter(q => q.reset_at_ms === null || q.reset_at_ms > now);
    const names: Record<string, string> = { codex: "Codex", claude: "Claude", gemini: "Antigravity" };
    const time = (ms: number): string => new Intl.DateTimeFormat(getLocale(), { hour: "numeric", minute: "2-digit" })
      .formatToParts(new Date(ms)).map(part => part.type === "dayPeriod" ? `${part.value} ` : part.value).join("").trim();
    quotaHost.innerHTML = quotas.map(q => `<span class="quota-chip" role="status">${ico("clock")}<span>${esc(t("chat.quota", { p0: names[q.provider] ?? q.provider }))}${q.reset_at_ms ? esc(t("chat.quotaReset", { p0: time(q.reset_at_ms) })) : ""}</span></span>`).join("");
    quotaHost.hidden = quotas.length === 0;
    if (quotaHost.hidden) quotaHost.remove();
    else composer.before(quotaHost);
    const next = Math.min(...quotas.map(q => q.reset_at_ms ?? Infinity));
    if (Number.isFinite(next)) quotaTimer = setTimeout(drawQuotas, Math.min(2_147_483_647, Math.max(1, next - now)));
  }
  async function readQuotas(): Promise<void> {
    try { const result = await api.core<{ quotas: typeof quotas }>("quota.list"); if (Array.isArray(result?.quotas)) { quotas = result.quotas; drawQuotas(); } } catch { /* Preserve the last known reset until reconnection. */ }
  }
  /** The member whose thread is open: 0 is Raphael. */
  const memberId = (): number => members.current();
  const inRaphael = (): boolean => memberId() === RAPHAEL_ID;
  drawConversation();

  const memberChat = el.querySelector<HTMLElement>(".mb-chat")!;
  /** The conversation between members a centred line opened over the thread (peer-chat.ts). */
  let peer: PeerChatView | null = null;
  const roomPane = createRoomPane(app, () => {
    el.classList.remove("is-room"); memberChat.hidden = false;
    el.querySelector(".mb-head-l")!.append(members.picker);
    if (visible) { members.show(); desktop.show(); }
  }, () => { if (visible) attachmentMedia.sync(); });
  el.append(roomPane.el);
  window.addEventListener("raphael:open-room", event => {
    if (!el.isConnected) return;
    unreadFrom = null;
    unreadCaptured = false;
    openingThread = true;
    // A member's private computer does not stay open behind a group.
    desktop.hide(true);
    el.classList.add("is-room"); memberChat.hidden = true;
    roomPane.el.querySelector(".room-picker")!.append(members.picker);
    members.show();
    void members.load();
    void roomPane.open((event as CustomEvent<{roomId:number}>).detail.roomId);
  });

  // ---------- the composer and the approval card ----------

  const composer = document.createElement("form");
  composer.className = "composer";
  composer.noValidate = true;
  composer.innerHTML = composerHTML();
  const input = composer.querySelector<HTMLTextAreaElement>(".cmp-input")!;
  const pageDraft = bindPageComposer(input);
  const correctionLearning = bindComposerLearning(input);
  const slashMenu = mountSlashMenu(input, { memberId, scope: app });
  const attachButton = composer.querySelector<HTMLElement>(".cmp-attach")!;
  bindActionMode(composer.querySelector<HTMLElement>(".cmp-mode")!);
  composerBrain = mountComposerBrain(composer.querySelector<HTMLElement>(".cmp-model")!, () => members.member(), { onEvent: handler => app.onEvent(handler), quick: () => conversationCache.get(memberId())?.find(c => c.id === conversationId())?.kind === "quick" });
  const voiceButton = composer.querySelector<HTMLButtonElement>(".cmp-voice")!;
  const sendButton = composer.querySelector<HTMLButtonElement>(".cmp-send")!;
  input.addEventListener("input", () => voiceChat.draw());
  // Voice chat waits for a later release (owner, 2026-11-06): the voice button records voice messages only.
  const VOICE_CALLS = false;
  const callEligible = (): boolean => VOICE_CALLS && !roomPane.active && memberId() > 0 && conversationId() !== undefined &&
    !input.value.trim() && !files.length && !missingFiles.length && !composerQuote && replacing === undefined && !composerTask();
  const voiceChat = mountVoiceChat({ composer, button: voiceButton, root: el,
    target: () => ({ member: roomPane.active ? -1 : memberId(), conversation: conversationId(), name: members.member().name }),
    eligible: callEligible, changed: () => {}, refresh: () => { if (visible) void load(false); },
  });
  const fileChip = composer.querySelector<HTMLElement>(".cmp-file")!;
  const picker = composer.querySelector<HTMLInputElement>(".cmp-picker")!;
  const hideTooltip = messageTooltip(el);
  const quoteCard = composer.querySelector<HTMLElement>(".cmp-quote")!;
  const hideSelection = selectionQuote({ host: el, thread, active: () => visible,
    author: message => message.matches(".bubble") ? t("chat.you") : members.nameOf(memberId()),
    onQuote: quote => { composerQuote = quote; drawQuote(); focusComposer(); },
  });

  const askCard = document.createElement("div");
  askCard.className = "ask-card-host";
  askCard.hidden = true;
  askCard.setAttribute("role", "group");
  askCard.innerHTML = cardHTML({ title: t("cards.permission", { p0: t("agent.title") }), status: "waiting", statusText: cardPromptText("permission"), cls: "ask-card",
    body: t("perm.title"),
    content: cardDisclosureHTML("approval", `<p class="ask-q card-body"></p>`),
    actions: `<button type="button" class="btn sm pri ask-yes" data-act="yes"><span class="ask-yes-t"></span></button>` +
      `<button type="button" class="btn sm ask-always" data-act="always" hidden></button>` +
      `<button type="button" class="btn sm ask-no" data-act="no"></button>`,
  });
  const askText = askCard.querySelector<HTMLElement>(".ask-q")!;
  const noButton = askCard.querySelector<HTMLButtonElement>(".ask-no")!;
  const alwaysButton = askCard.querySelector<HTMLButtonElement>(".ask-always")!;
  const yesButton = askCard.querySelector<HTMLButtonElement>(".ask-yes")!;
  const draftPanel = createDraftPanel({
    groups: () => members.groups(),
    onConfirm: (edited, groups) => void answer(true, false, edited, groups),
    onCancel: () => void answer(false),
  });

  // ---------- what the page keeps ----------

  /** What is loaded, newest first. */
  let turns: AgentTurn[] = [];
  let pendingQuestions: { member: number; conversation?: number; questions: OwnerQuestion[] } | undefined;
  let canLoadEarlier = false;
  let loadingEarlier = false;
  let failure: (() => string) | null = null;
  let pending = false;
  let loads = 0;
  let loadedThread = false;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const pacing = new ReplyPacing(() => { if (visible) render(); }, () => reducedMotion?.matches ?? false);
  reducedMotion?.addEventListener("change", () => { pacing.flush(); if (visible) render(); });
  const details = new Set<number>();
  const state: TimelineState = emptyTimelineState();
  const attachmentMedia = createAttachmentMedia(el, id => api.core("attachments.get", { id }));
  const previews = createLinkPreviews(scroller, url => api.core<LinkPreview | null>("links.preview", { url }));
  const regenerating = new Set<number>();
  const measureAllMessages = messagePreviewMeasure(thread);
  const messageResize = typeof ResizeObserver === "function" ? new ResizeObserver(measureAllMessages) : null;
  void document.fonts?.ready.then(measureAllMessages);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  /** Questions typed here whose turns have not come yet. */
  let outgoing: Outgoing[] = [];
  let sent = 0;
  /** A spoken question's recipient and history boundary stay fixed across thread changes. */
  let hearing: { since: number; after: number | null; member: number; conversation?: number } | null = null;
  /** Ends `hearing` at `HEARING_MAX_MS` when neither its turn nor any other word of the core comes. */
  let hearingTimer: ReturnType<typeof setTimeout> | undefined;
  const stoppingComposerTasks = new Set<string>();
  /** The native voice key names quick for Raphael and the main conversation for a member. */
  const voiceConversationId = (member: number): number | undefined =>
    conversationCache.get(member)?.find(c => member === RAPHAEL_ID ? c.kind === "quick" : c.is_default)?.id;
  const hearingBelongs = (): boolean => hearing !== null && hearing.member === memberId() && conversationId() === hearing.conversation;
  /** Draft file bytes, kept in memory until the request is sent. */
  let files: ComposerFile[] = [];
  let fileIds = 0;
  let missingFiles: TurnAttachment[] = [];
  let replacing: number | undefined;
  let composerQuote: MessageQuote | undefined;
  const drafts = new Map<string, ComposerDraft>();
  const restored = new Map<string, ComposerDraft>();
  const draftKey = (member = memberId(), conversation = conversationId()): string => `${member}:${conversation ?? "main"}`;
  let composerKey = draftKey();
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  function saveComposerDraft(): void {
    clearTimeout(draftTimer);
    if (composerKey === "deleted") return;
    const draft: ComposerDraft = { text: input.value, files: [...files], missing: [...missingFiles], replacing, quote: composerQuote, dictation: correctionLearning.snapshot(), pageId: pageDraft.pageId };
    if (draft.text || draft.files.length || draft.missing.length || draft.quote || draft.replacing !== undefined) restored.set(composerKey, draft);
    else restored.delete(composerKey);
    writeDraftWords(`member:${composerKey}`, { text: wholeLinks(draft.text), quote: draft.quote, pageId: draft.pageId });
  }
  function loadComposerDraft(): void {
    composerKey = draftKey();
    input.dispatchEvent(new Event("composer-draft-restored"));
    const saved = restored.get(composerKey) ?? readDraftWords<MessageQuote>(`member:${composerKey}`);
    if (saved) {
      restoreDraft({ files: [], missing: [], ...saved }, false);
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  function discardComposerDraft(key: string): void {
    restored.delete(key); writeDraftWords(`member:${key}`);
  }
  window.addEventListener("pagehide", saveComposerDraft);
  const retracting = new Set<string>();
  const retracted = new Set<string>();
  let attachmentEpoch = 0;
  let attaching = 0;
  let attachQueue: Promise<void> = Promise.resolve();
  const { measure: measureDrop, reset: resetDrop } = mountStageDrop(stage, () => composer.hidden ? (draftPanel.el.hidden ? askCard : draftPanel.el) : composer, list => { void attachAll(list); });
  const dropResize = typeof ResizeObserver === "function" ? new ResizeObserver(measureDrop) : null;
  /** The chip of each of them, made once (an image's picture is not loaded again at each drawing). */
  const fileChips = new Map<number, HTMLElement>();
  /** The YES/NO question that waits for an answer, and whether an answer is on its way. */
  let question: AgentQuestion | null = null;
  const questions = new Map<string, { prompt: AgentQuestion; owner: number }>();
  const answeringQuestions = new Set<string>();
  let answering = false;
  /** The member a typed question is on its way to, while it is: a question it asks is its thread's. */
  let askingMember: number | null = null;
  /** The thread of the question that waits (see `setQuestion`). */
  let questionOwner = RAPHAEL_ID;
  let searching = false;
  /** What each line of the thread was drawn from, so that a line whose HTML is the same stays as it is. */
  const drawnHTML = new WeakMap<Element, string>();
  const pagesHost = mountPages(thread, { place: pageDraft.place });
  mountOwnerQuestions(thread, () => { void load(false); });
  mountGreeting(thread, sendFromPage);
  const floatingQuestions = mountPendingQuestions(thread, scroller, () => load(false), () => pendingQuestions?.member === memberId() && pendingQuestions.conversation === conversationId() ? pendingQuestions.questions : [], revealTurn);
  /** The newest turn drawn: a turn after it comes in from below. */
  let newestDrawn = 0;
  let drewOnce = false;

  /** The thread's own turns: what colleagues asked this member is drawn, never stopped or searched here. */
  const own = (): AgentTurn[] => turns.filter((turn) => !exchangeTurn(turn));
  mountConversationScroll(scroller);
  const turnWindow = new TranscriptWindow();
  const windowMount = mountTranscriptWindow(scroller, thread, turnWindow, { draw: () => render(), older: () => load(true), canOlder: () => canLoadEarlier && !loadingEarlier && !searching });
  let drawingFollows = false;
  let openingWindowTarget: number | undefined;
  mountRichContent(scroller);
  const atBottom = (): boolean => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK_PX;
  const newestId = (): number => turns.reduce((max, turn) => Math.max(max, turn.id), 0);
  const isEmpty = (): boolean =>
    !turns.some(visibleTurn) && !outgoing.some(belongs) && !hearingBelongs();

  const look = (): TurnLook => {
    const latest = turns.filter(turn => turn.question.trim() && sourceOf(turn) !== "routine" && sourceOf(turn) !== "member" && turn.route !== "exchange" && (turn.text.trim() || turn.messages?.some(m => m.kind === "reply"))).reduce((id, turn) => Math.max(id, turn.id), 0);
    const busy = pacing.active || regenerating.size > 0 || outgoing.some(belongs) || own().some(turn => turn.status === "running" || isLive(turn.task));
    const shared = { greetingOpen: !turns.some(turn => !!turn.question.trim()) && !outgoing.some(belongs), regenerateTurnId: busy ? undefined : latest, revealing: (id: number) => pacing.waiting(id), waitingForOwner: desktop.waitingForOwner, memberName: members.nameOf, memberFace: (id: number, size = 18) => members.faceOf(id, size), mentions: members.mentionTargets(),
      // A permission card in the thread can be answered while the window holds its question and is not answering it.
      answerable: (cardId: string) => question?.id === cardId && !answering };
    if (inRaphael()) return { ...shared, face: () => faceHTML(members.member(), 26), liveFace: () => faceHTML(members.member(), 28), activityLabel: members.member().activity_label };
    const member = members.member();
    return { ...shared, face: () => faceHTML(member, 26), liveFace: () => faceHTML(member, 28), activityLabel: member.activity_label };
  };
  /**
   * The question that waits now (null: none), and whose thread it is in: the member a typed or
   * spoken question was on its way to when it came. The thread is kept with the question, so what is typed later
   * does not move it.
   */
  function setQuestion(next: AgentQuestion | null): void {
    if (next) questions.set(next.id, { prompt: next, owner: next.member_id ?? questions.get(next.id)?.owner ?? askingMember ?? RAPHAEL_ID });
    else if (question) { questions.delete(question.id); answeringQuestions.delete(question.id); }
    selectQuestion();
  }

  /** Keep other conversations' cards while selecting the question this thread can answer. */
  function selectQuestion(): void {
    const selected = [...questions.values()].find(({ prompt, owner }) => owner === memberId() &&
      (prompt.conversation_id !== undefined ? prompt.conversation_id === conversationId() : conversationCache.get(memberId())?.find(c => c.id === conversationId())?.is_default !== 0));
    question = selected?.prompt ?? null;
    answering = question !== null && answeringQuestions.has(question.id);
    questionOwner = selected?.owner ?? RAPHAEL_ID;
  }

  const voice = new VoiceMode({
    stage,
    button: () => (voiceButton.isConnected && !composer.hidden && !voiceButton.hidden ? voiceButton : null),
    composer: () => (composer.isConnected && !composer.hidden ? composer : null),
    target: () => (empty.hidden || !inRaphael() ? null : hero.querySelector<HTMLElement>(".av")),
    face: () => avatarHTML({ size: 132, loop: true }),
    live: () => currentAvatar() === null,
    onClick: () => void endVoice(),
  });

  // ---------- drawing ----------

  /**
   * The face of who the thread is with, where the composer, the card and the empty page show it:
   * Raphael's or the member's. Every thread's voice button is the gold emblem (拉斐爾大師), never a picture.
   */
  function drawFaces(): void {
    drawComposerTask();
    // Each conversation wears its member's colour, Raphael's his first blue slime's since 2026-11-07 (R-UI-81).
    const member = members.member(), color = memberColor(member);
    patchHTML(hero, faceHTML(member, inRaphael() ? 132 : 96));
    const bubble = ownerBubble(color);
    memberChat.dataset.memberBubble = bubble.words;
    memberChat.style.setProperty("--member-bubble", bubble.fill);
    memberChat.style.setProperty("--member-accent", memberAccent(color));
    voice.redraw();
  }

  /** The thread's prompt in the window's language. */
  function drawComposer(): void {
    const words = inRaphael() ? t("home.askRaphael") : memberPlaceholder(members.member().name);
    input.placeholder = words;
    input.setAttribute("aria-label", words);
    empty.classList.toggle("is-member", !inRaphael());
  }

  /** The words of the empty page: Raphael's greeting, or the member's name. */
  const emptyLine = (): string => (inRaphael() ? greetingLine() : members.member().name);

  /** The words of the composer, the card and the search, in the language of the window. */
  function drawWords(): void {
    heading.textContent = t("agent.title");
    sendButton.setAttribute("aria-label", t("chat.send"));
    sendButton.dataset.tooltip = t("chat.send");
    // The voice slot's tooltip is the custom one drawTaskSlot keeps (voice or Stop); a native title would double it.
    voiceButton.setAttribute("aria-label", t("agent.voice"));
    for (const [button, label] of [
      [searchButton, t("agent.search")],
      [attachButton, t("agent.attach")],
    ] as const) {
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    hi.textContent = emptyLine();
    drawAskLabels();
    drawConversation();
    askCard.setAttribute("aria-label", t("agent.asking"));
    drawFile();
    drawQuote();
  }

  /** Keep draft cards mounted while their filenames and remove labels stay current. */
  function drawFile(): void {
    sendButton.disabled = missingFiles.length > 0 || typedQuestion(input.value, files.length > 0) === null;
    // Most restored drafts have no files; an unchanged empty tray needs no layout read.
    if (!files.length && !missingFiles.length && fileChip.hidden && !fileChip.childElementCount) return;
    const label = esc(t("agent.unattach"));
    const beforeHeight = scroller.scrollHeight, beforeClient = scroller.clientHeight;
    const follows = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= BOTTOM_SLACK_PX;
    for (const [id, chip] of fileChips) {
      if (files.some((file) => file.id === id)) continue;
      chip.remove();
      fileChips.delete(id);
    }
    for (const file of files) {
      let chip = fileChips.get(file.id);
      if (!chip) {
        chip = fileChipElement(file);
        fileChips.set(file.id, chip);
      }
      fileChip.append(chip); // preserve attachment order
      const x = chip.querySelector<HTMLElement>(".chip-x")!;
      x.setAttribute("aria-label", t("agent.unattach"));
      x.title = t("agent.unattach");
    }
    fileChip.querySelectorAll("[data-missing]").forEach(chip => chip.remove());
    for (const [index, file] of missingFiles.entries()) fileChip.insertAdjacentHTML("beforeend",
      `<span class="cmp-chip" data-missing><span class="cmp-chip-t">${esc(file.name)} · ${esc(t("chat.reattach"))}</span>` +
      `<button type="button" class="chip-x" data-act="drop-missing" data-index="${index}" aria-label="${label}">${ico("x")}</button></span>`);
    fileChip.hidden = files.length === 0 && missingFiles.length === 0;
    if (follows && (beforeHeight !== scroller.scrollHeight || beforeClient !== scroller.clientHeight)) scroller.scrollTop = scroller.scrollHeight;
  }

  function drawQuote(): void {
    quoteCard.hidden = !composerQuote;
    quoteCard.innerHTML = composerQuote ? quoteHTML(composerQuote) +
      iconButton("x", t("chat.removeQuote"), ' data-act="remove-quote"').replace(" title=", " data-tooltip=") : "";
  }

  /** A draft card with a thumbnail or type icon, size and a remove button. */
  function fileChipElement(file: ComposerFile): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cmp-chip";
    chip.dataset.file = String(file.id);
    chip.innerHTML = draftFileHTML(file, `data-act="unattach-file" data-file="${file.id}"`);
    const thumb = chip.querySelector<HTMLImageElement>(".cmp-thumb");
    // A raster thumbnail from the draft's own bytes.
    if (thumb) {
      if (file.stored_id) void api.attachmentSource(file.stored_id).then(url => { if (thumb.isConnected) thumb.src = url; }).catch(() => {});
      else thumb.src = `data:${file.mime};base64,${file.data}`;
    }
    return chip;
  }

  /** Permission words, or the question's explicit choices when it offers a third answer. */
  function drawAskLabels(): void {
    const labels = askLabels(question);
    noButton.textContent = labels.no;
    askCard.querySelector<HTMLElement>(".ask-yes-t")!.textContent = labels.yes;
    alwaysButton.textContent = labels.always ?? "";
    alwaysButton.hidden = labels.always === null;
  }

  /** The composer or, while Raphael asks, the card in its place; under the thread, or under Raphael on the empty page. */
  function drawDock(): void {
    selectQuestion();
    drawComposerTask();
    hero.hidden = hi.hidden = false;
    const home = empty.hidden ? dock : slot;
    if (backgroundSlot.parentElement !== home) home.prepend(backgroundSlot);
    if (composer.parentElement !== home) home.append(composer);
    voiceChat.draw();
    if (!quotaHost.hidden && quotaHost.nextElementSibling !== composer) home.insertBefore(quotaHost, composer);
    if (!problemNotice.el.hidden) home.insertBefore(problemNotice.el, composer);
    const asking = question !== null;
    const waitingTurn = [...turns].reverse().find((turn) => turn.status === "confirm");
    const inline = asking && waitingTurn ? thread.querySelector<HTMLElement>(`[data-question-turn="${waitingTurn.id}"]`) : null;
    const cardHome = inline ?? home;
    if (asking && hasDrafts(question)) {
      if (voice.isUp) voice.drop();
      askCard.hidden = true;
      delete askCard.dataset.id;
      composer.hidden = false;
      if (draftPanel.el.parentElement !== cardHome) cardHome.append(draftPanel.el);
      draftPanel.sync(question, answering);
      return;
    }
    draftPanel.sync(null);
    // The question that a permission card in the thread asks is answered there, once: the gold card stays away.
    if (asking && permissionFor(turns, question!.id)) {
      askCard.hidden = true;
      delete askCard.dataset.id;
      composer.hidden = false;
      if (voice.isUp) voice.drop();
      return;
    }
    if (askCard.parentElement !== cardHome) cardHome.append(askCard);
    askCard.classList.toggle("is-member", !inRaphael());
    if (asking && !askCard.hidden && askCard.dataset.id === question!.id) return;
    askCard.hidden = !asking;
    composer.hidden = false;
    if (!asking) {
      delete askCard.dataset.id;
      return;
    }
    if (voice.isUp) voice.drop();
    const q = question!;
    if (askCard.dataset.id !== q.id) askCard.querySelector<HTMLButtonElement>("[data-card-dismiss]")?.click();
    askCard.dataset.id = q.id;
    askCard.dataset.tier = q.tier;
    askText.textContent = q.text;
    const copy = approvalCopy(q.text, inRaphael() ? t("agent.title") : members.nameOf(memberId()));
    askCard.querySelector(".card-title")!.textContent = copy.title;
    askCard.querySelector(".card-body.cc-state")!.textContent = copy.body;
    askCard.querySelector<HTMLElement>(".card-disclosure")!.hidden = q.text.trim() === copy.body || copy.title.includes(q.text.trim());
    drawAskLabels();
    noButton.disabled = alwaysButton.disabled = yesButton.disabled = answering;
    yesButton.dataset.hold = "idle";
  }

  /** One line of the thread as HTML, with the key it keeps across draws. */
  const renderedTurns = new ThreadRenderCache();
  let presentationVersion = 0;
  function lines(): { key: string; html: string; turnId?: number }[] {
    const shape = look();
    const active = [...turns].reverse().find(turn => turn.status === "running" || turn.status === "confirm" || isLive(turn.task) || turn.task?.state === "waiting");
    const sentHere = outgoing.filter(belongs);
    const additions = sentHere.length > 1 || active && (sentHere.length > 0 || turns.some(turn => turn.id > active.id && (turn.route === "owner_input" || turn.status === "queued")));
    const turnLook = additions ? { ...shape, deferPresence: true } : shape;
    const chronological = foldCallTurns(turns).sort((a, b) => a.created_at_ms - b.created_at_ms || a.id - b.id);
    const openingTarget = targetTurn ?? (openingThread && unreadFrom !== null ? chronological.find(turn => turn.id >= unreadFrom!)?.id : undefined);
    if (openingTarget !== undefined && openingTarget !== openingWindowTarget && chronological.some(turn => turn.id === openingTarget)) {
      turnWindow.focus(String(openingTarget), chronological.map(turn => String(turn.id))); openingWindowTarget = openingTarget;
    }
    const mounted = turnWindow.select(chronological, turn => String(turn.id), drawingFollows && !searching);
    const latestFailedTurnId = [...chronological].reverse().find(turn => turn.status === "error" || turn.task && ["failed", "interrupted", "cancelled", "limit"].includes(turn.task.state))?.id;
    windowMount.sync();
    const out = threadItems(mounted, state.nowMs).map((item) =>
      item.kind === "day"
        ? { key: item.key, html: dayHTML(item.label) }
        // Eligibility belongs to the turn; the menu checks which reply is latest when opened.
        : { key: item.key, html: (() => {
          if (item.turn.voice_call) return voiceCallCardHTML(item.turn.voice_call, members.nameOf(memberId()));
          const turn = item.turn, view = pacing.view(turn), task = turn.task?.id;
          const expanded = [...state.expandedMessages].filter(key => key.startsWith(`${turn.id}:`)).join("\0");
          const live = turn.status === "running" || turn.status === "confirm" || isLive(turn.task) || turn.task?.state === "waiting" || pacing.waiting(turn.id);
          return renderedTurns.line(item.key, historyRevisions.get(turn) ?? turn, [presentationVersion, getLocale(), turn.route === "greeting" ? shape.greetingOpen : false, shape.mentions, turnLook.query ?? "", details.has(turn.id),
            state.open.get(turn.id), state.thinkingOpen.get(turn.id), expanded, task !== undefined && state.stopping.has(task), task !== undefined && state.rerunning.has(task),
            state.workStartedAt.get(turn.id), view.messages?.length, pacing.waiting(turn.id), desktop.waitingForOwner(turn.id),
            live ? turnLook.deferPresence : false, live ? shape.activityLabel : "", turn.permissions?.some(card => shape.answerable?.(card.id)), turn.id === latestFailedTurnId],
            () => turnHTML(view, state, details.has(turn.id), { ...turnLook, regenerateTurnId: turn.id, latestFailedTurnId }));
        })(), turnId: item.turn.id },
    );
    renderedTurns.retain(new Set(out.map(line => line.key)));
    const boundary = unreadFrom;
    if (boundary !== null) {
      const firstUnread = chronological.find(turn => turn.id >= boundary)?.id;
      const at = out.findIndex(line => line.turnId !== undefined && line.turnId === firstUnread);
      if (at >= 0) out.splice(at, 0, unreadLine(boundary));
    }
    // What is on its way stands under the day its turn will have, so it does not move when the turn comes.
    const pendingAt = outgoing.find(belongs)?.sentAt ?? (hearingBelongs() ? hearing!.since : undefined);
    const lastAt = Math.max(0, ...turns.map(turn => turn.created_at_ms));
    if (pendingAt !== undefined && (!lastAt || new Date(pendingAt).toDateString() !== new Date(lastAt).toDateString())) out.push({ key: `time:pending:${pendingAt}`, html: dayHTML(dayLabel(pendingAt, state.nowMs)) });
    for (const sent of outgoing) if (belongs(sent)) out.push({ key: sent.key, html: pendingTurnHTML(sent.text, TYPED, shape, sent.files, { id: sent.requestId, time: sent.sentAt, quote: sent.quote }, state.nowMs, state.expandedMessages.has(`pending:${sent.requestId}:question`), !additions) });
    if (hearingBelongs()) out.push({ key: "hearing", html: pendingTurnHTML(null, VOICE, shape, [], { time: hearing!.since }, state.nowMs) });
    if (additions) out.push({ key: `presence:${memberId()}:${conversationId()}`, html: `<li class="tn tn-presence"><div class="ra"><div class="ra-body">${livePresenceHTML(shape, active ? latestProgress(active) : undefined, !active || active.status === "running" || isLive(active.task))}</div></div></li>` });
    return out;
  }

  /**
   * Draws the thread again where it changed: a line whose HTML is the same is left alone (its
   * movement is not replayed, its pictures not loaded again), a changed one is replaced where it
   * is, and the lines that are new are put in their places without moving the others.
   */
  function sendFromPage(text: string): void {
    const typed = input.value;
    const sourcePage = pageDraft.pageId;
    input.value = text;
    pageDraft.restore();
    void send().finally(() => { if (typed && !input.value) { input.value = typed; pageDraft.restore(sourcePage); fit(); } });
  }

  let renderedThread: ReturnType<typeof lines> = [];
  function drawThread(wanted = lines()): void {
    hideSelection();
    const droppedPending = [...thread.children].some(node => {
      const key = (node as HTMLElement).dataset.key ?? "";
      return (key.startsWith("out:") || key === "hearing") && !wanted.some(line => line.key === key);
    });
    const changed = patchThread(thread, wanted, drawnHTML, {
      arrives: line => drewOnce && (line.turnId === undefined ? !line.key.startsWith("day:") : line.turnId > newestDrawn && !droppedPending),
      carry(node, made) {
        const restore = carryTyped(node, made), restoreMail = carryMail(node, made), restorePages = pagesHost.carry(node, made), restoreSetup = carryInlineSetup(node, made);
        return () => { node.before(made); restorePages(); restoreSetup(); desktop.carry(node); node.remove(); restore(); restoreMail(); };
      },
    });
    newestDrawn = Math.max(newestDrawn, ...wanted.map((line) => line.turnId ?? 0));
    drewOnce = true;
    if (!changed) return;
    if (visible) attachmentMedia.sync();
    if (visible) previews.sync();
    else previews.pause();
    desktop.sync();
    taskResults.sync();
    pagesHost.sync();
    measureMessages();
    updateLiveTimes(thread);
  }

  /** Re-check wrapped lines when the window or the member details panel changes width. */
  function measureMessages(): void {
    measureMessagePreviews(thread);
  }

  const historyRevisions = new WeakMap<AgentTurn, number>();
  const historyVersions = new Map<number, { turn: AgentTurn; revision: number }>();
  let historyRevision = 0;
  function sameValue(a: unknown, b: unknown): boolean {
    return sameWire(a, b);
  }
  function historyStamp(items: AgentTurn[]): string {
    const ids = new Set(items.map(turn => turn.id));
    for (const id of historyVersions.keys()) if (!ids.has(id)) historyVersions.delete(id);
    return items.map(turn => {
      let revision = historyRevisions.get(turn);
      if (revision === undefined) {
        const previous = historyVersions.get(turn.id);
        revision = previous && sameValue(previous.turn, turn) ? previous.revision : ++historyRevision;
        historyRevisions.set(turn, revision);
        historyVersions.set(turn.id, { turn, revision });
      }
      return `${turn.id}:${revision}:${turn.messages?.length ?? 0}`;
    }).join(",");
  }
  let renderedPage = "";
  const pageStamp = (): string => JSON.stringify([new Date(Date.now()).toDateString(), memberId(), conversationId(), unreadFrom, pending, historyStamp(turns), outgoing, hearing, question, failure !== null, canLoadEarlier, loadingEarlier,
    [...state.stopping], [...state.rerunning], answering, searching]);
  function render(follow = false): void {
    renderedPage = pageStamp();
    // An open conversation between members follows the turns it is read from, and closes with its conversation.
    if (peer) queueMicrotask(() => peer?.update());
    stage.setAttribute("aria-busy", String(pending));
    // Only a thread not read yet says it is loading: a refresh of an empty one keeps its empty state (R-UI-71).
    if (pending && isEmpty() && !loadedThread) {
      wait.innerHTML = loadingHTML();
      wait.hidden = false;
      scroller.hidden = empty.hidden = dock.hidden = true;
      searchButton.hidden = true;
      return;
    }
    wait.hidden = true;
    const shown = turns;
    searchButton.hidden = shown.length === 0;
    if (shown.length === 0 && searching) closeSearch(false);
    if (isEmpty()) {
      thread.replaceChildren();
      renderedThread = [];
      scroller.hidden = dock.hidden = true;
      empty.hidden = false;
      empty.classList.toggle("is-failed", failure !== null);
      hi.textContent = failure ? `${t("agent.loadFailed")} ${failure()}` : emptyLine();
      drawDock();
      stopTicker();
      return;
    }
    const wasEmpty = scroller.hidden;
    empty.hidden = true;
    scroller.hidden = dock.hidden = false;
    const keepUp = !searching && (follow || wasEmpty || richScrollFollows(scroller));
    if (follow) turnWindow.latest();
    drawingFollows = keepUp && !turnWindow.after;
    drawDock();
    state.nowMs = Date.now();
    noteTaskEnds(shown, state);
    const wanted = lines();
    if (wanted.length !== renderedThread.length || wanted.some((line,index) => line.key !== renderedThread[index]?.key || line.html !== renderedThread[index]?.html)) {
      preserveRichScroll(scroller, () => drawThread(wanted)); renderedThread = wanted;
    }
    drawDock();
    markSeen(shown, state);
    none.hidden = true;
    finder.refresh();
    older.hidden = !loadingEarlier;
    older.innerHTML = loadingEarlier ? loadingHTML() : "";
    if (keepUp && (follow || wasEmpty)) followRichScroll(scroller);
    if (thread.querySelector(".work-section.is-live")) startTicker();
    else stopTicker();
    // A first page that does not fill the window has no scrolling to bring the earlier ones.
    if (wasEmpty && canLoadEarlier && !turnWindow.before && !loadingEarlier && !searching && scroller.scrollHeight <= scroller.clientHeight) void load(true);
  }

  /** The time since a task began, each second, in the lines that show it. */
  const clockGate = visibilityGate(tick, () => visible && !roomPane.active, () => { tick(); scheduleRefresh(); });
  function tick(): void {
    if (!windowVisible()) return;
    const now = Date.now();
    state.nowMs = now;
    updateLiveTimes(thread, now);
  }
  function startTicker(): void {
    if (ticker === null && visible) ticker = setInterval(clockGate.run, 1000);
  }
  function stopTicker(): void {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  }

  // Event messages also cover a missed data-change notification from an older core.
  const routineEvents = new Set<string>();

  // ---------- loading ----------

  /** Loads the newest turns, or with `earlier` the ones before what is loaded, keeping the reader's place. */
  let activeRead: { key: string; promise: Promise<void> } | null = null;
  const dirtyTurnIds = new Set<number>();
  const OPEN_HANDOFF = new Set(["queued", "running", "waiting"]);
  // A delta read never names turns a clear or delete removed; after a conversation change the
  // next read is whole. The version keeps a read started before the change from settling it.
  const staleHistory = new Map<number, number>();
  let newestReadId = 0;
  let readAgain = false;
  const needsUnreadHistory = (): boolean => openingThread && unreadFrom !== null && canLoadEarlier && (oldestId(turns) ?? 0) > unreadFrom;
  function finishOpening(): void {
    if (!openingThread || !unreadCaptured || pending || needsUnreadHistory() || !visible || scroller.hidden || targetTurn !== undefined) return;
    openingThread = false;
    // Opening at the first unread line is navigation: the first draw's follow must not pull it to the bottom.
    releaseRichScroll(scroller);
    if (!openUnread(scroller)) followRichScroll(scroller);
  }
  async function load(earlier: boolean, fromEvent = false): Promise<void> {
    if (earlier) return readPage(true);
    const key = `${memberId()}:${conversationId()}:${loads}`;
    if (activeRead?.key === key) { readAgain = true; return activeRead.promise; }
    const promise = readPage(false,fromEvent);
    const active = { key: `${memberId()}:${conversationId()}:${loads}`, promise };
    activeRead = active;
    try { await promise; }
    finally {
      if (activeRead === active) {
        activeRead = null;
        if (readAgain) { readAgain = false; scheduleRefresh(); }
      }
    }
  }
  async function readPage(earlier: boolean, fromEvent = false): Promise<void> {
    if (earlier && (loadingEarlier || !canLoadEarlier)) return;
    const mine = earlier ? loads : ++loads;
    if (earlier) loadingEarlier = true;
    else pending = true;
    if (turns.length === 0 && !earlier) render();
    else stage.setAttribute("aria-busy", "true");
    let got: AgentTurn[];
    const staleVersion = staleHistory.get(memberId());
    const deltaRead = fromEvent && loadedThread && turns.length > 0 && targetTurn === undefined && staleVersion === undefined;
    // A turn whose colleagues still work can gain a receipt or change one after the turn itself ended.
    const requestedIds = deltaRead ? [...new Set([...dirtyTurnIds, ...turns.filter(turn => turn.status === "running" || turn.status === "confirm" || isLive(turn.task) || turn.task?.state === "waiting" || turn.handoffs?.some(handoff => OPEN_HANDOFF.has(handoff.state))).map(turn => turn.id)])].slice(0, 50) : [];
    requestedIds.forEach(id => dirtyTurnIds.delete(id));
    let delta = false, more = false, removed: number[] = [];
    try {
      const before = earlier ? oldestId(turns) : undefined;
      const member = memberId();
      // The event's metadata reader will switch the thread if its selection changes;
      // its trailing read must not hold up a reply in the current conversation.
      if (conversationsDirty.has(member) || (!fromEvent && !conversationCache.has(member))) await readConversations(member,fromEvent);
      if (mine !== loads) return;
      const chosen = conversationId();
      const params = {
          limit: PAGE_SIZE,
          ...(deltaRead ? { after_id: newestReadId, turn_ids: requestedIds } : {}),
          ...(chosen !== undefined ? { conversation_id: chosen } : {}),
          ...(!earlier && targetTurn !== undefined ? { around_id: targetTurn } : {}),
          ...(before === undefined ? {} : { before_id: before }),
          ...(member === RAPHAEL_ID ? {} : { member_id: member }),
        };
      const historyRead = () => api.agentHistoryList(params);
      const history = await (fromEvent ? eventRead(`agent.history.list:${JSON.stringify(params)}`,historyRead,app) : historyRead());
      delta = history.delta === true;
      more = history.has_more === true;
      removed = history.removed_ids ?? [];
      if (mine === loads) {
        // Invalidated rows can be newer than this forward page; only its cursor advances paging.
        newestReadId = delta && history.next_after_id !== undefined ? history.next_after_id : Math.max(newestReadId, ...history.turns.map(turn => turn.id));
        if (!earlier && !delta && staleVersion !== undefined && staleHistory.get(member) === staleVersion) staleHistory.delete(member);
        pendingQuestions = { member, conversation: chosen, questions: history.pending_questions ?? [] };
        floatingQuestions.sync();
      }
      got = history.turns.filter(turn => !turn.session_id || !retracted.has(turn.session_id));
    } catch (err) {
      if (mine === loads) requestedIds.forEach(id => dirtyTurnIds.add(id));
      // A newer load of the newest turns took over: what this one shows does not count, but an
      // earlier page that failed must still let the reader page up again.
      if (mine !== loads) {
        if (earlier) loadingEarlier = false;
        return;
      }
      if (earlier) loadingEarlier = false;
      else pending = false;
      if (turns.length === 0) {
        canLoadEarlier = false;
        failure = () => describeError(err);
      } else {
        toaster.info(describeError(err)); // what is on screen stays
      }
      render();
      return;
    }
    if (mine !== loads) {
      if (earlier) loadingEarlier = false;
      return;
    }
    pacing.observe(turns, got, visible && loadedThread && !earlier && !searching, new Set(outgoing.filter(belongs).map(item => item.requestId)));
    loadedThread = true;
    let routinesChanged = false;
    for (const turn of got) {
      for (const message of turn.messages ?? []) {
        if (message.kind !== "event") continue;
        const key = `${turn.id}:${message.seq}`;
        if (routineEvents.has(key)) continue;
        routineEvents.add(key);
        routinesChanged = true;
      }
    }
    if (routinesChanged) members.refreshRoutines(memberId());
    const fromBottom = earlier ? scroller.scrollHeight - scroller.scrollTop : 0;
    if (earlier) {
      loadingEarlier = false;
      turns = mergeTurns(turns, got);
      canLoadEarlier = got.length === PAGE_SIZE;
    } else if (delta) {
      pending = false;
      const updates = new Map(got.map(turn => [turn.id, turn]));
      turns = [...turns.filter(turn => !removed.includes(turn.id)).map(turn => updates.get(turn.id) ?? turn), ...got.filter(turn => !turns.some(old => old.id === turn.id))].sort((a, b) => b.id - a.id);
    } else {
      pending = false;
      // The newest page replaces what it covers; what was paged back to beyond it stays while it
      // joins the page, and is dropped when more came meanwhile than a page holds (refreshTurns).
      const next = refreshTurns(turns, got, PAGE_SIZE);
      canLoadEarlier = next.keptOlder ? canLoadEarlier : got.length === PAGE_SIZE;
      turns = next.turns;
    }
    // A task that ended is no longer being stopped.
    for (const turn of turns) if (turn.task && !isLive(turn.task)) state.stopping.delete(turn.task.id);
    forgetReruns(state, turns);
    settlePending();
    failure = null;
    if (earlier || renderedPage !== pageStamp()) render();
    else { stage.setAttribute("aria-busy", "false"); updateLiveTimes(thread); }
    // The earlier turns come in above the reader, who stays where they were.
    if (earlier) scroller.scrollTop = scroller.scrollHeight - fromBottom;
    if (needsUnreadHistory()) {
      await readPage(true);
    }
    if (mine !== loads) return;
    if (more || dirtyTurnIds.size) scheduleRefresh();
    finishOpening();
    if (targetTurn !== undefined) {
      openingThread = false;
      const target = thread.querySelector<HTMLElement>(`[data-id="${targetTurn}"]`);
      if (target) { target.scrollIntoView?.({ block: "center" }); target.classList.add("is-search-target"); setTimeout(() => target.classList.remove("is-search-target"), 2400); }
      targetTurn = undefined;
    }
  }

  /** The questions in the history now are no longer waited for: a typed one by its words, a spoken one by any new turn of the voice. */
  function settlePending(): void {
    const current = memberId();
    const sinceSent = (sent: Outgoing): AgentTurn | undefined =>
      sent.member === current
        ? turns.find(
            (turn) =>
              (turn.member_id ?? RAPHAEL_ID) === sent.member &&
              sourceOf(turn) === TYPED &&
              (turn.session_id ? turn.session_id === sent.requestId : turn.question.trim() === sent.text.trim()) &&
              turn.created_at_ms >= sent.sentAt - 5_000,
          )
        : undefined;
    outgoing = outgoing.filter(sent => {
      const turn = sinceSent(sent);
      if (turn) state.workStartedAt.set(turn.id, sent.sentAt);
      return turn === undefined;
    });
    const spoken = hearingBelongs() ? turns.find(turn => sourceOf(turn) === VOICE &&
      (hearing!.after === null ? turn.created_at_ms >= hearing!.since : turn.id > hearing!.after)) : undefined;
    if (spoken) state.workStartedAt.set(spoken.id, hearing!.since);
    if (
      hearing &&
      (spoken ||
        Date.now() - hearing.since > HEARING_MAX_MS)
    ) {
      stopHearing();
    }
  }

  /**
   * A question said aloud is being answered: its line shows until its turn comes, a last phase of
   * the dictation says it ended, or `HEARING_MAX_MS` has passed. That last one is a timer of its
   * own, because a core that crashed or restarted sends neither a turn nor a phase, and no history
   * load would come to settle it.
   */
  function startHearing(member: number): void {
    hearing = { since: Date.now(), after: listeningKnown ? listeningAfter : null, member, conversation: voiceConversation };
    clearTimeout(hearingTimer);
    hearingTimer = setTimeout(() => {
      hearingTimer = undefined;
      if (!hearing) return;
      hearing = null;
      if (visible) render();
    }, HEARING_MAX_MS);
  }
  function stopHearing(): void {
    hearing = null;
    clearTimeout(hearingTimer);
    hearingTimer = undefined;
  }

  let refreshDue = 0;
  function scheduleRefresh(delay = REFRESH_DELAY_MS): void {
    if (!visible || roomPane.active || !windowVisible()) return;
    const wait = Math.max(REFRESH_DELAY_MS, delay), due = Date.now() + wait;
    if (refreshTimer !== null && refreshDue <= due) return;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshDue = due;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (windowVisible()) void load(false,true);
    }, wait);
  }

  // ---------- asking ----------

  /** Sends what the composer holds as a typed question: it shows at once, and Raphael's answer when it lands. */
  async function send(): Promise<void> {
    if (attaching) {
      const epoch = attachmentEpoch;
      await attachQueue;
      if (epoch !== attachmentEpoch) return;
    }
    if (missingFiles.length > 0) { toaster.info(t("chat.reattach")); return; }
    const text = typedQuestion(wholeLinks(input.value), files.length > 0);
    if (text === null) {
      if (input.value.trim() !== "") toaster.info(t("agent.tooLong"));
      return;
    }
    if (pageDraft.pageId && !files.length && !composerQuote && replacing === undefined && answerOwnerPage(thread, pageDraft.pageId, text, () => { void load(false); })) {
      clearTimeout(draftTimer); discardComposerDraft(composerKey);
      input.value = "";
      input.dispatchEvent(new Event("composer-draft-restored"));
      fit();
      return;
    }
    composer.querySelector(".composer-failure")?.remove();
    const sending = files;
    const dictation = correctionLearning.snapshot();
    const corrections = correctionLearning.take(input.value);
    const member = memberId();
    const sentConversation = conversationId();
    const requestId = crypto.randomUUID();
    const draft: ComposerDraft = { text: input.value, files: sending, missing: [], replacing, quote: composerQuote, dictation, pageId: pageDraft.pageId };
    rememberDraft(requestId, draft);
    clearTimeout(draftTimer); discardComposerDraft(composerKey);
    const mine: Outgoing = { key: `out:${++sent}`, requestId, member, conversationId: sentConversation, text, sentAt: Date.now(), files: sending.map(({ name, mime, data, size }) => ({ name, mime, size, preview: fileKind(mime) !== "file" ? `data:${mime};base64,${data}` : undefined })), quote: composerQuote };
    outgoing.push(mine);
    files = [];
    replacing = undefined;
    composerQuote = undefined;
    // Drawn while the layout is still clean, so reading the thread's scroll position costs nothing.
    render(true);
    input.value = "";
    input.dispatchEvent(new Event("composer-draft-restored"));
    drawQuote();
    drawFile();
    fit();
    drawDock();
    askingMember = member;
    try {
      await api.agentAskText(text, wireAttachments(sending), member, { requestId, ...destinationOf(member, sentConversation), ...(draft.replacing !== undefined ? { replaceTurnId: draft.replacing } : {}), ...(draft.quote ? { quote: draft.quote } : {}) });
      void learnComposerCorrections(corrections);
    } catch (err) {
      if (retracted.has(requestId)) return;
      if (askingMember === member) askingMember = null;
      outgoing = outgoing.filter((item) => item !== mine);
      if (memberId() === member && conversationId() === sentConversation && input.value === "" && !files.length) restoreDraft(draft);
      else restored.set(draftKey(member, sentConversation), draft);
      if (memberId() === member && conversationId() === sentConversation) {
        const failed = document.createElement("div"); failed.className = "composer-failure";
        failed.innerHTML = cardHTML({ title: t("cards.sendFailed"), status: "failed" });
        composer.querySelector(".composer-failure")?.remove(); composer.prepend(failed);
        cardFailure(failed.firstElementChild, () => { failed.remove(); void send(); }, () => failed.remove());
      }
      render();
      return;
    }
    if (retracted.has(requestId)) return;
    if (askingMember === member) askingMember = null;
    // The turn is written by now: the history brings it, and the question waits no more.
    if (memberId() === member && conversationId() === sentConversation) await load(false, true);
    else members.changed();
    outgoing = outgoing.filter((item) => item !== mine);
    render();
  }

  /** Send takes words or files; the field sizes itself to its text (`.cmp-input` in agent.css). */
  function fit(): void {
    sendButton.disabled = missingFiles.length > 0 || typedQuestion(input.value, files.length > 0) === null;
  }

  /**
   * A draft handed to the page: its words in the field in place of what was there, to be sent or
   * changed, never sent by itself. The field has the focus, the caret after the words, once the
   * composer is where it stays (`focusComposer`).
   */
  function putDraft(words: string): void {
    correctionLearning.clear();
    input.value = words;
    fit();
    focusComposer();
  }

  /**
   * The focus in the field, the caret at the end, when the composer is on the page: not while
   * Raphael's YES/NO card stands in its place (the draft waits in the field under it).
   */
  function focusComposer(): void {
    if (!visible || composer.hidden || !composer.isConnected) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
  }

  /**
   * 「＋」 or a paste: files of this PC for the next question, one after the other. One that cannot
   * be taken says why and the rest are still taken, but for too many: the first one over the limit
   * says so and ends it.
   */
  async function attachAll(list: readonly File[]): Promise<void> {
    const epoch = attachmentEpoch;
    attaching++;
    composer.setAttribute("aria-busy", "true");
    attachQueue = attachQueue.then(async () => {
      for (const file of list) {
        if (epoch !== attachmentEpoch) break;
        if (!(await attachFile(file, attachmentType(file), epoch))) break;
      }
    }).finally(() => {
      attaching--;
      if (!attaching) composer.removeAttribute("aria-busy");
    });
    await attachQueue;
  }

  async function attachFile(file: File, mime: string, epoch: number): Promise<boolean> {
    const name = file.name.trim() || `image.${mime.slice(mime.indexOf("/") + 1)}`;
    const refusal = attachRefusal(files.length, mime, file.size, files.reduce((sum, item) => sum + (item.size ?? 0), 0));
    if (refusal === "count") {
      toaster.info(t("agent.attachTooMany", { p0: ATTACH_MAX }));
      return false;
    }
    if (refusal === "size") {
      toaster.info(t("agent.attachTooBig", { p0: name, p1: attachmentLimit(mime) / 1024 / 1024 }));
      return true;
    }
    if (refusal === "total") {
      toaster.info(t("agent.attachTotal", { p0: TOTAL_MAX_BYTES / 1024 / 1024 }));
      return true;
    }
    let attached: WireAttachment;
    try {
      if (refusal === "empty") throw new Error("empty");
      attached = await readComposerFile(file, mime, () => epoch === attachmentEpoch);
    } catch {
      toaster.info(t("agent.attachUnreadable", { p0: name }));
      return true;
    }
    if (epoch !== attachmentEpoch) return false;
    // Others may have been attached while this one was read.
    if (files.length >= ATTACH_MAX) {
      toaster.info(t("agent.attachTooMany", { p0: ATTACH_MAX }));
      return false;
    }
    files = [...files, { ...attached, id: ++fileIds, name, mime, size: file.size }];
    const missing = missingFiles.findIndex(file => file.name === name && file.mime === mime);
    if (missing >= 0) missingFiles.splice(missing, 1);
    drawFile();
    input.focus();
    return true;
  }

  // ---------- the voice ----------

  let listenTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the app said it is listening since the voice button last sent the key. */
  let listening = false, listeningRun = 0;
  let voiceMember = RAPHAEL_ID;
  let voiceConversation: number | undefined;
  let voiceDestination: "quick" | undefined;
  let voiceRequested = false;
  let listeningAfter = 0;
  let listeningKnown = false;
  function rememberVoiceBoundary(member: number, conversation = voiceConversationId(member)): void {
    voiceConversation = conversation;
    voiceDestination = destinationOf(member, conversation).destination;
    listeningKnown = member === memberId() && conversationId() === conversation;
    listeningAfter = newestId();
  }
  let pressedMember = RAPHAEL_ID;
  const sendVoice = (edge: "down" | "up", member: number): Promise<void> =>
    voiceConversation === undefined ? (member === RAPHAEL_ID ? api.agentVoice(edge) : api.agentVoice(edge, member)) :
      voiceDestination ? api.agentVoice(edge, member, voiceConversation, voiceDestination) : api.agentVoice(edge, member, voiceConversation);

  /**
   * The voice button went down: the question key went down (a click is a press and a release).
   * The picture flies at once; if the app does not start listening (it is busy with something
   * else, say), it comes back down.
   */
  let taskStopPressed=false;
  function voiceDown(member = memberId(), conversation = conversationId()): void {
    const here = member === memberId() && conversation === conversationId();
    // Recording clicks release/send audio through the native key path; only Escape cancels it.
    if(here && !(listening && voiceMember === memberId()) && composer.dataset.taskState && composer.dataset.taskState!=="idle"){taskStopPressed=true;void stopComposerTask().catch(error=>toaster.info(describeError(error)));return;}
    if (here && question) return;
    pressedMember = member;
    const starting = !listening;
    if (starting) {
      voiceMember = pressedMember;
      rememberVoiceBoundary(pressedMember, conversation);
      voiceRequested = true;
    }
    if (here && voiceMember === memberId()) voice.up();
    if (starting) {
      listening = false;
      clearTimeout(listenTimer);
      listenTimer = setTimeout(() => {
        if (!listening) voice.down();
      }, LISTEN_WAIT_MS);
    }
    void sendVoice("down", pressedMember).catch((err) => {
      voiceRequested = false;
      voice.down();
      toaster.info(describeError(err));
    });
  }
  const voiceUp = (): void => {if(taskStopPressed){taskStopPressed=false;return;}void sendVoice("up", pressedMember).catch(() => {});};

  /** A click on the flyer: in toggle mode, a second press of the key ends the recording. */
  async function endVoice(): Promise<void> {
    if (app.device().dictation_mode === "hold") return; // the release of the button ends it
    try {
      await sendVoice("down", voiceMember);
      await sendVoice("up", voiceMember);
    } catch {
      // the hotkeys are not running: Esc or the overlay ends it
    }
  }

  // ---------- the approval card ----------

  /** `always` is the third answer: YES, and keep allowing (only a question that has the button). */
  async function answer(approved: boolean, always = false, editedDrafts?: MemberDraft[], groups?: GroupDraft[]): Promise<void> {
    if (!question || answering) return;
    if (always && !question.always) return;
    const id = question.id;
    answeringQuestions.add(id);
    answering = true;
    noButton.disabled = alwaysButton.disabled = yesButton.disabled = true;
    redrawCards();
    try {
      if (hasDrafts(question)) draftPanel.sync(question, true);
      await (editedDrafts !== undefined
        ? api.agentQuestionAnswer(question.id, approved, always, editedDrafts, groups)
        : always
          ? api.agentQuestionAnswer(question.id, true, true)
          : api.agentQuestionAnswer(question.id, approved));
    } catch (err) {
      answeringQuestions.delete(id);
      if (question?.id === id) {
        answering = false;
        noButton.disabled = alwaysButton.disabled = yesButton.disabled = false;
        if (hasDrafts(question)) draftPanel.sync(question, false);
        redrawCards();
      }
      if (question?.id !== id) return;
      cardFailure(thread.querySelector(`[data-permission-card="${CSS.escape(id)}"]`) ?? draftPanel.el.querySelector(".conversation-card") ?? askCard.querySelector(".conversation-card"), () => { if (question?.id === id) void answer(approved, always, editedDrafts, groups); });
    }
  }

  /** The permission cards in the thread are drawn again when the question they wait on comes, goes or is being answered. */
  function redrawCards(): void {
    if (visible && turns.some((turn) => turn.permissions?.length)) drawThread();
  }

  const finder = mountConversationFind({ button: searchButton, bar: find, thread, scroll: scroller,
    records: () => turnWindow.before || turnWindow.after ? foldCallTurns(turns).sort((a,b) => a.created_at_ms-b.created_at_ms || a.id-b.id).map(turn => ({ key: `turn:${turn.id}`,
      texts: turn.voice_call ? turn.voice_call.transcript.flatMap(item => [item.question, item.text]) : [turn.question, ...(turn.messages?.length ? turn.messages.filter(message => ["reply", "event"].includes(message.kind)).map(message => messagePlainText(message.text, true, composioAction(turn))) : [messagePlainText(turn.text, true, composioAction(turn))])] })) : undefined,
    reveal: key => { if (turnWindow.focus(key.replace(/^turn:/, ""))) render(); },
    revealWork: id => {
      state.thinkingOpen.set(id, true);
      // Search opens this body in place; acknowledge that state without replacing its marks or face.
      const line = lines().find(line => line.turnId === id), node = thread.querySelector(`.tn[data-id="${id}"]`);
      if (line && node) drawnHTML.set(node, threadLineIdentity(line.html));
    },
    changed: open => { searching = open; if (open) { pacing.flush(); render(); } }, load: async current => {
    const member = memberId(), conversation = conversationId();
    const gathered: AgentTurn[] = [];
    let before: number | undefined;
    for (;;) {
      const result = await api.agentHistoryList({member_id:member, ...(conversation !== undefined ? {conversation_id:conversation} : {}), limit:200, ...(before !== undefined ? {before_id:before} : {})});
      if (!current() || member !== memberId() || conversation !== conversationId()) return;
      gathered.push(...result.turns);
      const next = Math.min(...result.turns.map(turn => turn.id));
      if (result.turns.length < 200 || next === before) break;
      before = next;
    }
    const height = scroller.scrollHeight, top = scroller.scrollTop;
    turns = [...new Map([...gathered, ...turns].map(turn => [turn.id,turn])).values()].sort((a,b) => a.id-b.id);
    canLoadEarlier = false;
    render();
    scroller.scrollTop = top + scroller.scrollHeight - height;
  }});

  function closeSearch(_draw = true): void { finder.close(false); searching = false; }
  window.addEventListener("raphael:conversation-shortcut", event => {
    if (!visible) return;
    const action = (event as CustomEvent<string>).detail;
    if (action === "find") {
      if (roomPane.active) {
        const input = roomPane.el.querySelector<HTMLInputElement>('.ra-find:not([hidden]) input');
        if (input) input.focus();
        else roomPane.el.querySelector<HTMLElement>('[data-room-search]')?.click();
      }
      else finder.open();
      return;
    }
    if (roomPane.active) return;
    const items = conversationCache.get(memberId()) ?? [];
    const current = conversationId() ?? items.find(item => item.is_default)?.id;
    const at = items.findIndex(item => item.id === current);
    const next = items[at + (action === "previous" ? -1 : 1)];
    if (next) openConversation(memberId(), next.id);
  });

  /** The conversation is gone in the core: the page drops every turn it loaded and shows the empty page. */
  function forgetTurns(): void {
    pacing.flush();
    turns = [];
    state.stopping.clear();
    forgetReruns(state, turns);
    canLoadEarlier = false;
    newestDrawn = 0;
    if (visible) render();
  }

  // Settings › 資料 emptied the conversation while the page had it loaded (under the panel, or
  // before it was left): a load already under way brings nothing back, and nothing waits to be cleared.
  app.cleared.on("conversation", () => {
    if (memberId() !== RAPHAEL_ID) return;
    loads++;
    pending = false;
    loadingEarlier = false;
    failure = null;
    forgetTurns();
  });

  // ---------- what a turn shows ----------

  /** Opens or closes what a turn did, where it is: the box slides, nothing else is drawn again. */
  function toggleSteps(button: HTMLElement): void {
    const id = Number(button.closest<HTMLElement>(".tn")?.dataset.id);
    const turn = turns.find((candidate) => candidate.id === id);
    const box = button.closest<HTMLElement>(".steps");
    const steps = box?.querySelector<HTMLElement>(".steps-body");
    if (!turn || !box || !steps) return;
    const open = !stepsOpen(turn, state);
    state.open.set(id, open);
    box.dataset.open = String(open);
    button.setAttribute("aria-expanded", String(open));
    steps.toggleAttribute("inert", !open);
    rememberLine(button);
  }


  /**
   * The questions from the background that wait in the open thread (background-mount.ts): the gold
   * card is Raphael's own (his emblem, his 《問。》) in his thread and the member's (their face and
   * name, plain words) in theirs. Called when the thread changes, and it reads the questions again.
   */
  function drawBackgroundQuestions(): void {
    waiting = mountBackgroundQuestions(backgroundSlot, {
      memberId: memberId(),
      manageLocal: () => app.go("settings", "safety"),
      asker: () => {
        const member = members.member();
        return { face: faceHTML(member, 22, { cls: "bgq-face" }), name: inRaphael() ? null : member.name };
      },
      changed: () => {
        members.changed();
        if (visible && !scroller.hidden && atBottom()) scroller.scrollTop = scroller.scrollHeight;
      },
    });
  }

  /**
   * Another member's thread: what was loaded goes, and that member's turns are read. The search
   * closes, the composer and the card become that thread's, and nothing of the last thread moves in.
   */
  function switchThread(): void {
    turnWindow.reset(); openingWindowTarget = undefined; renderedTurns.clear(); renderedThread = [];
    unreadFrom = members.member().unread_from ?? null;
    unreadCaptured = true;
    openingThread = true;
    if (composerKey !== "deleted") saveComposerDraft();
    desktop.refresh();
    drawConversation();
    if (roomPane.active) roomPane.close();
    void slashMenu.refresh();
    hideTooltip();
    hideSelection();
    pacing.flush();
    loadedThread = false;
    dirtyTurnIds.clear();
    newestReadId = 0;
    loads++;
    attachmentEpoch++;
    attachmentMedia.reset();
    resetDrop();
    turns = [];
    canLoadEarlier = false;
    loadingEarlier = false;
    pending = false;
    failure = null;
    newestDrawn = 0;
    drewOnce = false;
    details.clear();
    if (searching) closeSearch(false);
    thread.replaceChildren();
    if (voice.isUp) voice.drop();
    input.value = "";
    correctionLearning.clear();
    files = [];
    missingFiles = [];
    replacing = undefined;
    composerQuote = undefined;
    drawQuote();
    loadComposerDraft();
    drawFile();
    fit();
    drawComposer();
    drawFaces();
    hi.textContent = emptyLine();
    // the card of another thread's question goes, and this thread's comes
    delete askCard.dataset.id;
    drawBackgroundQuestions();
    render();
    if (listening && voiceMember === memberId() && !question) drawComposerTask();
    if (visible) {
      const generation = loads + 1;
      void load(false).then(() => {
        if (generation === loads && visible && !scroller.hidden && !thread.querySelector(".is-search-target")) finishOpening();
      });
      focusComposer();
    }
  }

  function toggleDraftDone(button: HTMLElement): void {
    const box = button.closest<HTMLElement>(".draft-done");
    const list = box?.querySelector<HTMLElement>(".draft-done-list");
    if (!box || !list) return;
    const id = Number(box.dataset.draftDone ?? button.closest<HTMLElement>(".tn")?.dataset.id);
    const next = Boolean(list.hidden);
    list.hidden = !next;
    box.classList.toggle("is-open", next);
    button.setAttribute("aria-expanded", String(next));
    if (!Number.isNaN(id)) {
      if (next) details.add(id);
      else details.delete(id);
    }
    rememberLine(button);
  }

  function toggleDetail(button: HTMLElement): void {
    const turn = button.closest<HTMLElement>(".tn");
    const detail = turn?.querySelector<HTMLElement>(".tn-detail");
    if (!turn || !detail) return;
    const id = Number(turn.dataset.id);
    detail.hidden = !detail.hidden;
    button.setAttribute("aria-expanded", String(!detail.hidden));
    if (detail.hidden) details.delete(id);
    else details.add(id);
    rememberLine(button);
  }

  function toggleThinking(button: HTMLElement): void {
    const box = button.closest<HTMLElement>(".tn")?.querySelector<HTMLElement>(".think-box");
    const body = box?.querySelector<HTMLElement>(".think-body");
    if (!box || !body) return;
    const id = Number(box.dataset.thinkingTurn ?? button.closest<HTMLElement>(".tn")?.dataset.id);
    const next = Boolean(body.hidden);
    body.hidden = !next;
    box.classList.toggle("is-open", next);
    button.closest(".tn")?.querySelectorAll('[data-act="thinking"]').forEach(control => control.setAttribute("aria-expanded", String(next)));
    if (!Number.isNaN(id)) state.thinkingOpen.set(id, next);
    rememberLine(button);
  }

  function togglePdfExpand(button: HTMLElement): void {
    const card = button.closest<HTMLElement>(".media-pdf");
    if (!card) return;
    const expanded = card.classList.toggle("is-expanded");
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? t("agent.collapsePdf") : t("agent.expandPdf");
    rememberLine(button);
  }

  function openLightbox(button: HTMLElement, localSrc?: string): void {
    const src = localSrc ?? safeMediaSrc(button.dataset.src, true);
    if (src) openMediaLightbox(button, src);
  }

  /** A line changed in place by the reader is drawn from new data next time, so it is not kept as it was. */
  function rememberLine(control: HTMLElement): void {
    const line = control.closest<HTMLElement>("[data-key]");
    if (line) drawnHTML.delete(line);
  }

  async function rerun(button: HTMLElement): Promise<void> {
    const asked = requestRerun(state, Number(button.dataset.task), api.workerRerun);
    render(); // the button is off
    const outcome = await asked;
    if (outcome.error !== undefined) toaster.info(describeError(outcome.error));
    if (visible) void load(false);
  }

  async function stop(button: HTMLElement): Promise<void> {
    const taskId = Number(button.dataset.task);
    const asked = requestStop(state, taskId, api.workerCancel);
    render(); // the button says it is stopping
    const outcome = await asked;
    if (outcome.error !== undefined) toaster.info(describeError(outcome.error));
    if (visible) void load(false);
  }

  function messageSource(control: HTMLElement): { turn: AgentTurn; key: string; text: string; markdown: boolean } | null {
    const id = Number(control.closest<HTMLElement>(".tn[data-id]")?.dataset.id);
    const turn = turns.find(item => item.id === id);
    const key = control.closest<HTMLElement>("[data-message]")?.dataset.message;
    if (!turn || !key) return null;
    if (key === "question") return { turn, key, text: turn.question, markdown: false };
    const message = turn.messages?.find(item => String(item.seq) === key);
    if (key !== "reply" && !message) return null;
    if (message?.kind === "media") {
      const media = parseMediaPayload(message.text);
      return { turn, key, text: media ? [media.title, media.description, media.url].filter(Boolean).join("\n") : message.text, markdown: false };
    }
    const markdown = key === "reply" || message?.kind === "reply";
    // Copy and quote take the words as the thread shows them, without Raphael's 《prefix。…》.
    const replies = (turn.messages ?? []).filter(item => item.kind === "reply").sort((a, b) => a.seq - b.seq);
    const text = message?.kind === "reply" ? plainReplies(replies.map(item => item.text))[replies.indexOf(message)] : plainReplies([message?.text ?? turn.text])[0];
    return { turn, key, text, markdown };
  }

  async function copyMessage(control: HTMLElement): Promise<void> {
    const source = messageSource(control);
    const pending = outgoing.find(item => item.requestId === control.closest<HTMLElement>("[data-session]")?.dataset.session);
    if (!source && !pending) return;
    try { await copyButton(control, source ? messagePlainText(source.text, source.markdown) : pending!.text); }
    catch (err) { toaster.info(describeError(err)); }
  }

  function replyMessage(control: HTMLElement): void {
    const source = messageSource(control);
    const pending = outgoing.find(item => item.requestId === control.closest<HTMLElement>("[data-session]")?.dataset.session);
    if (!source && !pending) return;
    composerQuote = { text: source ? messagePlainText(source.text, source.markdown) : pending!.text,
      author: !source || source.key === "question" ? t("chat.you") : members.nameOf(source.turn.member_id ?? memberId()) };
    drawQuote(); focusComposer();
  }

  /**
   * The ⋯ of a message and a right click on it open one menu, as Grok Bot does: beside the bubble only react, reply and ⋯
   * show, so everything else is here. A colleague's message has its reactions above Reply, Copy, its work and Regenerate
   * on the latest answer; the owner's has Reply, Copy and Edit or Cancel; a message still being sent has Copy and Cancel.
   */
  function messageMenu(control: HTMLElement): void {
    const source = messageSource(control);
    const pending = !source && outgoing.some(item => item.requestId === control.closest<HTMLElement>("[data-session]")?.dataset.session);
    if (!source && !pending) return;
    const owner = !source || source.key === "question";
    const message = control.closest<HTMLElement>(".chat-message");
    const work = message?.querySelector<HTMLElement>('[data-act="thinking"]');
    const items: Parameters<typeof openActions>[1][number][] = [];
    if (source) items.push({ id: "reply", label: t("chat.reply"), icon: "reply" });
    items.push({ id: "copy", label: t("chat.copy"), icon: "copy" });
    if (work) items.push({ id: "work", label: work.getAttribute("aria-label") ?? t("work.inspect"), icon: "steps" });
    // A greeting that came through stays: only a failed one is written again (its rerun button), never a second.
    if (source && !owner && control.dataset.regenerate === "true" && look().regenerateTurnId === source.turn.id && source.turn.route !== "greeting") items.push({ id: "regenerate", label: t("chat.regenerate"), icon: "refresh" });
    const ownerAct = pending ? "cancel" : control.dataset.ownerAct;
    if (ownerAct === "edit") items.push({ id: "edit", label: t("chat.edit"), icon: "pencil" });
    if (ownerAct === "cancel") items.push({ id: "cancel", label: t("common.cancel"), icon: "x" });
    const reactions = source && !owner && message?.querySelector('[data-act="react-message"]') ? source.turn.reactions?.[source.key] ?? [] : null;
    openActions(control, items, pick => {
      if (pick === "regenerate") void regenerate(control);
      else if (pick === "reply") replyMessage(control);
      else if (pick === "work" && work) toggleThinking(work);
      else if (pick === "edit") void editMessage(control);
      else if (pick === "cancel") void cancelMessage(control);
      else void copyMessage(message?.querySelector<HTMLElement>('[data-act="copy-message"]') ?? control);
    }, reactions && source ? { html: menuReactionsHTML(reactions), onPick: lead => {
      const react = (emoji: string): void => {
        const scope = { member_id: source.turn.member_id ?? 0, conversation_id: source.turn.conversation_id, turn_id: source.turn.id };
        void api.core("agent.react", { ...scope, message_key: source.key, emoji, active: !reactions.includes(emoji) })
          .then(() => { if (visible) void load(false); }).catch(err => toaster.info(describeError(err)));
      };
      if (lead === MORE_EMOJI) openEmojiPicker(control, reactions, react);
      else react(lead);
    } } : undefined);
  }

  async function regenerate(control: HTMLElement): Promise<void> {
    const source = messageSource(control);
    const latest = look().regenerateTurnId;
    if (!source || latest === undefined || latest !== source.turn.id && !(source.turn.status === "error" && control.classList.contains("rerun"))) return;
    const member = memberId(), turn = source.turn;
    // A greeting has no question to send again: the core writes it again with the member's own model.
    if (turn.route === "greeting") {
      if (turn.status !== "error") return;
      regenerating.add(turn.id); render(true);
      try {
        await api.membersGreet(member);
        if (visible && memberId() === member) await load(false);
      } catch (err) { toaster.info(describeError(err)); }
      finally { regenerating.delete(turn.id); render(true); }
      return;
    }
    const sentConversation = conversationId();
    const requestId = crypto.randomUUID();
    const epoch = attachmentEpoch;
    const draft = await draftFor(turn);
    if (memberId() !== member || attachmentEpoch !== epoch) return;
    if (draft.missing.length) { restoreDraft(draft); toaster.info(t("chat.reattach")); return; }
    regenerating.add(turn.id);
    rememberDraft(requestId, draft);
    const mine: Outgoing = { key: `out:${++sent}`, requestId, member, conversationId: sentConversation, text: turn.question, sentAt: Date.now(), files: draft.files.map(({ name, mime }) => ({ name, mime })), quote: draft.quote };
    outgoing.push(mine); render(true);
    askingMember = member;
    try {
      await api.agentAskText(turn.question, wireAttachments(draft.files), member, { requestId, ...destinationOf(member, sentConversation), ...(draft.quote ? { quote: draft.quote } : {}) });
      if (visible && memberId() === member) await load(false);
      else members.changed();
    } catch (err) { toaster.info(describeError(err)); }
    finally {
      if (askingMember === member) askingMember = null;
      regenerating.delete(turn.id);
      outgoing = outgoing.filter(item => item !== mine);
      if (visible) render();
    }
  }

  // ---------- input ----------

  function rememberDraft(id: string, draft: ComposerDraft): void {
    drafts.set(id, draft);
    const bytes = (): number => [...drafts.values()].reduce((sum, item) => sum + item.files.reduce((size, file) => size + file.data.length, 0), 0);
    while (drafts.size > 1 && (drafts.size > 20 || bytes() > 64 * 1024 * 1024)) drafts.delete(drafts.keys().next().value!);
  }

  async function draftFor(turn: Pick<AgentTurn, "session_id" | "question" | "attachments" | "quote">): Promise<ComposerDraft> {
    const cached = drafts.get(turn.session_id ?? "");
    if (cached) return cached;
    const draft: ComposerDraft = { text: turn.question, files: [], missing: [], quote: turn.quote ?? undefined };
    for (const file of turn.attachments ?? []) {
      if (file.id) {
        try {
          if ((file.size ?? 0) > 4 * 1024 * 1024) {
            const stored = await api.core<{ mime: string; size: number }>("attachments.info", { id: file.id });
            draft.files.push({ id: ++fileIds, name: file.name, mime: stored.mime, data: "", stored_id: file.id, size: stored.size });
            continue;
          }
          const stored = await api.core<{ mime: string; data: string }>("attachments.get", { id: file.id });
          if (typeof stored.data !== "string" || typeof stored.mime !== "string") throw new Error("unavailable");
          const size = file.size ?? Math.floor(stored.data.length * 3 / 4) - (stored.data.endsWith("==") ? 2 : stored.data.endsWith("=") ? 1 : 0);
          draft.files.push({ id: ++fileIds, name: file.name, mime: stored.mime, data: stored.data, size });
          continue;
        } catch {
          // Old metadata or a missing stored copy needs an explicit replacement from the owner.
        }
      }
      draft.missing.push({ ...file });
    }
    return draft;
  }

  function restoreDraft(draft: ComposerDraft, focus = true): void {
    correctionLearning.restore(draft.dictation);
    input.value = draft.text;
    pageDraft.restore(draft.pageId);
    attachmentEpoch++;
    files = [...draft.files];
    missingFiles = draft.missing.map(file => ({ ...file }));
    replacing = draft.replacing;
    composerQuote = draft.quote;
    drawQuote();
    drawFile(); fit(); if (focus) focusComposer();
  }

  async function editMessage(control: HTMLElement): Promise<void> {
    const source = messageSource(control);
    if (!source || source.key !== "question") return;
    const member = memberId(), epoch = attachmentEpoch;
    const draft = await draftFor(source.turn);
    if (memberId() === member && attachmentEpoch === epoch) restoreDraft({ ...draft, replacing: source.turn.id });
  }

  /** The displayed slot and its action always refer to the same reply in this conversation. */
  function composerTask() {
    const member = memberId();
    // Speaking: the button ends the recording and sends it, so it is not Stop (that comes once something has been sent); Esc cancels.
    if(listening&&voiceMember===member)return {key:`listening:${listeningRun}`,state:"recording" as const,stop:()=>api.cancelSession()};
    const turn = [...own()].reverse().find(turn => turn.status === "running" || turn.status === "confirm" || isLive(turn.task) || turn.task?.state === "waiting");
    const task = turn?.task;
    if (task && (isLive(task) || task.state === "waiting")) return { key: `task:${task.id}`, state: "running" as const, stop: async () => {
      const result = turn?.session_id ? await api.agentStop(turn.session_id, member) : undefined;
      await api.workerCancel(task.id);
      return result;
    } };
    if (turn?.session_id) return { key: `request:${turn.session_id}`, state: "running" as const, stop: () => api.agentStop(turn.session_id!, member) };
    const sent = outgoing.find(belongs);
    if (sent) return { key: `request:${sent.requestId}`, state: "ack" as const, stop: () => api.agentStop(sent.requestId, member) };
    // Before agent.turn exists, the native controller alone owns transcription/routing and its session.
    if (hearingBelongs()) return { key: `voice:${hearing!.since}`, state: "ack" as const, stop: () => api.cancelSession() };
    return null;
  }

  function drawComposerTask(): void {
    const task = composerTask();
    if (!task) patchHTML(voiceButton, avatarHTML({ size: 32, avatar: null }));
    voiceButton.setAttribute("aria-label", t("agent.voice"));
    voiceButton.disabled = !task && conversationId() === undefined;
    let note = composer.querySelector<HTMLElement>("[data-conversation-missing]");
    if (voiceButton.disabled && !note) {
      note = document.createElement("div"); note.dataset.conversationMissing = ""; composer.append(note);
    }
    if (note) { note.hidden = !voiceButton.disabled; note.innerHTML = voiceButton.disabled ? noticeHTML("conversation") : ""; }
    if (task) { if (!listening || voiceMember !== memberId()) voice.drop(); voiceButton.classList.remove("vm-away"); }
    drawTaskSlot(composer, task ? question ? "waiting" : task.state : "idle", task !== null && stoppingComposerTasks.has(task.key));
    voiceChat.draw();
  }

  async function stopComposerTask(): Promise<void> {
    const task = composerTask();
    if (!task || stoppingComposerTasks.has(task.key)) return;
    stoppingComposerTasks.add(task.key);
    drawComposerTask();
    const member = memberId(), conversation = conversationId();
    try {
      const result = await task.stop() as { returned?: {session_id: string; text: string; attachments?: TurnAttachment[]; quote?: MessageQuote}[] } | undefined;
      if (result?.returned?.length) {
        const returned: ComposerDraft[] = [];
        for (const item of result.returned) returned.push(await draftFor({session_id: item.session_id, question: item.text, attachments: item.attachments, quote: item.quote}));
        const current = member === memberId() && conversation === conversationId();
        const before = current ? {text: input.value, files, missing: missingFiles, quote: composerQuote} : restored.get(draftKey(member, conversation)) ?? {text: "", files: [], missing: []};
        const combined: ComposerDraft = {text: [before.text, ...returned.map(draft => draft.text)].filter(Boolean).join("\n\n"), files: [...before.files, ...returned.flatMap(draft => draft.files)], missing: [...before.missing, ...returned.flatMap(draft => draft.missing)], quote: before.quote ?? returned.find(draft => draft.quote)?.quote};
        const sessions = new Set(result.returned.map(item => item.session_id));
        outgoing = outgoing.filter(item => !sessions.has(item.requestId));
        turns = turns.filter(item => !sessions.has(item.session_id ?? ""));
        if (current) restoreDraft(combined); else restored.set(draftKey(member, conversation), combined);
      }
    }
    finally { stoppingComposerTasks.delete(task.key); drawComposerTask(); }
    if (visible) void load(false);
  }

  async function cancelMessage(control?: HTMLElement): Promise<void> {
    const source = control ? messageSource(control) : null;
    const pending = control ? outgoing.find(item => item.requestId === control.closest<HTMLElement>("[data-session]")?.dataset.session) : [...outgoing].reverse().find(item => item.member === memberId());
    const turn = pending ? turns.find(turn => turn.session_id === pending.requestId) : source?.turn ?? (!control ? own().find(turn => sourceOf(turn) !== "routine" && sourceOf(turn) !== "member" && (turn.status === "running" || turn.status === "confirm" || isLive(turn.task) || turn.task?.state === "waiting")) : undefined);
    const session = pending?.requestId ?? turn?.session_id;
    if (!session || retracting.has(session)) return;
    const member = memberId(), sentConversation = conversationId();
    retracting.add(session);
    try {
      await api.agentRetract(session, member, turn?.id);
      const draft = await draftFor(pending ? { session_id: session, question: pending.text, attachments: pending.files, quote: pending.quote } : turn!);
      retracted.add(session);
      outgoing = outgoing.filter(item => item.requestId !== session);
      turns = turns.filter(item => item.session_id !== session && item.id !== turn?.id);
      if (questionOwner === member && (turn?.status === "confirm" || pending)) setQuestion(null);
      if (askingMember === member) askingMember = null;
      if (memberId() === member && conversationId() === sentConversation) { render(); restoreDraft(draft); }
      else restored.set(draftKey(member, sentConversation), draft);
      members.changed();
    } catch (err) { toaster.info(describeError(err)); }
    finally { retracting.delete(session); }
  }

  /** Connect or Cancel on a connector card. The core answers at once and tells each new state (`AgentTurn`). */
  async function cardAction(act: HTMLElement): Promise<void> {
    const id = act.dataset.card ?? "";
    (act as HTMLButtonElement).disabled = true;
    try {
      if (act.dataset.act === "card-cancel") await api.cardCancel(id);
      else {
        const result = await api.cardConnect(id);
        // Not started while the card still waits: another card's sign-in holds the browser.
        if (!result.started && ["pending", "failed", "cancelled"].includes(result.card.state)) {
          toaster.info(t("card.busy"));
          (act as HTMLButtonElement).disabled = false;
        }
      }
    } catch (err) {
      if (!cardFailure(act.closest(".conversation-card"), () => { void cardAction(act); })) toaster.info(describeError(err));
      (act as HTMLButtonElement).disabled = false;
    }
  }

  /** Focus the credential form already mounted in its originating conversation card. */
  async function cardSetup(act: HTMLElement): Promise<void> {
    act.closest("[data-connector]")?.querySelector<HTMLInputElement>("[data-setup-field]")?.focus();
  }

  mountInlineConnectionSetup(thread, async (id, fields) => {
    const result = await api.cardConnect(id, fields);
    return { connected: result.started || !["pending", "failed", "cancelled"].includes(result.card.state), error: result.card.error ?? undefined };
  });

  /**
   * Save the key typed into a secret card. It is read from the field here, the field is emptied before the
   * call, and the key goes to the core's vault through `integrations.card_save` and to nothing else. The
   * card's new states come back as `AgentTurn`.
   */
  async function secretSave(act: HTMLElement): Promise<void> {
    const field = act.closest<HTMLElement>(".secret-card")?.querySelector<HTMLInputElement>("input[data-secret-input]");
    if (!field || !field.value.trim()) return;
    const username = act.closest<HTMLElement>(".secret-card")?.querySelector<HTMLInputElement>("[data-login-user]");
    const value = username ? JSON.stringify({ username: username.value, password: field.value }) : field.value;
    if (username) username.value = "";
    field.value = "";
    field.disabled = true;
    (act as HTMLButtonElement).disabled = true;
    try {
      await api.cardSave(act.dataset.card ?? "", value);
    } catch (err) {
      cardFailure(act.closest(".conversation-card"), () => { field.focus(); });
    } finally {
      field.disabled = false;
    }
  }

  /** Try again, 我完成了 or 停止 on a card: the core answers at once and tells each new state (`AgentTurn`). */
  async function taskCardAction(act: HTMLElement): Promise<void> {
    const id = act.dataset.card ?? "";
    const buttons = [...(act.closest(".connector-card")?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    for (const button of buttons) button.disabled = true;
    try {
      if (act.dataset.act === "card-takeover") { desktop.takeover(); for (const button of buttons) button.disabled = false; return; }
      if (act.dataset.act === "card-resume") await api.cardResume(id);
      else if (act.dataset.act === "card-done") await api.cardDone(id);
      else await api.cardStop(id);
    } catch (err) {
      cardFailure(act.closest(".conversation-card"), () => { void taskCardAction(act); });
      for (const button of buttons) button.disabled = false;
    }
  }

  /**
   * 拒絕, 一律允許 or 允許一次 on a permission card. The question of an `ask` card is the one the window holds, answered as
   * the gold card answers it (the shell passes the answer on); a `run` card (a task that went on after the computer was
   * given back) has its own door in the core, and gives the digest of the action it shows.
   */
  async function permissionAnswer(act: HTMLElement): Promise<void> {
    if (act.dataset.source === "background") return;
    const id = act.dataset.card ?? "";
    const choice = act.dataset.act === "perm-deny" ? "deny" : act.dataset.act === "perm-always" ? "always" : "allow";
    if (act.dataset.source === "run") {
      const card = act.closest<HTMLElement>(".permission-card");
      const buttons = [...(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      for (const button of buttons) button.disabled = true;
      try {
        await api.permissionAnswer(choice, id, card?.dataset.digest ?? "");
      } catch (err) {
        cardFailure(card, () => { void permissionAnswer(act); });
        for (const button of buttons) button.disabled = false;
      }
      return;
    }
    if (question?.id !== id) return;
    if (act.dataset.act === "perm-never") {
      try { await api.settingsSet("local_commands_mode", "never"); }
      catch (err) { toaster.info(describeError(err)); return; }
      await answer(false);
    } else await answer(choice !== "deny", choice === "always");
  }

  const taskResults = mountTaskResults(thread, memberId, () => { desktop.files(); });

  mountMessageMetadata(thread, control => {
    const source = messageSource(control);
    if (!source) return null;
    const { turn, key } = source, messageKey = key === "question" ? "owner" : key;
    const scope = { member_id: turn.member_id ?? 0, conversation_id: turn.conversation_id, turn_id: turn.id };
    return { reactions: turn.reactions?.[messageKey] ?? [],
      react: (emoji, active) => api.core("agent.react", { ...scope, message_key: messageKey, emoji, active }) };
  }, () => { if (visible) void load(false); }, error => toaster.info(describeError(error)));
  mountMailActions(thread, (err) => toaster.info(describeError(err)), (words) => toaster.info(words));

  thread.addEventListener("input", (e) => {
    const field = (e.target as Element).closest<HTMLInputElement>("input[data-secret-input], input[data-login-user]");
    const save = field?.closest(".secret-card")?.querySelector<HTMLButtonElement>('[data-act="card-save"]');
    const inputs = field?.closest(".secret-card")?.querySelectorAll<HTMLInputElement>("input");
    if (inputs && save) save.disabled = [...inputs].some(input => !input.value.trim());
  });
  thread.addEventListener("keydown", (e) => {
    const field = (e.target as Element).closest<HTMLInputElement>("input[data-secret-input]");
    if (!field || e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const save = field.closest(".secret-card")?.querySelector<HTMLButtonElement>('[data-act="card-save"]');
    if (save && !save.disabled) save.click();
  });

  el.addEventListener("auxclick", (e) => {
    const link = (e.target as Element).closest<HTMLElement>('[data-act="open-url"]');
    if (!link || e.button !== 1) return;
    e.preventDefault();
    const url = safeHttpUrl(link.dataset.url);
    if (url) void api.openExternalUrl(url).catch(err => toaster.info(describeError(err)));
  });

  el.addEventListener("click", (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!act || (act as HTMLButtonElement).disabled) return;
    switch (act.dataset.act) {
      case "open-calendar-event":
        if (/^\d{4}-\d{2}-\d{2}$/.test(act.dataset.date ?? "")) app.go("automations", `calendar:${act.dataset.date}:own%3A${act.dataset.event}` as import("../types").CalendarEventFocus);
        break;
      case "open-routine":
        void Promise.all([api.routinesList(Number(act.dataset.routineMember ?? memberId())), api.membersList()]).then(([routines, team]) => {
          const routine = routines.routines.find(r => r.id === Number(act.dataset.routine));
          if (routine) openRoutineDialog({members:team.members, routine});
          else toaster.info(t("members.profile.noRoutines"));
        }).catch(error => toaster.info(describeError(error)));
        break;
      case "local-settings":
        app.go("settings", "safety");
        break;
      case "search":
      case "search-close":
        break;
      case "steps":
        toggleSteps(act);
        break;
      case "draft-done":
        toggleDraftDone(act);
        break;
      case "detail":
        toggleDetail(act);
        break;
      case "thinking":
        toggleThinking(act);
        break;
      case "open-url": {
        e.preventDefault();
        const url = safeHttpUrl(act.dataset.url);
        if (url) void api.openExternalUrl(url).catch(err => toaster.info(describeError(err)));
        break;
      }
      case "peer-chat":
        peer?.close();
        // What this member sent colleagues, and what colleagues said to it (its exchange turns), are one conversation.
        peer = openPeerChat(memberChat, act, () => turns.flatMap(turn => [...(turn.handoffs ?? []), ...(exchangeTurn(turn) ? [exchangeView(turn)] : [])]),
          (id, fallback) => ({ name: members.nameOf(id) || fallback, face: members.faceOf(id, 28), accent: members.accentOf(id) }), () => { peer = null; });
        break;
      case "copy-message":
        void copyMessage(act);
        break;
      case "reply-message":
        replyMessage(act);
        break;
      case "jump-quote":
        void jumpQuote(act).catch(err => toaster.info(describeError(err)));
        break;
      case "more-message":
        void messageMenu(act);
        break;
      case "edit-message":
        void editMessage(act);
        break;
      case "cancel-message":
        void cancelMessage(act);
        break;
      case "drop-missing":
        missingFiles.splice(Number(act.dataset.index), 1);
        drawFile();
        break;
      case "remove-quote":
        composerQuote = undefined;
        drawQuote(); focusComposer();
        break;
      case "copy-code": {
        const code = act.closest(".message-code")?.querySelector("code")?.textContent;
        if (code !== undefined && code !== null) void copyButton(act, code).catch(err => toaster.info(describeError(err)));
        break;
      }
      case "regenerate":
        void regenerate(act);
        break;
      case "expand-message": {
        const source = messageSource(act);
        const session = act.closest<HTMLElement>('.tn[data-session]')?.dataset.session;
        if (!source && !session) break;
        const key = source ? `${source.turn.id}:${source.key}` : `pending:${session}:question`;
        if (state.expandedMessages.has(key)) state.expandedMessages.delete(key);
        else state.expandedMessages.add(key);
        render();
        break;
      }
      case "attachment-image": {
        const src = attachmentMedia.source(act);
        if (src) openLightbox(act, src);
        break;
      }
      case "attachment-open":
        void api.openAttachment(act.dataset.id ?? "").catch(() => toaster.info(t("agent.fileUnavailable")));
        break;
      case "team-file-open":
        void api.openTeamFile(act.dataset.path ?? "").catch(() => toaster.info(t("agent.fileUnavailable")));
        break;
      case "lightbox":
        openLightbox(act);
        break;
      case "pdf-expand":
        togglePdfExpand(act);
        break;
      case "stop":
        void stop(act);
        break;
      case "rerun":
        void rerun(act);
        break;
      case "attach":
        picker.value = ""; picker.click();
        break;
      case "unattach-file": {
        const id = Number(act.dataset.file);
        files = files.filter((file) => file.id !== id);
        drawFile();
        input.focus();
        break;
      }
      case "card-connect":
      case "card-cancel":
        void cardAction(act);
        break;
      case "card-setup":
        void cardSetup(act);
        break;
      case "card-settings":
        app.go("settings", "repair:store:composio");
        break;
      case "card-save":
        void secretSave(act);
        break;
      case "card-resume":
      case "card-takeover":
      case "card-done":
      case "card-stop":
        void taskCardAction(act);
        break;
      case "perm-deny":
      case "perm-never":
      case "perm-always":
      case "perm-once":
        void permissionAnswer(act);
        break;
      case "no":
        void answer(false);
        break;
      case "always":
        void answer(true, true);
        break;
      case "yes":
        void answer(true);
        break;
    }
  });

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    void send();
  });
  input.addEventListener("keydown", (e) => {
    if (!sendsOnEnter(e)) return;
    e.preventDefault();
    void send();
  });
  cancelGesture().register(() => {
    const task = composerTask();
    return visible && !roomPane.active && task ? {
      key: task.key, immediate: task.key.startsWith("listening:") || task.key.startsWith("voice:"), button: voiceButton, hint: t("common.cancelAgain"),
      cancel: () => { void (listening ? api.cancelSession() : input.value.trim() || files.length || !task.key.startsWith("request:") ? stopComposerTask() : cancelMessage()).catch(error => toaster.info(describeError(error))); },
    } : null;
  });
  input.addEventListener("input", () => { fit(); clearTimeout(draftTimer); draftTimer = setTimeout(() => { if (el.isConnected) saveComposerDraft(); }, 300); });
  members.bindMentions(input);
  bindComposerHistory(input, () => api.agentSent());
  picker.addEventListener("change", () => {
    const chosen = Array.from(picker.files ?? []);
    if (chosen.length > 0) void attachAll(chosen);
  });
  bindFilePaste(input, pasted => { void attachAll(pasted); }, fit, () => files.map(file => file.name));

  // The voice button records while held. When calls return, an empty member composer's short click calls and a
  // 300 ms hold records. Capture the destination on press, before either the timer or navigation can change it.
  let voicePointer: { id: number; member: number; conversation?: number; recording: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
  let suppressVoiceClick = false;
  voiceButton.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || voicePointer) return;
    voiceButton.setPointerCapture(e.pointerId);
    suppressVoiceClick = true;
    const press = { id: e.pointerId, member: memberId(), conversation: conversationId(), recording: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    voicePointer = press;
    const record = (): void => { press.recording = true; voiceDown(press.member, press.conversation); };
    if (callEligible()) press.timer = setTimeout(record, 300);
    else record();
  });
  const releasePointer = (cancelled: boolean): void => {
    const press = voicePointer;
    if (!press) return;
    voicePointer = null;
    clearTimeout(press.timer);
    suppressVoiceClick = cancelled || press.recording || press.member !== memberId() || press.conversation !== conversationId();
    if (press.recording) voiceUp();
  };
  voiceButton.addEventListener("pointerup", e => { if (e.pointerId === voicePointer?.id) releasePointer(false); });
  voiceButton.addEventListener("pointercancel", e => { if (e.pointerId === voicePointer?.id) releasePointer(true); });
  voiceButton.addEventListener("lostpointercapture", e => { if (e.pointerId === voicePointer?.id) releasePointer(true); });
  voiceButton.addEventListener("click", e => {
    // A browser click follows pointerup even after a hold. Keyboard/assistive clicks stay usable.
    if (e.detail > 0 && suppressVoiceClick) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, { capture: true });
  // A key held on the button is let go wherever the focus is by then: the release is heard on the
  // whole page, for the key that pressed it, once; a window that loses the focus lets it go too.
  // (The button stays where it is while the picture is up, but the focus may still move: the
  // approval card can take the composer's place.)
  let heldKey: string | null = null;
  let keyRecordsVoice = false;
  const releaseKey = (): void => {
    heldKey = null;
    if (keyRecordsVoice) voiceUp();
    keyRecordsVoice = false;
  };
  voiceButton.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.repeat || heldKey !== null || voicePointer) return;
      heldKey = e.key;
      keyRecordsVoice = !callEligible();
      if (keyRecordsVoice) voiceDown(); else voiceButton.click();
    }
  });
  document.addEventListener("keyup", (e) => {
    if (heldKey !== null && e.key === heldKey) releaseKey();
  });
  window.addEventListener("blur", () => {
    releasePointer(true);
    if (heldKey !== null) releaseKey();
  });

  async function revealTurn(id: number): Promise<void> {
    releaseRichScroll(scroller);
    const member = memberId(), conversation = conversationId();
    if (!turns.some(turn => turn.id === id)) {
      const page = await api.agentHistoryList({ member_id: member, conversation_id: conversation, around_id: id, limit: PAGE_SIZE });
      if (member !== memberId() || conversation !== conversationId()) return;
      turns = mergeTurns(turns, page.turns);
    }
    const receipt = turns.find(turn => turn.id === id)?.voice_call_summary_id;
    if (receipt) {
      await revealTurn(receipt);
      const card = thread.querySelector<HTMLDetailsElement>(`[data-id="${receipt}"] details`);
      if (card) card.open = true;
      thread.querySelector(`[data-call-turn="${id}"]`)?.scrollIntoView({block: "center"});
      return;
    }
    const keys = [...turns].sort((a,b) => a.created_at_ms-b.created_at_ms || a.id-b.id).map(turn => String(turn.id));
    if (turnWindow.focus(String(id), keys)) { drawingFollows = false; render(); }
  }

  async function jumpQuote(control: HTMLElement): Promise<void> {
    const quotedAt = Number(control.closest<HTMLElement>(".tn[data-id]")?.dataset.id), quote = turns.find(turn => turn.id === quotedAt)?.quote;
    if (!quote) return;
    const member = memberId(), conversation = conversationId();
    const source = (): AgentTurn | undefined => [...turns].sort((a,b) => b.id-a.id).find(turn => turn.id < quotedAt &&
      [messagePlainText(turn.question), ...plainReplies((turn.messages ?? []).filter(message => message.kind === "reply").map(message => message.text)).map(text => messagePlainText(text, true, composioAction(turn))), messagePlainText(turn.text, true, composioAction(turn))].some(text => text.includes(quote.text)));
    let target = source();
    while (!target && canLoadEarlier) {
      const before = oldestId(turns), page = await api.agentHistoryList({member_id:member,conversation_id:conversation,before_id:before,limit:PAGE_SIZE});
      if (member !== memberId() || conversation !== conversationId()) return;
      turns = mergeTurns(turns, page.turns); canLoadEarlier = page.turns.length === PAGE_SIZE && oldestId(turns) !== before;
      target = source();
    }
    if (target) { await revealTurn(target.id); thread.querySelector<HTMLElement>(`.tn[data-id="${target.id}"]`)?.scrollIntoView({block:"center"}); }
  }

  app.onEvent((event) => {
    if (event.type === "Hotkey" && event.kind === "cancel_key" && visible ) cancelGesture().press();
    if (event.type === "Hotkey" && event.kind === "cancel_reset") cancelGesture().clear();
    members.follow(event);
    if (event.type === "ConversationsChanged") { conversationsDirty.add(event.member_id); staleHistory.set(event.member_id, (staleHistory.get(event.member_id) ?? 0) + 1); conversationChange(event.member_id); }
    if (event.type === "AgentTurn") { conversationsDirty.add(event.member_id ?? RAPHAEL_ID); conversationChange(event.member_id ?? RAPHAEL_ID); }
    if (event.type === "QuotaChanged") void readQuotas();
    if (event.type === "MembersChanged") void slashMenu.refresh(true);
    if (wantsRefresh(event)) {
      // a turn of another thread changes only that member's row
      if (event.type === "WorkerChanged") {
        for (const turn of turns) if (turn.task?.id === event.task_id || turn.handoffs?.some(handoff => handoff.task_id === event.task_id)) dirtyTurnIds.add(turn.id);
        const loaded=hasWorkerTask(turns,event.task_id);
        if (!loaded && visible && !roomPane.active && renderedPage!==pageStamp()) render();
        scheduleRefresh(loaded ? 0 : 1000+REFRESH_DELAY_MS);
      }
      else if (event.type === "AgentTurn" && (event.member_id ?? RAPHAEL_ID) === memberId()) { dirtyTurnIds.add(event.turn_id); scheduleRefresh(); }
      // Loaded running work changes history; activity and turn events own the roster's state and preview.
      if (event.type !== "WorkerChanged" || event.state !== "running" || !hasWorkerTask(turns, event.task_id)) members.changed(event.type === "WorkerChanged" ? 1000 : undefined);
    }
    waiting?.follow(event);
    if (event.type === "AgentQuestion") {
      setQuestion(openQuestion(event));
      drawDock();
      redrawCards();
      members.changed();
    } else if (event.type === "AgentQuestionClosed") {
      questions.delete(event.id);
      answeringQuestions.delete(event.id);
      drawDock();
      redrawCards();
      members.changed();
    } else if (event.type === "VoiceLevel") {
      voice.level(event.value);
    } else if (event.type === "Dictation" && event.agent) {
      if (event.phase === "listening") {
        const member = event.member_id ?? RAPHAEL_ID;
        if ((!listening && !voiceRequested) || voiceMember !== member) rememberVoiceBoundary(member);
        voiceMember = member;
        if(!listening)listeningRun++;
        listening = true;
        if (visible && !question && voiceMember === memberId()) drawComposerTask();
      } else {
        if (event.phase === "processing") {
          const member = event.member_id ?? RAPHAEL_ID;
          if ((!listening && !voiceRequested) || voiceMember !== member) rememberVoiceBoundary(member);
          voiceMember = member;
        }
        listening = false;
        voiceRequested = false;
        voice.down();
        drawComposerTask();
        if (event.phase === "processing") {
          startHearing(voiceMember);
          if (visible) render(true);
        } else if (hearing) {
          stopHearing();
          if (visible) render();
        }
      }
    }
  });

  onAvatarChange(() => {
    presentationVersion++;
    drawFaces();
    void members.load();
    for (const child of thread.children) drawnHTML.delete(child); // every face is drawn again
    if (visible) render();
  });

  onLocaleChange(() => {
    presentationVersion++;
    closeMediaLightbox();
    void slashMenu.refresh();
    drawWords();
    draftPanel.redraw();
    drawQuotas();
    drawComposer();
    for (const child of thread.children) drawnHTML.delete(child);
    render();
  });
  drawWords();
  drawFaces();
  drawComposer();
  drawBackgroundQuestions();

  let memberJump = 0;
  window.addEventListener("raphael:open-member", event => {
    if (!el.isConnected) return;
    if (roomPane.active) roomPane.close();
    const jump = ++memberJump;
    const { memberId, turnId, files } = (event as CustomEvent<{ memberId: number; turnId?: number; files?: boolean }>).detail;
    void members.load().then(async () => {
      members.select(memberId);
      if (files) { desktop.files(); }
      if (!turnId) return;
      await load(false);
      const generation = loads;
      const result = await api.agentHistoryList({ member_id: memberId, before_id: turnId + 1, limit: PAGE_SIZE });
      if (!visible || jump !== memberJump || generation !== loads || memberId !== members.current()) return;
      const target = result.turns.find(turn => turn.id === turnId);
      if (target?.conversation_id !== undefined) {
        openConversation(memberId, target.conversation_id, turnId);
        return;
      }
      turns = mergeTurns(turns, result.turns);
      await revealTurn(turnId);
      el.querySelector<HTMLElement>(`.tn[data-id="${turnId}"]`)?.scrollIntoView({ block: "center" });
    }).catch(error => toaster.info(describeError(error)));
  });

  return {
    id: "agent",
    el,
    sidebar: members.column,
    loadSidebar: () => members.load(),
    show(arg) {
      const wasVisible = visible;
      if (!wasVisible) { unreadFrom = null; unreadCaptured = false; openingThread = true; }
      visible = true;
      if (arg === "computer") { if (roomPane.active) roomPane.close(); members.computer(); }
      if (!wasVisible) members.show();
      if (!roomPane.active) desktop.show();
      else void roomPane.refresh();
      problemNotice.show();
      messageResize?.observe(scroller);
      dropResize?.observe(stage);
      dropResize?.observe(composer);
      dropResize?.observe(askCard);
      dropResize?.observe(draftPanel.el);
      void members.load();
      void readQuotas();
      // A draft goes into the field at once; the composer may then move (the empty page has it
      // under Raphael, the thread under the turns) or give way to a question, which takes the
      // focus away: it is given back once each of those is known.
      const draft = draftText(arg);
      if (draft !== null) putDraft(draft);
      const refocus = (): void => {
        if (!wasVisible || draft !== null) focusComposer();
      };
      // The page opens at the newest turn, and with the question that waits, if one does.
      void api
        .agentQuestionOpen()
        .then((open) => {
          if (open) setQuestion(openQuestion(open));
          drawDock();
          refocus();
        })
        .catch(() => {});
      void load(false).then(() => {
        if (visible && !scroller.hidden && (!wasVisible || draft !== null)) {
          if (unreadFrom !== null) finishOpening();
          else scroller.scrollTop = scroller.scrollHeight;
        }
        if (visible && listening && voiceMember === memberId() && !question) drawComposerTask();
        refocus();
      });
      drawBackgroundQuestions();
    },
    hide() {
      releasePointer(true);
      if (heldKey !== null) releaseKey();
      saveComposerDraft();
      desktop.hide();
      hideTooltip();
      hideSelection();
      pacing.flush();
      loadedThread = false;
      visible = false;
      cancelGesture().sync();
      problemNotice.hide();
      closeMediaLightbox();
      resetDrop();
      attachmentMedia.reset();
      previews.pause();
      messageResize?.disconnect();
      dropResize?.disconnect();
      members.hide();
      input.dispatchEvent(new Event("blur"));
      clearTimeout(listenTimer);
      loads++;
      loadingEarlier = false;
      stopTicker();
      voice.drop();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
    },
  };
}
