// The small building blocks of the pages: rows, groups, switches, buttons, menus and toasts. The
// functions that make HTML take HTML for `t`, `d`, `ctl`, `rows` and `foot`: whatever a person or
// the core wrote goes through `esc` first.

import { onLocaleChange, t, translatedMessage } from "./i18n";
import { pressWentThrough, pressWithoutOpener, registerDismissal } from "./dismissals";

import { type Notifier, UNDO_MS } from "./undo";
import { ICON } from "./icon-set";
import { nameScore } from "./find-match";

// ---------- HTML ----------

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text as it can go into HTML, in an attribute too. */
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Whose a generated face is. The same member's new colour or character keeps its face (slime.ts makes its clock again). */
function faceIdentity(surface: Element): string {
  return surface.querySelector("svg.slime")?.getAttribute("data-slime-member") ?? surface.getAttribute("data-slime-still") ?? "";
}

/** Update generated markup without discarding its live controls. */
export function patchHTML(root: Element, html: string): void {
  const faces = new Map<string, Element[]>(), retained: Element[] = [];
  for (const surface of root.querySelectorAll('.slime-surface[data-slime-reuse]')) {
    const id=`${surface.getAttribute('data-slime-reuse')}|${surface.getAttribute('data-state')}`;
    const matches=faces.get(id) ?? [];matches.push(surface);faces.set(id,matches);
  }
  // Skip parsing unchanged vector cels, as well as skipping their DOM patch.
  // Only generated surfaces opt in; changed identity/state still takes the normal path.
  const starts=/<span class="slime-surface"[^>]*data-slime-reuse="([^"]+)"[^>]*>/g;
  const spans=/<\/?span\b[^>]*>/g;
  let match: RegExpExecArray | null, end=0, compact='';
  while ((match=starts.exec(html))) {
    const id=`${match[1]}|${match[0].match(/data-state="([^"]+)"/)?.[1]}`;
    const surface=faces.get(id)?.shift();if(!surface)continue;
    spans.lastIndex=starts.lastIndex;
    let depth=1, tag:RegExpExecArray|null;
    while(depth && (tag=spans.exec(html)))depth+=tag[0].startsWith('</')?-1:1;
    if(depth)continue;
    compact+=html.slice(end,match.index)+`<span data-patch-slime="${retained.length}"></span>`;
    retained.push(surface);end=spans.lastIndex;starts.lastIndex=end;
  }
  const template = document.createElement("template");
  template.innerHTML = compact+html.slice(end);
  const key = (node: Node): string | null => node instanceof Element
    ? ["data-k", "data-member-item", "data-group", "data-room"].map(name => node.hasAttribute(name) ? `${name}:${node.getAttribute(name)}` : "").find(Boolean) ?? null : null;
  const face = (element: Element): Element | null => element.matches("svg.slime") ? element : element.matches(".slime-surface") ? element.querySelector("svg.slime") : null;
  const walk = (live: Node, next: Node, motion = false): void => {
    const keyed = new Map([...live.childNodes].flatMap(node => key(node) ? [[key(node)!, node] as const] : []));
    let at = live.firstChild;
    for (const fresh of [...next.childNodes]) {
      if (fresh instanceof Element && fresh.hasAttribute('data-patch-slime')) {
        const node=retained[Number(fresh.getAttribute('data-patch-slime'))]!;
        if(node!==at)live.insertBefore(node,at);
        at=node.nextSibling;continue;
      }
      const id = key(fresh);
      let node: Node | null = id ? keyed.get(id) ?? null : at && !key(at) ? at : null;
      if (!node || node.nodeType !== fresh.nodeType || (node instanceof Element && fresh instanceof Element && (node.tagName !== fresh.tagName || node.namespaceURI !== fresh.namespaceURI))) {
        // The parsed subtree is already detached; copying cels only creates garbage.
        node = fresh;
        if(node instanceof Element)for(const placeholder of node.querySelectorAll('[data-patch-slime]'))placeholder.replaceWith(retained[Number(placeholder.getAttribute('data-patch-slime'))]!);
        live.insertBefore(node, at);
      } else {
        if (node !== at) live.insertBefore(node, at);
        // A face never turns into someone else's: its clock remembers the drawing it was made with, so morphing
        // Testarossa's into Raphael's drew her bow on him while he moved. Another member takes the
        // fresh face whole.
        if (node instanceof Element && fresh instanceof Element && node.matches(".slime-surface") && fresh.matches(".slime-surface") && faceIdentity(node) !== faceIdentity(fresh)) {
          live.replaceChild(fresh, node);
          at = fresh.nextSibling;
          continue;
        }
        if (node instanceof Element && fresh instanceof Element) {
          const oldFace = face(node), nextFace = face(fresh);
          const sameDrawing = node.matches('.slime-surface[data-slime-drawing]') && node.getAttribute('data-slime-drawing') === fresh.getAttribute('data-slime-drawing') && (oldFace as SVGElement | null)?.style.getPropertyValue('--slime-color') === (nextFace as SVGElement | null)?.style.getPropertyValue('--slime-color');
          const keepMotion = oldFace && nextFace ? oldFace.getAttribute("data-slime-member") === nextFace.getAttribute("data-slime-member") && oldFace.getAttribute("data-state") === nextFace.getAttribute("data-state") : motion;
          if (keepMotion) {
            // Generated faces sample a phase for new nodes; retained nodes already have a clock and transition.
            if (oldFace && nextFace) {
              const before = (node as HTMLElement | SVGElement).style, after = (fresh as HTMLElement | SVGElement).style;
              for (const name of ["--slime-delay", "--slime-since"]) {
                const value = before.getPropertyValue(name);
                if (value) after.setProperty(name, value); else after.removeProperty(name);
              }
              if (before.cssText === after.cssText && node.hasAttribute("style")) fresh.setAttribute("style", node.getAttribute("style")!);
            }
            for (const name of ["is-delighted", "slime-in-between"]) if (node.classList.contains(name)) fresh.classList.add(name);
            if (node.hasAttribute("data-moved")) fresh.setAttribute("data-moved", node.getAttribute("data-moved")!);
            if (node.getAttribute("style") === "" && !fresh.hasAttribute("style")) fresh.setAttribute("style", "");
          }
          for (const attr of [...node.attributes]) if (!fresh.hasAttribute(attr.name)) node.removeAttribute(attr.name);
          for (const attr of [...fresh.attributes]) if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
          if (!(keepMotion && sameDrawing)) walk(node, fresh, !!keepMotion);
        } else if (node.nodeValue !== fresh.nodeValue) node.nodeValue = fresh.nodeValue;
      }
      at = node.nextSibling;
    }
    while (at) { const next = at.nextSibling; live.removeChild(at); at = next; }
  };
  walk(root, template.content);
}

// The app's line icons are Lucide's: icon-set.ts is generated from the pinned
// lucide-static by scripts/icons/build-icons.mjs. Each is drawn in a 24 x 24 box with a stroke of 2 (styles.css `svg.i`),
// so it shows 1.33 px lines at 16 px and 1.5 px at the 18 px of the edge buttons.
export type IconName = keyof typeof ICON;

/** A line icon, 16 px unless its place says otherwise. */
export const ico = (name: IconName): string =>
  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/** A row: the name (and a line of explanation) on the left, the control on the right. */
export function row(t: string, d = "", ctl = "", o: { cls?: string; attrs?: string } = {}): string {
  return (
    `<div class="row${o.cls ? " " + o.cls : ""}"${o.attrs ?? ""}>` +
    `<div class="lbl"><div class="t">${t}</div>${d ? `<div class="d">${d}</div>` : ""}</div>` +
    (ctl ? `<div class="ctl">${ctl}</div>` : "") +
    `</div>`
  );
}

/** A line under a row of a list: a warning about it, or what is wrong with what was typed. */
export const note = (html: string, attrs = ""): string => `<div class="note"${attrs}>${html}</div>`;

/** A block of rows with a line of small print below. */
export function group(rows: string[], foot = ""): string {
  return `<section class="group"><div class="list">${rows.join("")}</div>${foot ? `<p class="foot">${foot}</p>` : ""}</section>`;
}

/** An on/off switch. `attrs` is raw HTML for the button: a `data-act`, say. */
export const tg = (on: boolean, label: string, attrs = ""): string =>
  `<button type="button" class="tg" role="switch" aria-checked="${on}" aria-label="${esc(label)}"${attrs}></button>`;

export interface Choice {
  value: string;
  label: string;
  /** A quiet section heading; headings never participate in option navigation. */
  group?: string;
  /** Packaging provenance, shown as small print under the description. */
  source?: string;
  aliases?: readonly string[];
  /**
   * What the closed dropdown shows when the label is too long for it (a microphone's driver in
   * brackets): the menu lists the label, and the dropdown's tooltip has it too.
   */
  short?: string;
  /**
   * The whole text, for the tooltip, when the label itself shortens it (the automatic microphone,
   * by its short name). The label is the tooltip otherwise.
   */
  title?: string;
  /** A second, quieter text after the label in a menu: a price, say. */
  detail?: string;
  /** A line under the label in a menu: what the choice does. */
  desc?: string;
  /** A small tag after the label in a menu: 「建議」, say. */
  tag?: string;
  /** A quiet word at the right end of the row: what the choice is (「成員」, 「應用程式」). */
  trail?: string;
  /** A face or an icon before the label in a menu, as markup from the app's own helpers (faceHTML, ico). */
  lead?: string;
}

/** The text on a closed dropdown for `choice`, and its tooltip: the whole text. */
export const selText = (choice: Choice | undefined, current: string): { shown: string; full: string } => ({
  shown: choice?.short ?? choice?.label ?? current,
  full: choice?.title ?? choice?.label ?? current,
});

/** The button that opens a menu; it shows `current`'s label. `attrs` names it for the page. */
export function sel(options: Choice[], current: string, label: string, attrs = ""): string {
  const { shown, full } = selText(options.find((o) => o.value === current), current);
  return (
    `<button type="button" class="sel" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="${esc(full)}"${attrs}>` +
    `<span>${esc(shown)}</span>${ico("down")}</button>`
  );
}

export interface TabItem {
  id: string;
  label: string;
  /** A number beside the name; text for what is not a number yet (「—」: it cannot be known), none for an empty string. */
  count?: number | string;
  /** Extra attributes for the tab's button, with a leading space. */
  attrs?: string;
}

/**
 * The one tab / segmented component. `nav` switches between views (bordered, joined, role=tablist);
 * `filter` narrows one list (a pill; History and Dictionary only; role=group, aria-pressed).
 * `fill` stretches the nav tabs across the width of their container. `plain` draws the nav tabs as
 * quiet words with a soft fill under the one that is open, for a bar that also holds a search (the
 * 「已安裝」 and 「商店」 of 連接): still tabs, with the same roles and keys.
 */
export function tabs(items: TabItem[], selected: string, o: { label: string; kind: "nav" | "filter"; fill?: boolean; plain?: boolean; className?: string; attrs?: string }): string {
  const nav = o.kind === "nav";
  const one = (it: TabItem): string => {
    const on = it.id === selected;
    const state = nav ? `role="tab" aria-selected="${on}"` : `aria-pressed="${on}"`;
    const shown = typeof it.count === "string" ? it.count !== "" : it.count !== undefined && (it.count > 0 || o.plain);
    const n = shown ? `<span class="n">${esc(it.count)}</span>` : "";
    const label = nav ? esc(it.label) : `<span class="tab-label" data-label="${esc(it.label)}"><span>${esc(it.label)}</span></span>`;
    return `<button type="button" class="tab" ${state}${it.attrs ?? ""}>${label}${n}</button>`;
  };
  const cls = nav ? `tabs ${o.plain ? "plain" : "switch"}${o.fill ? " fill" : ""}` : "tabs seg";
  return `<div class="${cls}${o.className ? ` ${o.className}` : ""}" role="${nav ? "tablist" : "group"}" aria-label="${esc(o.label)}"${o.attrs ?? ""}>${items.map(one).join("")}</div>`;
}

/** How long 「中斷連線」 (of a connection or a messaging app) waits for its second press. */
export const DISCONNECT_CONFIRM_MS = 5000;

export const btn = (label: string, kind = "", attrs = ""): string =>
  `<button type="button" class="btn${kind ? " " + kind : ""}"${attrs}>${label}</button>`;

interface ActionButton {
  /** HTML label; escape user text before passing it. */
  label: string;
  attrs?: string;
  kind?: "sm";
}

export interface ActionRowOptions {
  primary?: ActionButton;
  /** Secondary controls, with Cancel last when present. */
  secondary?: string;
  destructive?: ActionButton;
  cls?: string;
  sticky?: boolean;
}

/** Danger first and separated, secondary controls next, and the primary action last in tab order. */
export function actionRow(o: ActionRowOptions): string {
  const button = (b: ActionButton, kind: string): string => btn(b.label, `${kind}${b.kind ? ` ${b.kind}` : ""}`, b.attrs);
  return `<div class="action-row${o.cls ? ` ${o.cls}` : ""}${o.sticky ? " is-sticky" : ""}">` +
    (o.destructive ? `<span class="action-destructive">${button(o.destructive, "danger")}</span>` : "") +
    (o.secondary ?? "") + (o.primary ? button(o.primary, "pri") : "") + `</div>`;
}

/**
 * A button with an icon only (trash, ×, chevron, search, settings, sliders): what it does is its
 * label and its tooltip. It has no border, only a fill under the pointer and the focus ring
 * (styles.css `.btn.icon`): a border is what tells a button with words in it. The ⋯ (`more`) is marked
 * `data-overflow`: context-menu.ts presses it when its row is right-clicked.
 */
export const iconButton = (name: IconName, label: string, attrs = "", cls = ""): string =>
  `<button type="button" class="btn icon${name === "trash" ? " danger" : ""}${cls ? " " + cls : ""}" aria-label="${esc(label)}" title="${esc(label)}"${attrs}${name === "more" ? " data-overflow" : ""}>${ico(name)}</button>`;

/** The filled primary send glyph shares the icon source with the line drawings. */
export const sendGlyph = (): string => `<svg class="cmp-plane" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 20.85 12.92a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91Z"/></svg>`;

/** The small icon button on a row (copy, delete, close): `iconButton` at the row's size, borderless too. */
export const iconBtn = (name: IconName, label: string, attrs = "", cls = ""): string => iconButton(name, label, attrs, `row${cls ? " " + cls : ""}`);

/** Keys as caps, such as 「右 Alt」 + 「V」. */
export const keys = (labels: string[]): string =>
  `<span class="keys">${labels.map((k) => `<kbd>${esc(k)}</kbd>`).join("<span>+</span>")}</span>`;

/** A status: always a dot and a word, never the color alone. */
export const st = (kind: "ok" | "warn" | "err" | "idle", text: string): string =>
  `<span class="st${kind === "warn" || kind === "err" ? " " + kind : ""}"><span class="dot ${kind}"></span>${esc(text)}</span>`;

const METER_SEGMENTS = 14;

/**
 * The microphone meter, a row of small bars that light up from the left with its loudness;
 * `setMeter` moves it. `segments` makes a longer one, such as the one as wide as a dropdown.
 */
export const meter = (segments = METER_SEGMENTS): string =>
  `<span class="meter" aria-hidden="true">${"<i></i>".repeat(segments)}</span>`;

/** Lights the meter's segments for a loudness of 0 to 1 (a little headroom, so a loud voice fills it). */
export function setMeter(el: Element | null, level: number): void {
  if (!el) return;
  const segments = el.querySelectorAll("i");
  const lit = Math.round(Math.max(0, Math.min(1, level * 1.05)) * segments.length);
  segments.forEach((segment, k) => segment.classList.toggle("on", k < lit));
}

export interface FieldOptions {
  /** Width in px. */
  w?: number;
  icon?: IconName;
  /** Text before the input, such as `US$`. */
  pre?: string;
  id?: string;
  /** What the input is called for a screen reader (defaults to the placeholder). */
  label?: string;
  num?: boolean;
  type?: "text" | "password";
  invalid?: boolean;
  disabled?: boolean;
}

export function fieldHTML(placeholder: string, value = "", o: FieldOptions = {}): string {
  return (
    `<label class="field"${o.w ? ` style="width:${o.w}px"` : ""}${o.invalid ? " data-invalid" : ""}>` +
    (o.icon ? ico(o.icon) : "") +
    (o.pre ? `<span class="pre">${esc(o.pre)}</span>` : "") +
    `<input ${o.id ? `id="${o.id}" ` : ""}type="${o.type ?? "text"}" value="${esc(value)}" placeholder="${esc(placeholder)}" ` +
    `aria-label="${esc(o.label ?? placeholder)}"${o.num ? ' inputmode="decimal"' : ""}${o.invalid ? ' aria-invalid="true"' : ""} ` +
    `autocomplete="off" spellcheck="false"${o.disabled ? " disabled" : ""}></label>`
  );
}

/** Raphael's words, as the subtitles on the desktop have them: one line, in the language of the window. */
export const line = (text: string): string => `<div class="line"><div class="sub-line">${esc(text)}</div></div>`;

// ---------- motion ----------
// The design's table of motion: a page that changes fades in and rises 6 px (180 ms), the rows of a
// list that is new come in one after another (25 ms apart, 300 ms at most), a dialog grows in from
// 96 % (200 ms) and goes the same way out (140 ms), a switch slides and tints its row (160 ms), a
// toast slides in from the corner with a bar that counts down. Only where something changes; the
// keyframes are in styles.css, and under `prefers-reduced-motion` nothing moves (the rule at the end
// of styles.css), and nothing waits for an animation that does not play.

/** Whether Windows asks for less motion. */
export const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays the way out of `el` (its `leaving` class, which styles.css animates over `ms`) and then calls
 * `done`, at once when nothing may move. Returns what stops the way out and leaves `el` as it was.
 */
export function leave(el: HTMLElement | null, ms: number, done: () => void): () => void {
  if (!el || reducedMotion()) {
    done();
    return () => {};
  }
  el.classList.add("leaving");
  const timer = setTimeout(() => {
    el.classList.remove("leaving");
    done();
  }, ms);
  return () => {
    clearTimeout(timer);
    el.classList.remove("leaving");
  };
}

/** Plays a one-off animation class on `el` again from its start (a page change, say). */
export function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // the class goes, so that its animation starts over when it comes back
  el.classList.add(cls);
}

/**
 * Puts `html` into `host` in place of what it holds (as `innerHTML` does) and lets only what changed
 * move, since a page is drawn again whole after every change:
 * - a list marked `data-stagger="<key>"` has its rows come in one after another when it is new; the
 *   same list drawn again (the same key) is marked `again` and stands still;
 * - a dialog marked `data-dialog="<key>"` grows in when it opens, not each time it is drawn again;
 * - a switch whose state changed since the last drawing slides to it (`flip`) and tints its row for a
 *   moment (`tinted`); one drawn in the state it had stands still. Switches are told apart by their
 *   `aria-label`, which names what each one switches.
 */
export function swapHTML(host: HTMLElement, html: string): void {
  const keys = (attr: string): Set<string> =>
    new Set(Array.from(host.querySelectorAll<HTMLElement>(`[${attr}]`), (node) => node.getAttribute(attr) ?? ""));
  const lists = keys("data-stagger");
  const dialogs = keys("data-dialog");
  const switches = new Map(Array.from(host.querySelectorAll<HTMLElement>(".tg"), (s) => [s.getAttribute("aria-label") ?? "", s.getAttribute("aria-checked")]));
  host.innerHTML = html;
  for (const [attr, seen] of [["data-stagger", lists], ["data-dialog", dialogs]] as const) {
    host.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((node) => {
      if (seen.has(node.getAttribute(attr) ?? "")) node.classList.add("again");
    });
  }
  host.querySelectorAll<HTMLElement>(".tg").forEach((s) => {
    const before = switches.get(s.getAttribute("aria-label") ?? "");
    if (before === undefined || before === s.getAttribute("aria-checked")) return;
    s.classList.add("flip");
    s.closest(".row, .cs-item")?.classList.add("tinted");
  });
}

// ---------- menu ----------

/** The menu or panel that is open, the button that opened it, and what it does with keys of its own. */
interface MenuState {
  el: HTMLElement; anchor: HTMLElement; rect: DOMRect; stopOutside(): void;
  onKey?: (e: KeyboardEvent) => boolean; onClose?: () => void;
  parent: MenuState | null; placement?: "beside" | "start" | "pointer" | "above" | "center" | "right" | "middle"; anchorRect?: () => DOMRect;
  /** Set when a right click asked for the menu: it stands at that point rather than under its button. */
  at?: PointerAt;
  stopHover?: () => void;
}
let menu: MenuState | null = null;
let menuListening = false;

/** Where a right click asked for the menu of a ⋯ button; `until` is when that stops holding (see `pressOverflow`). */
interface PointerAt { x: number; y: number; until: number }
const pointedAt = new WeakMap<HTMLElement, PointerAt>();
/** How long a press waits for a menu that opens after something is read (a message's), and for one that replaces another. */
const POINTED_GRACE_MS = 1500;

/**
 * Presses a ⋯ button for a right click (context-menu.ts). Its own handler runs as it always does. With a point, the menu it
 * opens, and any that replaces it from the same button (「移到分組」 after the first), stands there instead of under the
 * button; a left click on the button afterwards places the menu under it again. Any menu that is open closes first, unless
 * the ⋯ is in it: it would otherwise take the press for a click outside it.
 */
export function pressOverflow(button: HTMLElement, at?: { x: number; y: number }): void {
  if (!menu?.el.contains(button)) closeMenu();
  if (at) pointedAt.set(button, { ...at, until: performance.now() + POINTED_GRACE_MS });
  else pointedAt.delete(button);
  // The row was pressed, not the ⋯: a press on the ⋯ afterwards moves the menu under it (R-UI-124 leaves it no opener).
  pressWithoutOpener(() => button.click());
}

export function closeMenu(): void {
  while (menu) closeMenuLevel();
}
onLocaleChange(closeMenu);

function closeMenuLevel(): void {
  if (!menu) return;
  const closing = menu;
  menu = closing.parent;
  closing.stopOutside();
  closing.stopHover?.();
  closing.anchor.setAttribute("aria-expanded", "false");
  closing.anchor.removeAttribute("aria-controls");
  closing.el.remove();
  if (closing.at) closing.at.until = performance.now() + POINTED_GRACE_MS;
  closing.onClose?.();
}

/** The buttons of the open menu that can be reached with the arrow keys. */
const menuItems = (el: HTMLElement): HTMLButtonElement[] =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).filter((b) => !b.disabled && b.offsetParent !== null && !b.closest("[inert]"));

const MENU_LEAVE_MS = 700;

function insideMenus(target: EventTarget | null): boolean {
  if (target instanceof Node) {
    for (let current = menu; current; current = current.parent) if (current.el.contains(target)) return true;
  }
  return false;
}

function listenForMenuEvents(): void {
  if (menuListening) return;
  menuListening = true;
  document.addEventListener("keydown", (e) => {
    if (!menu || e.isComposing || e.keyCode === 229) return;
    const target = e.target === document ? document.activeElement : e.target;
    if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", " "].includes(e.key) && !insideMenus(target) &&
      !(target instanceof Element && target.closest('input, textarea, [contenteditable="true"]'))) {
      closeMenu();
      return;
    }
    if (menu.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    if (menu.parent && (e.key === "Escape" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const anchor = menu.anchor;
      closeMenuLevel(); anchor.focus({ preventScroll: true });
      return;
    }
    if (e.key === "Tab" && menu.el.getAttribute("role") === "dialog") {
      // A popover form (the computer location) keeps Tab inside it; only tabbing past its ends closes it.
      const stops = [...menu.el.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter(stop => stop.getClientRects().length > 0);
      const at = stops.indexOf(document.activeElement as HTMLElement), next = at + (e.shiftKey ? -1 : 1);
      if (at !== -1 && next >= 0 && next < stops.length) return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      const anchor = menuRootAnchor() ?? menu.anchor;
      closeMenu();
      anchor.focus({ preventScroll: true });
      return;
    }
    const items = menuItems(menu.el);
    if (e.key === "ArrowRight" && (document.activeElement as HTMLElement | null)?.getAttribute("aria-haspopup") === "menu") {
      e.preventDefault(); (document.activeElement as HTMLElement).click(); return;
    }
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  });
  // Leaving the window closes a menu. Another window taking the focus for a moment does not, and neither does a press
  // inside a frame of this window, which is a blur too (measured: a real one came back in 450 ms and closed a menu).
  let leaving: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("blur", () => {
    clearTimeout(leaving);
    leaving = setTimeout(() => { if (!document.hasFocus()) closeMenu(); }, MENU_LEAVE_MS);
  });
  window.addEventListener("resize", closeMenu);
  // A click of the person's own on a ⋯ puts its menu under it again, however an earlier right click placed it.
  document.addEventListener("click", (e) => {
    if (e.isTrusted && e.target instanceof Element) { const more = e.target.closest<HTMLElement>("[data-overflow]"); if (more) pointedAt.delete(more); }
  }, true);
  // Scroll intent closes menus before the page moves; scroll events alone also come from layout and follow-bottom.
  for (const type of ["wheel", "touchmove"]) document.addEventListener(type, e => {
    if (menu && !insideMenus(e.target)) closeMenu();
  }, { capture: true, passive: true });
  document.addEventListener(
    "scroll",
    (e) => {
      if (menu?.anchorRect && !menu.at && !insideMenus(e.target)) placeMenu();
    },
    true,
  );
}

/** Whether a menu is open for `anchor`. */
export const menuIsOpenFor = (anchor: HTMLElement): boolean => menu?.anchor === anchor;

/** Opens a selector from the keyboard without changing its page's click behavior. */
export function openMenuOnArrow(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || (e.key !== "ArrowDown" && e.key !== "ArrowUp") || !(e.target instanceof Element)) return false;
  const anchor = e.target.closest<HTMLButtonElement>(".sel");
  if (!anchor || anchor.disabled || menuIsOpenFor(anchor)) return false;
  e.preventDefault();
  // The Settings listens on `document`, like the menu: stopping only the propagation would still
  // let a menu listener added after the page's (the first Settings after launch) see this key and
  // move on from the item just focused.
  e.stopImmediatePropagation();
  anchor.click();
  if (menu?.anchor === anchor) {
    const items = menuItems(menu.el);
    (e.key === "ArrowUp" ? items[items.length - 1] : items[0])?.focus();
  }
  return true;
}

const pointRect = (at: PointerAt): DOMRect => new DOMRect(at.x, at.y, 0, 0);

/**
 * Keep anchored menus inside the usable viewport, below any custom window controls. A menu ends at its
 * anchor's right edge by default; `start` (a text completion) begins at its left edge and prefers the space above;
 * `pointer` (a right click, whose anchor is a point) begins at the point and prefers the space below.
 */
export function menuPlacement(
  anchor: Pick<DOMRect, "top" | "bottom" | "right"> & Partial<Pick<DOMRect, "left">>,
  size: { width: number; height: number },
  viewport: { width: number; height: number; headerBottom: number },
  alignment: "end" | "start" | "pointer" | "above" | "center" | "right" | "middle" = "end",
): { left: number; top: number; maxHeight: number } {
  const upper = viewport.headerBottom + 8;
  const lower = Math.max(upper, viewport.height - 8);
  if (alignment === "middle") {
    // A dialog: the middle of the window both ways, whatever the anchor, kept below the window controls and inside the window.
    const room = Math.max(0, lower - upper), height = Math.min(size.height, room);
    return { left: Math.max(8, Math.min((viewport.width - size.width) / 2, viewport.width - size.width - 8)), top: Math.max(upper, Math.min((viewport.height - height) / 2, lower - height)), maxHeight: room };
  }
  if (alignment === "right") {
    // Beside the anchor on its right, ending where the anchor ends (the avatar at the foot of the rail), kept inside the window.
    const room = Math.max(0, lower - upper), height = Math.min(size.height, room);
    return { left: Math.max(8, Math.min(anchor.right + 8, viewport.width - size.width - 8)), top: Math.max(upper, Math.min(anchor.bottom - height, lower - height)), maxHeight: room };
  }
  const belowTop = Math.max(upper, Math.min(anchor.bottom + 4, lower));
  const aboveBottom = Math.min(lower, Math.max(upper, anchor.top - 4));
  const below = lower - belowTop;
  const above = aboveBottom - upper;
  const useBelow = alignment === "start" || alignment === "above"
    ? !(size.height <= above || (size.height > below && above >= below))
    : size.height <= below || (size.height > above && below >= above);
  const maxHeight = useBelow ? below : above;
  return {
    // "center" stands under the middle of its anchor (a face picker under the face).
    left: Math.max(8, Math.min(alignment === "center" ? ((anchor.left ?? anchor.right) + anchor.right - size.width) / 2 : alignment === "end" || alignment === "above" ? anchor.right - size.width : anchor.left ?? anchor.right, viewport.width - size.width - 8)),
    top: useBelow ? belowTop : aboveBottom - Math.min(size.height, maxHeight),
    maxHeight,
  };
}

/** A nested menu follows its row, preferring the right side while staying within the viewport. */
export function submenuPlacement(
  anchor: Pick<DOMRect, "top" | "left" | "right">,
  size: { width: number; height: number },
  viewport: { width: number; height: number; headerBottom: number },
): { left: number; top: number; maxHeight: number } {
  const upper = viewport.headerBottom + 8, lower = Math.max(upper, viewport.height - 8);
  const right = anchor.right;
  return {
    left: Math.max(8, Math.min(right + size.width <= viewport.width - 8 ? right : anchor.left - size.width, viewport.width - size.width - 8)),
    top: Math.max(upper, Math.min(anchor.top, lower - Math.min(size.height, lower - upper))),
    maxHeight: lower - upper,
  };
}

/** Dropdowns prefer below; start-aligned text completions prefer above their character. */
export function placeMenu(): void {
  if (!menu) return;
  const { el, anchor } = menu;
  const r = menu.anchorRect?.() ?? menu.rect;
  const headerBottom = document.getElementById("window-chrome")?.getBoundingClientRect().bottom ?? 0;
  // A dropdown's menu is at least as wide as the dropdown itself.
  if (anchor.classList?.contains("sel")) el.style.minWidth = `${Math.round(r.width)}px`;
  // Release the previous side's height limit before measuring a menu after scrolling or redraw.
  const room = Math.max(0, innerHeight - headerBottom - 16);
  el.style.maxHeight = "";
  // A menu that scrolls (`menu-scroll`) has a height of its own in its CSS; the window's room only ever shortens it.
  const cap = el.classList?.contains("menu-scroll") ? Math.min(room, parseFloat(getComputedStyle(el).maxHeight) || room) : room;
  el.style.maxHeight = `${cap}px`;
  const size = { width: el.offsetWidth, height: el.offsetHeight }, viewport = { width: innerWidth, height: innerHeight, headerBottom };
  const placement = menu.placement === "beside" ? submenuPlacement(r, size, viewport) : menuPlacement(r, size, viewport, menu.placement === "start" || menu.placement === "pointer" || menu.placement === "above" || menu.placement === "center" || menu.placement === "right" || menu.placement === "middle" ? menu.placement : "end");
  if (cap < room) placement.maxHeight = Math.min(placement.maxHeight, cap);
  if (menu.placement === "beside") {
    const first = el.querySelector<HTMLElement>("button");
    const inset = first ? first.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
    placement.top = Math.max(headerBottom + 8, placement.top - inset);
  }
  el.style.maxHeight = `${placement.maxHeight}px`;
  el.style.left = `${placement.left}px`;
  el.style.top = `${placement.top}px`;
}

interface MenuPoint { x: number; y: number }

/** The corridor includes either opening direction, but never motion away from its near edge. */
export function submenuCorridor(origin: MenuPoint, point: MenuPoint, box: Pick<DOMRect, "left" | "right" | "top" | "bottom">): boolean {
  const edge = origin.x < box.left ? box.left : box.right;
  const ratio = (point.x - origin.x) / (edge - origin.x);
  return ratio > 0 && ratio <= 1 && point.y >= origin.y + (box.top - 8 - origin.y) * ratio &&
    point.y <= origin.y + (box.bottom + 8 - origin.y) * ratio;
}

/** Every submenu row shares its hover delay, corridor and delayed departure here. */
function listenForSubmenus(state: MenuState): void {
  if (!state.el.querySelector('[aria-haspopup="menu"]')) return;
  let timer: ReturnType<typeof setTimeout> | undefined, pending: HTMLElement | null = null;
  let origin: MenuPoint | undefined;
  const cancel = (): void => { clearTimeout(timer); timer = undefined; pending = null; };
  const childOf = (): MenuState | null => {
    let child = menu;
    while (child && child.parent !== state) child = child.parent;
    return child;
  };
  const closeChild = (): void => { while (menu && menu !== state && childOf()) closeMenuLevel(); };
  const move = (event: PointerEvent): void => {
    if (!(event.target instanceof Element) || !state.el.isConnected) return;
    const child = childOf(), point = { x: event.clientX, y: event.clientY };
    const inChild = child && child.el.contains(event.target);
    const row = event.target.closest<HTMLElement>('button[role="menuitem"], button[role="menuitemradio"]');
    if (inChild) { cancel(); return; }
    if (row && state.el.contains(row)) {
      if (child?.anchor === row) { cancel(); origin = point; return; }
      if (child && origin && submenuCorridor(origin, point, child.el.getBoundingClientRect())) return;
      if (pending === row) return;
      cancel();
      const switching = !!child;
      closeChild();
      if (row.getAttribute("aria-haspopup") !== "menu") return;
      origin = point; pending = row;
      const open = (): void => {
        pending = null; timer = undefined;
        if (!row.isConnected || !state.el.isConnected) return;
        const focus = document.activeElement as HTMLElement | null;
        row.click();
        focus?.focus({ preventScroll: true });
      };
      if (switching) open(); else timer = setTimeout(open, 120);
      return;
    }
    if (state.el.contains(event.target)) { cancel(); return; }
    if (timer && pending === null) return;
    cancel();
    if (child) timer = setTimeout(() => { closeChild(); cancel(); }, 250);
  };
  document.addEventListener("pointermove", move);
  state.stopHover = () => { cancel(); document.removeEventListener("pointermove", move); };
}

export interface PopoverOptions {
  /** Beside preserves its parent menu; start aligns text completions above their character; right stands on the anchor's right, ending where it ends; middle stands in the middle of the window, whatever the anchor. */
  placement?: "beside" | "start" | "above" | "center" | "right" | "middle";
  /** A live text/caret rectangle; the field remains the dismissal and focus anchor. */
  anchorRect?: () => DOMRect;
  onClose?: () => void;
  /** The classes of the panel, `menu` among them. */
  className: string;
  role: string;
  label?: string;
  /** Keys the panel handles itself (return true when it did); the others move between its buttons. */
  onKey?: (e: KeyboardEvent) => boolean;
}

/**
 * Opens a panel with `html` under `anchor`: it closes on Escape, Tab, a click outside or the window
 * going away, and the arrow keys move between its buttons. Returns the panel; the caller focuses in it.
 */
export function openPopover(anchor: HTMLElement, html: string, o: PopoverOptions): HTMLElement {
  listenForMenuEvents();
  // A panel that places itself (a caret, a submenu) keeps its own place; any other from a button that a right click pressed stands where it was.
  const pointed = o.anchorRect || o.placement === "beside" || o.placement === "middle" ? undefined : pointedAt.get(anchor);
  const at = pointed && pointed.until > performance.now() ? pointed : undefined;
  let parent: MenuState | null = null;
  if (o.placement === "beside") for (let current = menu; current; current = current.parent) if (current.el.contains(anchor)) { parent = current; break; }
  const rowRect = anchor.getBoundingClientRect();
  const parentRect = parent?.el.getBoundingClientRect();
  const sameAnchor = menu && (menu.anchor === anchor || (!menu.anchor.isConnected && anchor.dataset.k && menu.anchor.dataset.k === anchor.dataset.k));
  const previous = !parent && sameAnchor && !menu!.at && !o.anchorRect ? menu!.rect : undefined;
  const rect = at ? pointRect(at) : o.anchorRect?.() ?? (parentRect ? { top: rowRect.top, bottom: rowRect.bottom, height: rowRect.height,
    left: parentRect.left, right: parentRect.right, width: parentRect.width } as DOMRect : previous ?? rowRect);
  if (parent) while (menu && menu !== parent) closeMenuLevel();
  if (!parent) closeMenu();
  const el = document.createElement("div");
  el.className = o.className;
  el.id = parent ? "app-submenu" : "app-popover";
  el.tabIndex = -1;
  el.setAttribute("role", o.role);
  if (o.label) el.setAttribute("aria-label", o.label);
  el.innerHTML = html;
  document.body.append(el);
  if (at) at.until = Infinity;
  menu = { el, anchor, rect, parent, placement: at ? "pointer" : o.placement, anchorRect: at ? () => pointRect(at) : o.anchorRect, at,
    stopOutside: registerDismissal(el, () => { const root = menuRootAnchor(); closeMenu(); if (!pressWentThrough()) root?.focus({ preventScroll: true }); }, undefined, parent?.el ?? anchor), onKey: o.onKey, onClose: o.onClose };
  anchor.setAttribute("aria-expanded", "true");
  anchor.setAttribute("aria-controls", el.id);
  placeMenu();
  listenForSubmenus(menu);
  return el;
}

/**
 * The menu of a ⋯ whose one item destroys something (R-UI-56). The first press asks in the item's place, for
 * `DISCONNECT_CONFIRM_MS`; the second closes the menu and does `run`. Closing the menu forgets the first press.
 */
export function openConfirmMenu(anchor: HTMLElement, o: { label: string; ask: string; run(): void }): void {
  let asking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const el = openPopover(
    anchor,
    `<button type="button" role="menuitem" class="danger" tabindex="-1" data-confirm-item><span class="ck">${ico("trash")}</span><span class="mt">${esc(o.label)}</span></button>`,
    { className: "menu mb-menu", role: "menu", label: anchor.getAttribute("aria-label") ?? undefined, onClose: () => clearTimeout(timer) },
  );
  const item = el.querySelector<HTMLElement>("[data-confirm-item]")!;
  const say = (text: string): void => {
    item.querySelector<HTMLElement>(".mt")!.textContent = text;
    placeMenu();
  };
  item.addEventListener("click", () => {
    if (asking) {
      closeMenu();
      anchor.focus({ preventScroll: true });
      o.run();
      return;
    }
    asking = true;
    say(o.ask);
    timer = setTimeout(() => {
      asking = false;
      say(o.label);
    }, DISCONNECT_CONFIRM_MS);
  });
  item.focus();
}

function menuRootAnchor(): HTMLElement | undefined {
  let root = menu;
  while (root?.parent) root = root.parent;
  return root?.anchor;
}

/** An item at the foot of a menu that does something rather than choose (「重新搜尋麥克風」). */
export interface MenuAction {
  label: string;
  desc?: string;
  icon?: IconName;
  /** A mark drawn for this item alone, in the icon's place (trusted HTML: a member's faces, a tile). */
  mark?: string;
  submenu?: boolean;
  /** What it does is under way: the item stays where it is but does nothing until it is done. */
  busy?: boolean;
  /** Runs when the item is chosen. The menu stays open, so that what the action finds shows in it. */
  run(anchor: HTMLElement): void;
}

/**
 * Opens a menu of `options` under `anchor`, with `current` checked. `onPick` gets the value chosen.
 * `head` is a line of small print above the choices (what their details mean), and `actions` are
 * items below them, after a line, that do something instead of choosing.
 */
export function openMenu(
  anchor: HTMLElement,
  options: Choice[],
  current: string,
  onPick: (value: string) => void,
  head?: string,
  actions: readonly MenuAction[] = [],
  placement?: Pick<PopoverOptions, "placement" | "anchorRect"> & { selectionIndicator?: boolean; /** `false`: the focus stays where it is (a field an input method is composing in). */ focus?: boolean; completion?: boolean; className?: string; pageSize?: number;
    /** The menu has a fixed height in its CSS and every row stays on one list that scrolls (a mouse wheel, the arrow keys), never in pages. */ scroll?: boolean },
): void {
  if (placement?.pageSize && options.length > placement.pageSize) {
    const pageSize = placement.pageSize;
    const draw = (page: number): void => {
      const start = page * pageSize;
      openMenu(anchor, options.slice(start, start + pageSize), current, onPick, head, [
        ...(page ? [{ label: t("completion.previous"), run: () => draw(page - 1) }] : []),
        ...(start + pageSize < options.length ? [{ label: t("completion.next"), run: () => draw(page + 1) }] : []),
        ...actions,
      ], { ...placement, pageSize: undefined });
    };
    draw(0); return;
  }
  const active = document.activeElement as HTMLElement | null;
  const again = menu && (menu.anchor === anchor || (!menu.anchor.isConnected && menu.anchor.dataset.k === anchor.dataset.k)) &&
    active && menu.el.contains(active) ? active : null;
  const detailed = options.some((o) => o.detail);
  const described = options.some((o) => o.desc) || actions.some(a => a.desc);
  const html =
    (head ? `<div class="menu-head" aria-hidden="true">${esc(head)}</div>` : "") +
    options
      .map(
        (o, index) =>
          (o.group && o.group !== options[index - 1]?.group ? `<div class="menu-head" aria-hidden="true">${esc(o.group)}</div>` : "") +
          `<button type="button" class="menu-choice" role="${placement?.completion ? "option" : "menuitemradio"}" tabindex="-1" data-value="${esc(o.value)}" ${placement?.completion ? `aria-selected="false" aria-posinset="${index + 1}" aria-setsize="${options.length}"` : `aria-checked="${o.value === current}"`}` +
          `${o.title ? ` title="${esc(o.title)}"` : ""}>` +
          (o.lead ? `<span class="mlead" aria-hidden="true">${o.lead}</span>` : "") +
          (o.desc
            ? `<span class="mtd"><span class="mt">${esc(o.label)}</span><span class="mdesc">${esc(o.desc)}</span>${o.source ? `<small class="msource">${esc(o.source)}</small>` : ""}</span>`
            : `<span class="mt">${esc(o.label)}</span>`) +
          (!o.desc && o.source ? `<small class="msource">${esc(o.source)}</small>` : "") +
          (o.tag ? `<span class="mtag">${esc(o.tag)}</span>` : "") +
          (o.trail ? `<span class="mtrail">${esc(o.trail)}</span>` : "") +
          (o.detail ? `<span class="md num">${esc(o.detail)}</span>` : "") +
          (placement?.selectionIndicator === false ? "" : `<span class="ck">${o.value === current ? CHECK : ""}</span>`) +
          `</button>`,
      )
      .join("") +
    (options.length && actions.length ? `<div class="menu-sep" role="separator"></div>` : "") +
    actions
      .map(
        (a, i) =>
          `<button type="button" role="${placement?.completion ? "option" : "menuitem"}"${placement?.completion ? ' aria-selected="false"' : ""} tabindex="-1" class="menu-action" data-action="${i}"${a.busy ? ' aria-disabled="true"' : ""}${a.submenu ? ' aria-haspopup="menu" aria-expanded="false"' : ""}>` +
          `${a.mark ? `<span class="mmark" aria-hidden="true">${a.mark}</span>` : `<span class="ck">${a.icon ? ico(a.icon) : ""}</span>`}<span class="mtd"><span class="mt">${esc(a.label)}</span>${a.desc ? `<span class="mdesc">${esc(a.desc)}</span>` : ""}</span>${a.submenu ? ico("right") : ""}</button>`,
      )
      .join("");
  const el = openPopover(anchor, html, {
    ...placement,
    className: `menu${detailed ? " detailed" : ""}${described ? " described" : ""}${placement?.placement === "beside" ? " menu-submenu" : ""}${placement?.completion ? " completion-menu" : ""}${placement?.scroll ? " menu-scroll" : ""}${placement?.className ? " " + placement.className : ""}`,
    role: placement?.completion ? "listbox" : "menu",
    label: anchor.getAttribute("aria-label") ?? undefined,
    onClose: placement?.completion ? () => { anchor.removeEventListener("keydown", completionKey, true); anchor.removeAttribute("aria-activedescendant"); } : undefined,
  });
  if (placement?.completion && !placement.scroll && options.length > 1 && el.scrollHeight > el.clientHeight + 1) {
    const rowHeight = Math.max(34, ...[...el.querySelectorAll("button")].map(row => row.getBoundingClientRect().height));
    const headingsHeight = [...el.querySelectorAll(".menu-head")].reduce((height, head) => height + (head.getBoundingClientRect().height || 24) + 4, 0);
    const pageSize = Math.max(1, Math.min(8, options.length - 1, Math.floor((el.clientHeight - headingsHeight - 34 * (actions.length + 2) - 16) / rowHeight)));
    openMenu(anchor, options, current, onPick, head, actions, { ...placement, pageSize });
    return;
  }
  let selected = 0;
  const buttons = [...el.querySelectorAll<HTMLButtonElement>("button")];
  function highlight(keyboard = false): void {
    buttons.forEach((button, index) => {
      button.id = `completion-${index}`;
      if (button.hasAttribute("aria-selected")) button.setAttribute("aria-selected", String(index === selected));
      button.setAttribute("aria-posinset", String(index + 1)); button.setAttribute("aria-setsize", String(buttons.length));
      button.classList.toggle("is-active", index === selected);
    });
    if (buttons[selected]) anchor.setAttribute("aria-activedescendant", buttons[selected].id);
    // The arrow keys carry the highlight out of sight in a list that scrolls: the row they land on comes into view.
    if (keyboard && placement?.scroll) buttons[selected]?.scrollIntoView?.({ block: "nearest" });
  }
  function completionKey(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229 || !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === "Escape") { closeMenu(); return; }
    if (event.key === "Enter" || event.key === "Tab") { buttons[selected]?.click(); return; }
    selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    highlight(true);
  }
  if (placement?.completion) {
    anchor.addEventListener("keydown", completionKey, true);
    el.addEventListener("pointerdown", event => event.preventDefault());
    // A list that scrolls moves under a pointer that has not: the browser's own pointermove for that carries the same point and is no choice.
    let lastPoint = "";
    buttons.forEach((button, index) => button.addEventListener("pointermove", event => {
      const point = `${event.clientX},${event.clientY}`;
      if (point === lastPoint) return;
      lastPoint = point; selected = index; highlight();
    }));
    highlight();
  }
  // The menu is only so wide (styles.css): a label it cuts short has its whole text as a tooltip.
  el.querySelectorAll<HTMLElement>("button").forEach((button) => {
    const label = button.querySelector<HTMLElement>(".mt");
    if (label && !button.hasAttribute("title") && label.scrollWidth > label.clientWidth) button.setAttribute("title", label.textContent ?? "");
  });
  el.addEventListener("click", (e) => {
    const pick = (e.target as Element).closest("button");
    if (!pick) return;
    if (pick.dataset.action !== undefined) {
      const action = actions[Number(pick.dataset.action)];
      if (action && !action.busy) action.run(pick);
      return;
    }
    const root = menuRootAnchor();
    closeMenu();
    (root ?? anchor).focus();
    onPick(pick.dataset.value ?? "");
  });
  // The item that had the focus before the menu was drawn again keeps it: a choice by its value, an
  // action by its place.
  const remembered = again === null ? null : Array.from(el.querySelectorAll<HTMLElement>("button")).find((button) =>
    again.dataset.action !== undefined ? button.dataset.action === again.dataset.action : button.dataset.value === again.dataset.value);
  if (placement?.focus !== false && !placement?.completion) (remembered ?? el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>("button") ?? el).focus();
}

/** Matches within each section, best first and stable: exact, start, inside, then near misses (`find-match.ts`), by
 * the value, the label and other names. */
export function matchingChoices(options: Choice[], query: string): Choice[] {
  // A space after the words ends them: 「@研究組 」 is a finished mention, and only a longer name that goes on after those
  // words ("Google " for Google Calendar) still answers it.
  const finished = /\s$/u.test(query) ? query.trimStart().toLocaleLowerCase() : "";
  const scores = new Map(options.map(choice => {
    const names = [choice.value, choice.label.replace(/^[@/]/, ""), ...(choice.aliases ?? [])];
    return [choice, finished && !names.some(name => name.toLocaleLowerCase().startsWith(finished)) ? Infinity : nameScore(names, query)];
  }));
  const score = (choice: Choice): number => scores.get(choice)!;
  const groups = [...new Set(options.map(option => option.group))];
  return groups.flatMap(group => options.filter(option => option.group === group && score(option) < Infinity).sort((a, b) => score(a) - score(b)));
}

/** The check mark of a chosen item: drawn, so that it is the same in every font; the `check` of ICON,
 * drawn at 16 px by `.menu .ck svg`. */
export const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON.check}</svg>`;

// ---------- toasts ----------

/** How long a short note stays: a little more time for a longer one, which has to be read. */
const infoMs = (message: string): number => Math.min(8000, 2000 + 100 * message.length);

/** The toasts at the bottom of the window: short notes, and the ones with 「復原」. */
class Toaster implements Notifier {
  private host: HTMLElement | null = null;
  private undoToast: HTMLElement | null = null;
  private messages = new Map<HTMLElement, () => string>();

  constructor() {
    onLocaleChange(() => {
      for (const [toast, message] of this.messages) {
        if (!toast.isConnected) { this.messages.delete(toast); continue; }
        toast.querySelector("span")!.textContent = message();
        const undo = toast.querySelector("button");
        if (undo) undo.textContent = t("ui.001");
      }
    });
  }

  private container(): HTMLElement {
    if (!this.host?.isConnected) {
      this.host = document.createElement("div");
      this.host.className = "toasts";
      document.body.append(this.host);
    }
    this.lift(this.host);
    return this.host;
  }

  /**
   * A conversation's composer grows with its attachments, its quote and its draft, and a note that stands a fixed height above the
   * window's foot then lay over its attachments (2026-11-11, the twenty-first file). The note stands over the composer's top edge,
   * wherever that is; styles.css keeps its usual height as the least.
   */
  private lift(host: HTMLElement): void {
    const composers = [...document.querySelectorAll<HTMLElement>(".page-agent:not([hidden]) .composer")];
    const top = composers.map(composer => composer.getBoundingClientRect()).find(box => box.width > 0 && box.height > 0)?.top;
    if (top === undefined) host.style.removeProperty("--toast-lift");
    else host.style.setProperty("--toast-lift", `${Math.max(0, Math.round(window.innerHeight - top + 12))}px`);
  }

  /**
   * Shows `message`. With `undo` the toast stays until `hide()` (the 10 seconds of `Undoable`) and has
   * a 「復原」 button; without, it goes by itself. Either way a thin bar along its foot counts down the
   * time it has left (styles.css), so that its going is no surprise.
   */
  show(message: string, undo?: () => void): void {
    // The same note again takes the place of the one on screen and starts its time over: six failures in a row are one
    // note, not a pile of six (owner's screen, 2026-11-11).
    for (const shown of [...this.messages.keys()]) {
      if (shown !== this.undoToast && shown.querySelector("span")?.textContent === message) { shown.remove(); this.messages.delete(shown); }
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-atomic", "true");
    const text = document.createElement("span");
    this.messages.set(toast, translatedMessage(message));
    text.textContent = message;
    toast.append(text);
    const ms = undo ? UNDO_MS : infoMs(message);
    if (undo) {
      if (this.undoToast) this.messages.delete(this.undoToast);
      this.undoToast?.remove();
      this.undoToast = toast;
      toast.insertAdjacentHTML("beforeend", btn(t("ui.001"), "sm"));
      toast.querySelector("button")?.addEventListener("click", undo);
    } else {
      setTimeout(() => { toast.remove(); this.messages.delete(toast); }, ms);
    }
    const bar = document.createElement("i");
    bar.className = "toast-bar";
    bar.setAttribute("aria-hidden", "true");
    bar.style.animationDuration = `${ms}ms`;
    toast.append(bar);
    this.container().append(toast);
  }

  /** Same as `show(message)`. */
  info(message: string): void {
    this.show(message);
  }

  notice(render: () => string): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = render();
    const stop = onLocaleChange(() => { toast.innerHTML = render(); });
    this.container().append(toast);
    setTimeout(() => { stop(); toast.remove(); }, 12000);
  }

  /** Takes the toast with 「復原」 away. */
  hide(): void {
    if (this.undoToast) this.messages.delete(this.undoToast);
    this.undoToast?.remove();
    this.undoToast = null;
  }
}

export const toaster = new Toaster();

// ---------- clipboard ----------

/** Puts `text` on the clipboard. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // not allowed here: try the old way
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error(t("ui.002"));
}

const copyFeedback = new WeakMap<HTMLElement, { html: string; label: string | null; title: string | null; tooltip: string | null; width: string; timer?: ReturnType<typeof setTimeout> }>();
const copyPresses = new WeakMap<HTMLElement, number>();

/** Reserve both translated labels before the first press so feedback never clips or resizes. */
export function copyLabel(label: string, withIcon = false): string {
  return `<span class="copy-label"><span>${withIcon ? ico("copy") : ""}${esc(label)}</span><span class="copy-reserve" aria-hidden="true">${ico("check")}${esc(t("setup.copied"))}</span></span>`;
}

function resetCopyButton(button: HTMLElement): void {
  const state = copyFeedback.get(button);
  if (!state) return;
  clearTimeout(state.timer);
  button.innerHTML = state.html; button.style.width = state.width;
  for (const [name, value] of [["aria-label", state.label], ["title", state.title], ["data-tooltip", state.tooltip]] as const) {
    if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
  }
  copyFeedback.delete(button);
}

/** Copy feedback belongs to the pressed control and never shifts its neighbours. */
export async function copyButton(button: HTMLElement, text: string): Promise<boolean> {
  const press = (copyPresses.get(button) ?? 0) + 1; copyPresses.set(button, press);
  try { await copyText(text); }
  catch { if (copyPresses.get(button) === press) resetCopyButton(button); toaster.info(t("ui.002")); return false; }
  if (copyPresses.get(button) !== press) return true;
  let state = copyFeedback.get(button);
  if (!state) {
    state = { html: button.innerHTML, label: button.getAttribute("aria-label"), title: button.getAttribute("title"), tooltip: button.getAttribute("data-tooltip"), width: button.style.width };
    const width = button.getBoundingClientRect().width;
    if (width) button.style.width = `${width}px`;
    copyFeedback.set(button, state);
  }
  clearTimeout(state.timer);
  const label = t("setup.copied");
  button.innerHTML = ico("check") + (button.classList.contains("icon") ? "" : `<span>${esc(label)}</span>`);
  button.setAttribute("aria-label", label);
  if (state.tooltip !== null) { button.dataset.tooltip = label; button.removeAttribute("title"); }
  else button.title = label;
  state.timer = setTimeout(() => resetCopyButton(button), 1600);
  return true;
}
