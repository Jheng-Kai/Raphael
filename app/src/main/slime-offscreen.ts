// A slime far outside what can be seen does not move. Chromium does not paint content well outside a
// scroller's view, so it cannot hand those animations to the compositor and instead advances them on the
// main thread every frame, at the display's refresh rate, which froze the window in long threads.
// Only surfaces intersecting the viewport need animation work. The JS pose clock restores a newly visible
// surface in phase; a preload margin would keep unseen atlases moving for no visible benefit.

import { showSlime } from "./slime";

const MARGIN = "0px";
// A picture (`data-slime-still`) has nothing to pause: it is not watched at all (owner, 2026-11-11).
const SURFACE = ".slime-surface:not([data-slime-still])";

/** Watches every slime under `root`, now and as lines are drawn, and marks the far ones `data-offscreen`. Returns the way to stop. */
export function stopOffscreenSlimes(root: ParentNode & Node = document.body): () => void {
  if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const sight = new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.toggleAttribute("data-offscreen", !entry.isIntersecting);
      if (entry.isIntersecting) showSlime(entry.target);
    }
  }, { rootMargin: MARGIN });
  const surfacesIn = (node: Node): Element[] => {
    if (!(node instanceof Element)) return [];
    const found = [...node.querySelectorAll(SURFACE)];
    return node.matches(SURFACE) ? [node, ...found] : found;
  };
  for (const el of root instanceof Element ? surfacesIn(root) : root.querySelectorAll(SURFACE)) sight.observe(el);
  const lines = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) for (const el of surfacesIn(node)) if (!el.isConnected) sight.unobserve(el);
      for (const node of record.addedNodes) for (const el of surfacesIn(node)) sight.observe(el);
    }
  });
  lines.observe(root, { childList: true, subtree: true });
  const resume = (): void => {
    if (document.visibilityState !== "hidden") for (const surface of root.querySelectorAll(`${SURFACE}[data-slime-pending]:not([data-offscreen])`)) showSlime(surface);
  };
  document.addEventListener("visibilitychange", resume);
  return () => { lines.disconnect(); sight.disconnect(); document.removeEventListener("visibilitychange", resume); };
}
