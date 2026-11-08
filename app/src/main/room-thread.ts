import * as api from "./api";
import { createChatComposer } from "./chat-composer";
import { describeError } from "./format";
import { getLocale, t } from "./i18n";
import { messageHTML, replyContentHTML } from "./message-content";
import { mountRichContent } from "./message-rich";
import { createAttachmentMedia } from "./attachment-media";
import { patchThread } from "./thread-diff";
import { conversationCardsHTML, messageActionsHTML, filesHTML } from "./timeline";
import { mountConversationCardActions } from "./conversation-card-actions";
import { mountOwnerQuestions } from "./owner-questions";
import { createBackgroundQuestions } from "./background-questions";
import { carryTyped } from "./secret-card";
import { carryMail } from "./mail-card";
import { faceHTML } from "./members";
import { mountMessageMetadata, reactionControlHTML, reactionRowHTML } from "./message-metadata";
import type { AppContext, MembersList, RoomMessage } from "./types";
import { copyButton, esc, iconButton, toaster } from "./ui";

/** One side thread, carried by the existing room worker and composer. */
export async function openRoomThread(host: HTMLElement, app: AppContext, roomId: number, messageId: number, people: MembersList, changed: () => void): Promise<() => void> {
  const result = await api.core<{ thread_id: number }>("rooms.thread_open", { room_id: roomId, message_id: messageId });
  const pane = document.createElement("aside"); pane.className = "room-side-thread"; pane.setAttribute("aria-label", t("rooms.thread"));
  pane.innerHTML = `<header><b>${esc(t("rooms.thread"))}</b>${iconButton("x", t("common.close"), ' data-thread-close')}</header><div class="room-side-scroll"><div class="room-thread-origin"></div><ol class="thread"></ol></div><div class="room-thread-dock"></div>`;
  host.append(pane); host.classList.add("has-side-thread");
  let alive = true, generation = 0, messages: RoomMessage[] = [], pending: string | undefined;
  const thread = pane.querySelector<HTMLElement>("ol")!, origin = pane.querySelector<HTMLElement>(".room-thread-origin")!;
  const drawn = new WeakMap<Element, string>();
  const carryTranscript = (before: Element, after: HTMLElement): (() => void) => {
    const restoreTyped = carryTyped(before, after), restoreMail = carryMail(before, after);
    return () => { before.before(after); before.remove(); restoreTyped(); restoreMail(); };
  };
  const media = createAttachmentMedia(pane, id => api.core("attachments.get", { id }));
  const render = (message: RoomMessage): string => {
    const member = people.members.find(person => person.id === message.member_id);
    const actions = messageActionsHTML(message.created, false, undefined, false, reactionControlHTML());
    const reactions = reactionRowHTML(message.reactions);
    const body = message.member_id === null
      ? `<div class="me"><div class="chat-message owner-message">${filesHTML(message.attachments)}<div class="bubble"><div class="message-text">${messageHTML(message.text, "", false)}</div></div>${reactions}${actions}</div></div>`
      : `<div class="ra"><span class="ra-face"${member ? ` data-tooltip="${esc(member.name)}"` : ""}>${member ? faceHTML(member, 28) : ""}</span><div class="ra-body"><b class="au-room-author">${esc(member?.name ?? t("rooms.owner"))}</b><div class="chat-message">${filesHTML(message.attachments)}${replyContentHTML(message.text, "", message.status === "running")}${reactions}${actions}</div>${message.turn ? conversationCardsHTML(message.turn, member?.name) : ""}</div></div>`;
    return `<li class="tn" data-side-message="${message.id}">${body}</li>`;
  };
  const refresh = async (): Promise<void> => {
    const mine = ++generation;
    const history = await api.roomMessages(roomId, undefined, result.thread_id);
    if (!alive || mine !== generation) return;
    messages = [...(history.parent ? [history.parent] : []), ...history.messages];
    if (!origin.firstElementChild) origin.innerHTML = '<ol class="thread"></ol>';
    const line = (message: RoomMessage) => ({ key: String(message.id), html: render(message) });
    patchThread(origin.firstElementChild as HTMLElement, history.parent ? [line(history.parent)] : [], drawn, { carry: carryTranscript });
    patchThread(thread, history.messages.map(line), drawn, { carry: carryTranscript });
    media.sync();
    composer.setTaskState(history.messages.some(message => message.status === "running") || ["queued", "running"].includes(history.exchange?.state ?? "") ? "running" : "idle");
    await questions.load();
  };
  const composer = createChatComposer({
    placeholder: () => t("rooms.threadReply"),
    send: async (text, files) => {
      if (!text.trim() && !files.length) return;
      const request = pending ??= crypto.randomUUID();
      composer.setTaskState("running");
      try {
        await api.roomSend(roomId, text, request, getLocale(), files, undefined, result.thread_id);
        pending = undefined;
        if (!alive) return;
        composer.setDraft(""); await refresh(); changed();
      } catch (error) { composer.setTaskState("idle"); toaster.info(describeError(error)); }
    },
    stopTask: async () => { await api.roomStop(roomId, result.thread_id); if (alive) await refresh(); },
  });
  pane.querySelector(".room-thread-dock")!.append(composer.el);
  const questions = createBackgroundQuestions({ memberId: () => 0, roomId: () => roomId, threadId: () => result.thread_id, manageLocal: () => app.go("settings", "safety"), changed });
  pane.querySelector(".room-thread-dock")!.prepend(questions.element);
  mountConversationCardActions(pane, () => app.go("settings", "connections"));
  mountOwnerQuestions(pane, () => { void refresh().catch(error => toaster.info(describeError(error))); });
  mountRichContent(pane);
  const unmount = mountMessageMetadata(pane, button => {
    const message = messages.find(item => item.id === Number(button.closest<HTMLElement>("[data-side-message]")?.dataset.sideMessage));
    return message ? { reactions: message.reactions ?? [], react: (emoji, active) => api.core("rooms.react", { room_id: roomId, message_id: message.id, emoji, active }) } : null;
  }, () => { void refresh().catch(error => toaster.info(describeError(error))); }, error => toaster.info(describeError(error)));
  pane.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-act="copy-message"], [data-act="attachment-open"]');
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.act === "attachment-open") { void api.openAttachment(button.dataset.id ?? "").catch(error => toaster.info(describeError(error))); return; }
    const message = messages.find(message => message.id === Number(button.closest<HTMLElement>('[data-side-message]')?.dataset.sideMessage));
    if (message) void copyButton(button, message.text).catch(error => toaster.info(describeError(error)));
  });
  const unsubscribe = app.onEvent(event => { if (event.type === "WorkerChanged" || (event.type === "RoomsChanged" && event.room_id === roomId) || (event.type === "AgentTurn" && messages.some(message => message.turn_id === event.turn_id))) void refresh().catch(error => toaster.info(describeError(error))); });
  const close = (): void => { if (!alive) return; alive = false; generation++; unsubscribe(); unmount(); questions.reset(); composer.stopVoice(); media.reset(); pane.remove(); host.classList.remove("has-side-thread"); changed(); };
  pane.querySelector("[data-thread-close]")!.addEventListener("click", close);
  try { await refresh(); composer.input.focus(); } catch (error) { close(); throw error; }
  return close;
}
