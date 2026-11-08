// The guide is a card of its own size, as Typeless's is (owner, 2026-11-07): while it is up the window is exactly the
// card under the control strip, cannot be resized or maximized, and afterwards it returns to the size, place and
// maximized state it had.
import { LogicalSize, type PhysicalPosition, type PhysicalSize } from "@tauri-apps/api/window";

/** The card (`.ob-card` in styles.css). */
export const GUIDE_WIDTH = 960;
export const GUIDE_HEIGHT = 640;

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

let restore: (() => Promise<void>) | null = null;

/** Makes the window the guide's card; `controls` is the height of the window's control strip above it. */
export async function fitGuideWindow(win: GuideWindow, controls: number, root: HTMLElement = document.documentElement): Promise<void> {
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
  await win.setSize(new LogicalSize(GUIDE_WIDTH, GUIDE_HEIGHT + controls));
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
