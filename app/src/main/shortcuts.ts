import { t } from "./i18n";
import { closeMenu, esc, openPopover } from "./ui";
import { findsName } from "./find-match";
import { IS_MAC, primaryKey } from "../shared/platform";

function shortcutOverlayOpen(allowPalette = false): boolean {
  return Array.from(document.querySelectorAll('.mb-scrim, [role="dialog"], #app-popover')).some(element =>
    !element.closest('[hidden], [inert]') &&
    !(allowPalette && element.id === "app-popover" && element.querySelector('[data-command-palette]')),
  );
}

/**
 * Whether the key's target is the composer's rich field (an editor: its element carries ProseMirror's class). Ctrl or ⌘ with B is its
 * bold and with K its link, and nothing else in the window takes them while the focus is there; the sidebar's B and the palette's K
 * belong to everywhere else. (The palette stays reachable from the field with Shift+P.)
 */
const inEditor = (event: KeyboardEvent): boolean => {
  const target = event.target instanceof Element ? event.target : document.activeElement;
  return !!target?.closest(".ProseMirror");
};

export function shortcut(event: KeyboardEvent, mac = IS_MAC): string | null {
  // The system's other key is never the window's: the Windows key, or on a Mac Control, whose combinations are a
  // text field's own editing keys (⌃K deletes to the end of the line, ⌃F and ⌃B move the caret).
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || (mac ? event.ctrlKey : event.metaKey)) return null;
  const primary = primaryKey(event, mac);
  // The letter or digit the key types (so Dvorak and Colemak keep theirs); a layout that types neither there (Russian,
  // Thai, Korean) is read by the key's place on the keyboard.
  const typed = event.key.toLowerCase();
  const letter = /^[a-z0-9]$/.test(typed) ? typed
    : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : typed;
  const editing = primary && !event.altKey && inEditor(event);
  if (primary && !event.altKey && ((!event.shiftKey && letter === "k" && !editing) || (event.shiftKey && letter === "p"))) return shortcutOverlayOpen(true) ? null : "palette";
  if (shortcutOverlayOpen()) return null;
  // ⌘/Ctrl+F, +Shift+F, +B, +N and +1..9 type nothing, so they also work while a text field has the focus.
  // Every combination a field uses itself (A, C, V, X, Z, Y, Enter, the arrows) is not in this list and stays with the field.
  if (primary && !event.altKey) {
    if (letter === "f") return event.shiftKey ? "search" : "find";
    if (!event.shiftKey && ["b", "n"].includes(letter) && !(editing && letter === "b")) return letter === "b" ? "sidebar" : "new";
    if (!event.shiftKey && /^[1-9]$/.test(letter)) return `member:${letter}`;
  }
  // Alt (Option) + arrows move the caret by a paragraph or a word, so a text field keeps them.
  const key = event.key.toLowerCase();
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return null;
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ["arrowup", "arrowdown"].includes(key)) return key === "arrowup" ? "previous" : "next";
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
