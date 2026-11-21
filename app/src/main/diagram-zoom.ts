// The larger view of a reply's diagram (R-UI-173). The chart starts fitted to its stage; the wheel or a pinch zooms it about the
// pointer, a press of the left, middle or right button drags it, a double press puts it back, and the dialog's −, + and reset do
// the same from its head. The arrows move it and + - 0 zoom and reset it from the keyboard. The chart is redrawn at each size
// (its width and height change, never a scaled picture of it), so its lines and words stay sharp at every zoom.

/** How far the chart zooms, as a multiple of its fitted size: a quarter of it to four times it. */
export const ZOOM_OUT_MOST = 0.25;
export const ZOOM_IN_MOST = 4;
/** However large a chart is, it zooms to at least twice its own size, where the words of a large chart read. */
const OWN_SIZE_MOST = 2;
/** A small chart is fitted at most at twice its own size, so its words never stand huge. */
const FIT_MOST = 2;
/** The air around the fitted chart, px. */
const FIT_PAD = 24;
/** How much of the chart always stays in the stage when it is dragged away, px. */
const KEEP_PX = 48;
/** One press of − or +. */
export const ZOOM_STEP = 1.25;
/** One press of an arrow key, px (with Shift three times as far). */
const ARROW_PX = 40;

export interface ZoomView { scale: number; x: number; y: number }
/** The chart's own size and its stage's, px. */
export interface ZoomBox { width: number; height: number; stageWidth: number; stageHeight: number }

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));

/** The whole chart in the middle of its stage, with air around it, at most twice its own size. */
export function fitView(box: ZoomBox): ZoomView {
  const room = (n: number): number => Math.max(1, n - 2 * FIT_PAD);
  const scale = Math.min(room(box.stageWidth) / box.width, room(box.stageHeight) / box.height, FIT_MOST);
  return { scale, x: (box.stageWidth - box.width * scale) / 2, y: (box.stageHeight - box.height * scale) / 2 };
}

/** The smallest and the largest scale of the chart in this stage. */
export function zoomLimits(box: ZoomBox): [number, number] {
  const fit = fitView(box).scale;
  return [fit * ZOOM_OUT_MOST, Math.max(fit * ZOOM_IN_MOST, OWN_SIZE_MOST)];
}

/** Keeps a part of the chart in the stage, wherever it is dragged. */
export function keepInStage(view: ZoomView, box: ZoomBox): ZoomView {
  const width = box.width * view.scale, height = box.height * view.scale;
  const keepX = Math.min(KEEP_PX, width), keepY = Math.min(KEEP_PX, height);
  return { scale: view.scale, x: clamp(view.x, keepX - width, box.stageWidth - keepX), y: clamp(view.y, keepY - height, box.stageHeight - keepY) };
}

/** The chart zoomed `factor` times about the stage point `px`, `py`, which stays where it is, within the limits. */
export function zoomAt(view: ZoomView, box: ZoomBox, factor: number, px: number, py: number): ZoomView {
  const [least, most] = zoomLimits(box);
  const scale = clamp(view.scale * factor, least, most), ratio = scale / view.scale;
  return keepInStage({ scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }, box);
}

export function panBy(view: ZoomView, box: ZoomBox, dx: number, dy: number): ZoomView {
  return keepInStage({ ...view, x: view.x + dx, y: view.y + dy }, box);
}

/**
 * The zoom one wheel event asks for. A mouse's notch (about 100 px) is 1.2×. A trackpad's pinch comes as a wheel with Ctrl whose
 * delta is −100·ln of the pinch, so the chart follows the fingers; one event never zooms more than 1.25×.
 */
export function wheelFactor(event: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey">, page = 800): number {
  const pixels = event.deltaY * (event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? page : 1);
  return clamp(Math.exp(-pixels * (event.ctrlKey ? 0.01 : Math.log(1.2) / 100)), 1 / ZOOM_STEP, ZOOM_STEP);
}

/** The chart's own size: its viewBox (Mermaid always writes one), else its width and height, else an SVG's default. */
function ownSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  const width = Number.parseFloat(svg.getAttribute("width") ?? ""), height = Number.parseFloat(svg.getAttribute("height") ?? "");
  return { width: width > 0 ? width : 300, height: height > 0 ? height : 150 };
}

export interface DiagramZoom {
  /** Carries out a head control (`zoom-in`, `zoom-out`, `zoom-reset`); false for anything else. */
  act(name: string): boolean;
  view(): ZoomView;
  stop(): void;
}

/** Makes `stage` (holding `.diagram-pan > svg`) the larger view; `controls` holds the −, + and reset buttons. */
export function mountDiagramZoom(stage: HTMLElement, controls: ParentNode = stage): DiagramZoom {
  const pan = stage.querySelector<HTMLElement>(".diagram-pan")!, svg = pan.querySelector<SVGSVGElement>("svg")!;
  const own = ownSize(svg);
  const box = (): ZoomBox => ({ ...own, stageWidth: stage.clientWidth || 1, stageHeight: stage.clientHeight || 1 });
  let view = fitView(box());
  /** Until the person moves it, the chart keeps fitting a stage that changes size. */
  let fitted = true;
  const button = (act: string): HTMLButtonElement | null => controls.querySelector<HTMLButtonElement>(`[data-dlg="${act}"]`);
  const draw = (): void => {
    svg.style.width = `${own.width * view.scale}px`;
    svg.style.height = `${own.height * view.scale}px`;
    pan.style.transform = `translate(${view.x}px, ${view.y}px)`;
    const [least, most] = zoomLimits(box()), out = button("zoom-out"), into = button("zoom-in");
    if (out) out.disabled = view.scale <= least * 1.0001;
    if (into) into.disabled = view.scale >= most / 1.0001;
    stage.dataset.zoom = String(Math.round((view.scale / fitView(box()).scale) * 100));
  };
  const set = (next: ZoomView, fit = false): void => { view = next; fitted = fit; draw(); };
  const reset = (): void => set(fitView(box()), true);
  const middle = (): [number, number] => [stage.clientWidth / 2, stage.clientHeight / 2];
  const local = (event: MouseEvent): [number, number] => {
    const rect = stage.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  stage.addEventListener("wheel", event => {
    event.preventDefault();
    // A sideways scroll (Shift with a wheel, two fingers across a trackpad) moves the chart across; the rest zooms it.
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) set(panBy(view, box(), -event.deltaX, 0));
    else set(zoomAt(view, box(), wheelFactor(event, stage.clientHeight), ...local(event)));
  }, { passive: false });

  // Any of the three buttons drags the chart; nothing is selected, the middle button starts no scrolling, the right no menu.
  let held: { id: number; x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", event => {
    if (event.button > 2 || held) return;
    event.preventDefault();
    stage.focus({ preventScroll: true });
    try { stage.setPointerCapture(event.pointerId); } catch { /* a pointer the page did not see go down: it still drags */ }
    held = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.dataset.dragging = "";
  });
  stage.addEventListener("pointermove", event => {
    if (!held || event.pointerId !== held.id) return;
    const dx = event.clientX - held.x, dy = event.clientY - held.y;
    held = { ...held, x: event.clientX, y: event.clientY };
    if (dx || dy) set(panBy(view, box(), dx, dy));
  });
  const drop = (event: PointerEvent): void => {
    if (!held || event.pointerId !== held.id) return;
    held = null;
    delete stage.dataset.dragging;
  };
  stage.addEventListener("pointerup", drop);
  stage.addEventListener("pointercancel", drop);
  stage.addEventListener("lostpointercapture", drop);
  stage.addEventListener("mousedown", event => { if (event.button === 1) event.preventDefault(); });
  stage.addEventListener("auxclick", event => event.preventDefault());
  stage.addEventListener("contextmenu", event => event.preventDefault());
  stage.addEventListener("dblclick", event => { event.preventDefault(); reset(); });
  stage.addEventListener("keydown", event => {
    const step = event.shiftKey ? 3 * ARROW_PX : ARROW_PX;
    // An arrow moves the chart its way, as the picture's frame does (avatar-settings.ts).
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) set(panBy(view, box(), ...moves[event.key]!));
    else if (event.key === "+" || event.key === "=") set(zoomAt(view, box(), ZOOM_STEP, ...middle()));
    else if (event.key === "-" || event.key === "_") set(zoomAt(view, box(), 1 / ZOOM_STEP, ...middle()));
    else if (event.key === "0") reset();
    else return;
    event.preventDefault();
  });

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => fitted ? reset() : set(keepInStage(view, box()))) : null;
  resize?.observe(stage);
  draw();
  return {
    act(name) {
      if (name === "zoom-in") set(zoomAt(view, box(), ZOOM_STEP, ...middle()));
      else if (name === "zoom-out") set(zoomAt(view, box(), 1 / ZOOM_STEP, ...middle()));
      else if (name === "zoom-reset") reset();
      else return false;
      return true;
    },
    view: () => ({ ...view }),
    stop: () => resize?.disconnect(),
  };
}
