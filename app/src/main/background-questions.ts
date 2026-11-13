// The questions of the background: a task that needs the owner's yes pauses and waits, at most a day,
// for an answer here (the core's `background/service.py`). The shared permission card names the
// member and action in plain words, with Allow once first and Deny beside it.
// It is answered here only, never from a chat app (`background.answer`, which the core refuses from
// anywhere else).
//
// The cards are one self-contained element for one member's thread (`memberId`, 0 is Raphael): the
// page that has the thread puts `element` where the thread ends. It reads the questions that wait
// (`background.questions.list {member_id}`) when it is shown and whenever a background task moves
// on (`WorkerChanged`: the core tells it when a question opens and when it is answered).
// `backgroundQuestionHTML` draws one card from a question (pure, so it can be tested without a
// browser). Nothing here logs a question.

import { cardHTML, cardFailure } from "./card";
import { core } from "./api";
import { onAvatarChange } from "./avatar";
import { faceHTML, RAPHAEL_ID } from "./members";
import { describeError } from "./format";
import { onLocaleChange, t } from "./i18n";
import type { MainEvent, PermissionCard } from "./types";
import { permissionCardHTML } from "./permission-card";
import { esc, toaster } from "./ui";

/** A question that waits, as `background.questions.list` gives it. */
export interface BackgroundQuestion {
  id: string;
  task_id: number;
  member_id: number;
  prefix: string;
  text: string;
  tier: string | null;
  created_at_ms: number;
  expires_at_ms: number;
  permission?: PermissionCard;
}

/** What `background.answer` says became of an answer. */
export type AnswerStatus = "approved" | "denied" | "expired" | "cancelled" | "unknown" | string;

/**
 * Who asks in a thread: `name` is null for Raphael (his bare emblem), and a
 * member's name otherwise, with `face` that member's face (members.ts `faceHTML`, 22 px).
 */
export interface Asker {
  face: string;
  name: string | null;
}

/** Raphael's own: his face (the first blue slime, or the owner's picture), bare, and no name. */
const RAPHAEL: Asker = {
  get face() {
    return faceHTML({ id: RAPHAEL_ID, name: "" }, 22, { cls: "bgq-face" });
  },
  name: null,
};

/** One shared card, scoped to its originating member, with controls disabled during the answer. */
export function backgroundQuestionHTML(q: BackgroundQuestion, busy = false, asker: Asker = RAPHAEL): string {
  if (q.permission) return `<div data-bgq-card="${esc(q.id)}" data-task="${q.task_id}">${permissionCardHTML(q.permission, !busy, asker.name || t("agent.title"))}</div>`;
  const off = busy ? " disabled" : "";
  const ids = ` data-task="${q.task_id}" data-id="${esc(q.id)}"`;
  return cardHTML({ title: asker.name ? t("cards.permission", { p0: asker.name }) : t("perm.title"), status: "waiting", body: q.text,
    actions: `<button type="button" class="btn sm pri bgq-yes" data-bgq="yes"${ids}${off}>${esc(t("perm.once"))}</button>` +
      `<button type="button" class="btn sm bgq-no" data-bgq="no"${ids}${off}>${esc(t("perm.deny"))}</button>`,
    cls: "bgq-card", attrs: ` data-bgq-card="${esc(q.id)}"`,
  });
}

export interface BackgroundQuestionsHost {
  /** The member whose thread this is (0 is Raphael). */
  memberId(): number;
  /** The room whose questions these are, when they wait in a room rather than a member's thread. */
  roomId?(): number | undefined;
  threadId?(): number | undefined;
  /** Who asks in this thread (absent: Raphael). Read each time a card is drawn. */
  asker?(question?: BackgroundQuestion): Asker;
  /** The cards changed (one came or went): the page may keep its thread at the bottom. */
  changed?(): void;
}

export interface BackgroundQuestions {
  /** The cards, to be put where the thread ends. Empty (and hidden) while nothing waits. */
  element: HTMLElement;
  /** Read the questions that wait in this thread again. */
  load(): Promise<void>;
  /** The thread is another member's now: the cards of the last one go before this one's are read. */
  reset(): void;
  /** The cards are drawn again (the asker's name or face changed). */
  redraw(): void;
  /** An event of the window: a task that moved on may have asked, or been answered. */
  follow(event: MainEvent): void;
  /** The questions shown now, oldest first. */
  questions(): readonly BackgroundQuestion[];
}

/** Events that come together (a question and the move of its task) read the questions once. */
const REFRESH_DELAY_MS = 120;

export function createBackgroundQuestions(host: BackgroundQuestionsHost): BackgroundQuestions {
  const element = document.createElement("div");
  element.className = "bgq-list";
  element.hidden = true;
  let shown: BackgroundQuestion[] = [];
  const answering = new Set<string>();
  let loads = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The HTML each card was drawn from. */
  const drawn = new WeakMap<Element, string>();

  /** The cards that changed are drawn again; one that is the same is left alone (its movement is not replayed). */
  function draw(): void {
    const before = new Map<string, Element>();
    for (const card of [...element.children]) before.set((card as HTMLElement).dataset.bgqCard ?? "", card);
    const cards = shown.map((q) => {
      const html = backgroundQuestionHTML(q, answering.has(q.id), host.asker?.(q));
      const old = before.get(q.id);
      if (old && drawn.get(old) === html) return old;
      const made = document.createElement("template");
      made.innerHTML = html;
      const card = made.content.firstElementChild as HTMLElement;
      drawn.set(card, html);
      return card;
    });
    const changed = cards.length !== before.size || cards.some((card, n) => element.children[n] !== card);
    if (changed) element.replaceChildren(...cards);
    element.hidden = shown.length === 0;
    if (changed) host.changed?.();
  }

  function reset(): void {
    loads++; // a read still on its way belongs to the last thread
    shown = [];
    answering.clear();
    draw();
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    try {
      const room = host.roomId?.();
      const next = await core<{ questions: BackgroundQuestion[] }>("background.questions.list", room === undefined ? { member_id: host.memberId() } : { room_id: room, ...(host.threadId?.() === undefined ? {} : { thread_id: host.threadId!() }) });
      if (mine !== loads) return;
      shown = next?.questions ?? [];
    } catch {
      if (mine !== loads) return; // the cards that were there stay until the core answers again
    }
    draw();
  }

  async function answer(taskId: number, id: string, approved: boolean, choice?: string): Promise<void> {
    if (answering.has(id)) return;
    answering.add(id);
    draw();
    try {
      const permission = shown.find(q => q.id === id)?.permission;
      const reply = await core<{ status: AnswerStatus }>("background.answer", { task_id: taskId, question_id: id, approved,
        ...(permission ? { digest: permission.digest, always: choice === "perm-always", never: choice === "perm-never" } : {}) });
      if (reply.status !== "approved" && reply.status !== "denied") toaster.info(t("bgq.gone"));
    } catch (err) {
      const card = [...element.querySelectorAll<HTMLElement>("[data-bgq-card]")].find(card => card.dataset.bgqCard === id);
      if (!cardFailure(card ?? null, () => { void answer(taskId, id, approved, choice); })) toaster.info(describeError(err));
      answering.delete(id);
      card?.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
      return;
    }
    answering.delete(id);
    await load();
  }

  element.addEventListener("click", (e) => {
    const local = (e.target as Element | null)?.closest<HTMLButtonElement>('.permission-card [data-act]');
    if (local) {
      e.stopPropagation();
      if (local.disabled) return;
      const task = Number(local.closest<HTMLElement>("[data-task]")?.dataset.task);
      if (Number.isInteger(task)) void answer(task, local.dataset.card ?? "", ["perm-always", "perm-once"].includes(local.dataset.act ?? ""), local.dataset.act);
      return;
    }
    const button = (e.target as Element | null)?.closest<HTMLButtonElement>("[data-bgq]");
    if (!button || button.disabled) return;
    const taskId = Number(button.dataset.task);
    const id = button.dataset.id ?? "";
    if (!Number.isInteger(taskId) || !id) return;
    void answer(taskId, id, button.dataset.bgq === "yes");
  });

  function follow(event: MainEvent): void {
    if (event.type !== "WorkerChanged" || (event.state === "running" && !shown.some(question => question.task_id === event.task_id))) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void load();
    }, REFRESH_DELAY_MS);
  }

  onLocaleChange(draw);
  onAvatarChange(draw);

  return { element, load, reset, redraw: draw, follow, questions: () => shown };
}
