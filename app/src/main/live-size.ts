// A width that the pointer is dragging, handed to the few elements that use it.
//
// A custom property that is inherited (one set on the root, or on a page) is read again by every element beneath the element
// it is set on: for a window of 1,500 elements that is a style recalculation of the whole window for each pointer move, and it
// is what made the list's and the panel's edges stutter. The live properties are registered as not inherited (styles.css
// `@property`) and written only on the elements whose own rules read them (the grid that holds the panes, the caption strip, the
// panel, a scrim), so a move restyles those elements and lays out the panes, and nothing else.

const values = new Map<string, string>();
const users = new Map<string, Set<HTMLElement>>();

/** A style is written only when it differs: the same value again would still be a mutation, and a restyle, of the element. */
function write(el: HTMLElement, name: string, value: string | null | undefined): void {
  if (el.style.getPropertyValue(name) === (value ?? "")) return;
  if (value == null) el.style.removeProperty(name); else el.style.setProperty(name, value);
}

/** Writes `value` (null removes it) to every element that uses `name`; elements that left the document are forgotten. */
export function setLive(name: string, value: string | null): void {
  if (value === null) values.delete(name); else values.set(name, value);
  for (const el of users.get(name) ?? []) {
    if (!el.isConnected) { users.get(name)!.delete(el); continue; }
    write(el, name, value);
  }
}

/** `el` reads `name` from now on: it gets the value the drag left, and every later one. */
export function useLive(name: string, el: HTMLElement | null | undefined): void {
  if (!el) return;
  let set = users.get(name);
  if (!set) users.set(name, set = new Set());
  set.add(el);
  write(el, name, values.get(name));
}
