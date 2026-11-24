// The tabs of the slime picker (member-dialogs.ts `openAvatarPicker`): one row of the groups across the top, as the app's
// small pill tabs, and under it only the open group's slimes. The panels stand on one another in one place (slime.ts
// `slimePickerHTML`), so a press on a tab changes what shows and nothing about the size or the place of the picker.

import { t } from "./i18n";
import { clearLayerForward } from "./nav-history";
import { SLIME_GROUPS, slimeGroupName, slimeGroupOf, slimeGroupSwatch, slimePickerHTML as slimePanelsHTML, type SlimeGroup } from "./slime";
import { esc } from "./ui";

/**
 * The tab row: the colour families as a row of swatches, as a colour row is (R-SLIME-PICK-01), exactly one chosen with a
 * ring. A swatch carries no words: its family's name is its accessible name and its tooltip.
 */
export function slimeTabsHTML(open: SlimeGroup): string {
  const one = (group: SlimeGroup): string => {
    const on = group === open, name = esc(slimeGroupName(group));
    return `<button type="button" class="mb-slime-family" role="tab" aria-selected="${on}" aria-label="${name}" title="${name}" id="slime-tab-${group}" data-slime-tab="${group}"` +
      ` aria-controls="slime-panel-${group}" tabindex="${on ? 0 : -1}" style="--family:${slimeGroupSwatch(group)}"><span class="mb-family-dot" aria-hidden="true"></span></button>`;
  };
  return `<div class="mb-slime-tabs"><div class="mb-slime-tablist" role="tablist" aria-label="${esc(t("settings.avatar"))}">${SLIME_GROUPS.map(one).join("")}</div></div>`;
}

/**
 * The whole picker, laid out as a colour picker is: the slimes of the open family, then the row of swatches under them, and
 * nothing above (R-SLIME-PICK-01). It opens on the family that holds the face it starts from.
 */
export function slimePickerHTML(avatar: string | null | undefined, esc: (text: string) => string): string {
  const open = slimeGroupOf(avatar);
  return `<div class="mb-slime-panels">${slimePanelsHTML(avatar, esc, open)}</div>` + slimeTabsHTML(open);
}

/** Shows `group`: its tab is the chosen one and its panel the open one. Nothing is measured, so nothing moves. */
export function selectSlimeTab(root: ParentNode, group: string, focus = false): void {
  for (const tab of root.querySelectorAll<HTMLElement>("[data-slime-tab]")) {
    const on = tab.dataset.slimeTab === group;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus({ preventScroll: true });
  }
  for (const panel of root.querySelectorAll<HTMLElement>("[data-slime-group]")) {
    const on = panel.dataset.slimeGroup === group;
    panel.toggleAttribute("data-active", on);
    panel.toggleAttribute("inert", !on);
  }
  const panels = root.querySelector<HTMLElement>(".mb-slime-panels");
  // A group is read from its top; when the place scrolls (the largest group does not fit a short window) that is its own scroll.
  if (panels) panels.scrollTop = 0;
}

/**
 * The keys of the picker (the popover gives them first): Left and Right move between the swatches and open the one they
 * reach, Home and End go to the first and the last, Up goes into the open family above (to the chosen slime, else its last)
 * and Down to its first. The slimes keep the popover's own keys otherwise (Up and Down step through them and on to the
 * chosen swatch, Escape closes), now over the open family alone.
 */
export function slimeKeys(root: HTMLElement, event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !root.contains(target)) return false;
  const tabsHere = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
  const chosen = tabsHere.find(tab => tab.getAttribute("aria-selected") === "true");
  const grid = [...root.querySelectorAll<HTMLElement>(".mb-slime-group[data-active] button")];
  const tab = target.closest<HTMLElement>('[role="tab"]');
  if (tab) {
    const at = tabsHere.indexOf(tab), count = tabsHere.length;
    const to = { ArrowRight: (at + 1) % count, ArrowLeft: (at - 1 + count) % count, Home: 0, End: count - 1 }[event.key];
    if (to !== undefined) {
      if (tabsHere[to] !== chosen) clearLayerForward();
      selectSlimeTab(root, tabsHere[to]!.dataset.slimeTab!, true);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const pressed = grid.find(button => button.getAttribute("aria-pressed") === "true");
      (event.key === "ArrowUp" ? pressed ?? grid[grid.length - 1] : grid[0])?.focus();
      return true;
    }
    return false;
  }
  if (!grid.includes(target) || !chosen) return false;
  const ring = [...grid, chosen], at = ring.indexOf(target);
  if (event.key === "ArrowDown") ring[(at + 1) % ring.length]!.focus();
  else if (event.key === "ArrowUp") ring[(at - 1 + ring.length) % ring.length]!.focus();
  else if (event.key === "Home") grid[0]!.focus();
  else if (event.key === "End") grid[grid.length - 1]!.focus();
  else return false;
  return true;
}
