import "./character.css";

/** The app's icon, the first blue slime (app/public/brand/app-icon.png, owner 2026-11-07), shown on the About page. */
export function brandIcon(className = ""): string {
  return `<img class="app-icon ${className}" src="/brand/app-icon.png" alt="" width="40" height="40" draggable="false">`;
}
