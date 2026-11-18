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
 * Scrolls `scroller` one nudge and back in two frames, which makes WebKit paint the whole view afresh: it can leave part of a
 * thread unpainted after a change of its layout, a hard cut (or the whole thread black) that only a scroll clears. The nudge
 * goes up, which never ends a held place (message-rich.ts readingAnchor), and down only from the very top; a view a few px short
 * of the bottom, where the person may have stopped on purpose, is left as it is, since any scroll there would hand it back to
 * following. A person who scrolls in the nudge's frame keeps where they scrolled to. Gives a way to cancel it.
 */
export function repaintView(scroller: HTMLElement, slack = 4): () => void {
  let nudge = requestAnimationFrame(() => {
    const was = scroller.scrollTop, gap = scroller.scrollHeight - scroller.clientHeight - was;
    if (gap > 0.5 && gap <= slack) return;
    const to = was >= NUDGE_PX ? was - NUDGE_PX : gap > NUDGE_PX + slack ? was + NUDGE_PX : null;
    if (to === null) return;
    scroller.scrollTop = to;
    const nudged = scroller.scrollTop;
    nudge = requestAnimationFrame(() => { if (scroller.scrollTop === nudged) scroller.scrollTop = was; });
  });
  return () => cancelAnimationFrame(nudge);
}

/**
 * Told on every draw whether a member is at work in the thread: when the work ends (the work line and the slime go, the reply is
 * drawn and the thread kept at its bottom, all in one frame), on a Mac the view is painted afresh once that has settled. WebKit
 * left the whole thread black there until a scroll.
 */
export function repaintAfterWork(scroller: HTMLElement, mac = IS_MAC): (working: boolean) => void {
  let was = false, settle = 0, cancel = (): void => {};
  return working => {
    const ended = was && !working;
    was = working;
    if (!ended || !mac) return;
    clearTimeout(settle); cancel();
    settle = window.setTimeout(() => { cancel = repaintView(scroller); }, SETTLE_MS);
  };
}

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
  let frame = 0, settle = 0, cancelNudge = (): void => {};
  const paint = (): void => { cancelNudge(); cancelNudge = repaintView(scroller, slack); };
  const resized = (): void => {
    const now = scroller.clientWidth;
    // Not drawn: the width it had stays the one to compare with when it is drawn again, and the place it had with it.
    if (!now || now === width) return;
    width = now;
    const keep = anchor, want = offset, atBottom = bottom;
    const place = (): void => {
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
      else if (keep?.isConnected) {
        scroller.scrollTop += keep.getBoundingClientRect().top - scroller.getBoundingClientRect().top - want;
        // The thread follows the newest turn only from its bottom (message-rich.ts readingAnchor): a place in the middle,
        // which a narrower thread may have had clamped to the new end for a moment, is still the owner's.
        scroller.dispatchEvent(new CustomEvent("conversation-hold"));
      }
    };
    // Now, and again once the thread has measured its messages for the new width (a long one folds or unfolds).
    place();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { place(); take(); });
    if (repaint) { clearTimeout(settle); settle = window.setTimeout(paint, SETTLE_MS); }
  };
  // A thread made wider is shorter: the place read can lie past its new end, and the browser clamps it to the bottom with a
  // scroll that may come before the width is reported (the details panel closed). That scroll is the width change, not the
  // owner's: the place read before it is the one kept.
  const scrolled = (): void => { if (scroller.clientWidth && scroller.clientWidth !== width) resized(); else take(); };
  scroller.addEventListener("scroll", scrolled, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(scroller);
  take();
  return () => { scroller.removeEventListener("scroll", scrolled); observer?.disconnect(); clearTimeout(settle); cancelNudge(); };
}
