// When a conversation's column changes width (the details panel dragged wider or narrower, the window resized) the
// reading place stays: the message at the top of the view keeps its place while the lines rewrap,
// and a view at the bottom stays at the bottom. The thread's own scroll anchoring is off (agent.css: the thread
// manages its scrolling itself), so this corrects width changes only; growth, new turns and a scroller made shorter or taller
// by what stands under it are followed by the thread's one stick to the bottom (message-rich.ts readingAnchor).

/** Keeps `scroller`'s reading place across width changes of it; `items` are the messages, in order. */
export function keepReadingPlace(scroller: HTMLElement, items: string, slack = 4): () => void {
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
  let frame = 0;
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
  };
  scroller.addEventListener("scroll", take, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(scroller);
  take();
  return () => { scroller.removeEventListener("scroll", take); observer?.disconnect(); };
}
