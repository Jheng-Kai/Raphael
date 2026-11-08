// The guide is a card of its own size, as Typeless's is (owner, 2026-11-07): while it is up the window is exactly the
// card under the control strip, cannot be resized or maximized, and afterwards it returns to the size, place and
// maximized state it had.
import { LogicalSize, type PhysicalPosition, type PhysicalSize } from "@tauri-apps/api/window";

/** The card (`.ob-card` in styles.css): roomy enough for a store of three columns (owner, 2026-11-09: 「導覽的頁面有一點點太小」). */
export const GUIDE_WIDTH = 1080;
export const GUIDE_HEIGHT = 720;
/** The smallest the window may be (tauri.conf.json), and the edge kept free around it on a small screen. */
const MIN_WIDTH = 720, MIN_HEIGHT = 480, MARGIN = 32;

/** The native operations this needs, so a test can stand in for the window. */
export interface GuideWindow {
  isMaximized(): Promise<boolean>;
  outerSize(): Promise<PhysicalSize>;
  outerPosition(): Promise<PhysicalPosition>;
  unmaximize(): Promise<void>;
  maximize(): Promise<void>;
  setSize(size: LogicalSize | PhysicalSize): Promise<void>;
  setPosition(position: PhysicalPosition): Promise<void>;
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
  const maximized = await win.isMaximized();
  // The size to give back is the window's ordinary one, read once it is no longer maximized: read while maximized it is
  // the whole screen, and giving that back made the screen-sized window what 「還原」 returned to (owner, 2026-11-08).
  if (maximized) await win.unmaximize();
  const size = await win.outerSize(), position = await win.outerPosition();
  restore = async () => {
    await win.setResizable(true);
    await win.setMaximizable(true);
    await win.setSize(size);
    await win.setPosition(position);
    if (maximized) await win.maximize();
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

/** Gives the window back what it had before the guide. */
export async function releaseGuideWindow(root: HTMLElement = document.documentElement): Promise<void> {
  const back = restore;
  restore = null;
  delete root.dataset.windowFixed;
  if (back) await back();
}
