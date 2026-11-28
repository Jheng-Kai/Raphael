// When a conversation's column changes width (the details panel dragged wider or narrower, the window resized) the
// reading place stays: the message at the top of the view keeps its place while the lines rewrap,
// and a view at the bottom stays at the bottom. The thread's own scroll anchoring is off (agent.css: the thread
// manages its scrolling itself), so this corrects width changes only; growth, new turns and a scroller made shorter or taller
// by what stands under it are followed by the thread's one stick to the bottom (message-rich.ts readingAnchor).
// While a pane's edge is dragged the conversation takes the width it has at every moment and keeps the line the owner reads
// where it stands on the screen, in the frame the lines rewrap (`followLines`).

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
 * Keeps `scroller`'s reading place across width changes of it; `items` are the messages, in order. With `repaint` (on a
 * Mac), once the width has settled the view scrolls one pixel and back: WebKit can leave part of a thread whose place was
 * set while its width changed unpainted, a hard cut over the background that only a scroll clears (seen with the details
 * panel dragged wider over its Computer tab). The scroll goes up, which never ends a held place (message-rich.ts readingAnchor),
 * and down only from the very top; a view a few px short of the bottom, where the person may have stopped on purpose, is left as
 * it is, since any scroll there would hand it back to following. The nudge and its return are in two frames, so WebKit draws the
 * nudged place once.
 */
export function keepReadingPlace(scroller: HTMLElement, items: string, slack = 4, repaint = IS_MAC): () => void {
  // The width that sets the lines is the column's: a scroller made wider or narrower beside a column at its widest sets the same
  // lines, and its place needs nothing.
  const column = scroller.querySelector<HTMLElement>(":scope > .ra-col") ?? scroller;
  const lineWidth = (): number => scroller.clientWidth && column.clientWidth;
  let width = lineWidth();
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
  // A drag of an edge in the window (`followLines`) owns the place until it is let go: the line read, or the bottom.
  let drag: { line: Line | null; want: number; observer: ResizeObserver | null; lines: number } | null = null;
  const resized = (): void => {
    const now = lineWidth();
    // Not drawn: the width it had stays the one to compare with when it is drawn again, and the place it had with it.
    if (!now || now === width) return;
    width = now;
    if (drag) return;
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
  const scrolled = (): void => {
    if (drag) return;
    const now = lineWidth();
    if (now && now !== width) resized(); else take();
  };
  scroller.addEventListener("scroll", scrolled, { passive: true });
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
  observer?.observe(scroller);
  if (column !== scroller) observer?.observe(column);
  take();

  // The edge is taken: the line read is found now, before anything moves, and put back where it stood after every layout.
  // An observer made now is told after the ones the page made earlier (a message's fold measured for the new lines), in the
  // frame of the change and before it is drawn, so the line is read where the owner will see it and the place is written once.
  const press = (): (() => void) | null => {
    if (drag || !scroller.clientWidth || !scroller.clientHeight) return null;
    const bottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= slack;
    const line = bottom ? null : readLine(scroller, items);
    if (!bottom && !line) return null;
    const own = drag = { line, want: line ? (lineTop(line) ?? 0) - scroller.getBoundingClientRect().top : 0, observer: null as ResizeObserver | null, lines: column.getBoundingClientRect().width };
    // The column's width goes in steps (agent.css `data-stepping`): the grid of widths it may take passes through the width it has
    // now, so nothing wraps again when the edge is taken, and a width never passes the space the pane leaves.
    const stepped = column !== scroller;
    if (stepped) {
      column.style.setProperty("--step-r", `${((own.lines % LINE_STEP_PX) - 0.02).toFixed(2)}px`);
      scroller.dataset.stepping = "";
    }
    // A place in the middle is the owner's: the thread does not follow its newest turn while the lines move under it.
    if (line) scroller.dispatchEvent(new CustomEvent("conversation-hold"));
    const keep = (): void => {
      if (drag !== own || !scroller.clientHeight) return;
      // Folds and the like are measured for the lines of this frame before the place is read (the page listens); the lines change
      // only in the frames where the column crosses a step.
      const lines = column.getBoundingClientRect().width;
      if (lines !== own.lines) { own.lines = lines; scroller.dispatchEvent(new CustomEvent("conversation-measure")); }
      if (!own.line) { scroller.scrollTop = scroller.scrollHeight; return; }
      const at = lineTop(own.line);
      if (at === null) return;
      const off = at - scroller.getBoundingClientRect().top - own.want;
      if (Math.abs(off) >= LINE_SLACK_PX) scroller.scrollTop += off;
    };
    if (typeof ResizeObserver === "function") {
      own.observer = new ResizeObserver(keep);
      own.observer.observe(scroller);
      if (column !== scroller) own.observer.observe(column);
    }
    return () => {
      if (drag !== own) return;
      own.observer?.disconnect();
      if (stepped) { delete scroller.dataset.stepping; column.style.removeProperty("--step-r"); }
      own.lines = -1;
      keep();
      drag = null;
      width = lineWidth() || width;
      take();
      if (repaint) { clearTimeout(settle); settle = window.setTimeout(paint, SETTLE_MS); }
    };
  };
  const keeper: Keeper = { press };
  keepers.add(keeper);
  return () => { keepers.delete(keeper); drag?.observer?.disconnect(); drag = null; scroller.removeEventListener("scroll", scrolled); observer?.disconnect(); clearTimeout(settle); cancelNudge(); };
}

interface Keeper { press(): (() => void) | null }
/** Every conversation that keeps its reading place. */
const keepers = new Set<Keeper>();
/** A line's top that is still the same to the eye: a move of less than this is the browser's rounding of the scroll to a device pixel. */
const LINE_SLACK_PX = 0.5;
/** The steps of the column's width while an edge is dragged (px): the lines wrap again when the width crosses one, not at every pixel. Keep it equal to `--step` in agent.css. */
export const LINE_STEP_PX = 24;

/** A position in a text: the character that starts a line the owner reads. Its top is where that line stands. */
export interface Line { text: Text; offset: number }

/** The top of the character at `line`, or null where it is no longer drawn (its text was replaced). */
export function lineTop(line: Line): number | null {
  if (!line.text.isConnected || line.offset >= line.text.length) return null;
  const range = document.createRange();
  range.setStart(line.text, line.offset);
  range.setEnd(line.text, line.offset + 1);
  const box = range.getBoundingClientRect();
  return box.height > 0 ? box.top : null;
}

/**
 * The first line of the conversation the owner can read whole: its text and the character that starts it, found among the
 * messages `items` that reach into the view. Text is searched in order and the character by halving, so a long thread costs a
 * few reads.
 */
export function readLine(scroller: HTMLElement, items: string): Line | null {
  const view = scroller.getBoundingClientRect();
  const range = document.createRange();
  const charTop = (text: Text, at: number): number | null => {
    range.setStart(text, at); range.setEnd(text, at + 1);
    const box = range.getBoundingClientRect();
    return box.height > 0 ? box.top : null;
  };
  for (const item of scroller.querySelectorAll<HTMLElement>(items)) {
    const box = item.getBoundingClientRect();
    if (box.bottom <= view.top) continue;
    if (box.top >= view.bottom) break;
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
      if (!text.data.trim() || text.parentElement?.closest("[hidden], [aria-hidden='true'], svg, textarea, button")) continue;
      range.selectNodeContents(text);
      const line = [...range.getClientRects()].find(rect => rect.width > 2 && rect.height > 4 && rect.top >= view.top - 0.5 && rect.bottom <= view.bottom);
      if (!line) continue;
      // The first character at or below that line's top: the line's own first one (the characters of a text run down the page).
      let low = 0, high = text.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        let probe = middle, top = charTop(text, probe);
        while (top === null && probe < high) top = charTop(text, ++probe);
        if (top === null || top >= line.top - 0.5) high = middle; else low = middle + 1;
      }
      return charTop(text, low) === null ? null : { text, offset: low };
    }
  }
  return null;
}

/**
 * While a pane's edge is dragged, every conversation takes the width it has at every moment of the drag, so no word is covered
 * or cut by the panes beside it. The line the owner reads stays where it stands on the screen while the lines wrap again around
 * it (the last line of a conversation at its bottom stays at the bottom), written in the frame of each change, after layout.
 * Returns the letting go.
 */
export function followLines(): () => void {
  const released = [...keepers].map(keeper => keeper.press()).filter((release): release is () => void => release !== null);
  return () => { for (const release of released) release(); };
}

