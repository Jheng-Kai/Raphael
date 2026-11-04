import { ownerQuestionBring } from "./api";
import { describeError } from "./format";
import { onLocaleChange, t } from "./i18n";
import type { OwnerQuestion } from "./types";
import { btn, esc, ico, openMenu } from "./ui";

interface PendingQuestion { id: string; title: string; card?: HTMLElement }
export function mountPendingQuestions(thread: HTMLElement, scroller: HTMLElement, changed: () => Promise<void>, questions: () => readonly OwnerQuestion[] = () => []): { sync(): void } {
  const row = document.createElement("div");
  row.className = "pending-questions";
  row.hidden = true;
  scroller.before(row);
  let cards: PendingQuestion[] = [], busy = false, queued = false, stamp = "", failure = "";
  let brought: { id: string; turn: number } | undefined;
  const sync = (): void => {
    if (brought) {
      const moved = [...thread.querySelectorAll<HTMLElement>("[data-owner-question]")].find(card => card.dataset.ownerQuestion === brought!.id && Number(card.dataset.ownerTurn) === brought!.turn);
      if (moved) {
        brought = undefined;
        moved.scrollIntoView({ block: "end", behavior: "instant" });
        moved.focus({ preventScroll: true });
      }
    }
    const viewport = scroller.getBoundingClientRect();
    const mounted = [...thread.querySelectorAll<HTMLElement>('[data-owner-kind="ask_owner"]')];
    cards = mounted.filter(card => {
      if (card.dataset.cardState !== "asked") return false;
      const bounds = card.getBoundingClientRect();
      return bounds.bottom <= viewport.top + 40 || bounds.top >= viewport.bottom;
    }).map(card => ({ id: card.dataset.ownerQuestion!, title: card.querySelector(".card-title")?.textContent ?? "", card }));
    for (const question of questions()) if (question.state === "asked" && question.kind === "ask_owner" && !mounted.some(card => card.dataset.ownerQuestion === question.id)) cards.push({ id: question.id, title: question.question });
    row.hidden = !cards.length || !!scroller.closest("[hidden]");
    const title = cards[0]?.title ?? "";
    const label = t("ownerQuestion.waiting", { p0: cards.length });
    const next = JSON.stringify([cards.map(card => card.id), title, label, busy, failure]);
    if (stamp === next) return;
    stamp = next;
    row.innerHTML = btn(`${ico("chat")}<span class="pending-question-title">${esc(title)}</span><span class="pending-question-mark">${esc(label)}</span>${ico("down")}`, "sm pending-question", `${busy ? " disabled" : ""}${cards.length > 1 ? ' aria-haspopup="menu"' : ""}`) + `<p role="alert"${failure ? "" : " hidden"}>${esc(failure)}</p>`;
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };
  async function bring(question: PendingQuestion): Promise<void> {
    const current = (): boolean => !!(question.card && thread.contains(question.card)) || questions().some(item => item.id === question.id);
    if (busy || !current()) return;
    busy = true; failure = ""; sync();
    const id = question.id;
    try {
      const result = await ownerQuestionBring(id);
      // A navigation while the call was in flight must not pull the new conversation down.
      if (!current()) return;
      brought = { id, turn: result.turn_id };
      await changed();
    } catch (error) {
      failure = describeError(error);
    } finally { busy = false; schedule(); }
  }
  row.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button || busy) return;
    if (cards.length === 1) void bring(cards[0]);
    else openMenu(button, cards.map(card => ({ value: card.id, label: card.title })), "", id => {
      const card = cards.find(item => item.id === id);
      if (card) void bring(card);
    });
  });
  scroller.addEventListener("scroll", schedule, { passive: true });
  new MutationObserver(schedule).observe(thread, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-card-state", "data-owner-turn"] });
  if (typeof ResizeObserver === "function") {
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller); resize.observe(thread);
  }
  onLocaleChange(schedule);
  schedule();
  return { sync: schedule };
}
