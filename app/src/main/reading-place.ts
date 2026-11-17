// When a conversation's column changes width (the details panel dragged wider or narrower, the window resized) the
// reading place stays: the message at the top of the view keeps its place while the lines rewrap,
// and a view at the bottom stays at the bottom. The thread's own scroll anchoring is off (agent.css: the thread
// manages its scrolling itself), so this corrects width changes only; growth, new turns and a scroller made shorter or taller
// by what stands under it are followed by the thread's one stick to the bottom (message-rich.ts readingAnchor).

import { IS_MAC } from "../shared/platform";

/** How long the width stays the same before WebKit is made to paint the view again (`repaint`). */
export const SETTLE_MS = 150;
/** The repaint's scroll: two CSS px are still a whole device pixel at the smallest zoom (70%), where one would round to none. */
export const NUDGE_PX = 2;

/**
 * Keeps `scroller`'s reading place across width changes of it; `items` are the messages, in order. With `repaint` (on a
 * Mac), once the width has settled the view scrolls one pixel and back: WebKit can leave part of a thread whose place was
 * set while its width changed unpainted, a hard cut over the background that only a scroll clears (seen with the details
 * panel dragged wider over its Computer tab). The scroll goes up, which never ends a held place (message-rich.ts readingAnchor),
 * and down only from the very top; a view a few px short of the bottom, where the person may have stopped on purpose, is left as
 * it is, since any scroll there would hand it back to following. The nudge and its return are in two frames, so WebKit draws the
 * nudged place once.
 */
export function keepReadingPlace(scroller: HTMLElement, items: string, slack = 4, repaint = IS_MAC): () => void {
  let width = scroller.clientWidth;
  let anchor: HTMLElement | null = null, offset = 0, bottom = true;
  const take = (): void => {
    // A scroller that is not drawn (the settings page over it) reads as empty, so as "at the bottom": its place is kept.
    if (!scroller.clientWidth || !scroller.clientHeight) return;
    bottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= slack;
    const top = scroller.getBoundingClientRect().top;
    anchor = null;
    for (const item of scroller.querySelectorAll<HTMLElement>(items)) {
      const box = item.getBoundingClientRect();
      if (box.bottom > top) { anchor = item; offset = box.top - top; break; }
    }
  };
  let frame = 0, settle = 0, nudge = 0;
  const paint = (): void => {
    nudge = requestAnimationFrame(() => {
      const was = scroller.scrollTop, gap = scroller.scrollHeight - scroller.clientHeight - was;
      if (gap > 0.5 && gap <= slack) return;
      const to = was >= NUDGE_PX ? was - NUDGE_PX : gap > NUDGE_PX + slack ? was + NUDGE_PX : null;
      if (to === null) return;
      scroller.scrollTop = to;
      const nudged = scroller.scrollTop;
      // A person who scrolled in that frame keeps where they scrolled to.
      nudge = requestAnimationFrame(() => { if (scroller.scrollTop === nudged) scroller.scrollTop = was; });
    });
  };
  const resized = (): void => {
    const now = scroller.clientWidth;
    // Not drawn: the width it had stays the one to compare with when it is drawn again, and the place it had with it.
    if (!now || now === width) return;
    width = now;
    const keep = anchor, want = offset, atBottom = bottom;
    const place = (): void => {
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
      else if (keep?.isConnected) scroller.scrollTop += keep.getBoundingClientRect().top - scroller.getBoundingClientRect().top - want;
    };
    // Now, and again once the thread has measured its messages for the new width (a long one folds or unfolds).
    place();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { place(); take(); });
    if (repaint) { clearTimeout(settle); settle = window.setTimeout(paint, SETTLE_MS); }
  };
  scroller.addEventListener("scroll", take, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(scroller);
  take();
  return () => { scroller.removeEventListener("scroll", take); observer?.disconnect(); clearTimeout(settle); cancelAnimationFrame(nudge); };
}
