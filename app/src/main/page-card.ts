// A page a member shows in the conversation, a product page or a small tool, or one a plugin brings (`agent/pages.py`).
// It runs from the core's own loopback host in a sandbox with an opaque origin, so it reaches neither the app nor the
// core: it can only post messages to the frame's parent, and everything it asks for is checked here. A thread redraw
// moves the live frame to the new card, so a page does not reload and lose what the owner did in it. Pressed, a card opens
// its page in the conversation's place (`page-view.ts`): the same frame moves there and, going back, returns to its card.
import "./page-card.css";
import { cardFailure, cardHTML, cardStatusHTML, failedClose } from "./card";
import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { cancelGesture } from "../shared/cancel-gesture";
import { mountPageView, tellPage, type PageShell, type PageView } from "./page-view";
import { mountReportView, type ReportPeople, type ReportView } from "./report-page";
import type { AgentTurn, PageCard, PageOpened } from "./types";
import { btn, esc, ico, toaster } from "./ui";

const MIN_HEIGHT = 80, MAX_HEIGHT = 2400;
/** A page open in the whole area is as tall as its content, up to this (core agent/pages.py's helper); its card keeps `MAX_HEIGHT`. */
const FULL_MAX_HEIGHT = 20000;
const SEND_LIMIT = 4000, SEND_GAP_MS = 1000;
/** How long a page asked for by its id waits for its card to be in the thread and ready. */
const CARD_WAIT_MS = 10000;
const MCP_PROTOCOL = "2026-01-26";

/** A report's link card, as Grok Bot's Page: the same card as a file a member made, its icon, its title and 「頁面」. */
const reportLinkHTML = (page: PageCard): string =>
  `<button type="button" class="btn attachment-file pg-link" data-page-act="report" data-page="${esc(page.id)}" data-page-rev="${page.rev}">` +
  `${ico("report")}<span class="attachment-name"><span class="me-file-t">${esc(page.title)}</span><small>${esc(t("page.kind"))}</small></span></button>`;

/** A page that failed reads as a failed mail card: what failed in the card's body line, then what it knows of the page
 *  (the member's plain words) in a well where the page stood, then 再試一次 below (the judge on page-gone, 2026-11-10). */
function failedHTML(page: PageCard): string {
  const words = page.fallback?.trim();
  return `<div class="pg-failed" hidden><p class="card-body cc-state" role="alert">${esc(t("page.failed"))}</p>` +
    (words ? `<p class="card-well pg-fallback">${esc(words)}</p>` : "") +
    `<div class="card-actions">${btn(esc(t("page.retry")), "sm pri", ' data-page-act="retry"')}</div></div>`;
}

/** The cards a turn shows, below what it said. A card holds no frame: `mountPages` brings it. A report is a link card.
 *  A page is a card of one fixed height (`--h-page-peek`) whatever it holds or whether it is loading, ready or failed: its
 *  title row and, under it, only the top of the page, clipped and faded into the card (owner, 2026-11-11: a page shown
 *  whole made one very long block). The preview is one control: pressing it, or Enter or Space on it, opens the page whole
 *  (`expand`), where it scrolls and its buttons work. It is a control only once the page is ready. */
export function pageCardsHTML(turn: AgentTurn): string {
  return (turn.pages ?? []).map(page => page.kind === "report" ? reportLinkHTML(page) : cardHTML({ title: page.title, status: "ready",
    content: `<div class="pg-body" data-state="loading" data-page-act="expand" role="button" aria-disabled="true" aria-label="${esc(t("page.open", { title: page.title }))}">` +
      `<span class="pg-more" aria-hidden="true">${ico("expand")}</span></div>${failedHTML(page)}`,
    cls: "pg-card",
    attrs: ` data-page="${esc(page.id)}" data-page-rev="${page.rev}" style="--pg-h:${clampHeight(page.height)}px"`,
  })).join("");
}

const clampHeight = (height: unknown, max = MAX_HEIGHT): number => {
  const value = Number(height);
  return Number.isFinite(value) ? Math.min(max, Math.max(MIN_HEIGHT, Math.ceil(value))) : 320;
};

/** The app hears nothing once the pointer is over a frame of another origin (measured in the real app: no event, and no
 *  `:hover`), so where it last heard the pointer is the nearest thing it knows: a fast move covers this much between two
 *  events. */
const POINTER_REACH = 96;
let lastInput: { kind: "move" | "press" | "tab" | "key"; x: number; y: number } | null = null;
let hearing = false;

function hearInput(): void {
  if (hearing) return;
  hearing = true;
  const heard = (kind: "move" | "press") => (event: Event): void => {
    const { clientX: x, clientY: y } = event as PointerEvent;
    lastInput = { kind, x, y };
  };
  window.addEventListener("pointermove", heard("move"), { capture: true, passive: true });
  window.addEventListener("pointerdown", heard("press"), { capture: true, passive: true });
  window.addEventListener("keydown", event => { lastInput = { kind: event.key === "Tab" ? "tab" : "key", x: 0, y: 0 }; }, { capture: true, passive: true });
}

/** No press at all, or none in this frame: a press elsewhere in the app activates it too, and a page can take the focus by
 *  itself (both seen in the real app). The pointer it cannot move. */
function pressOf(frame: HTMLIFrameElement): "none" | "unsure" | "sure" {
  if (navigator.userActivation?.isActive !== true || document.activeElement !== frame) return "none";
  if (lastInput?.kind === "tab") return "sure";
  if (lastInput?.kind !== "move") return "unsure";
  const box = frame.getBoundingClientRect(), { x, y } = lastInput;
  return x >= box.left - POINTER_REACH && x <= box.right + POINTER_REACH && y >= box.top - POINTER_REACH && y <= box.bottom + POINTER_REACH ? "sure" : "unsure";
}

const themeNow = (): "dark" | "light" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

interface Live {
  id: string;
  rev: number;
  frame: HTMLIFrameElement;
  height: number | null;
  /** What it says it is as tall as in the whole area (not cut at its card's height), and the box that holds it there. */
  full: number | null;
  box: HTMLElement | null;
  opened: PageOpened | null;
  ready: boolean;
  /** It could not open: a redraw of its line shows that again, not an empty box that never loads. */
  failed: boolean;
  /** It stands in the conversation's place (page-view.ts), not in its card. */
  expanded: boolean;
  /** Where the owner was reading it there (how far the area is scrolled), kept for the next time it opens. */
  reading: number;
  /** A changed page loading beside the one on screen, which it replaces once it is ready, and the height it says. */
  next: HTMLIFrameElement | null;
  nextFull: number | null;
  /** A declined external link asks no more without a sure press. */
  refused: boolean;
}

/** Only an atomic move keeps a frame running; a plain append reloads it, which is still better than losing it. A frame in
 *  a card is only a preview: nothing in it can be pressed, focused or scrolled; it works only where the page is made larger. */
function moveFrame(frame: HTMLIFrameElement, target: HTMLElement): void {
  frame.toggleAttribute("inert", !target.closest(".pgv"));
  if (target.moveBefore && frame.isConnected) target.moveBefore(frame, null);
  else target.append(frame);
}

export interface PagesHost {
  /** Every card in the thread has its frame; an open report follows its card. */
  sync(): void;
  /** Before a line is replaced: moves its frames to the new line, once that line is in the document. */
  carry(from: Element, to: Element): () => void;
  /** The owner is sending something: an open page stays, the core is told which page it is, and its reply is waited for under it. */
  sent(): Promise<void> | null;
  /** Puts an open page away, so the thread is in sight again. */
  close(): void;
  /** The page open now, an HTML page or a report. */
  shown(): { id: string; kind: "page" | "report" } | null;
  /**
   * Opens page `id` whole, from wherever its card stands in the thread (the Library's press, R-PAGE-08): the view stands at
   * once with the page's title, and the page takes its place when its card is in the thread and ready. `done` runs once the
   * page is put away, however it was. Answers whether the page opened; a page whose card never came or that cannot be
   * read leaves nothing open (and `done` has run).
   */
  show(id: string, title: string, done: () => void): Promise<boolean>;
}

export function mountPages(thread: HTMLElement, o: { place(pageId: string, text: string): boolean; people?: () => ReportPeople; shell?: PageShell }): PagesHost {
  const frames = new Map<string, Live>();
  let lastSend = 0, asking = false;
  /** A page asked for by its id (`show`) whose card is not in the thread yet: its view stands, empty, until it is. */
  let waiting: string | null = null;
  hearInput();
  // A page, a report or an HTML page, opens in the thread's place: in the conversation's stage, above the composer that stays below it.
  let pageView: PageView | null = null;
  const view = (): PageView => pageView ??= mountPageView(thread.closest<HTMLElement>(".ra-stage") ?? thread.parentElement!, o.shell);
  let reports: ReportView | null = null;
  const reportView = (): ReportView => reports ??= mountReportView(view(), o.people ?? (() => ({ nameOf: () => "", colorOf: () => "var(--text-3)" })));

  const cardOf = (live: Live): HTMLElement | null => thread.querySelector<HTMLElement>(`.pg-card[data-page="${CSS.escape(live.id)}"]`);

  function setBodyState(live: Live, state: "loading" | "ready" | "failed"): void {
    const card = cardOf(live);
    if (!card) return;
    const pill = card.querySelector(".card-status")!;
    const next = state === "failed" ? "failed" : "ready";
    if (!pill.classList.contains(`is-${next}`)) pill.outerHTML = cardStatusHTML(next);
    const body = card.querySelector<HTMLElement>(".pg-body")!;
    body.dataset.state = state;
    body.hidden = state === "failed";
    // The preview is a control only once there is a page to open.
    if (state === "ready") { body.tabIndex = 0; body.removeAttribute("aria-disabled"); }
    else { body.removeAttribute("tabindex"); body.setAttribute("aria-disabled", "true"); }
    card.querySelector<HTMLElement>(".pg-failed")!.hidden = state !== "failed";
    // The × that puts a failed page away (R-UI-117) is in the heading only while it failed: a hidden one was taken by the
    // shared failure of a link the page could not open, which was then left with no × to put it away.
    const head = card.querySelector<HTMLElement>(":scope > .card-head")!, close = head.querySelector(":scope > [data-card-failed-close]");
    if (state === "failed" && !close) head.insertAdjacentHTML("beforeend", failedClose());
    else if (state !== "failed") close?.remove();
  }

  /** A page is as tall as it says, in its card's preview. In the conversation's place it fills it and says nothing the card
   *  follows: the card keeps its own height until the page is back and says so there, narrow again. */
  function applyHeight(live: Live): void {
    if (live.expanded) { live.box?.style.setProperty("--pgv-h", `${live.full ?? live.height ?? MIN_HEIGHT}px`); return; }
    if (live.height !== null) cardOf(live)?.style.setProperty("--pg-h", `${live.height}px`);
  }
  const heard = (live: Live, height: unknown): void => { live.height = clampHeight(height); live.full = clampHeight(height, FULL_MAX_HEIGHT); };

  async function open(live: Live): Promise<void> {
    live.ready = false;
    live.failed = false;
    setBodyState(live, "loading");
    try {
      const opened = await api.pagesOpen(live.id, themeNow());
      if (frames.get(live.id) !== live) return;
      live.opened = opened;
      live.frame.title = opened.title;
      live.frame.src = opened.url;
    } catch {
      if (frames.get(live.id) !== live) return;
      live.failed = true;
      setBodyState(live, "failed");
    }
  }

  function newFrame(live: Live): HTMLIFrameElement {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.className = "pg-frame";
    frame.setAttribute("inert", "");
    frame.addEventListener("load", () => { if (live.opened) setBodyState(live, "ready"); });
    return frame;
  }

  function make(id: string, rev: number): Live {
    const live = { id, rev, height: null, full: null, box: null, opened: null, ready: false, failed: false, expanded: false, reading: 0, next: null, nextFull: null, refused: false } as unknown as Live;
    live.frame = newFrame(live);
    frames.set(id, live);
    return live;
  }

  /**
   * The page changed while it stands in the conversation's place (its member updated it): the new one loads beside the one
   * on screen, is put back where the owner was reading, and takes its place once it has drawn, so nothing closes, flashes or
   * jumps (owner, 2026-11-11). A page that cannot be read again stays as it was.
   */
  async function replaceInPlace(live: Live): Promise<void> {
    let opened: PageOpened;
    try { opened = await api.pagesOpen(live.id, themeNow()); } catch { return; }
    const box = live.frame.parentElement;
    if (frames.get(live.id) !== live || !box) return;
    // The owner went back while it was read: the card's page is the one to change.
    if (!live.expanded) { void open(live); return; }
    live.next?.remove();
    live.opened = opened;
    live.nextFull = null;
    const next = newFrame(live);
    live.next = next;
    next.removeAttribute("inert");
    next.title = opened.title;
    next.style.visibility = "hidden";
    let done = false;
    const swap = (): void => {
      if (done || live.next !== next) return;
      done = true;
      live.next = null;
      const old = live.frame;
      live.frame = next;
      // The area keeps its scroll, so the owner stays where they were reading; the changed page says how tall it is.
      if (live.nextFull !== null) { live.full = live.nextFull; live.height = Math.min(MAX_HEIGHT, live.nextFull); live.nextFull = null; applyHeight(live); }
      next.style.visibility = "";
      old.remove();
    };
    // Once it has drawn: a frame later, so the first paint of the changed page is what takes the place.
    next.addEventListener("load", () => { requestAnimationFrame(swap); setTimeout(swap, 250); });
    box.append(next);
    next.src = opened.url;
  }

  function sync(): void {
    const seen = new Set<string>();
    for (const card of thread.querySelectorAll<HTMLElement>(".pg-card[data-page]")) {
      const id = card.dataset.page!, rev = Number(card.dataset.pageRev);
      seen.add(id);
      const body = card.querySelector<HTMLElement>(".pg-body")!;
      const live = frames.get(id);
      if (!live) {
        const fresh = make(id, rev);
        body.append(fresh.frame);
        void open(fresh);
        continue;
      }
      if (!live.expanded && live.frame.parentElement !== body) body.append(live.frame);
      applyHeight(live);
      if (live.failed) setBodyState(live, "failed");
      else if (live.ready || live.opened) setBodyState(live, "ready");
      if (live.rev !== rev) { live.rev = rev; void (live.expanded ? replaceInPlace(live) : open(live)); }
    }
    for (const id of [...frames.keys()]) if (!seen.has(id)) frames.delete(id);
    followPage();
  }

  /** An open page closes when its card left the thread (another conversation, or none), and a report follows its member's changes. */
  function followPage(): void {
    const shown = pageView?.shown();
    if (!shown || waiting === shown.id) return;
    if (shown.kind === "page") {
      if (!thread.querySelector(`.pg-card[data-page="${CSS.escape(shown.id)}"]`)) pageView!.close();
      return;
    }
    const open = reports?.shown();
    const link = thread.querySelector<HTMLElement>(`.pg-link[data-page="${CSS.escape(shown.id)}"]`);
    if (!link) reports?.close();
    else if (open && Number(link.dataset.pageRev) !== open.rev) void reports!.refresh();
  }
  // A thread emptied or redrawn without a sync (a conversation that is loading, empty or failed) is followed too.
  new MutationObserver(followPage).observe(thread, { childList: true });

  function carry(from: Element, to: Element): () => void {
    const moves = [...from.querySelectorAll<HTMLElement>(".pg-card[data-page]")].flatMap(card => {
      const frame = card.querySelector("iframe"), target = to.querySelector<HTMLElement>(`.pg-card[data-page="${CSS.escape(card.dataset.page!)}"] .pg-body`);
      return frame && target ? [{ frame, target }] : [];
    });
    return () => {
      for (const { frame, target } of moves) moveFrame(frame, target);
    };
  }

  /** A press that cannot be told from the page acting alone is the owner's to confirm, with the words in front of them. */
  function whenPressed(live: Live, title: "page.askOpen", shown: string, act: () => void): void {
    const press = pressOf(live.frame);
    if (press === "sure") { act(); return; }
    if (press === "none" || asking || live.refused) return;
    asking = true;
    openDialog({
      title: t(title), body: `<p class="pg-ask-words">${esc(shown)}</p>`, cls: "mb-confirm pg-ask",
      actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("page.askYes")), attrs: ' data-dlg="yes"' } },
      onAct(action, _target, dialog) {
        if (action === "yes") act(); else live.refused = true;
        dialog.close();
      },
      onClose() { asking = false; },
    });
  }

  function placeText(live: Live, text: unknown): boolean {
    if (typeof text !== "string" || !text.trim() || text.length > SEND_LIMIT) return false;
    const now = Date.now();
    if (now - lastSend < SEND_GAP_MS || pressOf(live.frame) === "none" || !cardOf(live)) return false;
    // The page stays open and the composer, in sight under it, holds the words (R-CARD-11): the owner alone sends them.
    if (!o.place(live.id, text.trim())) return false;
    lastSend = now;
    return true;
  }

  function openLink(live: Live, url: unknown): void {
    if (typeof url !== "string") return;
    let safe: URL;
    try { safe = new URL(url); } catch { return; }
    if (safe.protocol !== "https:") return;
    // The card is out of sight while its page stands in the conversation's place: there the failure is a word of its own.
    const open = (): void => { void api.openExternalUrl(safe.href).catch(() => { if (live.expanded) toaster.show(t("cards.failed")); else cardFailure(cardOf(live), open); }); };
    whenPressed(live, "page.askOpen", safe.href, open);
  }

  const post = (live: Live, message: object, frame: HTMLIFrameElement = live.frame): void => { frame.contentWindow?.postMessage(message, "*"); };

  function hostContext(): object {
    return { theme: themeNow(), displayMode: "inline", availableDisplayModes: ["inline"], locale: document.documentElement.lang };
  }

  /** The MCP Apps side of a plugin's page: a small JSON-RPC over the same window messages. */
  async function rpc(live: Live, message: { id?: string | number; method?: string; params?: Record<string, unknown> }): Promise<void> {
    const { id, method, params = {} } = message;
    const answer = (result: unknown): void => { if (id !== undefined) post(live, { jsonrpc: "2.0", id, result }); };
    const refuse = (code: number, words: string): void => { if (id !== undefined) post(live, { jsonrpc: "2.0", id, error: { code, message: words } }); };
    switch (method) {
      case "ui/initialize":
        return answer({ protocolVersion: MCP_PROTOCOL, hostInfo: { name: "raphael", version: "1" }, hostCapabilities: { openLinks: {}, serverTools: {} }, hostContext: hostContext() });
      case "ui/notifications/initialized":
        post(live, { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: live.opened?.tool_input ?? {} } });
        post(live, { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: live.opened?.tool_result ?? { content: [] } });
        return;
      case "ui/notifications/size-changed":
        heard(live, params.height);
        return applyHeight(live);
      case "ping":
        return answer({});
      case "ui/open-link":
        openLink(live, params.url);
        return answer({});
      case "ui/message": {
        const content = Array.isArray(params.content) ? params.content : [params.content];
        const words = content.map(part => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : "").join("\n");
        return placeText(live, words) ? answer({ status: "placed" }) : refuse(-32000, "The page text was not placed in the composer.");
      }
      case "tools/call":
        if (typeof params.name !== "string" || !params.name) return refuse(-32602, "tools/call needs {name, arguments?}.");
        try {
          const called = await api.pagesToolCall(live.id, params.name, (params.arguments ?? {}) as object);
          if (called.status === "confirm") return refuse(-32000, t("page.waitingYes"));
          return called.ok ? answer(called.tool_result ?? { content: [] }) : refuse(-32000, called.error ?? t("page.failed"));
        } catch (error) {
          return refuse(-32000, describeError(error));
        }
      default:
        return refuse(-32601, "Method not found");
    }
  }

  window.addEventListener("message", event => {
    const live = event.source ? [...frames.values()].find(item => item.frame.contentWindow === event.source || item.next?.contentWindow === event.source) : undefined;
    const data = event.data as { raphaelPage?: number; jsonrpc?: string; type?: string; text?: unknown; url?: unknown; height?: unknown; y?: unknown } | null;
    if (!live || !data || typeof data !== "object") return;
    const loading = live.next !== null && live.next.contentWindow === event.source;
    // A changed page still loading says how tall it is before it takes its place.
    if (loading && data.raphaelPage === 1 && data.type === "height") live.nextFull = clampHeight(data.height, FULL_MAX_HEIGHT);
    if (data.jsonrpc === "2.0") {
      if (live.opened?.source === "mcp" && !loading) void rpc(live, data as Parameters<typeof rpc>[1]);
      return;
    }
    if (data.raphaelPage !== 1) return;
    // The area scrolls, not the page (R-PAGE-08): where the owner reads is kept from the area's own scroll (`expand`).
    if (data.type === "scroll" || loading) return;
    if (data.type === "height") { heard(live, data.height); applyHeight(live); }
    else if (data.type === "send" && placeText(live, data.text)) post(live, { raphaelPage: 1, type: "result", status: "placed" });
    else if (data.type === "open") openLink(live, data.url);
    // Escape pressed in the page goes back, as it does outside it, unless a task's Stop or a recording has it first.
    else if (data.type === "escape" && live.expanded && pressOf(live.frame) !== "none" && !cancelGesture().hasTarget()) pageView?.close();
  });

  /** Share (R-PAGE-08): the page saved as one HTML file, which the core builds of the page it keeps (`pages.export`: no text of
   *  the window's goes into it), in the owner's output folder or Downloads, shown selected there, and a word of where it went. */
  let sharing = false;
  async function share(live: Live): Promise<void> {
    if (sharing) return;
    sharing = true;
    try {
      const saved = await api.pageSave(live.id);
      toaster.show(t("page.report.saved", { p0: saved.place === "downloads" ? t("page.report.downloads") : saved.folder }));
    } catch {
      toaster.show(t("page.report.saveFailed"));
    } finally {
      sharing = false;
    }
  }

  /** The page opens in the whole area right of the sidebar (owner, 2026-11-14), the same frame moved there, so nothing the
   *  owner did in it is lost. The area scrolls, not the page: the frame is as tall as the page says. It is the card's frame
   *  again, back at its top, when the owner goes back (`leave`). */
  function expand(live: Live, card: HTMLElement): void {
    const host = view();
    const title = card.querySelector(".card-title")?.textContent ?? live.opened?.title ?? "";
    host.body.innerHTML = `<div class="pgv-page" tabindex="-1"><div class="pgv-frame-box"></div></div>`;
    const area = host.body.querySelector<HTMLElement>(".pgv-page")!, box = area.querySelector<HTMLElement>(".pgv-frame-box")!;
    live.expanded = true;
    live.box = box;
    live.full ??= live.height ?? clampHeight(parseFloat(card.style.getPropertyValue("--pg-h")), FULL_MAX_HEIGHT);
    applyHeight(live);
    area.addEventListener("scroll", () => { live.reading = area.scrollTop; }, { passive: true });
    host.open({
      id: live.id, title, kind: "page", opener: card.querySelector<HTMLElement>(".pg-body"),
      // A plugin's page works through its host, which a file does not have.
      action: live.opened?.source === "mcp" ? undefined : { icon: "fileDown", label: t("page.report.share"), run: () => { void share(live); } },
      leave() {
        live.expanded = false;
        live.box = null;
        live.next?.remove();
        live.next = null;
        live.nextFull = null;
        // The card shows the top of the page again; where the owner was reading is kept for the next time.
        const home = cardOf(live)?.querySelector<HTMLElement>(".pg-body");
        if (home) moveFrame(live.frame, home);
        host.body.replaceChildren();
        applyHeight(live);
      },
    });
    moveFrame(live.frame, box);
    if (live.reading > 0) area.scrollTop = live.reading;
  }

  /** A ready page opens whole; one still loading or failed has nothing to open. */
  function enlarge(card: HTMLElement): void {
    const live = frames.get(card.dataset.page!);
    if (live && card.querySelector<HTMLElement>(".pg-body")?.dataset.state === "ready") expand(live, card);
  }

  thread.addEventListener("click", event => {
    const from = event.target as Element;
    const target = from.closest<HTMLElement>("[data-page-act]");
    if (target?.dataset.pageAct === "report") { void reportView().open(target.dataset.page!, target); return; }
    const card = (target ?? from).closest<HTMLElement>(".pg-card");
    const live = card ? frames.get(card.dataset.page!) : undefined;
    if (!card || !live) return;
    if (target?.dataset.pageAct === "retry") void open(live);
    // The title row is part of the same card: pressing it opens the page too (not a button of its own, such as the failed card's ×).
    else if (target?.dataset.pageAct === "expand" || (!target && from.closest(".pg-card > .card-head") && !from.closest("button"))) enlarge(card);
  });
  thread.addEventListener("keydown", event => {
    const body = event.target as Element;
    if ((event.key !== "Enter" && event.key !== " ") || !body.matches('.pg-body[data-page-act="expand"]')) return;
    event.preventDefault();
    enlarge(body.closest<HTMLElement>(".pg-card")!);
  });

  // A page draws in the app's theme, which it is told when it opens.
  // The same theme set again (opening Settings does) must not reload a page and lose what the owner did in it.
  let theme = themeNow();
  new MutationObserver(() => {
    if (themeNow() === theme) return;
    theme = themeNow();
    for (const live of frames.values()) void (live.expanded ? replaceInPlace(live) : open(live));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /** The card of page `id` once it is in the thread (a report's link card, or an HTML page's card that has read its page); null
   *  when it does not come, or when the page cannot be read. */
  function cardFor(id: string): Promise<HTMLElement | null> {
    const find = (): HTMLElement | null => {
      const link = thread.querySelector<HTMLElement>(`.pg-link[data-page="${CSS.escape(id)}"]`);
      if (link) return link;
      const card = thread.querySelector<HTMLElement>(`.pg-card[data-page="${CSS.escape(id)}"]`);
      return card?.querySelector<HTMLElement>(".pg-body")?.dataset.state === "ready" ? card : null;
    };
    const failed = (): boolean => thread.querySelector(`.pg-card[data-page="${CSS.escape(id)}"] .pg-body[data-state="failed"]`) !== null;
    return new Promise(resolve => {
      let finish: (card: HTMLElement | null) => void;
      const watch = new MutationObserver(() => { const card = find(); if (card || failed()) finish(card); });
      const timer = setTimeout(() => finish(null), CARD_WAIT_MS);
      finish = card => { watch.disconnect(); clearTimeout(timer); resolve(card); };
      const now = find();
      if (now) { finish(now); return; }
      watch.observe(thread, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    });
  }

  async function show(id: string, title: string, done: () => void): Promise<boolean> {
    const host = view();
    waiting = id;
    host.watchClose(() => { if (waiting === id) waiting = null; done(); });
    host.open({ id, title, kind: "page", leave() { /* the content that comes brings its own */ } });
    const card = await cardFor(id);
    // The owner went back while it was read, or asked for another page.
    if (waiting !== id || host.shown()?.id !== id) return false;
    waiting = null;
    const live = frames.get(id);
    if (!card || (!live && !card.matches(".pg-link"))) { host.close(); toaster.info(t("page.failed")); return false; }
    if (card.matches(".pg-link")) {
      await reportView().open(id, card);
      // A report that could not be read leaves its view empty: nothing is left open.
      if (reports?.shown()?.id !== id) { host.close(); return false; }
    } else expand(live!, card);
    return host.shown()?.id === id;
  }

  return { sync, carry, sent: () => (pageView ? pageView.sent() : tellPage(null)), close: () => pageView?.close(), shown: () => pageView?.shown() ?? null, show };
}

export type { PageCard };
