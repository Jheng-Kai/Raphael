import { t } from "./i18n";
import { closeMenu, esc, openPopover } from "./ui";
import { findsName } from "./find-match";

function shortcutOverlayOpen(allowPalette = false): boolean {
  return Array.from(document.querySelectorAll('.mb-scrim, [role="dialog"], #app-popover')).some(element =>
    !element.closest('[hidden], [inert]') &&
    !(allowPalette && element.id === "app-popover" && element.querySelector('[data-command-palette]')),
  );
}

export function shortcut(event: KeyboardEvent): string | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && !event.altKey && !event.shiftKey && key === "k") return shortcutOverlayOpen(true) ? null : "palette";
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return null;
  if (shortcutOverlayOpen()) return null;
  if (event.ctrlKey && !event.altKey) {
    if (key === "f") return event.shiftKey ? "search" : "find";
    if (!event.shiftKey && ["b", "n"].includes(key)) return key === "b" ? "sidebar" : "new";
    if (!event.shiftKey && /^[1-9]$/.test(key)) return `member:${key}`;
  }
  if (event.altKey && !event.ctrlKey && !event.shiftKey && ["arrowup", "arrowdown"].includes(key)) return key === "arrowup" ? "previous" : "next";
  return null;
}

export interface Command { id: string; label: string; keys?: string; run(): void }

/** Reuses the app's popover placement, dismissal, buttons and focus handling. */
export function openCommandPalette(anchor: HTMLElement, commands: Command[]): void {
  if (document.querySelector('[data-command-palette]')) { closeMenu(); return; }
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : anchor;
  const panel = openPopover(previous, `<div class="conversation-tools" data-command-palette><input type="search" aria-label="${esc(t("shortcuts.palette"))}" placeholder="${esc(t("shortcuts.palette"))}"></div><div class="command-results conversation-rows"></div>`, {
    className: "menu conversation-search", role: "dialog", label: t("shortcuts.palette"),
    anchorRect: () => new DOMRect(Math.max(12, (innerWidth - 390) / 2), Math.min(96, innerHeight / 5), Math.min(390, innerWidth - 24), 0),
    onClose: () => previous.focus({ preventScroll: true }),
    onKey: event => {
      if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return false;
      panel.querySelector<HTMLButtonElement>(".command-results button")?.click(); return true;
    },
  });
  const input = panel.querySelector<HTMLInputElement>("input")!;
  const results = panel.querySelector<HTMLElement>(".command-results")!;
  const draw = (): void => {
    const query = input.value.trim().toLocaleLowerCase();
    const found = commands.filter(command => `${command.label} ${command.keys ?? ""}`.toLocaleLowerCase().includes(query) || findsName([command.label], query));
    results.innerHTML = found.map(command => `<button type="button" class="menu-action" data-command="${esc(command.id)}"><span class="mt">${esc(command.label)}</span>${command.keys ? `<span class="note">${esc(command.keys)}</span>` : ""}</button>`).join("") || `<p class="note">${esc(t("shortcuts.empty"))}</p>`;
  };
  input.addEventListener("input", draw);
  results.addEventListener("click", event => {
    const id = (event.target as Element).closest<HTMLElement>("[data-command]")?.dataset.command;
    const command = commands.find(command => command.id === id);
    if (command) { closeMenu(); command.run(); }
  });
  draw(); input.focus();
}
