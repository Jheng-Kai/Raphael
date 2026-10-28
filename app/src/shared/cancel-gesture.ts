/** All UI cancellation keys use the same target-bound, two-press gesture. */
export const CANCEL_WINDOW_MS = 1500;
export interface CancelTarget {
  key: string;
  button: HTMLElement;
  hint: string;
  cancel(): void;
}

const managers = new WeakMap<Document, CancelGesture>();
export function cancelGesture(doc: Document = document): CancelGesture {
  let manager = managers.get(doc);
  if (!manager) { manager = new CancelGesture(doc); managers.set(doc, manager); }
  return manager;
}

export class CancelGesture {
  private targets = new Set<() => CancelTarget | null>();
  private armed: CancelTarget | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(doc: Document) {
    doc.addEventListener("keydown", event => { if (event.key !== "Escape") this.clear(); }, true);
    doc.defaultView?.addEventListener("keydown", event => {
      if (event.key !== "Escape") { this.clear(); return; }
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (this.press()) { event.preventDefault(); event.stopImmediatePropagation(); }
    });
    doc.addEventListener("input", () => this.clear(), true);
    doc.addEventListener("pointerdown", () => this.clear(), true);
    doc.addEventListener("click", () => this.clear(), true);
    doc.defaultView?.addEventListener("blur", () => this.clear());
  }
  register(target: () => CancelTarget | null): () => void {
    this.targets.add(target);
    return () => { this.targets.delete(target); this.sync(); };
  }
  private current(): CancelTarget | null {
    for (const get of [...this.targets].reverse()) {
      const target = get();
      if (target && target.button.isConnected && !target.button.closest('[hidden], [inert]') && !(target.button as HTMLButtonElement).disabled) return target;
    }
    return null;
  }
  sync(): void {
    const target = this.current();
    if (this.armed && (target?.key !== this.armed.key || target.button !== this.armed.button)) this.clear();
  }
  press(): boolean {
    const target = this.current();
    if (!target) { this.clear(); return false; }
    if (this.armed?.key === target.key && this.armed.button === target.button) {
      this.clear(); target.cancel(); return true;
    }
    this.clear(); this.armed = target;
    target.button.dataset.cancelArmed = "true";
    target.button.dataset.cancelHint = target.hint;
    target.button.setAttribute("aria-description", `Esc - ${target.hint}`);
    this.timer = setTimeout(() => this.clear(), CANCEL_WINDOW_MS);
    return true;
  }
  clear(): void {
    clearTimeout(this.timer);
    if (this.armed) {
      delete this.armed.button.dataset.cancelArmed;
      delete this.armed.button.dataset.cancelHint;
      this.armed.button.removeAttribute("aria-description");
    }
    this.armed = null;
  }
}
