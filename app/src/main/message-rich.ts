import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { messageUrl, tablePlainText } from "./message-content";
import { copyButton, esc, toaster } from "./ui";
import "./message-rich.css";
import { mountShimmers } from './shimmer';

/** Preserve the visible reading anchor across asynchronous SVG/image size changes. */
export function preserveRichScroll(root: HTMLElement, change: () => void): void {
  const height = root.scrollHeight;
  if (height - root.scrollTop - root.clientHeight < 80) {
    change();
    if (root.scrollHeight !== height) root.scrollTop = root.scrollHeight;
    return;
  }
  const top = root.getBoundingClientRect().top;
  const anchor = [...root.querySelectorAll<HTMLElement>(".rich-block, .message-text, .message-actions")].find(node => node.getBoundingClientRect().bottom > top + 2);
  const before = anchor?.getBoundingClientRect().top;
  const turn = anchor?.closest<HTMLElement>(".tn");
  const turnId = turn?.dataset.id, roomId = turn?.dataset.roomMessage;
  const content = anchor?.dataset.source ?? anchor?.textContent;
  change();
  if (anchor && before !== undefined) {
    const replacementTurn = turnId ? root.querySelector<HTMLElement>(`.tn[data-id="${CSS.escape(turnId)}"]`)
      : roomId ? root.querySelector<HTMLElement>(`.tn[data-room-message="${CSS.escape(roomId)}"]`) : null;
    const replacement = anchor.isConnected ? anchor : [...replacementTurn?.querySelectorAll<HTMLElement>(".rich-block, .message-text, .message-actions") ?? []]
      .find(node => (node.dataset.source ?? node.textContent) === content);
    if (replacement) {
      const delta = replacement.getBoundingClientRect().top - before;
      if (Math.abs(delta) >= 1) root.scrollTop += delta;
    }
  }
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
  const states = new WeakMap<HTMLElement, string>();
  const images = new Map<string, HTMLImageElement>();
  const sourceViews = new Map<string, boolean>();
  const refresh = (): void => {
    if (!root.isConnected || !root.getBoundingClientRect().width) return;
    mountShimmers(root);
    const viewport = root.getBoundingClientRect();
    for (const block of root.querySelectorAll<HTMLElement>(".message-code")) {
      const rect = block.getBoundingClientRect();
      if (!rect.width || rect.bottom < viewport.top - 300 || rect.top > viewport.bottom + 300) continue;
      const source = block.dataset.source ?? "", language = block.dataset.language ?? "";
      if (block.classList.contains("message-diagram")) {
        if (block.dataset.complete !== "true") continue;
        if (sourceViews.has(source) && !block.dataset.query) block.querySelector('[data-rich-act="view-source"]')?.setAttribute("aria-expanded", String(sourceViews.get(source)));
        const colors = colorsOf(root), key = JSON.stringify([source, colors]);
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
  const observer = new MutationObserver(refresh); observer.observe(root, { childList: true, subtree: true });
  root.addEventListener("scroll", refresh, { passive: true });
  root.addEventListener("toggle", refresh, true);
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-skin", "style"] });
  if (typeof ResizeObserver === "function") new ResizeObserver(refresh).observe(root);
  refresh();
}

function showLarge(title: string, body: string): void {
  openDialog({ title, body, cls: "rich-view-dialog", actions: { primary: { label: esc(t("common.close")), attrs: ' data-dlg="close"' } }, onAct(_act, _target, dialog) { dialog.close(); } });
}
