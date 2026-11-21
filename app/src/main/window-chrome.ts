import type { Window } from "@tauri-apps/api/window";

type ResizeDirection = Parameters<Window["startResizeDragging"]>[0];

/** The native operations used by the main window's custom frame. */
export interface WindowChromeWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
}

const DIRECTIONS = new Set<ResizeDirection>([
  "North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest",
]);
const INTERACTIVE = "button, a, input, select, textarea, [contenteditable], [role='button']";
/**
 * A drag sends a resize event for every step, but whether the window is maximized only has to be
 * asked once they have stopped coming for this long.
 */
export const RESIZE_SETTLE_MS = 100;

/** Follow only frame boundaries. A document-wide relational selector here invalidates the thread on composer edits. */
export function followConversationChrome(main: HTMLElement, chrome: HTMLElement): () => void {
  const body = main.ownerDocument.body;
  const parts = new MutationObserver(update);
  const bodyChildren = new MutationObserver(records => {
    const coversHeader = (node: Node): boolean => node instanceof Element && node.matches(".mb-scrim, .side-search");
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(coversHeader))) update();
  });
  bodyChildren.observe(body, { childList: true });
  update();
  return () => { parts.disconnect(); bodyChildren.disconnect(); };

  function update(): void {
    parts.disconnect();
    parts.observe(main, { childList: true });
    const page = main.querySelector<HTMLElement>(":scope > .page-agent");
    const chats = page?.querySelectorAll<HTMLElement>(":scope > .mb-chat") ?? [];
    const settings = page?.querySelector<HTMLElement>(":scope > .ms-pane");
    if (page) parts.observe(page, { childList: true, attributes: true, attributeFilter: ["hidden", "class", "data-det"] });
    for (const chat of chats) parts.observe(chat, { childList: true, attributes: true, attributeFilter: ["hidden"] });
    if (settings) parts.observe(settings, { attributes: true, attributeFilter: ["hidden", "data-scrolled"] });
    const cover = settings?.querySelector(".ms-cover");
    if (cover) parts.observe(cover, { attributes: true, attributeFilter: ["data-pattern"] });
    const conversation = !!page && !page.hidden;
    const header = conversation && [...chats].some(chat => !chat.hidden && chat.querySelector(":scope > .mb-head"));
    const scrims = [...body.querySelectorAll(":scope > .mb-scrim")];
    const search = body.querySelector(":scope > .side-search");
    for (const scrim of scrims) parts.observe(scrim, { attributes: true, attributeFilter: ["class"] });
    const covered = (settings && !settings.hidden) || scrims.length > 0 || !!search;
    const dialog = scrims.some(scrim => !scrim.classList.contains("store-scrim"));
    chrome.toggleAttribute("data-conversation-caption", conversation);
    chrome.toggleAttribute("data-conversation-details", conversation && page.dataset.det === "open" && !page.classList.contains("is-room"));
    chrome.toggleAttribute("data-settings-caption", !!settings && !settings.hidden && !settings.hasAttribute("data-scrolled") && cover?.getAttribute("data-pattern") === "image");
    chrome.toggleAttribute("data-creator-caption", scrims.length > 0 && scrims.every(scrim => scrim.classList.contains("cr-scrim")));
    chrome.toggleAttribute("data-member-dialog", dialog);
    chrome.toggleAttribute("data-caption-dimmed", !!search || dialog);
    chrome.toggleAttribute("data-conversation-drag", header && !covered);
  }
}

/** The names of the frame's controls, in the language of the window. */
export interface WindowControlLabels {
  controls: string;
  minimize: string;
  maximize: string;
  close: string;
}

/**
 * Names the controls, and gives each one the same words as its tooltip. The maximize button keeps
 * one name whatever the window does: `showMaximized` says whether it is pressed.
 */
export function labelWindowControls(chrome: ParentNode, labels: WindowControlLabels): void {
  chrome.querySelector(".window-controls")?.setAttribute("aria-label", labels.controls);
  for (const action of ["minimize", "maximize", "close"] as const) {
    const button = chrome.querySelector<HTMLElement>(`[data-window-action="${action}"]`);
    if (!button) continue;
    button.setAttribute("aria-label", labels[action]);
    button.title = labels[action];
  }
}

/** The maximize button is pressed while the window is maximized. */
export function showMaximized(chrome: ParentNode, maximized: boolean): void {
  chrome.querySelector('[data-window-action="maximize"]')?.setAttribute("aria-pressed", String(maximized));
}

/** Bind real DOM events; native operations and state rendering are the only seams. */
export function installWindowChrome(
  target: EventTarget,
  window: WindowChromeWindow,
  render: (maximized: boolean) => void,
  report: (error: unknown) => void = (error) => console.warn("window chrome request failed", error),
): () => void {
  let active = true;
  let maximized = false;
  let generation = 0;
  let handledDoubleClick = false;
  let unlisten: (() => void) | undefined;
  /** What `render` last drew; undefined until the first answer. */
  let drawn: boolean | undefined;
  let settling: ReturnType<typeof setTimeout> | undefined;
  const run = (operation: () => Promise<unknown>): void => {
    void operation().catch((error) => { if (active) report(error); });
  };
  const refresh = async (): Promise<void> => {
    const request = ++generation;
    const state = await window.isMaximized();
    if (!active || request !== generation) return;
    maximized = state;
    // The controls only differ when the state does: a resize that left it alone has nothing to redraw.
    if (state === drawn) return;
    drawn = state;
    render(state);
  };
  const resized = (): void => {
    clearTimeout(settling);
    settling = setTimeout(() => run(refresh), RESIZE_SETTLE_MS);
  };
  const toggle = async (): Promise<void> => {
    // The guide's window keeps its card size (guide-window.ts).
    if (typeof document !== "undefined" && document.documentElement.dataset.windowFixed === "true") return;
    await window.toggleMaximize();
    await refresh();
  };
  const element = (event: Event): Element | null => {
    const node = event.target;
    return node && "closest" in node && typeof node.closest === "function" ? node as Element : null;
  };
  const click = (event: Event): void => {
    const action = element(event)?.closest<HTMLElement>("[data-window-action]")?.dataset.windowAction;
    if (action === "minimize") run(() => window.minimize());
    if (action === "maximize") run(toggle);
    // close() preserves Rust's close-request handler, which hides the window to the tray.
    if (action === "close") run(() => window.close());
  };
  const press = (event: Event): void => {
    const mouse = event as MouseEvent;
    if (mouse.button !== 0) return;
    const node = element(event);
    const direction = node?.closest<HTMLElement>("[data-window-resize]")?.dataset.windowResize as ResizeDirection | undefined;
    if (direction && DIRECTIONS.has(direction)) {
      if (!maximized) {
        event.preventDefault();
        run(() => window.startResizeDragging(direction));
      }
      return;
    }
    if (!node?.closest("[data-window-drag]") || node.closest(INTERACTIVE)) return;
    event.preventDefault();
    handledDoubleClick = mouse.detail === 2;
    // Native dragging may consume dblclick, so also handle its second mouse press.
    if (handledDoubleClick) run(toggle);
    else run(() => window.startDragging());
  };
  const doubleClick = (event: Event): void => {
    const node = element(event);
    if ((event as MouseEvent).button !== 0 || !node?.closest("[data-window-drag]") || node.closest(INTERACTIVE)) return;
    event.preventDefault();
    if (!handledDoubleClick) run(toggle);
    handledDoubleClick = false;
  };
  target.addEventListener("click", click);
  target.addEventListener("mousedown", press);
  target.addEventListener("dblclick", doubleClick);
  run(refresh);
  run(async () => {
    const stop = await window.onResized(resized);
    if (active) unlisten = stop;
    else stop();
  });
  return () => {
    active = false;
    generation++;
    clearTimeout(settling);
    target.removeEventListener("click", click);
    target.removeEventListener("mousedown", press);
    target.removeEventListener("dblclick", doubleClick);
    unlisten?.();
  };
}
