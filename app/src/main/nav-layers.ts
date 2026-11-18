import { NAV_LIMIT, type NavStep } from "./nav-history";

/** True when a step stayed inside the layer. Back at its first view falls through to its close. */
export type LayerStep = (direction: NavStep, withinLayer: () => boolean) => boolean;

/** A small history owned by one open panel, including its initial view. */
export class LayerViews<T> {
  private views: T[];
  private at = 0;

  constructor(first: T) { this.views = [first]; }

  visit(view: T): void {
    if (view === this.views[this.at]) return;
    this.views.splice(this.at + 1, Infinity, view);
    if (this.views.length > NAV_LIMIT) this.views.shift();
    this.at = this.views.length - 1;
  }

  canStep(direction: NavStep): boolean {
    return direction === "back" ? this.at > 0 : this.at + 1 < this.views.length;
  }

  step(direction: NavStep, show: (view: T) => void): boolean {
    const next = this.at + (direction === "back" ? -1 : 1);
    if (next < 0 || next >= this.views.length) return false;
    this.at = next;
    show(this.views[next]!);
    return true;
  }
}

interface InlineLayer {
  order: number;
  active(direction?: NavStep): boolean;
  back(): void;
  step?: LayerStep;
}

const inline = new WeakMap<HTMLElement, InlineLayer>();
let order = 0;

/** An inline surface that owns navigation but keeps its existing outside-click policy. */
export function bindNavLayer(el: HTMLElement, back: () => void, options: { active?: (direction?: NavStep) => boolean; step?: LayerStep } = {}): void {
  el.dataset.navLayer = "";
  inline.set(el, { order: ++order, back, active: options.active ?? (() => true), step: options.step });
}

/** Inline editors keep the same cancel action and busy guard as their visible button. */
export function bindLayerCancels(root: HTMLElement, selector: string): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(selector)) {
    bindNavLayer(button, () => button.click());
  }
}

/** Delegate a tab or subpage at the edge of its history back to the enclosing layer. */
export function bindLayerSteps<T>(el: HTMLElement, views: LayerViews<T>, show: (view: T) => void): void {
  bindNavLayer(el, () => {}, {
    active: direction => direction ? views.canStep(direction) : views.canStep("back") || views.canStep("forward"),
    step: direction => views.step(direction, show),
  });
}

/** Only surfaces inside the top dialog are eligible. A child takes precedence over its parent. */
function topInline(scope: ParentNode, direction?: NavStep): InlineLayer | undefined {
  let top: HTMLElement | undefined;
  const nodes = [...scope.querySelectorAll<HTMLElement>("[data-nav-layer]")];
  if (scope instanceof HTMLElement && inline.has(scope)) nodes.unshift(scope);
  for (const el of nodes) {
    const layer = inline.get(el);
    if (!layer || el.closest("[hidden], [inert]") || !layer.active(direction)) continue;
    if (!top || top.contains(el) || (!el.contains(top) && layer.order > inline.get(top)!.order)) top = el;
  }
  return top && inline.get(top);
}

// Only the focused frame can act, and only on its own topmost layer. A frame cannot
// request an action on another dialog or navigate the page beneath its viewer.
const frameOwners = new WeakMap<HTMLIFrameElement, HTMLElement>();

export function bindNavFrame(frame: HTMLIFrameElement, owner: HTMLElement): void { frameOwners.set(frame, owner); }

export function frameStep(event: MessageEvent, scope: Document | HTMLElement): NavStep | undefined {
  const frame = document.activeElement;
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow || event.source !== frame.contentWindow
    || event.data?.type !== "raphael-frame-navigation") return;
  const direction = event.data.direction;
  if (direction !== "back" && direction !== "forward") return;
  const owner = frameOwners.get(frame);
  if (!owner?.contains(frame) || !scope.contains(owner)) return;
  const origin = frame.sandbox.contains("allow-same-origin") ? new URL(frame.src, document.baseURI).origin : "null";
  const layer = inline.get(owner);
  if (event.origin === origin && layer && topInline(scope, direction) === layer) return direction;
}

export function hasInlineLayer(): boolean { return !!topInline(document); }

export function stepInlineLayer(scope: ParentNode, direction: NavStep, withinLayer: () => boolean): boolean {
  const layer = topInline(scope, direction);
  if (!layer) return false;
  if (layer.step?.(direction, withinLayer)) return true;
  if (direction === "back") layer.back();
  return true;
}
