import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { messageUrl, tablePlainText } from "./message-content";
import { copyButton, esc, toaster } from "./ui";
import "./message-rich.css";
import { mountShimmers } from './shimmer';

/** The first of `nodes`, in reading order, whose bottom is below `y`. Lines stack down the thread, so a
 * halving search reads a few positions where reading them all took a long thread most of a frame. */
export function firstBelow<T extends Element>(nodes: readonly T[], y: number): T | undefined {
  let low = 0, high = nodes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (nodes[middle]!.getBoundingClientRect().bottom > y) high = middle;
    else low = middle + 1;
  }
  return nodes[low];
}

interface ReadingAnchor {
  node?: HTMLElement; scrollTop: number; queued: boolean; correction: boolean; follows: boolean;
  position?: number; turnId?: string; roomId?: string; content?: string | null;
  generation: number;
}
const anchors = new WeakMap<HTMLElement, ReadingAnchor>();
const ANCHOR_CONTENT = ".rich-block, .message-text, .message-actions";
function readingAnchor(root: HTMLElement): ReadingAnchor {
  const known = anchors.get(root);
  if (known) return known;
  const state: ReadingAnchor = { scrollTop: root.scrollTop, queued: false, correction: false, follows: true, generation: 0 };
  anchors.set(root, state);
  selectAnchor(root, state);
  const observed = typeof IntersectionObserver === 'function' && !!root.querySelector('.conversation-end');
  const schedule = (): void => {
    if (state.queued) return;
    state.queued = true;
    requestAnimationFrame(() => { state.queued = false; selectAnchor(root, state); });
  };
  root.addEventListener("conversation-near-bottom", event => {
    if (!observed || root.closest('[hidden]')) return;
    state.follows = (event as CustomEvent<boolean>).detail;
    if (state.follows) { state.node = undefined; state.position = undefined; }
    else schedule();
  });
  root.addEventListener("scroll", () => {
    // The shared end observer owns following. Programmatic bottom writes need
    // no geometry read in a scroll callback after the next content mutation.
    if (observed) { if (!state.follows) schedule(); return; }
    if (state.scrollTop !== root.scrollTop) schedule();
  }, { passive: true });
  return state;
}
function selectAnchor(root: HTMLElement, state: ReadingAnchor): void {
  state.scrollTop = root.scrollTop;
  state.follows = !Number(root.dataset.windowLater) && root.scrollHeight - state.scrollTop - root.clientHeight < 80;
  if (state.follows) { state.node = undefined; state.position = undefined; return; }
  const top = root.getBoundingClientRect().top + 2;
  const thread = root.querySelector<HTMLElement>(".thread") ?? root;
  const turn = firstBelow([...thread.children] as HTMLElement[], top);
  state.node = turn && (firstBelow([...turn.querySelectorAll<HTMLElement>(ANCHOR_CONTENT)], top) ?? turn);
  state.node ??= root.querySelector<HTMLElement>(ANCHOR_CONTENT) ?? undefined;
  state.position = state.node?.getBoundingClientRect().top;
  const owner = state.node?.closest<HTMLElement>('.tn');
  state.turnId = owner?.dataset.id; state.roomId = owner?.dataset.roomMessage;
  state.content = state.node?.dataset.source ?? state.node?.textContent;
}
/** Scroll events own container measurements; content updates reuse that decision. */
export function richScrollFollows(root: HTMLElement): boolean { return readingAnchor(root).follows; }
/** Follow the latest with a clamped write instead of a layout-producing scrollHeight read. */
export function followRichScroll(root: HTMLElement): void {
  const state = readingAnchor(root);
  state.follows = true; state.node = undefined; state.position = undefined;
  queueRichCorrection(root, state);
}
/** Explicit navigation owns its destination; an older deferred correction cannot move it. */
export function releaseRichScroll(root: HTMLElement): void {
  const state = readingAnchor(root);
  state.generation++; state.correction = false; state.follows = false;
  state.node = undefined; state.position = undefined;
}
interface ScrollProbe { phase: string; richScroll: unknown[] }
interface ScrollTrace { elements: string[] }
function scrollProbe(): ScrollProbe | undefined {
  return (window as typeof window & { __raphaelConversationProbe?: ScrollProbe }).__raphaelConversationProbe;
}
/** Coalesce updates, then measure only the reader's one anchor once in the next frame. */
export function preserveRichScroll(root: HTMLElement, change: () => void): void {
  const state = readingAnchor(root), probe = scrollProbe();
  const trace = probe && { at: performance.now(), phase: probe.phase, elements: [] as string[], coalesced: state.correction, follows: state.follows };
  if (trace) probe!.richScroll.push(trace);
  change();
  queueRichCorrection(root, state, trace);
}
function queueRichCorrection(root: HTMLElement, state: ReadingAnchor, trace?: ScrollTrace): void {
  if (state.correction) return;
  state.correction = true;
  const generation = state.generation;
  requestAnimationFrame(() => {
    if (generation !== state.generation) return;
    state.correction = false;
    if (!root.isConnected) return;
    if (state.follows) { root.scrollTop = 1e9; return; }
    let anchor = state.node;
    if (anchor && !anchor.isConnected) {
      // A turn that owner messages joined is drawn in several lines (conversation.ts threadItems): look in each.
      const turns = state.turnId ? root.querySelectorAll<HTMLElement>(`.tn[data-id="${CSS.escape(state.turnId)}"]`)
        : state.roomId ? root.querySelectorAll<HTMLElement>(`.tn[data-room-message="${CSS.escape(state.roomId)}"]`) : [];
      anchor = [...turns].flatMap(turn => [...turn.querySelectorAll<HTMLElement>(ANCHOR_CONTENT)])
        .find(node => (node.dataset.source ?? node.textContent) === state.content);
    }
    if (!anchor || state.position === undefined) return;
    trace?.elements.push(`${state.turnId ?? state.roomId ?? 'content'}:${anchor.tagName.toLowerCase()}.${anchor.className}`);
    const after = anchor.getBoundingClientRect().top, delta = after - state.position;
    if (Math.abs(delta) >= 1) root.scrollTop = state.scrollTop + delta;
    state.scrollTop += delta;
    state.node = anchor;
    // Moving the scroll position cancels the anchor's displacement.
    state.position = after - delta;
  });
}

let renderQueue: Promise<void> = Promise.resolve();
const diagrams = new Map<string, string | null>();
let instance = 0;
function uniqueSVG(svg: string): string {
  const suffix = `-instance-${++instance}`;
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  return svg.replace(/\bid="([^"]+)"/g, (_all, id: string) => `id="${id}${suffix}"`)
    .replace(/#([\w-]+)/g, (all, id: string) => ids.has(id) ? `#${id}${suffix}` : all)
    .replace(/aria-labelledby="([^"]+)"/g, (_all, value: string) => `aria-labelledby="${value.split(" ").map(id => ids.has(id) ? id + suffix : id).join(" ")}"`);
}
function colorsOf(root: HTMLElement): Record<string, string> {
  const style = getComputedStyle(root);
  return Object.fromEntries(Object.entries({ panel: "--panel", surface: "--surface-2", text: "--text", muted: "--text-2", edge: "--edge" })
    .map(([key, token]) => [key, style.getPropertyValue(token).trim()]));
}

/** One controller for private, chief and group replies; no remote image request before consent. */
export function mountRichContent(root: HTMLElement): void {
  // Establish container metrics at mount; mutations only use the cached reading state.
  readingAnchor(root);
  const states = new WeakMap<HTMLElement, string>();
  const themes = new WeakMap<HTMLElement, number>();
  let themeVersion = 0;
  const images = new Map<string, HTMLImageElement>();
  const sourceViews = new Map<string, boolean>();
  const codeBlocks = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".message-code")].filter(block => !block.closest("details:not([open])"));
  let blocks = codeBlocks();
  const refresh = (checkBlocks = true): void => {
    if (!root.isConnected) return;
    const pending = checkBlocks ? blocks.filter(block => block.classList.contains("message-diagram")
      ? block.dataset.complete === "true" && themes.get(block) !== themeVersion
      : !!block.dataset.language && !block.dataset.query && !states.has(block)) : [];
    // Completed highlighting is immutable. Ordinary text/scroll mutations must
    // not force layout just to rediscover that these blocks have no work left.
    if (pending.length) {
      const viewport = root.getBoundingClientRect();
      if (!viewport.width) return;
      const first = firstBelow(pending, viewport.top - 300);
      for (let index = first ? pending.indexOf(first) : pending.length; index < pending.length; index++) {
        const block = pending[index]!;
        const rect = block.getBoundingClientRect();
        if (rect.top > viewport.bottom + 300) break;
        if (!rect.width || rect.bottom < viewport.top - 300) continue;
        const source = block.dataset.source ?? "", language = block.dataset.language ?? "";
        if (block.classList.contains("message-diagram")) {
          if (block.dataset.complete !== "true") continue;
          if (sourceViews.has(source) && !block.dataset.query) block.querySelector('[data-rich-act="view-source"]')?.setAttribute("aria-expanded", String(sourceViews.get(source)));
          const colors = colorsOf(root), key = JSON.stringify([source, colors]);
          themes.set(block, themeVersion);
          if (states.get(block) === key) continue;
          states.set(block, key);
          renderQueue = renderQueue.then(async () => {
            if (!block.isConnected || states.get(block) !== key) return;
            const renderer = await import("./message-diagram");
            if (!diagrams.has(key)) {
              const svg = await renderer.renderDiagram(source, colors);
              if (diagrams.size >= 64) diagrams.delete(diagrams.keys().next().value!);
              diagrams.set(key, svg);
            }
            if (!block.isConnected || states.get(block) !== key) return;
            const svg = diagrams.get(key), view = block.querySelector<HTMLElement>(".diagram-view")!;
            preserveRichScroll(root, () => {
              if (svg) {
                view.innerHTML = uniqueSVG(svg); view.hidden = false;
                block.querySelector("pre")!.hidden = block.querySelector('[data-rich-act="view-source"]')?.getAttribute("aria-expanded") === "true" ? false : true;
                block.querySelector<HTMLElement>(".rich-note")!.hidden = true;
                block.querySelector<HTMLButtonElement>('[data-rich-act="expand"]')!.hidden = false;
                block.dataset.diagramState = "rendered";
              } else block.dataset.diagramState = "source";
            });
          }).catch(() => { if (block.isConnected) block.dataset.diagramState = "source"; });
        } else if (language && !block.dataset.query && !states.has(block)) {
          states.set(block, source);
          void import("./message-highlight").then(({ highlight }) => {
            const html = highlight(source, language);
            if (block.isConnected && html) block.querySelector("code")!.innerHTML = html;
            block.dataset.highlighted = "true";
          }).catch(() => { /* Escaped plain code remains usable if the optional chunk fails. */ });
        }
      }
    }
    for (const card of root.querySelectorAll<HTMLElement>(".message-image")) {
      const image = images.get(card.dataset.imageUrl ?? "");
      if (image && !card.querySelector("img")) attachImage(card, image.cloneNode() as HTMLImageElement);
    }
  };
  function attachImage(card: HTMLElement, image: HTMLImageElement): void {
    const body = card.querySelector<HTMLElement>(".rich-image-body")!;
    const button = document.createElement("button"); button.type = "button"; button.className = "rich-image-open"; button.dataset.richAct = "expand-image";
    button.setAttribute("aria-label", t("chat.expandBlock")); button.append(image);
    const settle = (): void => { if (card.isConnected) preserveRichScroll(root, () => { image.style.height = ""; }); };
    // Reserve a stable loading area; settle only when the image has its intrinsic dimensions.
    image.style.height = "220px"; image.onload = settle;
    image.onerror = () => { images.delete(card.dataset.imageUrl ?? ""); if (card.isConnected) preserveRichScroll(root, () => { body.textContent = t("chat.imageFailed"); }); };
    preserveRichScroll(root, () => body.replaceChildren(button));
    if (image.complete && image.naturalWidth) settle();
  }
  root.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-rich-act]");
    if (!target || !root.contains(target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const block = target.closest<HTMLElement>(".rich-block")!;
    const source = block.dataset.source ?? "";
    switch (target.dataset.richAct) {
      case "copy-source": void copyButton(target, source).catch(error => toaster.info(describeError(error))); break;
      case "copy-table": void copyButton(target, tablePlainText(source)).catch(error => toaster.info(describeError(error))); break;
      case "view-source": {
        const show = target.getAttribute("aria-expanded") !== "true";
        if (sourceViews.size >= 64) sourceViews.delete(sourceViews.keys().next().value!);
        sourceViews.set(source, show);
        target.setAttribute("aria-expanded", String(show));
        if (block.dataset.diagramState === "rendered") preserveRichScroll(root, () => { block.querySelector("pre")!.hidden = !show; });
        break;
      }
      case "load-image": {
        const url = messageUrl(block.dataset.imageUrl); if (!url) break;
        const image = new Image(); image.referrerPolicy = "no-referrer"; image.crossOrigin = null;
        image.alt = block.querySelector(".rich-head > span")?.textContent ?? "";
        if (images.size >= 32) images.delete(images.keys().next().value!);
        images.set(url, image); attachImage(block, image); image.src = url; break;
      }
      case "expand-image": {
        const image = block.querySelector("img")!;
        showLarge(image.alt, `<img src="${esc(image.src)}" alt="${esc(image.alt)}" referrerpolicy="no-referrer">`); break;
      }
      case "expand": showLarge(t("chat.diagram"), `<div class="diagram-view">${uniqueSVG(block.querySelector(".diagram-view")!.innerHTML)}</div>`); break;
    }
  }, true);
  const newContent = new Set<HTMLElement>();
  let framed = false, checkBlocks = false;
  const schedule = (check = false): void => {
    checkBlocks ||= check;
    if (framed) return;
    framed = true;
    requestAnimationFrame(() => {
      framed = false;
      const check = checkBlocks; checkBlocks = false;
      blocks = blocks.filter(block => root.contains(block) && !block.closest("details:not([open])"));
      const added = new Set<HTMLElement>();
      for (const node of newContent) if (root.contains(node)) {
        if (node.matches(".message-code")) added.add(node);
        for (const block of node.querySelectorAll<HTMLElement>(".message-code")) added.add(block);
        mountShimmers(node);
      }
      newContent.clear();
      if (added.size) blocks = [...new Set([...blocks, ...added])].filter(block => !block.closest("details:not([open])"))
        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      refresh(check || added.size > 0);
    });
  };
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof HTMLElement) newContent.add(node);
    schedule();
  });
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("scroll", () => schedule(!richScrollFollows(root)), { passive: true });
  root.addEventListener("conversation-near-bottom", event => { if (!(event as CustomEvent<boolean>).detail) schedule(true); });
  root.addEventListener("toggle", event => { if (event.target instanceof HTMLElement) newContent.add(event.target); schedule(true); }, true);
  new MutationObserver(() => { themeVersion++; schedule(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-skin", "style"] });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => schedule(true)).observe(root);
  mountShimmers(root);
  refresh();
}

function showLarge(title: string, body: string): void {
  // A chart or a diagram, larger: its × closes it, with no 「關閉」 under it.
  openDialog({ title, body, cls: "rich-view-dialog", actions: {}, onAct(_act, _target, dialog) { dialog.close(); } });
}
