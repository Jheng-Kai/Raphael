// The place a page takes in a conversation (owner, 2026-11-11: 「我要的不是像是這樣子會出現一個 dialog，我要的應該是像是 Grokbot
// 這樣子直接顯示在對話裡，它就是會直接替代掉對話，就是內部的顯示器的感覺…左上角會變成返回上頁」). A page, an HTML page or a
// report, a member's or a group's, opens in the thread's place in the conversation's stage, above the composer that stays
// where it is. The thread keeps its layout and scroll underneath, hidden, so going back finds it where it was. The way back
// is the round arrow at the header's top left (Escape goes back too); nothing about the page is a dialog, and no scrim.
// What the member answers to a message written while a page is open shows under the page: a line while it works, then
// the first words of its reply, which the arrow brings in full.
// Since 2026-11-14 (R-PAGE-08; owner, with a page opened from Grok Bot's Library: 「它會直接打開那個檔案本身…然後它有一個share的鍵」) the open
// page is the whole area right of the sidebar, as Grok Bot's: the header's centre becomes the page's own pill (its mark and
// title) while it stands, its Share button is at the right, and the area scrolls as one.
import "./page-view.css";
import { cancelGesture } from "../shared/cancel-gesture";
import * as api from "./api";
import { t } from "./i18n";
import { type IconName, esc, ico, iconButton } from "./ui";

export interface PageViewOpen {
  id: string;
  title: string;
  kind: "page" | "report";
  /** What gets the focus back when the page is put away. */
  opener?: HTMLElement | null;
  /**
   * The one thing this page can be passed on by (Share: a report or an HTML page is saved as a file). It stands at the
   * header's top right, where the thread's own share stands, as the round button every header tool is: one place for what is
   * on screen, as Grok Bot's share (owner, 2026-11-12: 「位置要特別設計過 外觀也是」). A page with none (a plugin's) leaves that
   * place empty.
   */
  action?: { icon: IconName; label: string; run(): void };
  /** The page's content is put away (a frame goes back to its card). The view itself is already closed. */
  leave(): void;
}

export interface PageView {
  /** Where a page puts its content. */
  readonly body: HTMLElement;
  /** Shows the page in the thread's place. The same page again only renames it. */
  open(page: PageViewOpen): void;
  /** The thread is back where it was. */
  close(): void;
  shown(): { id: string; kind: "page" | "report"; title: string } | null;
  /** `done` runs once, after the page now open (or the next one to open) is put away and its content has left. */
  watchClose(done: () => void): void;
  /**
   * The owner is sending something. The page stays; the core is told which page stands open beside the message
   * (before it is sent, so the member that answers knows what "here" means), and the reply is waited for under it. Nothing
   * to tell (no page open now or before) answers null, so the send itself does not wait.
   */
  sent(): Promise<void> | null;
}

/** The page last told to the core: every pane shares the one answer, as the core holds one. */
let told: string | null = null;

/** Tells the core which page stands open beside the composer; what the owner writes goes all the same if it cannot. */
export function tellPage(id: string | null): Promise<void> | null {
  if (id === null && told === null) return null;
  return api.pagesViewing(id).then(() => { told = id; }, () => { /* the message goes anyway */ });
}

const clip = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 240);

/** What an open page takes from the window and gives back: the details panel folds while it stands (R-PAGE-08). */
export interface PageShell { fold(): void; unfold(): void }

export function mountPageView(stage: HTMLElement, shell?: PageShell): PageView {
  const pane = stage.parentElement;
  const thread = stage.querySelector<HTMLElement>(".thread");
  let view: HTMLElement | null = null;
  let body: HTMLElement;
  let status: HTMLElement;
  let back: HTMLButtonElement | null = null;
  let tools: HTMLElement | null = null;
  let act: HTMLButtonElement | null = null;
  let pill: HTMLElement | null = null;
  const closing: (() => void)[] = [];
  let current: PageViewOpen | null = null;
  /** A message was sent with this page open, and the reply that is not the last one yet is the answer. */
  let awaiting: { baseline: string } | null = null;
  let observer: MutationObserver | null = null;
  let frame = 0;
  // Escape belongs to a task's Stop first (R-UI-46) and to a recording: that gesture's own listener runs before ours.
  const gesture = cancelGesture();

  /** The words of the newest reply in the thread: what the member said, not the owner. */
  const lastReply = (): string => {
    const words = [...(thread?.querySelectorAll<HTMLElement>(".message-text") ?? [])].filter(item => !item.closest(".owner-message, .me"));
    return clip(words[words.length - 1]?.textContent ?? "");
  };

  function drawStatus(): void {
    frame = 0;
    if (!current || !view) return;
    // The thread's own working line, in its words alone: whose conversation it is stands in the header, and the face is the thread's.
    const working = thread?.querySelector<HTMLElement>(".live-presence .live-action")?.textContent?.trim();
    let html = "";
    if (awaiting && working) html = `<div class="live-presence pgv-live"><span class="live-action">${esc(working)}</span></div>`;
    else if (awaiting) {
      const words = lastReply();
      if (words && words !== awaiting.baseline) html = `<p class="pgv-reply">${esc(words)}</p>`;
    }
    status.hidden = !html;
    // A refresh that changes nothing touches nothing.
    const same = status.dataset.drawn === html;
    if (!same) { status.dataset.drawn = html; status.innerHTML = html; }
  }
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(drawStatus); };

  function element(): HTMLElement {
    if (view) return view;
    view = document.createElement("div");
    view.className = "pgv";
    view.setAttribute("role", "region");
    view.hidden = true;
    view.innerHTML = `<div class="pgv-body"></div><div class="pgv-status" role="status" hidden></div>`;
    body = view.querySelector<HTMLElement>(".pgv-body")!;
    status = view.querySelector<HTMLElement>(".pgv-status")!;
    stage.insertBefore(view, stage.querySelector(":scope > .ra-dock"));
    // The way back stands at the header's top left, where the search stood: the conversation header's round edge button.
    const slot = pane?.querySelector<HTMLElement>(":scope > .mb-head .mb-head-l, :scope > .mb-head .room-picker");
    if (slot) {
      slot.insertAdjacentHTML("afterbegin", iconButton("left", t("chooser.back"), ' data-page-back data-nav-back hidden', "ra-tool pgv-back"));
      back = slot.querySelector<HTMLButtonElement>("[data-page-back]");
      back!.addEventListener("click", () => close());
    }
    tools = pane?.querySelector<HTMLElement>(":scope > .mb-head .ra-tools") ?? null;
    // The header's centre says which page this is while it stands, as Grok Bot's pill does: the page's mark and its title. A
    // room's centre is its own name and faces, which stay.
    const centre = pane?.querySelector<HTMLElement>(":scope > .mb-head .mb-head-c");
    if (centre) {
      centre.insertAdjacentHTML("beforeend", '<span class="pgv-pill" hidden></span>');
      pill = centre.querySelector<HTMLElement>(":scope > .pgv-pill");
    }
    return view;
  }

  function drawPill(): void {
    if (!pill) return;
    pill.hidden = !current;
    pill.innerHTML = current ? `${ico("report")}<span class="pgv-pill-t">${esc(current.title)}</span>` : "";
  }

  /** The open page's own button, first in the header's tools at the right; none for a page that has nothing to pass on. */
  function drawAction(): void {
    act?.remove();
    act = null;
    const action = current?.action;
    if (!action || !tools) return;
    tools.insertAdjacentHTML("afterbegin", iconButton(action.icon, action.label, " data-page-act", "ra-tool pgv-act"));
    act = tools.querySelector<HTMLButtonElement>(":scope > [data-page-act]");
    act!.addEventListener("click", () => current?.action?.run());
  }

  function open(page: PageViewOpen): void {
    const host = element();
    const same = current?.id === page.id && !host.hidden;
    current = page;
    host.setAttribute("aria-label", page.title);
    stage.dataset.pageKind = page.kind;
    drawPill();
    // The same page again (a placeholder that is now the page) takes the new content's way out and Share.
    if (same) { drawAction(); return; }
    awaiting = null;
    status.hidden = true;
    status.replaceChildren();
    delete status.dataset.drawn;
    host.hidden = false;
    shell?.fold();
    stage.classList.add("is-page");
    if (back) { back.hidden = false; back.setAttribute("aria-label", t("chooser.back")); back.title = t("chooser.back"); }
    drawAction();
  }

  function close(): void {
    const page = current;
    if (!page || !view) return;
    current = null;
    awaiting = null;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    view.hidden = true;
    status.hidden = true;
    status.replaceChildren();
    delete status.dataset.drawn;
    stage.classList.remove("is-page");
    delete stage.dataset.pageKind;
    if (back) back.hidden = true;
    drawPill();
    drawAction();
    page.leave();
    shell?.unfold();
    if (page.opener?.isConnected) page.opener.focus({ preventScroll: true });
    for (const done of closing.splice(0)) done();
  }

  /** Back to the conversation: Escape, when nothing else owns it. */
  window.addEventListener("keydown", event => {
    if (!current || event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.repeat) return;
    if (stage.closest("[hidden]") || !stage.isConnected) return;
    // A menu, a dialog or a list has its own Escape; a task's Stop or a recording takes it first.
    if ([...document.querySelectorAll('#app-popover, .mb-scrim, .modal-scrim, [role="dialog"], [role="menu"], [role="listbox"]')].some(layer => !layer.closest("[hidden], [inert]"))) return;
    if (gesture.hasTarget()) return;
    event.preventDefault();
    close();
  });

  return {
    get body() { element(); return body; },
    open,
    close,
    shown: () => (current ? { id: current.id, kind: current.kind, title: current.title } : null),
    watchClose: done => { closing.push(done); },
    sent() {
      const id = current?.id ?? null;
      if (current) {
        awaiting = { baseline: lastReply() };
        // What the thread does from now on (the member's working line, then its reply) is what shows under the page.
        if (thread) (observer ??= new MutationObserver(schedule)).observe(thread, { childList: true, subtree: true, characterData: true });
        schedule();
      }
      // Said again at every send while a page is open (the core's word never outlives the window's), and once when it is put away.
      return tellPage(id);
    },
  };
}
