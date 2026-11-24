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
import { bindNavFrame } from "./nav-layers";
import { cancelGesture } from "../shared/cancel-gesture";
import { mountPageView, tellPage, type PageShell, type PageView } from "./page-view";
import { mountReportView, type ReportPeople, type ReportView } from "./report-page";
import type { AgentTurn, PageCard, PageOpened } from "./types";
import { btn, esc, ico, toaster } from "./ui";

const MIN_HEIGHT = 80, MAX_HEIGHT = 2400;
/** The colour a page says its own background is (core agent/pages.py's helper): a plain rgb or rgba colour and nothing else, so
 *  nothing a page sends can reach the app's style as anything but a colour. */
const PAGE_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,4}|1\.0{1,4})\s*)?\)$/;
const SEND_LIMIT = 4000, SEND_GAP_MS = 1000;
/** How long a page asked for by its id waits for its card to be in the thread and ready. */
const CARD_WAIT_MS = 10000;
/** How long a page has, once its address is set, to load or say anything (its helper's first height) before its card says it
 *  could not be shown, rather than stand as an empty box. A style sheet from elsewhere holds a page back for at most a few
 *  seconds (core agent/pages.py `_HELPER`), so a page still silent after this is stuck. */
const DRAW_MS = 15000;
const MCP_PROTOCOL = "2026-01-26";

/** A report's link card: the same card as a file a member made, its icon, its title and 「頁面」. */
const reportLinkHTML = (page: PageCard): string =>
  `<button type="button" class="btn attachment-file pg-link" data-page-act="report" data-page="${esc(page.id)}" data-page-rev="${page.rev}">` +
  `${ico("report")}<span class="attachment-name"><span class="me-file-t">${esc(page.title)}</span><small>${esc(t("page.kind"))}</small></span></button>`;

/** What a failed page's card says: it could not open (its address could not be read), or it opened and drew nothing. */
type Failure = "open" | "draw";
const failureWords = (why: Failure): string => t(why === "draw" ? "page.notDrawn" : "page.failed");

/** A page that failed reads as a failed mail card: what failed in the card's body line, then what it knows of the page
 *  (the member's plain words) in a well where the page stood, then 再試一次 below. */
function failedHTML(page: PageCard): string {
  const words = page.fallback?.trim();
  return `<div class="pg-failed" hidden><p class="card-body cc-state" role="alert">${esc(failureWords("open"))}</p>` +
    (words ? `<p class="card-well pg-fallback">${esc(words)}</p>` : "") +
    `<div class="card-actions">${btn(esc(t("page.retry")), "sm pri", ' data-page-act="retry"')}</div></div>`;
}

/** The cards a turn shows, below what it said. A card holds no frame: `mountPages` brings it. A report is a link card.
 *  A page is a card of one fixed height (`--h-page-peek`) whatever it holds or whether it is loading, ready or failed: its
 *  title row and, under it, only the top of the page, clipped and faded into the card (a page shown
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
  /** The area it stands in while it is open whole (R-PAGE-10: the frame is the page's window, which the page scrolls in), and the
   *  box in it that holds the frame. */
  area: HTMLElement | null;
  box: HTMLElement | null;
  /** The colour it says its own background is (the helper's `background`), painted behind the composer's row while it is open. */
  background: string | null;
  opened: PageOpened | null;
  /** It has drawn: its frame loaded, or the page said something (its helper speaks once it is parsed). Only then is its
   *  preview shown and pressable; a redraw of its line while it is still on its way keeps it loading. */
  ready: boolean;
  /** It could not open, or opened and drew nothing in time: a redraw of its line shows that again, not an empty box. */
  failed: Failure | null;
  /** Ends its wait to draw (`DRAW_MS`). */
  drawTimer: ReturnType<typeof setTimeout> | undefined;
  /** It stands in the conversation's place (page-view.ts), not in its card. */
  expanded: boolean;
  /** Where the owner was reading it there (how far the page has scrolled in its frame, from its own scroll messages), kept for the
   *  next time it opens. */
  reading: number;
  /** A changed page loading beside the one on screen, which it replaces once it is ready, and the height and the background it says. */
  next: HTMLIFrameElement | null;
  nextHeight: number | null;
  nextBackground: string | null;
  /** A declined external link asks no more without a sure press. */
  refused: boolean;
}

/** Only an atomic move keeps a frame running; a plain append reloads it, which is still better than losing it. A frame in
 *  a card is only a preview: nothing in it can be pressed, focused or scrolled; it works only where the page is made larger. */
function moveFrame(frame: HTMLIFrameElement, target: HTMLElement): void {
  const viewer = target.closest<HTMLElement>(".pgv");
  frame.toggleAttribute("inert", !viewer);
  if (viewer) bindNavFrame(frame, viewer);
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
  shown(): { id: string; kind: "page" | "report"; title: string } | null;
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
    const failed = card.querySelector<HTMLElement>(".pg-failed")!;
    failed.hidden = state !== "failed";
    if (state === "failed") failed.querySelector(":scope > .card-body")!.textContent = failureWords(live.failed ?? "open");
    // The × that puts a failed page away (R-UI-117) is in the heading only while it failed: a hidden one was taken by the
    // shared failure of a link the page could not open, which was then left with no × to put it away.
    const head = card.querySelector<HTMLElement>(":scope > .card-head")!, close = head.querySelector(":scope > [data-card-failed-close]");
    if (state === "failed" && !close) head.insertAdjacentHTML("beforeend", failedClose());
    else if (state !== "failed") close?.remove();
  }

  /** A page is as tall as it says, in its card's preview. In the conversation's place its frame is that place's size and it scrolls
   *  in it as in a browser (R-PAGE-10), so what it says changes nothing there: the card keeps its own height until the page is
   *  back and says so there, narrow again. */
  function applyHeight(live: Live): void {
    if (!live.expanded && live.height !== null) cardOf(live)?.style.setProperty("--pg-h", `${live.height}px`);
  }
  const heard = (live: Live, height: unknown): void => { live.height = clampHeight(height); };

  /** Behind the composer's row the area shows the page's own background, so the page still reads as running to the window's foot. */
  function paintBackground(live: Live): void {
    if (live.background) live.area?.style.setProperty("--pgv-bg", live.background);
    else live.area?.style.removeProperty("--pgv-bg");
  }
  /** Puts the page where the owner was reading it (R-PAGE-10): the helper scrolls to it in its own window. */
  const placeAt = (live: Live, y: number, frame: HTMLIFrameElement = live.frame): void => { post(live, { raphaelPage: 1, type: "scroll-to", y }, frame); };

  async function open(live: Live): Promise<void> {
    live.ready = false;
    live.failed = null;
    clearTimeout(live.drawTimer);
    setBodyState(live, "loading");
    try {
      const opened = await api.pagesOpen(live.id, themeNow());
      if (frames.get(live.id) !== live) return;
      live.opened = opened;
      live.frame.title = opened.title;
      live.frame.src = opened.url;
      live.drawTimer = setTimeout(() => {
        if (frames.get(live.id) !== live || live.ready || live.failed) return;
        live.failed = "draw";
        setBodyState(live, "failed");
      }, DRAW_MS);
    } catch {
      if (frames.get(live.id) !== live) return;
      live.failed = "open";
      setBodyState(live, "failed");
    }
  }

  /** The page has drawn after all, even after its card said it drew nothing: its preview stands. */
  function drawn(live: Live): void {
    if (!live.opened || live.ready || live.failed === "open") return;
    clearTimeout(live.drawTimer);
    live.ready = true;
    live.failed = null;
    setBodyState(live, "ready");
  }

  function newFrame(live: Live): HTMLIFrameElement {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.className = "pg-frame";
    frame.setAttribute("inert", "");
    frame.addEventListener("load", () => drawn(live));
    return frame;
  }

  function make(id: string, rev: number): Live {
    const live = { id, rev, height: null, area: null, box: null, background: null, opened: null, ready: false, failed: null, drawTimer: undefined, expanded: false, reading: 0, next: null, nextHeight: null, nextBackground: null, refused: false } as unknown as Live;
    live.frame = newFrame(live);
    frames.set(id, live);
    return live;
  }

  /**
   * The page changed while it stands in the conversation's place (its member updated it): the new one loads beside the one
   * on screen, is scrolled to where the owner was reading, and takes its place once it has drawn, so nothing closes, flashes or
   * jumps. A page that cannot be read again stays as it was.
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
    live.nextHeight = null;
    live.nextBackground = null;
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
      // The changed page says how tall it is (for its card) and what its background is.
      if (live.nextHeight !== null) { live.height = live.nextHeight; live.nextHeight = null; applyHeight(live); }
      live.background = live.nextBackground;
      paintBackground(live);
      next.style.visibility = "";
      old.remove();
    };
    // Once it has drawn: a frame later, so the first paint of the changed page is what takes the place.
    // It is scrolled to where the owner was reading before it shows, so the owner stays there.
    next.addEventListener("load", () => { if (live.reading > 0) placeAt(live, live.reading, next); requestAnimationFrame(swap); setTimeout(swap, 250); });
    moveFrame(next, box);
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
      // A line drawn again while its page is still on its way stays loading: its address alone is not a page that drew.
      if (live.failed) setBodyState(live, "failed");
      else if (live.ready) setBodyState(live, "ready");
      if (live.rev !== rev) { live.rev = rev; void (live.expanded ? replaceInPlace(live) : open(live)); }
    }
    for (const [id, live] of [...frames]) if (!seen.has(id)) { clearTimeout(live.drawTimer); frames.delete(id); }
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
      title: t(title), body: `<p class="pg-ask-words">${esc(shown)}</p>`, cls: "mb-confirm pg-ask", blockNavigation: true,
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
    // Only a page the owner opened places words (R-CARD-11): one still in its card is a preview, and a preview that takes the
    // focus right after a press elsewhere in the app, or loads again (a theme, a reload), says nothing into the composer.
    if (!live.expanded || now - lastSend < SEND_GAP_MS || pressOf(live.frame) === "none" || !cardOf(live)) return false;
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

  /** What a page says its background is, if it is a plain colour; anything else is none, and the area keeps its own. */
  const backgroundOf = (color: unknown): string | null => (typeof color === "string" && PAGE_COLOR.test(color) ? color : null);

  window.addEventListener("message", event => {
    const live = event.source ? [...frames.values()].find(item => item.frame.contentWindow === event.source || item.next?.contentWindow === event.source) : undefined;
    const data = event.data as { raphaelPage?: number; jsonrpc?: string; type?: string; text?: unknown; url?: unknown; height?: unknown; y?: unknown; color?: unknown; state?: unknown } | null;
    if (!live || !data || typeof data !== "object") return;
    const loading = live.next !== null && live.next.contentWindow === event.source;
    // A changed page still loading says how tall it is before it takes its place.
    if (loading && data.raphaelPage === 1 && data.type === "height") live.nextHeight = clampHeight(data.height);
    if (loading && data.raphaelPage === 1 && data.type === "background") live.nextBackground = backgroundOf(data.color);
    // A page that speaks has been read and laid out, though its load may wait on a font or a picture from elsewhere that
    // never comes: its preview stands now, not when that load ends.
    if (!loading && (data.raphaelPage === 1 || data.jsonrpc === "2.0")) drawn(live);
    if (data.jsonrpc === "2.0") {
      if (live.opened?.source === "mcp" && !loading) void rpc(live, data as Parameters<typeof rpc>[1]);
      return;
    }
    if (data.raphaelPage !== 1) return;
    if (loading) return;
    // The page scrolls in its own window (R-PAGE-10): where the owner reads is what it says its scroll is, while it is open.
    if (data.type === "scroll") { if (live.expanded && Number.isFinite(data.y)) live.reading = Math.max(0, Math.round(Number(data.y))); return; }
    if (data.type === "background") { live.background = backgroundOf(data.color); paintBackground(live); }
    else if (data.type === "height") { heard(live, data.height); applyHeight(live); }
    else if (data.type === "send" && placeText(live, data.text)) post(live, { raphaelPage: 1, type: "result", status: "placed" });
    else if (data.type === "open") openLink(live, data.url);
    // What the owner did on the page goes to the core, which serves it back when the page opens again (R-PAGE-14). The page
    // is the one this frame shows: what a frame says never names another page.
    else if (data.type === "state" && data.state && typeof data.state === "object" && JSON.stringify(data.state).length <= 64 * 1024) {
      api.pagesState(live.id, data.state).catch((error) => console.warn("page-card: the page's state was not kept", describeError(error)));
    }
    // Escape pressed in the page goes back, as it does outside it, unless a task's Stop or a recording has it first.
    else if (data.type === "escape" && live.expanded && pressOf(live.frame) !== "none" && !cancelGesture().hasTarget()) pageView?.close();
  });

  /** Share (R-PAGE-08): the page saved as one HTML file, which the core builds of the page it keeps (`pages.export`: no text of
   *  the window's goes into it), in the member's work folder or Downloads, shown selected there, and a word of where it went. */
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

  /** The page opens in the whole area right of the sidebar, the same frame moved there, so nothing the
   *  owner did in it is lost. The frame is the page's window, as a browser gives one: it fills the area from under the header's
   *  band down to just above the composer's row and the page scrolls in it (R-PAGE-10), so `100vh`, sticky and fixed parts work.
   *  It is the card's frame again, back at its top, when the owner goes back (`leave`). */
  function expand(live: Live, card: HTMLElement): void {
    const host = view();
    const title = card.querySelector(".card-title")?.textContent ?? live.opened?.title ?? "";
    host.body.innerHTML = `<div class="pgv-page" tabindex="-1"><div class="pgv-frame-box"></div></div>`;
    const area = host.body.querySelector<HTMLElement>(".pgv-page")!, box = area.querySelector<HTMLElement>(".pgv-frame-box")!;
    live.expanded = true;
    live.area = area;
    live.box = box;
    paintBackground(live);
    host.open({
      id: live.id, title, kind: "page", opener: card.querySelector<HTMLElement>(".pg-body"),
      reopen: () => { void show(live.id, title, () => {}); },
      // A plugin's page works through its host, which a file does not have.
      action: live.opened?.source === "mcp" ? undefined : { icon: "fileDown", label: t("page.report.share"), run: () => { void share(live); } },
      leave() {
        live.expanded = false;
        live.area = null;
        live.box = null;
        live.next?.remove();
        live.next = null;
        live.nextHeight = null;
        live.nextBackground = null;
        // The card shows the top of the page again; where the owner was reading is kept for the next time.
        const home = cardOf(live)?.querySelector<HTMLElement>(".pg-body");
        if (home) moveFrame(live.frame, home);
        placeAt(live, 0);
        host.body.replaceChildren();
        applyHeight(live);
      },
    });
    moveFrame(live.frame, box);
    // Back where the owner was reading (a frame that had to load again says it once it has).
    if (live.reading > 0) {
      const frame = live.frame, at = live.reading;
      placeAt(live, at);
      frame.addEventListener("load", () => { if (live.expanded && live.frame === frame) placeAt(live, at); }, { once: true });
    }
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
    host.open({
      id, title, kind: "page", leave() { /* the content that comes brings its own */ },
      reopen: () => { void show(id, title, () => {}); },
    });
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
