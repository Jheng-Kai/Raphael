// The monthly limit (Settings › 用量 › 概覽, the gear on 這個月's card): a small popover with 不設上限 or 設上限 as a dropdown,
// the amount in US$ when there is one. A change goes to the core at once, with no save
// button: 不設上限 stores null, an amount is stored when it is typed (Enter, leaving the field, or closing the popover).
// The popover stays open over a redraw of the page, on the gear drawn again in its place (`follow`).

import { parseLimit } from "./format";
import { t } from "./i18n";
import { type Choice, closeMenu, esc, fieldHTML, menuIsOpenFor, openMenu, openPopover, patchHTML, placeMenu, sel } from "./ui";

export type CapMode = "none" | "set";

/** A limit as the field holds it: digits and a point, whatever the language (parseLimit reads it back). */
const limitText = (limit: number): string => (Number.isInteger(limit) ? String(limit) : limit.toFixed(2));

export const CAP_MODES = (): Choice[] => [
  { value: "none", label: t("usage.noCap") },
  { value: "set", label: t("usage.setCap") },
];

/** What the popover shows: the choice, the amount being typed and whether it is one. */
export function usageCapHTML(o: { mode: CapMode; draft: string; invalid: boolean }): string {
  return `<h3>${esc(t("common.monthlyLimit"))}</h3>` +
    sel(CAP_MODES(), o.mode, t("common.monthlyLimit"), ' data-k="usage-cap-mode"') +
    (o.mode === "set" ? fieldHTML("", o.draft, { id: "limit-input", pre: "US$", num: true, label: t("common.monthlyLimit"), invalid: o.invalid }) : "") +
    (o.invalid ? `<p class="cap-error" role="alert">${esc(t("common.limitInvalid"))}</p>` : "");
}

export interface UsageCap {
  /** Opens the popover under the gear, or closes it when it is open. */
  toggle(anchor: HTMLElement): void;
  /** Whether it is open. */
  open(): boolean;
  /** The page was drawn again: the popover, if open, moves to the gear now in its place, with what was typed. */
  follow(anchor: HTMLElement | null): void;
}

/**
 * `limit` is the limit in force (null for none); `save` stores a new one (null for none) and draws the page again.
 * The limit in force decides the choice each time the popover opens; 設上限 with nothing typed yet stores nothing.
 */
export function createUsageCap(o: { limit(): number | null; save(limit: number | null): Promise<void> }): UsageCap {
  let panel: HTMLElement | null = null;
  let mode: CapMode = "none", draft = "", invalid = false;
  /** The popover is being moved to the gear drawn again: its closing stores nothing. */
  let moving = false;

  const draw = (): void => {
    if (!panel) return;
    patchHTML(panel, usageCapHTML({ mode, draft, invalid }));
    placeMenu();
  };

  /** Stores what is typed if it is a limit and not the one in force; says so under the field when it is no number. */
  const commit = (): void => {
    if (mode !== "set" || draft.trim() === "") return;
    const limit = parseLimit(draft);
    invalid = limit === null;
    if (limit === null) { draw(); return; }
    draw();
    if (limit !== o.limit()) void o.save(limit);
  };

  function show(anchor: HTMLElement, focus: "choice" | "field" | null): void {
    panel = openPopover(anchor, usageCapHTML({ mode, draft, invalid }), {
      className: "menu usage-cap", role: "dialog", label: t("common.monthlyLimit"),
      // Under the whole spend card, at the gear's right: the limit line and its bar stay in sight while it changes.
      anchorRect: () => {
        const gear = anchor.getBoundingClientRect(), card = anchor.closest(".spend-card")?.getBoundingClientRect();
        return card ? new DOMRect(gear.left, card.top, gear.width, card.height) : gear;
      },
      onClose: () => {
        if (moving) return;
        // Escape or a press outside: what was typed is the owner's choice all the same.
        const typed = panel?.querySelector<HTMLInputElement>("#limit-input")?.value;
        panel = null;
        if (typed !== undefined) draft = typed;
        commit();
      },
    });
    const here = panel;
    here.addEventListener("click", (event) => {
      const choose = (event.target as Element).closest<HTMLElement>('[data-k="usage-cap-mode"]');
      if (!choose) return;
      openMenu(choose, CAP_MODES(), mode, (value) => {
        if (value !== "none" && value !== "set") return;
        // The submenu closed the popover with it: it opens again where it was, with the new choice.
        moving = true;
        try { show(anchor.isConnected ? anchor : choose, null); } finally { moving = false; }
        if (value === mode) { focusIn(focus === "field" ? "field" : "choice"); return; }
        mode = value; invalid = false;
        if (value === "none") { draft = ""; draw(); focusIn("choice"); if (o.limit() !== null) void o.save(null); }
        else { draft = o.limit() === null ? "" : limitText(o.limit()!); draw(); focusIn("field"); }
      }, undefined, [], { placement: "beside" });
    });
    here.addEventListener("keydown", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === "limit-input" && event.key === "Enter" && !event.isComposing) { event.preventDefault(); draft = input.value; commit(); }
    });
    here.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === "limit-input") draft = input.value;
    });
    here.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id === "limit-input") { draft = input.value; commit(); }
    });
    focusIn(focus);
  }

  function focusIn(focus: "choice" | "field" | null): void {
    if (!panel || focus === null) return;
    const target = focus === "field" ? panel.querySelector<HTMLInputElement>("#limit-input") : panel.querySelector<HTMLElement>('[data-k="usage-cap-mode"]');
    target?.focus({ preventScroll: true });
  }

  return {
    toggle(anchor) {
      if (panel && menuIsOpenFor(anchor)) { closeMenu(); anchor.focus({ preventScroll: true }); return; }
      const limit = o.limit();
      mode = limit === null ? "none" : "set"; draft = limit === null ? "" : limitText(limit); invalid = false;
      show(anchor, "choice");
    },
    open: () => panel !== null,
    follow(anchor) {
      if (!panel) return;
      const active = document.activeElement as HTMLElement | null;
      const focus = active && panel.contains(active) ? (active.id === "limit-input" ? "field" : "choice") : null;
      const input = panel.querySelector<HTMLInputElement>("#limit-input");
      const caret = input && active === input ? [input.selectionStart, input.selectionEnd] as const : null;
      if (input) draft = input.value;
      if (!anchor) { closeMenu(); return; }
      moving = true;
      try { show(anchor, focus); } finally { moving = false; }
      const again = panel?.querySelector<HTMLInputElement>("#limit-input");
      if (again && caret) again.setSelectionRange(caret[0], caret[1]);
    },
  };
}
