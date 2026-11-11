import { ownerQuestionHTML } from "./permission-card";
import type { AgentTurn } from "./types";

/** Share the answer-form card; choices submit ordinary owner words through the composer. */
export function greetingHTML(turn: AgentTurn, open: boolean): string {
  if (turn.route !== "greeting" || !open) return "";
  try {
    const data = JSON.parse(turn.detail || "null");
    if (data?.kind !== "greeting" || !Array.isArray(data.options) || data.options.length > 4 || !data.options.every((v: unknown) => typeof v === "string" && v.length <= 400)) return "";
    return ownerQuestionHTML({id: `greeting-${turn.id}`, task_id: 0, turn_id: turn.id, member_id: turn.member_id || 0,
      kind: "ask_owner", card_id: "", question: turn.text, options: data.options, free_text: true, state: "asked", result: null})
      .split("data-owner-").join("data-greeting-");
  } catch {return "";}
}

export function mountGreeting(thread: HTMLElement, send: (text: string) => void): void {
  thread.addEventListener("input", event => {
    const field = (event.target as Element).closest<HTMLInputElement>("[data-greeting-answer-input]");
    const submit = field?.closest(".owner-question")?.querySelector<HTMLButtonElement>('[data-greeting-answer="text"]');
    if (submit) { submit.disabled = !field!.value.trim(); submit.hidden = submit.disabled; }
  });
  thread.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-greeting-option],[data-greeting-answer]");
    const card = button?.closest<HTMLElement>("[data-greeting-question]");
    if (!button || button.disabled || !card) return;
    if (button.dataset.greetingAnswer === "cancel") {card.hidden = true; return;}
    const text = button.dataset.greetingOption ?? card.querySelector<HTMLInputElement>("[data-greeting-answer-input]")?.value.trim();
    if (text) send(text);
  });
  thread.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const target = event.target as Element, card = target.closest("[data-greeting-question]");
    if (!card) return;
    if (target.matches("input,textarea") && event.key === "Enter") {event.preventDefault(); card.querySelector<HTMLButtonElement>('[data-greeting-answer="text"]')?.click();}
    else if (!target.closest("input,textarea,[contenteditable=true]") && /^[a-d]$/i.test(event.key)) {
      event.preventDefault(); card.querySelectorAll<HTMLButtonElement>("[data-greeting-option]")[event.key.toUpperCase().charCodeAt(0) - 65]?.click();
    }
  });
}
