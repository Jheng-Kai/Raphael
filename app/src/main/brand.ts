import "./character.css";

/** Raphael's portrait on the About page: the same picture as the top of the README on GitHub
 *  (app/public/brand/raphael-portrait.png, owner 2026-11-07). The window, taskbar and tray keep the app icon. */
export function brandIcon(className = ""): string {
  return `<img class="app-icon ${className}" src="/brand/raphael-portrait.png" alt="" width="40" height="40" draggable="false">`;
}
