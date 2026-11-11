import { ownerQuestionAnswer } from "./api";
import { describeError } from "./format";
import { cardFailure } from "./card";
import { mountMcpProposals } from "./mcp-proposal";
import { chosenOptions, syncQuestionCard } from "./owner-question-sync";
import type { AgentTurn, OwnerQuestion } from "./types";

export function answerOwnerPage(thread: HTMLElement, pageId: string, text: string, changed: () => void): boolean {
  const card = thread.querySelector<HTMLElement>(`[data-owner-page="${CSS.escape(pageId)}"][data-card-state="asked"]`);
  if (!card?.dataset.ownerQuestion) return false;
  const id = card.dataset.ownerQuestion;
  const answer = (): void => { void ownerQuestionAnswer(id, text).then(changed).catch(error => {
    const notice = card.querySelector<HTMLElement>('[role="alert"]')!;
    notice.textContent = describeError(error); notice.hidden = false;
    cardFailure(card, answer);
  }); };
  answer();
  return true;
}

/** The rows a letter key can reach: the member's options, then the skip row when the card has one. */
const rowsOf = (card: Element): HTMLButtonElement[] => [...card.querySelectorAll<HTMLButtonElement>("[data-owner-option], [data-owner-skip]")];

/** A shared controller for private and room cards. The core owns every answer and continuation. */
export function mountOwnerQuestions(thread: HTMLElement, changed: () => void): void {
  mountMcpProposals(thread, changed);
  const busy = new Set<string>();
  thread.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const target = event.target as Element;
    if (target.closest("input,textarea,[contenteditable=true]")) {
      // Enter in the own-answer row sends it (Shift+Enter is a new line; a key that picks a candidate in an IME is not Enter).
      const own = target.closest<HTMLTextAreaElement>("[data-owner-answer-input]");
      const card = own?.closest<HTMLElement>("[data-owner-question][data-card-state=asked]");
      if (own && card && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        card.querySelector<HTMLButtonElement>('[data-owner-answer="text"]:not([disabled]), [data-owner-answer="choices"]:not([disabled])')?.click();
      }
      return;
    }
    const card = target.closest<HTMLElement>("[data-owner-question][data-card-state=asked]");
    const index = event.key.toUpperCase().charCodeAt(0) - 65;
    if (!card || event.key.length !== 1 || index < 0 || index > 4) return;
    const choice = rowsOf(card)[index];
    if (choice && !choice.disabled) { event.preventDefault(); choice.click(); }
  });
  thread.addEventListener("input", event => {
    const card = (event.target as Element).closest<HTMLElement>("[data-owner-question]");
    if (card && (event.target as Element).matches("[data-owner-answer-input]")) syncQuestionCard(card, busy.has(card.dataset.ownerQuestion!));
  });
  thread.addEventListener("click", event => {
    const target = event.target as Element;
    // The one row of an answered card: the whole words when they were cut to one line, and back.
    const line = target.closest<HTMLButtonElement>("[data-owner-line]");
    if (line) {
      const text = line.querySelector<HTMLElement>(".question-answer-text")!;
      const open = line.getAttribute("aria-expanded") === "true";
      if (open || text.scrollWidth > text.clientWidth + 1) line.setAttribute("aria-expanded", String(!open));
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-owner-option],[data-owner-skip],[data-owner-answer]");
    const card = button?.closest<HTMLElement>("[data-owner-question]");
    const id = card?.dataset.ownerQuestion;
    if (!button || !card || !id || busy.has(id)) return;
    // On a several-choice card a row is marked or unmarked; nothing is sent until its submit.
    if (button.dataset.ownerOption !== undefined && card.dataset.ownerMultiple === "true" && button.getAttribute("role") === "checkbox") {
      button.setAttribute("aria-checked", String(button.getAttribute("aria-checked") !== "true"));
      syncQuestionCard(card);
      return;
    }
    const field = card.querySelector<HTMLTextAreaElement>("[data-owner-answer-input]");
    const typed = field?.value.trim() ?? "";
    const answer = button.dataset.ownerAnswer === "cancel" ? null
      : button.hasAttribute("data-owner-skip") ? { skip: true as const }
      : button.dataset.ownerAnswer === "choices" ? [...chosenOptions(card), ...(typed ? [typed] : [])]
      : button.dataset.ownerOption ?? typed;
    if (answer === "" || (Array.isArray(answer) && !answer.length)) return;
    busy.add(id);
    card.querySelectorAll<HTMLButtonElement>("button").forEach(control => { control.disabled = true; });
    if (field) field.disabled = true;
    void ownerQuestionAnswer(id, answer).then(changed).catch(error => {
      const notice = card.querySelector<HTMLElement>('[role="alert"]')!;
      notice.textContent = describeError(error); notice.hidden = false;
      card.querySelectorAll<HTMLButtonElement>("button").forEach(control => { control.disabled = false; });
      if (field) field.disabled = false;
      syncQuestionCard(card);
      cardFailure(card, () => button.click());
    }).finally(() => { busy.delete(id); });
  });
}

/** Whether a question card waits for the owner in these turns (or among the conversation's pending questions): the composer then says it takes the answer or anything else. */
export const questionWaits = (turns: readonly AgentTurn[], pending: readonly OwnerQuestion[] = []): boolean =>
  [...pending, ...turns.flatMap(turn => turn.owner_questions ?? [])].some(question => question.state === "asked" && question.kind === "ask_owner");
