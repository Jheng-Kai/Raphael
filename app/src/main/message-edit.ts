import { t } from "./i18n";
import { btn, esc, ico } from "./ui";

/**
 * The owner's message open as an editor in its own place (owner, 2026-11-14): its words so far and the files of the
 * original that are not stored any more and wait for the owner to drop them. The files and the quote it carries stay
 * as they were, and what is sent goes through the composer's own send (`send` in pages/agent.ts).
 */
export interface OwnerEditing {
  turnId: number;
  text: string;
  missing: readonly { name: string }[];
  /** Whether Send has something to send: the composer's rule (`typedQuestion`), with no file of the original left missing. */
  sendable: boolean;
}

/**
 * The owner's bubble itself, its words in a field (owner, 2026-11-14: 「用原本的 message bubble 下去編輯就好了」): the same
 * `.bubble` as the sent message's, under the files and the quote it keeps, so its colour, shape, type and width are the
 * bubble's own and it grows with its words. Cancel and Send are small and under it, at its right edge, in no box of their own.
 * The caller puts it in the message element that carries `data-msg-editor`.
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
 * An editor drawn again (its line changed for another reason) keeps its words, its caret and the focus: the field of
 * `before` hands its value, selection and focus to the one of `after`. Call the result once `after` is in the page.
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
