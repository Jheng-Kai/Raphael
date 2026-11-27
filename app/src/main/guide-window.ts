// The guide is a card of its own size: while it is up the window is exactly the
// card under the control strip and cannot be resized or maximized. The first run opens the window at that size already
// (lib.rs `opening_size`), and when the guide ends the window keeps its size and place and is only given its resizing back:
// the step from the guide into the app is a step into a page, not into a new window, and nothing resizes under it.
import { LogicalSize, type PhysicalSize } from "@tauri-apps/api/window";

/** The card (`.ob-card` in styles.css): roomy enough for a store of three columns. */
export const GUIDE_WIDTH = 1080;
export const GUIDE_HEIGHT = 720;
/** The smallest the window may be (tauri.conf.json), and the edge kept free around it on a small screen. */
const MIN_WIDTH = 720, MIN_HEIGHT = 480, MARGIN = 32;

/** The native operations this needs, so a test can stand in for the window. */
export interface GuideWindow {
  isMaximized(): Promise<boolean>;
  unmaximize(): Promise<void>;
  setSize(size: LogicalSize | PhysicalSize): Promise<void>;
  setResizable(resizable: boolean): Promise<void>;
  setMaximizable(maximizable: boolean): Promise<void>;
  center(): Promise<void>;
}

/** The screen's free area in logical pixels, or null when it cannot be read. */
export type ScreenRoom = () => Promise<{ width: number; height: number } | null>;

let restore: (() => Promise<void>) | null = null;

/**
 * Makes the window the guide's card; `controls` is the height of the window's control strip above it. On a screen too
 * small for the card the window takes what the screen has, never less than the app's smallest window.
 */
export async function fitGuideWindow(win: GuideWindow, controls: number, root: HTMLElement = document.documentElement, room?: ScreenRoom): Promise<void> {
  if (restore) return;
  if (await win.isMaximized()) await win.unmaximize();
  // What the window gives back is only what the card took away. Its bounds stay the guide's: a resize on the way into the
  // app showed the webview's own background at the window's edge, and made the app a new window.
  restore = async () => {
    await win.setResizable(true);
    await win.setMaximizable(true);
  };
  const free = room ? await room().catch(() => null) : null;
  const width = free ? Math.max(MIN_WIDTH, Math.min(GUIDE_WIDTH, Math.floor(free.width - MARGIN))) : GUIDE_WIDTH;
  const height = free ? Math.max(MIN_HEIGHT, Math.min(GUIDE_HEIGHT + controls, Math.floor(free.height - MARGIN))) : GUIDE_HEIGHT + controls;
  await win.setSize(new LogicalSize(width, height));
  await win.setResizable(false);
  await win.setMaximizable(false);
  await win.center();
  root.dataset.windowFixed = "true";
}

/** Lets the window be resized and maximized again, at the size and place the guide left it. */
export async function releaseGuideWindow(root: HTMLElement = document.documentElement): Promise<void> {
  const back = restore;
  restore = null;
  delete root.dataset.windowFixed;
  if (back) await back();
}
