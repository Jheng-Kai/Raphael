import { NAV_LIMIT, rememberLayerBack, type NavStep } from "./nav-history";

export interface LayerNavigation {
  back?: () => void;
  discard?: () => void;
  /** Owns special cases such as a guide, confirmation or dirty editor. */
  step?: (direction: NavStep) => boolean;
  /** Captures the current destination before Back closes it. */
  restore?: () => (() => void) | undefined;
}

/** Close one level, recording what Forward can restore after it. */
export function closeLayerBack(close: () => void, navigation: LayerNavigation): void {
  const restore = navigation.restore?.();
  if (restore) rememberLayerBack(close, restore, navigation.discard);
  else close();
}

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

interface InlineLayer extends LayerNavigation {
  order: number;
  active(): boolean;
  back(): void;
}

const inline = new WeakMap<HTMLElement, InlineLayer>();
let order = 0;

/** An inline surface that owns navigation but keeps its existing outside-click policy. */
export function bindNavLayer(el: HTMLElement, back: () => void, options: LayerNavigation & { active?: () => boolean } = {}): void {
  el.dataset.navLayer = "";
  inline.set(el, { ...options, order: ++order, back, active: options.active ?? (() => true) });
}

/** Keep unsaved input in its editor until the owner uses the editor's own save or cancel control. */
export function keepEditedField(root: ParentNode, selector = "input, textarea, select"): boolean {
  for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)) {
    if (field.disabled || field.closest("[hidden], [inert]")) continue;
    const changed = field instanceof HTMLSelectElement ? [...field.options].some((option, i) =>
      option.selected !== (option.defaultSelected || i === 0 && !field.multiple && ![...field.options].some(item => item.defaultSelected)))
      : field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")
        ? field.checked !== field.defaultChecked : field.value !== field.defaultValue;
    if (changed) { field.focus({ preventScroll: true }); return true; }
  }
  return false;
}

/** Focus a changed inline editor so the owner can save or cancel it. */
export function bindLayerCancels(root: HTMLElement, selector: string): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(selector)) {
    const editor = button.closest<HTMLElement>("section, form, .ob-tile, .cs-form") ?? root;
    const fields = (): (HTMLInputElement | HTMLTextAreaElement)[] => [...editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]), textarea")];
    const drawn = fields().map(field => field.value);
    const changedField = () => fields().find((field, at) => field.value !== drawn[at]);
    bindNavLayer(button, () => changedField()?.focus({ preventScroll: true }), { active: () => !!changedField() });
  }
}

/**
 * Only surfaces inside the top dialog are eligible. A child takes precedence over its parent, whatever the order they were
 * bound in; among the rest the one bound last is on top. Parents are left out before the order is compared, so the answer
 * never depends on where an unrelated layer stands in the document.
 */
function topInline(scope: ParentNode): InlineLayer | undefined {
  const nodes = [...scope.querySelectorAll<HTMLElement>("[data-nav-layer]")];
  if (scope instanceof HTMLElement && inline.has(scope)) nodes.unshift(scope);
  const eligible = nodes.filter(el => {
    const layer = inline.get(el);
    return !!layer && !el.closest("[hidden], [inert]") && layer.active();
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
  if (event.origin === origin && layer && topInline(scope) === layer) return direction;
}

export function inlineLayer(scope: ParentNode): InlineLayer | undefined { return topInline(scope); }

