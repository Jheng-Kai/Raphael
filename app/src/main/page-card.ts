// A page a member shows in the conversation, a product page or a small tool, or one a plugin brings (`agent/pages.py`).
// It runs from the core's own loopback host in a sandbox with an opaque origin, so it reaches neither the app nor the
// core: it can only post messages to the frame's parent, and everything it asks for is checked here. A thread redraw
// moves the live frame to the new card, so a page does not reload and lose what the owner did in it.
import "./page-card.css";
import { cardFailure, cardHTML, cardStatusHTML, failedClose } from "./card";
import * as api from "./api";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { mountReportView, type ReportPeople, type ReportView } from "./report-page";
import type { AgentTurn, PageCard, PageOpened } from "./types";
import { btn, esc, ico, iconButton } from "./ui";

const MIN_HEIGHT = 80, MAX_HEIGHT = 2400;
const SEND_LIMIT = 4000, SEND_GAP_MS = 1000;
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

/** The cards a turn shows, below what it said. A card holds no frame: `mountPages` brings it. A report is a link card. */
export function pageCardsHTML(turn: AgentTurn): string {
  return (turn.pages ?? []).map(page => page.kind === "report" ? reportLinkHTML(page) : cardHTML({ title: page.title, status: "ready",
    content: `<div class="pg-body" data-state="loading"></div>${failedHTML(page)}`,
    actions: iconButton("expand", t("page.expand"), ' data-page-act="expand"', "pg-expand"), cls: "pg-card",
    attrs: ` data-page="${esc(page.id)}" data-page-rev="${page.rev}" style="--pg-h:${clampHeight(page.height)}px"`,
  })).join("");
}

const clampHeight = (height: unknown): number => {
  const value = Number(height);
  return Number.isFinite(value) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(value))) : 320;
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
  opened: PageOpened | null;
  ready: boolean;
  /** It could not open: a redraw of its line shows that again, not an empty box that never loads. */
  failed: boolean;
  expanded: boolean;
  closeExpanded?: () => void;
  /** A declined external link asks no more without a sure press. */
  refused: boolean;
}

/** Only an atomic move keeps a frame running; a plain append reloads it, which is still better than losing it. */
function moveFrame(frame: HTMLIFrameElement, target: HTMLElement): void {
  if (target.moveBefore && frame.isConnected) target.moveBefore(frame, null);
  else target.append(frame);
}

export interface PagesHost {
  /** Every card in the thread has its frame; an open report follows its card. */
  sync(): void;
  /** Before a line is replaced: moves its frames to the new line, once that line is in the document. */
  carry(from: Element, to: Element): () => void;
  /** Puts an open report away, so the thread is in sight again (the owner sent something, or left the conversation). */
  closeReport(): void;
}

export function mountPages(thread: HTMLElement, o: { place(pageId: string, text: string): boolean; people?: () => ReportPeople }): PagesHost {
  const frames = new Map<string, Live>();
  let lastSend = 0, asking = false;
  hearInput();
  // A report opens in the thread's place: in the conversation's stage, above the composer that stays below it.
  let reports: ReportView | null = null;
  const reportView = (): ReportView => reports ??= mountReportView(thread.closest<HTMLElement>(".ra-stage") ?? thread.parentElement!,
    o.people ?? (() => ({ nameOf: () => "", colorOf: () => "var(--text-3)" })));

  const cardOf = (live: Live): HTMLElement | null => thread.querySelector<HTMLElement>(`.pg-card[data-page="${CSS.escape(live.id)}"]`);

  function setBodyState(live: Live, state: "loading" | "ready" | "failed"): void {
    const card = cardOf(live);
    if (!card) return;
    const pill = card.querySelector(".card-status")!;
    const next = state === "failed" ? "failed" : "ready";
    if (!pill.classList.contains(`is-${next}`)) pill.outerHTML = cardStatusHTML(next);
    card.querySelector<HTMLElement>(".pg-body")!.dataset.state = state;
    card.querySelector<HTMLElement>(".pg-body")!.hidden = state === "failed";
    card.querySelector<HTMLElement>(".pg-failed")!.hidden = state !== "failed";
    // The × that puts a failed page away (R-UI-117) is in the heading only while it failed: a hidden one was taken by the
    // shared failure of a link the page could not open, which was then left with no × to put it away.
    const head = card.querySelector<HTMLElement>(":scope > .card-head")!, close = head.querySelector(":scope > [data-card-failed-close]");
    if (state === "failed" && !close) head.insertAdjacentHTML("beforeend", failedClose());
    else if (state !== "failed") close?.remove();
  }

  /** A page is as tall as it says. Made larger, it says again once it is wider, and only its dialog follows: the card
   *  keeps its own height behind it until the page is back and says so there. */
  function applyHeight(live: Live): void {
    if (live.height !== null) (live.frame.closest<HTMLElement>(".pg-view") ?? cardOf(live))?.style.setProperty("--pg-h", `${live.height}px`);
  }

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

  function make(id: string, rev: number): Live {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.className = "pg-frame";
    const live: Live = { id, rev, frame, height: null, opened: null, ready: false, failed: false, expanded: false, refused: false };
    frame.addEventListener("load", () => { if (live.opened) setBodyState(live, "ready"); });
    frames.set(id, live);
    return live;
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
      if (live.rev !== rev) { live.rev = rev; void open(live); }
    }
    for (const id of [...frames.keys()]) if (!seen.has(id)) frames.delete(id);
    followReport();
  }

  /** An open report closes when its card left the thread (another conversation, or none), and follows its member's changes. */
  function followReport(): void {
    const shown = reports?.shown();
    if (!shown) return;
    const link = thread.querySelector<HTMLElement>(`.pg-link[data-page="${CSS.escape(shown.id)}"]`);
    if (!link) reports!.close();
    else if (Number(link.dataset.pageRev) !== shown.rev) void reports!.refresh();
  }
  // A thread emptied or redrawn without a sync (a conversation that is loading, empty or failed) is followed too.
  new MutationObserver(followReport).observe(thread, { childList: true });

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
    if (!o.place(live.id, text.trim())) return false;
    live.closeExpanded?.();
    lastSend = now;
    return true;
  }

  function openLink(live: Live, url: unknown): void {
    if (typeof url !== "string") return;
    let safe: URL;
    try { safe = new URL(url); } catch { return; }
    if (safe.protocol !== "https:") return;
    const open = (): void => { void api.openExternalUrl(safe.href).catch(() => cardFailure(cardOf(live), open)); };
    whenPressed(live, "page.askOpen", safe.href, open);
  }

  const post = (live: Live, message: object): void => { live.frame.contentWindow?.postMessage(message, "*"); };

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
        live.height = clampHeight(params.height);
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
    const live = event.source ? [...frames.values()].find(item => item.frame.contentWindow === event.source) : undefined;
    const data = event.data as { raphaelPage?: number; jsonrpc?: string; type?: string; text?: unknown; url?: unknown; height?: unknown } | null;
    if (!live || !data || typeof data !== "object") return;
    if (data.jsonrpc === "2.0") {
      if (live.opened?.source === "mcp") void rpc(live, data as Parameters<typeof rpc>[1]);
      return;
    }
    if (data.raphaelPage !== 1) return;
    if (data.type === "height") { live.height = clampHeight(data.height); applyHeight(live); }
    else if (data.type === "send" && placeText(live, data.text)) post(live, { raphaelPage: 1, type: "result", status: "placed" });
    else if (data.type === "open") openLink(live, data.url);
  });

  /** Larger in the shared dialog, the frame moved there and back, so nothing the owner did in it is lost. The dialog is
   *  as tall as the card until the page, now wider, says how tall it is there (applyHeight). */
  function expand(live: Live, card: HTMLElement): void {
    const dialog = openDialog({
      // openDialog escapes the title itself: escaping it here too showed a title's & or < as an entity.
      title: card.getAttribute("aria-label") ?? "", body: `<div class="pg-view"></div>`, cls: "pg-view-dialog",
      // Its × closes it, with no 「關閉」 under it (owner, 2026-11-08).
      actions: {},
      onAct(_act, _target, shown) { shown.close(); },
      onClosing() {
        live.expanded = false;
        live.closeExpanded = undefined;
        const home = cardOf(live)?.querySelector<HTMLElement>(".pg-body");
        if (home) moveFrame(live.frame, home);
      },
    });
    const view = dialog.el.querySelector<HTMLElement>(".pg-view")!;
    view.style.setProperty("--pg-h", card.style.getPropertyValue("--pg-h") || "320px");
    live.expanded = true;
    live.closeExpanded = () => dialog.close();
    moveFrame(live.frame, view);
  }

  thread.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-page-act]");
    if (target?.dataset.pageAct === "report") { void reportView().open(target.dataset.page!, target); return; }
    const card = target?.closest<HTMLElement>(".pg-card");
    const live = card ? frames.get(card.dataset.page!) : undefined;
    if (!target || !card || !live) return;
    if (target.dataset.pageAct === "expand") expand(live, card);
    else void open(live);
  });

  // A page draws in the app's theme, which it is told when it opens.
  // The same theme set again (opening Settings does) must not reload a page and lose what the owner did in it.
  let theme = themeNow();
  new MutationObserver(() => {
    if (themeNow() === theme) return;
    theme = themeNow();
    for (const live of frames.values()) void open(live);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return { sync, carry, closeReport: () => reports?.close() };
}

export type { PageCard };
