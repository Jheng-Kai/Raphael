// Which system the app runs on, read once from the webview: WKWebView on macOS says "Macintosh",
// WebView2 on Windows says "Windows". The page uses it only for what differs on screen: the window
// frame (macOS draws its own traffic lights), the names of keys and the system's own words.

export type Platform = "windows" | "macos";

/** The platform a user agent string belongs to. Anything that is not a Mac is treated as Windows. */
export function platformOf(userAgent: string): Platform {
  return /Macintosh|Mac OS X/.test(userAgent) ? "macos" : "windows";
}

/** The platform this page runs on. */
export const PLATFORM: Platform = typeof navigator === "undefined" ? "windows" : platformOf(navigator.userAgent);

/** Whether this page runs on macOS. */
export const IS_MAC = PLATFORM === "macos";

/** Marks the document with its platform (`data-platform`), for the styles that differ. */
export function markPlatform(root: HTMLElement = document.documentElement): void {
  root.dataset.platform = PLATFORM;
}

/**
 * Whether the system's own command key is held, and not the other: ⌘ on a Mac (where Control
 * combinations are the text fields' own editing keys, ⌃K, ⌃F, ⌃B), Ctrl on Windows (where the
 * Windows key belongs to the system).
 */
export const primaryKey = (event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">, mac = IS_MAC): boolean =>
  mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
