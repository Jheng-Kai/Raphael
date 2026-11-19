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
  /** Overrides eligibility for a mouse side press, for surfaces that also have keyboard history. */
  side?: () => boolean;
  /** The layer is itself a place of the view history (a page, a member's settings, the Details column): forward with no
   *  inner step goes on through the history instead of stopping at it. */
  place: boolean;
}

const inline = new WeakMap<HTMLElement, InlineLayer>();
let order = 0;

/** An inline surface that owns navigation but keeps its existing outside-click policy. */
export function bindNavLayer(el: HTMLElement, back: () => void, options: {
  active?: (direction?: NavStep) => boolean; step?: LayerStep; place?: boolean; side?: () => boolean;
} = {}): void {
  el.dataset.navLayer = "";
  inline.set(el, { order: ++order, back, active: options.active ?? (() => true), step: options.step, place: options.place ?? false, side: options.side });
}

/**
 * Inline editors keep the same cancel action and busy guard as their visible button. Back never throws away words that were
 * typed: once a field of the editor differs from what it held when the editor was drawn, back only puts the focus on it, and
 * the editor's own Cancel is the way to drop them. A secret's draft (`secret`: a vault entry, a key) is the exception: back
 * drops it as its Cancel does, so a secret never stays in a field the owner has left.
 */
export function bindLayerCancels(root: HTMLElement, selector: string, options: { secret?: boolean } = {}): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(selector)) {
    const editor = button.closest<HTMLElement>("section, form, .ob-tile, .cs-form") ?? root;
    const fields = (): (HTMLInputElement | HTMLTextAreaElement)[] => [...editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]), textarea")];
    const drawn = fields().map(field => field.value);
    const changedField = (now = fields()) => {
      const changed = now.findIndex((field, at) => field.value !== drawn[at]);
      if (changed >= 0 || now.length !== drawn.length) return now[Math.max(changed, 0)];
    };
    bindNavLayer(button, () => {
      const field = !options.secret && changedField();
      if (field) { field.focus(); return; }
      button.click();
    }, { side: () => !options.secret && !!changedField() });
  }
}

/** Delegate a tab or subpage at the edge of its history back to the enclosing layer. */
export function bindLayerSteps<T>(el: HTMLElement, views: LayerViews<T>, show: (view: T) => void): void {
  bindNavLayer(el, () => {}, {
    side: () => false,
    active: direction => direction ? views.canStep(direction) : views.canStep("back") || views.canStep("forward"),
    step: direction => views.step(direction, show),
  });
}

/**
 * Only surfaces inside the top dialog are eligible. A child takes precedence over its parent, whatever the order they were
 * bound in; among the rest the one bound last is on top. Parents are left out before the order is compared, so the answer
 * never depends on where an unrelated layer stands in the document.
 */
function topInline(scope: ParentNode, direction?: NavStep, side = false): InlineLayer | undefined {
  const nodes = [...scope.querySelectorAll<HTMLElement>("[data-nav-layer]")];
  if (scope instanceof HTMLElement && inline.has(scope)) nodes.unshift(scope);
  const eligible = nodes.filter(el => {
    const layer = inline.get(el);
    return !!layer && !el.closest("[hidden], [inert]") && (side && layer.side ? layer.side() : layer.active(direction));
  });
  const innermost = eligible.filter(el => !eligible.some(other => other !== el && el.contains(other)));
  let top: HTMLElement | undefined;
  for (const el of innermost) if (!top || inline.get(el)!.order > inline.get(top)!.order) top = el;
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
  if (event.origin === origin && layer && topInline(scope, direction, event.data.input === "side") === layer) return direction;
}

export function hasInlineLayer(): boolean { return !!topInline(document); }

export function stepInlineLayer(scope: ParentNode, direction: NavStep, withinLayer: () => boolean): boolean {
  const layer = topInline(scope, direction);
  if (!layer) return false;
  if (layer.step?.(direction, withinLayer)) return true;
  // Forward never moves the page under a dialog or a menu, but a layer that is itself a place lets it go on.
  if (direction === "forward") return !layer.place;
  layer.back();
  return true;
}

export function stepInlineSideLayer(scope: ParentNode, direction: NavStep): boolean {
  const layer = topInline(scope, direction, true);
  if (!layer) return false;
  if (direction === "back") layer.back();
  return true;
}
