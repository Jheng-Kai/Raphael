import { t } from "./i18n";
import { exchangeTurn, ownerTurn, sourceOf } from "./conversation";
import type { AgentTurn } from "./types";
import { btn, esc, ico, iconBtn } from "./ui";

/**
 * How the owner edits a sent message (R-UI-163): back in the composer while its member has not answered it yet (R-UI-158),
 * in its own bubble once the member has answered it, so that the first exchange stays as a version of the message.
 */
export type OwnerEdit = "composer" | "bubble";

/**
 * Whether a turn opens with a message of the owner's own, drawn as their bubble: not a routine's run, a resumed task, a
 * colleague's brief, a new member's set-up or a greeting.
 */
export function ownerMessageTurn(turn: AgentTurn): boolean {
  return ownerTurn(turn) && !exchangeTurn(turn) && sourceOf(turn) !== "connector" && !turn.setup && turn.route !== "greeting"
    && (turn.question.trim() !== "" || (turn.attachments?.length ?? 0) > 0);
}

/**
 * Whether the member answered the turn with a message bubble: a reply or something it showed (a picture, a link's card), or the
 * answer of a turn that has no reply lines, as the thread draws them (timeline.ts). The core keeps the same rule
 * (`AgentHistory.answered`): the edit of an answered message keeps the first exchange as version 1.
 */
export function answeredTurn(turn: AgentTurn): boolean {
  const lines = turn.messages ?? [];
  if (lines.some(line => (line.kind === "reply" || line.kind === "media") && line.text.trim() !== "")) return true;
  return !lines.some(line => line.kind === "reply") && turn.status !== "confirm" && turn.route !== "draft" && turn.text.trim() !== "";
}

/**
 * The owner's last message of a conversation, the only one that can be edited: the newest turn that opens with their own words.
 * `later` says something the owner sent is still on its way: then no message in the history is the last.
 * `turns` run from the oldest to the newest.
 */
export function lastOwnerTurnId(turns: readonly AgentTurn[], later = false): number | undefined {
  if (later) return undefined;
  for (let i = turns.length - 1; i >= 0; i--) if (ownerMessageTurn(turns[i]!)) return turns[i]!.id;
  return undefined;
}

/**
 * The state rule of 編輯, in one place: a message that is not the owner's last has none (something they sent later exists); the
 * last one goes back to the composer while its member has sent no message bubble for it (still thinking, or a turn that ended
 * with none), and is edited in its own bubble once the member answered it with one, also while that work still goes on (the
 * edit stops it, as Stop does). A message that waits in the queue keeps its 取消 and 立即送出 instead (R-QUEUE-05), and an
 * earlier version shown again is read only.
 */
export function ownerEditOf(turn: AgentTurn, last: boolean): OwnerEdit | null {
  if (!last || !ownerMessageTurn(turn) || turn.status === "queued" || (turn.version ?? 1) < (turn.versions ?? 1)) return null;
  return answeredTurn(turn) ? "bubble" : "composer";
}

/** Whether a turn is an earlier version of an edited message, shown again for the owner to read (`agent.history.version`). */
export const earlierVersion = (turn: AgentTurn): boolean => (turn.version ?? 1) < (turn.versions ?? 1);

/**
 * The owner's message open as an editor in its own place: its words so far and the files of the original that are not stored any
 * more and wait for the owner to drop them. The files and the quote it carries stay as they were.
 */
export interface OwnerEditing {
  turnId: number;
  text: string;
  missing: readonly { name: string }[];
  /** Whether Send has something to send: the composer's rule (`typedQuestion`), with no file of the original left missing. */
  sendable: boolean;
}

/**
 * The owner's bubble itself, its words in a field: the same `.bubble` as the sent message's, under the files and the quote it
 * keeps, so its colour, shape, type and width are the bubble's own and it grows with its words. 取消 and the primary 送出 are
 * small and under it, at its right edge, in no box of their own. The caller puts it in the message element that carries
 * `data-msg-editor`.
 */
export function ownerEditorHTML(editing: OwnerEditing, files: string, quote: string): string {
  const chips = editing.missing.map((file, index) => `<span class="cmp-chip" data-missing><span class="cmp-chip-t">${esc(file.name)} · ${esc(t("chat.reattach"))}</span>` +
    `<button type="button" class="chip-x" data-act="drop-edit-missing" data-index="${index}" aria-label="${esc(t("agent.unattach"))}" title="${esc(t("agent.unattach"))}">${ico("x")}</button></span>`).join("");
  const bubble = `<div class="bubble">${quote}<div class="message-text">` +
    `<textarea class="msg-editor-input" data-edit-input rows="1" aria-label="${esc(t("chat.edit"))}">${esc(editing.text)}</textarea></div></div>`;
  return (files ? `<div class="owner-content">${files}${bubble}</div>` : bubble) +
    `<div class="msg-editor-under">${chips ? `<div class="msg-editor-files">${chips}</div>` : ""}` +
    `<div class="msg-editor-actions">${btn(`<span>${esc(t("common.cancel"))}</span>`, "sm", ' data-act="edit-cancel"')}${btn(esc(t("chat.send")), "sm pri", ` data-act="edit-send"${editing.sendable ? "" : " disabled"}`)}</div></div>`;
}

/**
 * An editor drawn again (its line changed for another reason) keeps its words, its caret and the focus: the field of `before`
 * hands its value, selection and focus to the one of `after`. Call the result once `after` is in the page.
 */
export function carryEditor(before: Element, after: Element): () => void {
  const old = before.querySelector<HTMLTextAreaElement>("[data-edit-input]"), fresh = after.querySelector<HTMLTextAreaElement>("[data-edit-input]");
  if (!old || !fresh) return () => {};
  fresh.value = old.value;
  const focused = old === document.activeElement, start = old.selectionStart, end = old.selectionEnd;
  return () => {
    if (!focused) return;
    fresh.focus({ preventScroll: true });
    fresh.setSelectionRange(start, end);
  };
}

/**
 * Under the bubble of a message edited after it was answered: ‹ 2/2 ›. ‹ and › show the version before or after, the message and
 * what the member answered it with, for the owner to read; they never change what the member reads (its context is the newest).
 * Each is a real button with its own name, at an end not pressable; the count says which version is shown.
 */
export function versionPagerHTML(turn: AgentTurn): string {
  const versions = turn.versions ?? 1;
  if (versions < 2) return "";
  const shown = Math.min(Math.max(turn.version ?? versions, 1), versions);
  const step = (icon: "left" | "right", label: string, act: string, off: boolean): string =>
    iconBtn(icon, label, ` data-act="${act}"${off ? " disabled" : ""}`).replace(" title=", " data-tooltip=");
  return `<div class="msg-versions" role="group" aria-label="${esc(t("chat.versions"))}" data-version="${shown}" data-versions="${versions}">` +
    step("left", t("chat.versionPrevious"), "version-previous", shown <= 1) +
    `<span class="msg-versions-count" aria-live="polite">${shown}/${versions}</span>` +
    step("right", t("chat.versionNext"), "version-next", shown >= versions) + `</div>`;
}
