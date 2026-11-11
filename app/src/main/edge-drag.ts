// A pane's edge that the pointer drags to resize it: no handle is drawn and
// there is no button for it. The cursor changes over the edge and a thin line shows while it moves. From the keyboard it is
// a separator: the arrow keys move it, and Enter does what the pane does when it is dragged as far as it goes.

export interface EdgeOptions {
  label: string;
  /** The pane's width with the pointer at `x` (a left pane: x; a right pane: the window's width minus x). */
  widthAt(x: number): number;
  /** The pane's width now, which the arrow keys move from. */
  width(): number;
  /** Shows `width` while the edge moves; false ends the drag (the pane closed). */
  resize(width: number): boolean | void;
  /** The edge stopped: keep what it was left at. */
  done(): void;
  /** Which way the right arrow moves the width: 1 for a pane on the left, -1 for one on the right. */
  grow: 1 | -1;
  /** Enter on the edge: the left pane folds to its rail or back, the right one closes. */
  toggle?(): void;
}

/** How far one arrow press moves the edge (px). */
const STEP = 16;

export function mountEdge(edge: HTMLElement, o: EdgeOptions): () => void {
  edge.setAttribute("role", "separator");
  edge.setAttribute("aria-orientation", "vertical");
  edge.setAttribute("aria-label", o.label);
  edge.tabIndex = 0;
  let pointer: number | null = null;
  const end = (): void => {
    if (pointer === null) return;
    if (edge.hasPointerCapture(pointer)) edge.releasePointerCapture(pointer);
    pointer = null;
    edge.classList.remove("is-dragging");
    document.documentElement.removeAttribute("data-resizing");
    o.done();
  };
  const down = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    edge.setPointerCapture(event.pointerId);
    edge.classList.add("is-dragging");
    // The whole window keeps the resize cursor and selects no text while the edge moves.
    document.documentElement.setAttribute("data-resizing", "");
  };
  const move = (event: PointerEvent): void => {
    if (pointer !== event.pointerId) return;
    if (o.resize(o.widthAt(event.clientX)) === false) end();
  };
  const key = (event: KeyboardEvent): void => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction) {
      event.preventDefault();
      if (o.resize(o.width() + direction * o.grow * STEP) !== false) o.done();
    } else if ((event.key === "Enter" || event.key === " ") && o.toggle) {
      event.preventDefault();
      o.toggle();
    }
  };
  edge.addEventListener("pointerdown", down);
  edge.addEventListener("pointermove", move);
  edge.addEventListener("pointerup", end);
  edge.addEventListener("pointercancel", end);
  edge.addEventListener("lostpointercapture", end);
  edge.addEventListener("keydown", key);
  return () => {
    end();
    edge.removeEventListener("pointerdown", down);
    edge.removeEventListener("pointermove", move);
    edge.removeEventListener("pointerup", end);
    edge.removeEventListener("pointercancel", end);
    edge.removeEventListener("lostpointercapture", end);
    edge.removeEventListener("keydown", key);
  };
}

/** A width saved in the browser's storage, when it is a number within the range; otherwise null. */
export function savedWidth(key: string, min: number, max: number): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null;
  } catch { return null; }
}

export function saveWidth(key: string, width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(width)));
  } catch { /* The width holds for this session. */ }
}
