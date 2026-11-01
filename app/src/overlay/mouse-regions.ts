export interface ControlRect { x: number; y: number; width: number; height: number }
export interface MouseReport { revision: number; rects: ControlRect[]; held: boolean }

/** Reports CSS hit areas in physical client pixels; the shell supplies the desktop origin. */
export function reportMouseRegions(root: HTMLElement, send: (report: MouseReport) => Promise<unknown>,
  selector = ".ask-card, .ask-btn, #ask-expand, #overlay-stop") {
  let revision = 0, held: HTMLElement | undefined, pointer: number | undefined, cancelledClick: number | undefined;
  let frame = 0, previous = "", disposed = false, suspended = false, pending = Promise.resolve();
  const observed = new Set<Element>();
  const visible = (element: HTMLElement): boolean => {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    return getComputedStyle(element).pointerEvents === "auto" && !(element instanceof HTMLButtonElement && element.disabled);
  };
  const release = (): void => { held = undefined; pointer = undefined; flush(); };
  const resize = new ResizeObserver(() => schedule());
  const measure = (): void => {
    frame = 0;
    if (disposed) return;
    const elements = [root, ...root.querySelectorAll<HTMLElement>(selector)];
    for (const element of observed) if (!elements.includes(element as HTMLElement)) { resize.unobserve(element); observed.delete(element); }
    for (const element of elements) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
    const rects: ControlRect[] = [];
    for (const element of suspended ? [] : root.querySelectorAll<HTMLElement>(selector)) {
      if (!visible(element)) continue;
      const r = element.getBoundingClientRect(), scale = window.devicePixelRatio;
      if (r.width > 0 && r.height > 0) rects.push({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale });
    }
    if (held && (!root.contains(held) || !visible(held))) { held = undefined; pointer = undefined; }
    const report = { revision, rects, held: held !== undefined && rects.length > 0 };
    const signature = JSON.stringify(report);
    if (signature === previous) return;
    previous = signature;
    // A slow IPC response cannot let an older press overtake a release or a hide.
    pending = pending.then(() => send(report)).then(() => {}, error => { previous = ""; console.warn("floating controls could not be reported", error); });
  };
  function schedule(): void { if (!disposed && !frame) frame = requestAnimationFrame(measure); }
  function flush(): void { cancelAnimationFrame(frame); measure(); }
  const down = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
    if (event.button !== 0 || !target || !root.contains(target) || !target.matches(selector) || !visible(target)) return;
    cancelledClick = undefined;
    held = target; pointer = event.pointerId;
    try { target.setPointerCapture(event.pointerId); } catch { /* The webview may already have cancelled the pointer. */ }
    flush();
  };
  const up = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    if (event.type === "pointerup" && held) {
      const r = held.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) cancelledClick = pointer;
    }
    release();
  };
  // Pointer capture must not turn a normal drag-off cancellation into an approval or Stop.
  const click = (event: MouseEvent): void => {
    if (event instanceof PointerEvent && event.pointerId === cancelledClick) {
      cancelledClick = undefined; event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const hide = (): void => { suspended = true; release(); };
  const mutation = new MutationObserver(records => {
    if (records.some(({ target, addedNodes, removedNodes }) => {
      const element = target instanceof Element ? target : target.parentElement;
      return element && (element === root || element === document.documentElement || element.matches(selector) || element.closest(selector) || element.querySelector(selector)) ||
        [...addedNodes, ...removedNodes].some(node => node instanceof Element && (node.matches(selector) || node.querySelector(selector)));
    })) schedule();
  });
  mutation.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  if (root !== document.documentElement) mutation.observe(document.documentElement, { attributes: true });
  root.addEventListener("pointerdown", down, true);
  root.addEventListener("click", click, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  root.addEventListener("lostpointercapture", up, true);
  root.addEventListener("transitionend", schedule, true);
  document.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("blur", release);
  window.addEventListener("pagehide", hide);
  schedule();
  return {
    reset(next: number): void { revision = next; previous = ""; suspended = false; held = undefined; pointer = undefined; schedule(); },
    dispose(): void {
      hide(); disposed = true; cancelAnimationFrame(frame); mutation.disconnect(); resize.disconnect();
      root.removeEventListener("pointerdown", down, true); document.removeEventListener("pointerup", up, true);
      root.removeEventListener("click", click, true);
      document.removeEventListener("pointercancel", up, true); root.removeEventListener("lostpointercapture", up, true);
      root.removeEventListener("transitionend", schedule, true); document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule); window.removeEventListener("blur", release); window.removeEventListener("pagehide", hide);
    },
  };
}

