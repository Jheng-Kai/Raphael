// When a conversation's column changes width (the details panel dragged wider or narrower, the window resized) the
// reading place stays (owner, 2026-11-07): the message at the top of the view keeps its place while the lines rewrap,
// and a view at the bottom stays at the bottom. The thread's own scroll anchoring is off (agent.css: the thread
// manages its scrolling itself), so this corrects width changes only; growth and new turns are left to the thread.

/** Keeps `scroller`'s reading place across width changes of it; `items` are the messages, in order. */
export function keepReadingPlace(scroller: HTMLElement, items: string, slack = 4): () => void {
  let width = scroller.clientWidth;
  let anchor: HTMLElement | null = null, offset = 0, bottom = true;
  const take = (): void => {
    bottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= slack;
    const top = scroller.getBoundingClientRect().top;
    anchor = null;
    for (const item of scroller.querySelectorAll<HTMLElement>(items)) {
      const box = item.getBoundingClientRect();
      if (box.bottom > top) { anchor = item; offset = box.top - top; break; }
    }
  };
  let frame = 0;
  const resized = (): void => {
    const now = scroller.clientWidth;
    if (now === width) return;
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
  };
  scroller.addEventListener("scroll", take, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(scroller);
  take();
  return () => { scroller.removeEventListener("scroll", take); observer?.disconnect(); };
}

/**
 * A view at the bottom stays at the bottom when its scroller gets shorter or taller because what stands under it changed
 * (the composer with typed or placed text, a question card or a notice in the dock, a quota chip), so the last message or
 * card is whole above the composer; a view scrolled up stays where it is (the design judge's R-UI-21 and R-CARD-11 findings: a
 * page card placed text, the composer grew and covered the last card's foot). `followed` tells the thread's own follow state.
 */
export function keepBottomOnResize(scroller: HTMLElement, followed: () => void, slack = 6): () => void {
  let height = scroller.clientHeight;
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const before = height;
    height = scroller.clientHeight;
    // A scroller that was or is not drawn (the page hidden, the settings page over it) has no place to keep.
    if (!before || !height || before === height) return;
    // A shorter scroller leaves scrollTop where it was, so the old height measures where the view stood; a taller one
    // clamps scrollTop to the new end itself, which only looks away from the old height by what it grew.
    if (scroller.scrollHeight - scroller.scrollTop - before > slack) return;
    followed();
    scroller.scrollTop = scroller.scrollHeight;
  }) : null;
  observer?.observe(scroller);
  return () => observer?.disconnect();
}
