// The place a page takes in a conversation (owner, 2026-11-11: 「我要的不是像是這樣子會出現一個 dialog，我要的應該是像是 Grokbot
// 這樣子直接顯示在對話裡，它就是會直接替代掉對話，就是內部的顯示器的感覺…左上角會變成返回上頁」). A page, an HTML page or a
// report, a member's or a group's, opens in the thread's place in the conversation's stage, above the composer that stays
// where it is. The thread keeps its layout and scroll underneath, hidden, so going back finds it where it was. The way back
// is the round arrow at the header's top left (Escape goes back too); nothing about the page is a dialog, and no scrim.
// What the member answers to a message written while a page is open shows under the page: a line while it works, then
// the first words of its reply, which the arrow brings in full.
import "./page-view.css";
import { cancelGesture } from "../shared/cancel-gesture";
import * as api from "./api";
import { t } from "./i18n";
import { esc, iconButton } from "./ui";

export interface PageViewOpen {
  id: string;
  title: string;
  kind: "page" | "report";
  /** What gets the focus back when the page is put away. */
  opener?: HTMLElement | null;
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
  shown(): { id: string; kind: "page" | "report" } | null;
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

export function mountPageView(stage: HTMLElement): PageView {
  const pane = stage.parentElement;
  const thread = stage.querySelector<HTMLElement>(".thread");
  let view: HTMLElement | null = null;
  let body: HTMLElement;
  let status: HTMLElement;
  let back: HTMLButtonElement | null = null;
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
      slot.insertAdjacentHTML("afterbegin", iconButton("left", t("chooser.back"), ' data-page-back hidden', "ra-tool pgv-back"));
      back = slot.querySelector<HTMLButtonElement>("[data-page-back]");
      back!.addEventListener("click", () => close());
    }
    return view;
  }

  function open(page: PageViewOpen): void {
    const host = element();
    const same = current?.id === page.id;
    current = page;
    host.setAttribute("aria-label", page.title);
    if (same && !host.hidden) return;
    awaiting = null;
    status.hidden = true;
    status.replaceChildren();
    delete status.dataset.drawn;
    host.hidden = false;
    stage.classList.add("is-page");
    stage.dataset.pageKind = page.kind;
    if (back) { back.hidden = false; back.setAttribute("aria-label", t("chooser.back")); back.title = t("chooser.back"); }
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
    page.leave();
    if (page.opener?.isConnected) page.opener.focus({ preventScroll: true });
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
    shown: () => (current ? { id: current.id, kind: current.kind } : null),
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
