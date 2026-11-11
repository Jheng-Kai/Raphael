// What the owner has done inside a question card that waits (the rows chosen on a several-choice card, the words typed in
// its own-answer row) decides which of its buttons show and work. It is drawn from the card's own fields, never kept
// elsewhere, so a card drawn again (carryTyped) shows the same by calling this once.

/** The labels of the rows chosen on a several-choice card, in the order the rows stand. */
export const chosenOptions = (card: Element): string[] =>
  [...card.querySelectorAll<HTMLElement>('[data-owner-option][aria-checked="true"]')].map(row => row.dataset.ownerOption!);

/** Shows the pill beside the own-answer row once something is typed, and enables a several-choice card's submit once a row is chosen or something is typed. */
export function syncQuestionCard(card: Element, busy = false): void {
  const typed = !!card.querySelector<HTMLTextAreaElement>("[data-owner-answer-input]")?.value.trim();
  const pill = card.querySelector<HTMLButtonElement>('[data-owner-answer="text"]');
  if (pill) { pill.hidden = !typed; pill.disabled = busy || !typed; }
  const choices = card.querySelector<HTMLButtonElement>('[data-owner-answer="choices"]');
  if (choices) choices.disabled = busy || (!typed && chosenOptions(card).length === 0);
}
