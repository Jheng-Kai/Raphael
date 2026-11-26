// Ctrl + plus / minus / zero zoom the main window by fixed steps (⌘ on a Mac). WebView2's own zoom keys allow
// 25%–500%, so the app handles a narrower range through the
// keys itself and remembers the level.
//
// Zooming out stops where one CSS pixel would be drawn on less than one of the screen's pixels: below that every line
// and letter falls between pixels and the words blur (at 70 % a screen at 100 % drew the 12 px words on 8 pixels). How
// far that is depends on the screen, not on the system: a screen at 100 % (a 1080p monitor on Windows, or on a Mac,
// which offers such a screen no scale between 1x and 2x) keeps 100 % as its least, one at 125 % keeps 80 %, one at
// 150 % or a Retina screen keeps every step. Zooming in is the same on every screen.

/** Every step, three either way of 100%; a screen keeps those it can draw (`zoomLevels`). */
export const ZOOM_LEVELS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3] as const;
export type ZoomAction = "in" | "out" | "reset";

const STORAGE_KEY = "raphael.zoom";
/** A screen's scale can come a hair off its value (1.5000000596, or 1.2499999). */
const EPSILON = 1e-6;

interface ZoomStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The scale of the screen the window is on (its device pixels per CSS pixel at 100%), and its changes when the
 *  window moves to another screen. */
export interface ScreenScale {
  read(): Promise<number>;
  watch(listener: (scale: number) => void): void;
}

/** The steps a screen of `scale` can draw: 100% and up always, a smaller step only while a CSS pixel keeps at least
 *  one of the screen's pixels. A scale that is not a number counts as 1. */
export function zoomLevels(scale: number): number[] {
  const known = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return ZOOM_LEVELS.filter((level) => level >= 1 || level * known >= 1 - EPSILON);
}

function nearest(levels: readonly number[], factor: number): number {
  return levels.reduce((best, level) => (Math.abs(level - factor) < Math.abs(best - factor) ? level : best), 1);
}

export function nextZoom(current: number, action: ZoomAction, levels: readonly number[] = ZOOM_LEVELS): number {
  if (action === "reset") return 1;
  const index = levels.indexOf(nearest(levels, current)) + (action === "in" ? 1 : -1);
  return levels[Math.min(levels.length - 1, Math.max(0, index))]!;
}

export function zoomAction(event: KeyboardEvent): ZoomAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  switch (event.code) {
    case "Equal": case "NumpadAdd": return "in";
    case "Minus": case "NumpadSubtract": return "out";
    case "Digit0": case "Numpad0": return "reset";
    default: return null;
  }
}

function saved(storage: ZoomStorage | undefined): number {
  try {
    const value = Number(storage?.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? nearest(ZOOM_LEVELS, value) : 1;
  } catch {
    return 1;
  }
}

/** Applies the saved level as far as the window's screen can draw it, then handles the zoom keys on `target` with
 *  `setZoom` (the webview's). A level the screen cannot draw shows as its least and stays remembered, so that it comes
 *  back on a screen that can draw it; a key steps from what shows. */
export function installWindowZoom(
  target: EventTarget,
  setZoom: (factor: number) => Promise<void>,
  screen: ScreenScale,
  storage: ZoomStorage | undefined = globalThis.localStorage,
): () => void {
  let chosen = saved(storage);
  // Unknown until the first reading, so that a screen that keeps 70% never flashes 100% first.
  let scale: number | undefined;
  const levels = () => zoomLevels(scale ?? 1);
  const apply = () => {
    if (scale === undefined) return;
    void setZoom(nearest(levels(), chosen)).catch((error) => console.warn("window zoom failed", error));
  };
  let live = true;
  const heard = (value: number) => {
    if (!live) return;
    scale = value;
    apply();
  };
  screen.read().then(heard, (error) => {
    // Unread, the screen counts as one at 100%: the zoom never goes below what such a screen draws.
    console.warn("window zoom: the screen's scale is unknown", error);
    heard(1);
  });
  screen.watch(heard);
  const onKey = (event: Event) => {
    const action = zoomAction(event as KeyboardEvent);
    if (!action) return;
    event.preventDefault();
    chosen = nextZoom(chosen, action, levels());
    try {
      storage?.setItem(STORAGE_KEY, String(chosen));
    } catch {
      // A blocked storage only loses the remembered level.
    }
    apply();
  };
  target.addEventListener("keydown", onKey, { capture: true });
  return () => {
    live = false;
    target.removeEventListener("keydown", onKey, { capture: true });
  };
}
