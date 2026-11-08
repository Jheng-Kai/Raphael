// What members said to each other: the centred line 「與 X 的 2 則訊息」 opens
// the real conversation in place of the thread, with a pill 「A ⇄ X」 on top, each message under its speaker's face and
// coloured name, day dividers, and 「關閉對話」 where the composer was. A hand-off is two messages: what one member sent
// (`request`) and what the other answered (`result`, with its files); an unfinished one ends on the other's state.
import { dayLabel } from "./format";
import { getLocale, t } from "./i18n";
import { messageHTML } from "./message-content";
import type { HandoffView } from "./types";
import { esc, ico, iconButton } from "./ui";

export interface PeerPerson { name: string; face: string; accent: string }
/** Member `id`'s name, 28 px face and name colour; `fallback` is the name the record carries. */
export type PeerPeople = (id: number, fallback: string) => PeerPerson;

export interface PeerLine { key: string; from: number; at: number; text: string; files: string[]; state?: string }

const STATES = { queued: "handoff.queued", running: "handoff.running", waiting: "handoff.waiting", withheld: "handoff.withheld" } as const;
const REASONS = { missing_artifact: "handoff.missingArtifact", artifact_changed: "handoff.changedArtifact", work_without_action: "handoff.noAction",
  missing_terminal: "handoff.invalidFinal", dangling_mention: "handoff.invalidFinal", cancelled: "handoff.cancelled" } as const;

export const peerKey = (task: HandoffView): string => String(task.task_id ?? `x${task.work_turn_id}`);

/** The quiet words that stand for the other side's answer while there is none. */
export function peerStateWords(task: HandoffView): string {
  if (task.waiting_owner) return t("ownerQuestion.waiting", { p0: task.waiting_owner });
  return t(STATES[task.state as keyof typeof STATES] ?? "handoff.failed");
}

/** Both sides of `tasks`, oldest first: each request from its sender, then the answer or the state it stands at. */
export function peerLines(tasks: readonly HandoffView[]): PeerLine[] {
  const lines: PeerLine[] = [];
  const ordered = [...new Map(tasks.map(task => [peerKey(task), task])).values()]
    .sort((a, b) => a.created_at_ms - b.created_at_ms || (a.task_id ?? 0) - (b.task_id ?? 0));
  for (const task of ordered) {
    const key = peerKey(task);
    const asked = task.request?.trim() ?? "";
    if (asked) lines.push({ key, from: task.from_member_id, at: task.created_at_ms, text: asked, files: [] });
    const files = task.evidence.filter(item => item.kind === "artifact" && item.uri).map(item => item.uri!.split("/").pop()!);
    const at = task.finished_at_ms ?? task.started_at_ms ?? task.created_at_ms;
    const answer = task.result.trim();
    if (task.state === "done" && (answer || files.length)) lines.push({ key, from: task.member_id, at, text: answer, files });
    else {
      const reason = REASONS[task.reason as keyof typeof REASONS];
      lines.push({ key, from: task.member_id, at, text: "", files: [], state: reason && task.state !== "done" ? `${peerStateWords(task)} · ${t(reason)}` : peerStateWords(task) });
    }
  }
  return lines;
}

/** How many messages the line counts: what was said, not the states standing in for an answer. */
export const peerCount = (tasks: readonly HandoffView[]): number => Math.max(1, peerLines(tasks).filter(line => !line.state).length);

const personHTML = (person: PeerPerson): string => `<span class="peer-person">${person.face}<b>${esc(person.name)}</b></span>`;

/** The view of `tasks` seen from `host`, the member whose conversation it opens in. */
export function peerChatHTML(host: number, tasks: readonly HandoffView[], people: PeerPeople, now = Date.now()): string {
  const named = new Map<number, string>();
  for (const task of tasks) { named.set(task.from_member_id, named.get(task.from_member_id) ?? ""); named.set(task.member_id, task.member_name); }
  const who = (id: number): PeerPerson => people(id, named.get(id) ?? "");
  const others = [...named.keys()].filter(id => id !== host);
  const list = new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" });
  const title = `${who(host).name} ⇄ ${list.format(others.map(id => who(id).name))}`;
  let day = "";
  const rows = peerLines(tasks).map(line => {
    const person = who(line.from), label = dayLabel(line.at, now);
    const divider = label !== day ? `<li class="day"><span>${esc(label)}</span></li>` : "";
    day = label;
    const body = line.state
      ? `<p class="peer-state" role="status">${esc(line.state)}</p>`
      : (line.text ? `<div class="chat-message"><div class="ans"><div class="message-text">${messageHTML(line.text, "", true)}</div></div></div>` : "") +
        (line.files.length ? `<ul class="handoff-files">${line.files.map(name => `<li>${ico("file")}<span>${esc(name)}</span></li>`).join("")}</ul>` : "");
    return divider + `<li class="tn peer-line" data-peer-key="${esc(line.key)}" data-peer-from="${line.from}"><div class="ra">` +
      `<span class="ra-face">${person.face}</span><div class="ra-body">` +
      `<b class="peer-who" style="--peer-accent:${esc(person.accent)}">${esc(person.name)}</b>${body}</div></div></li>`;
  }).join("");
  return `<div class="peer-head"><span class="peer-pill" role="heading" aria-level="2" aria-label="${esc(title)}">${personHTML(who(host))}` +
    `<span class="peer-swap">${ico("swap")}</span>${others.map(id => personHTML(who(id))).join("")}</span></div>` +
    `<div class="peer-scroll"><ol class="thread peer-thread">${rows}</ol></div>` +
    // The same 「跳至最新訊息」 button the conversations have; shown once the view is scrolled up.
    iconButton("down", t("chat.latest"), ' data-peer="latest" hidden', "conversation-latest peer-latest") +
    `<div class="peer-foot"><button type="button" class="btn peer-close" data-peer="close">${esc(t("peer.close"))}</button></div>`;
}

/**
 * The exchanges a line counts (`keys`, its `data-peer-keys`) with every other one between the same members in `all`,
 * and who sent the first: the member whose side the view takes. Null once `all` no longer has them.
 */
export function peerTasks(keys: string, all: readonly HandoffView[]): { tasks: HandoffView[]; host: number } | null {
  const wanted = new Set(keys.split(" ").filter(Boolean));
  const picked = all.filter(task => wanted.has(peerKey(task)));
  if (!picked.length) return null;
  const pairs = new Set(picked.map(task => `${task.from_member_id}:${task.member_id}`));
  return { tasks: all.filter(task => pairs.has(`${task.from_member_id}:${task.member_id}`)), host: picked[0]!.from_member_id };
}

export interface PeerChatView { readonly el: HTMLElement; update(): void; close(): void }

/**
 * Opens the conversation a line counts over `container` (the conversation column), scrolled to that exchange, and keeps it
 * current from `all` on `update`. It closes on its button or Esc, or when `all` no longer has the exchange (the owner
 * left the conversation), and gives the focus back to `trigger`.
 */
export function openPeerChat(container: HTMLElement, trigger: HTMLElement, all: () => readonly HandoffView[], people: PeerPeople, closed: () => void = () => {}): PeerChatView | null {
  const keys = trigger.dataset.peerKeys ?? "";
  const focus = keys.split(" ")[0] ?? "";
  const draw = (): string | null => { const found = peerTasks(keys, all()); return found ? peerChatHTML(found.host, found.tasks, people) : null; };
  if (!draw()) return null;
  container.querySelector(":scope > .peer-chat")?.remove();
  const el = document.createElement("div");
  el.className = "peer-chat";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  let drawn = "";
  const paint = (): void => {
    const html = draw();
    if (html === null) { close(); return; }
    if (html === drawn) return;
    const scroll = el.querySelector<HTMLElement>(".peer-scroll");
    const atEnd = !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 24;
    const top = scroll?.scrollTop ?? 0;
    el.innerHTML = drawn = html;
    el.setAttribute("aria-label", el.querySelector(".peer-pill")?.getAttribute("aria-label") ?? "");
    const next = el.querySelector<HTMLElement>(".peer-scroll")!;
    if (scroll) next.scrollTop = atEnd ? next.scrollHeight : top;
    sync();
  };
  const sync = (): void => {
    const scroll = el.querySelector<HTMLElement>(".peer-scroll"), latest = el.querySelector<HTMLButtonElement>("[data-peer='latest']");
    if (scroll && latest) latest.hidden = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 80;
  };
  el.addEventListener("scroll", sync, { capture: true, passive: true });
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    document.removeEventListener("keydown", key, true);
    el.remove();
    container.removeAttribute("data-peer-open");
    // A redraw of the thread may have put a new line in the trigger's place.
    const back = trigger.isConnected ? trigger : container.querySelector<HTMLElement>(`[data-peer-keys="${CSS.escape(keys)}"]`);
    back?.focus({ preventScroll: true });
    closed();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !el.isConnected) return;
    event.preventDefault(); event.stopPropagation();
    close();
  };
  el.addEventListener("click", event => {
    const target = event.target as Element;
    if (target.closest("[data-peer='latest']")) {
      event.stopPropagation();
      const scroll = el.querySelector<HTMLElement>(".peer-scroll")!;
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      return;
    }
    if (!target.closest("[data-peer='close']")) return;
    event.stopPropagation();
    close();
  });
  paint();
  container.dataset.peerOpen = "";
  container.append(el);
  document.addEventListener("keydown", key, true);
  const scroll = el.querySelector<HTMLElement>(".peer-scroll")!;
  const first = el.querySelector<HTMLElement>(`[data-peer-key="${CSS.escape(focus)}"]`);
  scroll.scrollTop = scroll.scrollHeight;
  if (first && first.offsetTop < scroll.scrollTop) scroll.scrollTop = Math.max(0, first.offsetTop - 24);
  sync();
  el.querySelector<HTMLElement>(".peer-close")!.focus({ preventScroll: true });
  return { el, update: () => { if (open) paint(); }, close };
}
