import { ownerQuestionAnswer } from "./api";
import { describeError } from "./format";
import { cardFailure } from "./card";
import { mountMcpProposals } from "./mcp-proposal";

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

/** A shared controller for private and room cards. The core owns every answer and continuation. */
export function mountOwnerQuestions(thread: HTMLElement, changed: () => void): void {
  mountMcpProposals(thread, changed);
  const busy = new Set<string>();
  thread.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const target = event.target as Element;
    if (target.closest("input,textarea,[contenteditable=true]")) return;
    const card = target.closest<HTMLElement>("[data-owner-question][data-card-state=asked]");
    const index = event.key.toUpperCase().charCodeAt(0) - 65;
    if (!card || event.key.length !== 1 || index < 0 || index > 3) return;
    const choice = card.querySelectorAll<HTMLButtonElement>("[data-owner-option]")[index];
    if (choice && !choice.disabled) { event.preventDefault(); choice.click(); }
  });
  thread.addEventListener("input", event => {
    const field = event.target as HTMLTextAreaElement;
    const card = field.closest<HTMLElement>("[data-owner-question]");
    const submit = card?.querySelector<HTMLButtonElement>('[data-owner-answer="text"]');
    if (submit) submit.disabled = !field.value.trim() || busy.has(card!.dataset.ownerQuestion!);
    if (card && field instanceof HTMLTextAreaElement) { field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`; }
  });
  thread.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-owner-option],[data-owner-answer]");
    const card = button?.closest<HTMLElement>("[data-owner-question]");
    const id = card?.dataset.ownerQuestion;
    if (!button || !card || !id || busy.has(id)) return;
    const field = card.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-owner-answer-input]");
    const answer = button.dataset.ownerAnswer === "cancel" ? null : button.dataset.ownerOption ?? field?.value.trim() ?? "";
    if (answer === "") return;
    busy.add(id);
    card.querySelectorAll<HTMLButtonElement>("button").forEach(control => { control.disabled = true; });
    if (field) field.disabled = true;
    void ownerQuestionAnswer(id, answer).then(changed).catch(error => {
      const notice = card.querySelector<HTMLElement>('[role="alert"]')!;
      notice.textContent = describeError(error); notice.hidden = false;
      card.querySelectorAll<HTMLButtonElement>("button").forEach(control => { control.disabled = false; });
      if (field) field.disabled = false;
      const submit = card.querySelector<HTMLButtonElement>('[data-owner-answer="text"]');
      if (submit) submit.disabled = !field?.value.trim();
      cardFailure(card, () => button.click());
    }).finally(() => { busy.delete(id); });
  });
}
