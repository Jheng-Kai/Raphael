/** Visibility is independent of focus: work remains visible while another app has the keyboard. */
export function windowVisible(): boolean { return typeof document === "undefined" || !document.hidden; }

/** One gate for interval ticks and the single refresh on returning to a visible window. */
export function visibilityGate(refresh: () => void, active: () => boolean = () => true, resume: () => void = refresh): { run(): void; stop(): void } {
  if (typeof document === "undefined") return { run: () => { if (active()) refresh(); }, stop: () => {} };
  let visible = windowVisible();
  const run = (): void => { if (windowVisible() && active()) refresh(); };
  const changed = (): void => {
    const next = windowVisible(), resumed = next && !visible;
    visible = next;
    if (resumed && active()) resume();
  };
  document.addEventListener("visibilitychange", changed);
  return { run, stop: () => document.removeEventListener("visibilitychange", changed) };
}

/** The same pause rule covers an invisible window and a slime far outside a scroller. */
export function watchWindowVisibility(): () => void {
  const sync = (): void => { document.documentElement.toggleAttribute("data-window-hidden", !windowVisible()); };
  sync();
  document.addEventListener("visibilitychange", sync);
  return () => document.removeEventListener("visibilitychange", sync);
}
