// A row of chips wider than its place scrolls sideways: the mouse wheel moves it, an arrow stands at each
// end that has more chips behind it, and those ends fade. The wheel listener sits on each row alone, so the
// rest of the window keeps scrolling off the main thread.

import { iconButton } from "./ui";
import { t } from "./i18n";
import { KEYS_ATTRIBUTE } from "./focus-keys";

const ROW = "[data-chip-row]";
const SCROLLER = "[data-chip-scroll]";
/** The wheel reports lines in some setups; a line is this many pixels. */
const LINE = 40;

/** The arrows of a chip row, written once beside its scroller. */
export const chipSteps = (): string =>
  [-1, 1].map(dir => iconButton(dir < 0 ? "left" : "right", t(dir < 0 ? "chips.before" : "chips.after"), ` data-chip-step="${dir}" tabindex="-1"`, "chip-step")).join("");

/** Marks which ends of a row have more chips behind them. */
export function chipEdges(scroller: HTMLElement): void {
  const row = scroller.closest<HTMLElement>(ROW);
  if (!row) return;
  const end = scroller.scrollWidth - scroller.clientWidth;
  row.toggleAttribute("data-more-before", scroller.scrollLeft > 1);
  row.toggleAttribute("data-more-after", scroller.scrollLeft < end - 1);
}

const fadeOf = (scroller: HTMLElement): number =>
  parseFloat(scroller.ownerDocument.defaultView?.getComputedStyle(scroller.closest(ROW) ?? scroller).getPropertyValue("--chip-fade") ?? "") || 0;

/** Scrolls a chip's row just enough that the whole chip shows: clear of the faded ends when the keyboard reached it,
 * inside the row when the mouse did, so a chip pressed near an end does not slide from under the pointer. */
export function revealChip(chip: Element): void {
  const scroller = chip.closest<HTMLElement>(SCROLLER);
  if (!scroller || chip === scroller) return;
  const frame = scroller.getBoundingClientRect(), box = chip.getBoundingClientRect();
  const fade = scroller.ownerDocument.documentElement.hasAttribute(KEYS_ATTRIBUTE) ? fadeOf(scroller) : 0;
  if (box.right > frame.right - fade) scroller.scrollLeft += box.right - frame.right + fade;
  else if (box.left < frame.left + fade) scroller.scrollLeft = Math.max(0, scroller.scrollLeft + box.left - frame.left - fade);
}

function wheel(event: WheelEvent): void {
  const scroller = event.currentTarget as HTMLElement;
  // A sideways swipe already scrolls the row; a pinch is a zoom.
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const delta = event.deltaY * (event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? scroller.clientWidth : 1);
  const end = scroller.scrollWidth - scroller.clientWidth;
  // At either end the wheel goes back to scrolling the page.
  if (end <= 1 || (delta < 0 && scroller.scrollLeft <= 0) || (delta > 0 && scroller.scrollLeft >= end - 1)) return;
  event.preventDefault();
  scroller.scrollLeft = Math.max(0, Math.min(end, scroller.scrollLeft + delta));
}

function step(event: MouseEvent): void {
  const button = (event.target as Element).closest<HTMLElement>("[data-chip-step]");
  const scroller = button?.closest(ROW)?.querySelector<HTMLElement>(SCROLLER);
  if (!button || !scroller) return;
  const still = scroller.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollBy({ left: Number(button.dataset.chipStep) * Math.max(120, scroller.clientWidth * 0.7), behavior: still ? "auto" : "smooth" });
}

/** Watches every chip row under `root`, now and as pages are drawn. Returns the way to stop. */
export function watchChipRows(root: ParentNode & Node = document.body): () => void {
  if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const sizes = new ResizeObserver(entries => { for (const entry of entries) chipEdges(entry.target as HTMLElement); });
  const moved = (event: Event): void => chipEdges(event.currentTarget as HTMLElement);
  const watched = new WeakSet<Element>();
  const scrollersIn = (node: Node): HTMLElement[] => {
    if (!(node instanceof HTMLElement)) return [];
    const found = [...node.querySelectorAll<HTMLElement>(SCROLLER)];
    return node.matches(SCROLLER) ? [node, ...found] : found;
  };
  const watch = (scroller: HTMLElement): void => {
    if (watched.has(scroller)) return;
    watched.add(scroller);
    scroller.addEventListener("wheel", wheel, { passive: false });
    scroller.addEventListener("scroll", moved, { passive: true });
    sizes.observe(scroller);
  };
  for (const scroller of scrollersIn(root as Node)) watch(scroller);
  if (!(root instanceof HTMLElement)) for (const scroller of root.querySelectorAll<HTMLElement>(SCROLLER)) watch(scroller);
  const lines = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) for (const scroller of scrollersIn(node)) if (!scroller.isConnected) sizes.unobserve(scroller);
      for (const node of record.addedNodes) for (const scroller of scrollersIn(node)) watch(scroller);
    }
  });
  lines.observe(root, { childList: true, subtree: true });
  const focused = (event: FocusEvent): void => {
    const chip = (event.target as Element | null)?.closest?.(`${SCROLLER} > *`);
    // Only a chip reached by the keyboard moves into view: one pressed with the mouse would slide away from the pointer.
    if (chip && document.documentElement.hasAttribute(KEYS_ATTRIBUTE)) revealChip(chip);
  };
  root.addEventListener("click", step as EventListener);
  root.addEventListener("focusin", focused as EventListener);
  return () => {
    lines.disconnect();
    sizes.disconnect();
    root.removeEventListener("click", step as EventListener);
    root.removeEventListener("focusin", focused as EventListener);
  };
}
