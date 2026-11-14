/** A turn includes two messages, work and cards, so it needs a smaller cold window than message-only transcripts. */
export const TRANSCRIPT_WINDOW = { initial: 25, step: 20, maximum: 100, margin: 300 } as const;

/** Stable keys keep a reading window independent of history pages, prepends and new arrivals. */
export class TranscriptWindow {
  private keys: string[] = [];
  private start?: string;
  private end?: string;
  private startIndex = 0;
  private endIndex = 0;
  private following = true;

  get before(): number { return this.startIndex; }
  get after(): number { return this.keys.length - this.endIndex; }
  get total(): number { return this.keys.length; }
  get mounted(): number { return this.endIndex - this.startIndex; }

  reset(): void { this.keys = []; this.start = this.end = undefined; this.following = true; this.startIndex = this.endIndex = 0; }
  latest(): void { this.start = this.end = undefined; this.following = true; }

  /** The window as it is: put back with `restore`, once the keys it spans are drawn again (a page opened from the Library). */
  snapshot(): { start?: string; end?: string; following: boolean } { return { start: this.start, end: this.end, following: this.following }; }
  /** Puts a window back; false (nothing changed) when a turn it spans is not among the turns now known. */
  restore(was: { start?: string; end?: string; following: boolean }): boolean {
    if ((was.start !== undefined && !this.keys.includes(was.start)) || (was.end !== undefined && !this.keys.includes(was.end))) return false;
    this.start = was.start; this.end = was.end; this.following = was.following;
    return true;
  }

  select<T>(items: readonly T[], key: (item: T) => string, follow = false): T[] {
    if (follow) this.following = true;
    const keys = items.map(key);
    let start = this.start === undefined ? Math.max(0, keys.length - TRANSCRIPT_WINDOW.initial) : keys.indexOf(this.start);
    let end = this.end === undefined ? keys.length : keys.indexOf(this.end) + 1;
    if (start < 0 || end <= start) { start = Math.max(0, keys.length - TRANSCRIPT_WINDOW.initial); end = keys.length; this.following = true; }
    if (follow && this.following) end = keys.length;
    if (end - start > TRANSCRIPT_WINDOW.maximum) {
      if (follow && this.following) start = end - TRANSCRIPT_WINDOW.maximum;
      else end = start + TRANSCRIPT_WINDOW.maximum;
    }
    this.keys = keys; this.startIndex = start; this.endIndex = end;
    this.start = keys[start];
    this.end = this.following && follow ? undefined : keys[end - 1];
    return items.slice(start, end);
  }

  earlier(): boolean {
    if (!this.startIndex) return false;
    this.following = false;
    this.startIndex = Math.max(0, this.startIndex - TRANSCRIPT_WINDOW.step);
    this.endIndex = Math.min(this.endIndex, this.startIndex + TRANSCRIPT_WINDOW.maximum);
    this.start = this.keys[this.startIndex]; this.end = this.keys[this.endIndex - 1];
    return true;
  }

  later(): boolean {
    if (!this.after) return false;
    this.endIndex = Math.min(this.keys.length, this.endIndex + TRANSCRIPT_WINDOW.step);
    this.startIndex = Math.max(this.startIndex, this.endIndex - TRANSCRIPT_WINDOW.maximum);
    this.start = this.keys[this.startIndex]; this.end = this.keys[this.endIndex - 1];
    this.following = this.endIndex === this.keys.length;
    return true;
  }

  focus(key: string, keys = this.keys): boolean {
    const target = keys.indexOf(key);
    if (target < 0) return false;
    if (keys === this.keys && target >= this.startIndex && target < this.endIndex) return true;
    // Adapted from OpenMausBot's focusWindowRange (Apache-2.0); see core/packaging/licenses/OpenMausBot-Apache-2.0.txt.
    const start = Math.max(0, Math.min(target - Math.floor(TRANSCRIPT_WINDOW.initial / 2), Math.max(0, keys.length - TRANSCRIPT_WINDOW.initial)));
    this.keys = keys; this.start = keys[start]; this.end = keys[Math.min(keys.length, start + TRANSCRIPT_WINDOW.initial) - 1];
    this.startIndex = start; this.endIndex = Math.min(keys.length, start + TRANSCRIPT_WINDOW.initial); this.following = false;
    return true;
  }
}

/** The same sentinel and exact anchor preservation for private conversations and rooms. */
export function mountTranscriptWindow(scroll: HTMLElement, thread: HTMLElement, window: TranscriptWindow, options: {
  draw(): void; older(): Promise<void>; canOlder(): boolean;
}): { sync(): void; stop(): void } {
  const top = document.createElement("div"), bottom = document.createElement("div");
  for (const [node, edge] of [[top, "top"], [bottom, "bottom"]] as const) {
    node.className = "thread-window-sentinel"; node.dataset.windowEdge = edge; node.setAttribute("aria-hidden", "true");
  }
  thread.before(top); thread.after(bottom);
  let queued = false, expanding = false, previousTop = scroll.scrollTop, armed = false;
  let nearTop = false, nearBottom = false;
  const sync = (): void => {
    top.hidden = !window.before && !options.canOlder(); bottom.hidden = !window.after;
    scroll.dataset.windowTotal = String(window.total); scroll.dataset.windowMounted = String(window.mounted);
    scroll.dataset.windowBefore = String(window.before); scroll.dataset.windowLater = String(window.after);
  };
  const extend = async (earlier: boolean): Promise<void> => {
    if (expanding || scroll.closest("[hidden]")) return;
    expanding = true;
    // Keep one existing turn in place even when the other end of the capped range is removed.
    const viewport = scroll.getBoundingClientRect();
    const nodes = [...thread.children].filter(node => node.classList.contains("tn")) as HTMLElement[];
    let low = 0, high = nodes.length;
    while (low < high) { const middle = (low + high) >> 1; if (nodes[middle]!.getBoundingClientRect().bottom > viewport.top + 2) high = middle; else low = middle + 1; }
    const anchor = nodes[low], before = anchor?.getBoundingClientRect().top;
    try {
      // A partial page must not turn a 20-turn prepend into a five-turn stop at the page boundary.
      if (earlier && window.before < TRANSCRIPT_WINDOW.step && options.canOlder()) {
        await options.older();
        if (anchor && !anchor.isConnected) return;
      }
      if (earlier ? window.earlier() : window.later()) options.draw();
      if (anchor?.isConnected && before !== undefined) scroll.scrollTop += anchor.getBoundingClientRect().top - before;
      previousTop = scroll.scrollTop; sync();
    } finally { expanding = false; }
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const currentTop = scroll.scrollTop;
      if (currentTop < previousTop) armed = true;
      previousTop = currentTop;
      if (!armed) return;
      if (currentTop <= TRANSCRIPT_WINDOW.margin && (window.before || options.canOlder())) void extend(true);
      else if (window.after && scroll.scrollHeight - currentTop - scroll.clientHeight <= TRANSCRIPT_WINDOW.margin) void extend(false);
    });
  };
  const onScroll = (): void => {
    if (!observer) { schedule(); return; }
    armed = true;
    // Intersections already tell us whether paging is possible. Automatic
    // following far from the older sentinel needs no scroll-position read.
    if (nearTop || (window.after && nearBottom)) schedule();
  };
  const onWheel = (event: WheelEvent): void => { if (event.deltaY < 0) armed = true; schedule(); };
  const latest = (): void => { armed = false; window.latest(); options.draw(); sync(); };
  scroll.addEventListener("scroll", onScroll, { passive: true }); scroll.addEventListener("wheel", onWheel, { passive: true });
  scroll.addEventListener("conversation-latest", latest);
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target === top) nearTop = entry.isIntersecting;
      if (entry.target === bottom) nearBottom = entry.isIntersecting;
    }
    if (armed && (nearTop || (window.after && nearBottom))) schedule();
  }, { root: scroll, rootMargin: `${TRANSCRIPT_WINDOW.margin}px 0px` }) : null;
  observer?.observe(top); observer?.observe(bottom);
  sync();
  return { sync, stop() { observer?.disconnect(); scroll.removeEventListener("scroll", onScroll); scroll.removeEventListener("wheel", onWheel); scroll.removeEventListener("conversation-latest", latest); top.remove(); bottom.remove(); } };
}
