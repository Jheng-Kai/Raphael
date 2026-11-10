// The tabs of the slime picker (member-dialogs.ts `openAvatarPicker`): one row of the groups across the top, as the app's
// small pill tabs, and under it only the open group's slimes (owner, 2026-11-11: 「這個不要這樣放，這個要跟…Grokbot 他們的 UI
// 類似，就是上面會有一些 tab、button 之類的，然後可以選擇」). The panels stand on one another in one place (slime.ts
// `slimePickerHTML`), so a press on a tab changes what shows and nothing about the size or the place of the picker.

import { chipSteps } from "./chip-scroll";
import { t } from "./i18n";
import { SLIME_GROUPS, slimeGroupName, slimeGroupOf, slimePickerHTML as slimePanelsHTML, type SlimeGroup } from "./slime";
import { tabs } from "./ui";

/** The tab row: the groups in their order, exactly one chosen, in a chip row that scrolls when the tabs do not all fit. */
export function slimeTabsHTML(open: SlimeGroup): string {
  const row = tabs(
    SLIME_GROUPS.map(group => ({ id: group, label: slimeGroupName(group),
      attrs: ` id="slime-tab-${group}" data-slime-tab="${group}" aria-controls="slime-panel-${group}" tabindex="${group === open ? 0 : -1}"` })),
    open,
    { label: t("settings.avatar"), kind: "nav", className: "mb-slime-tablist", attrs: " data-chip-scroll" },
  );
  return `<div class="mb-slime-tabs" data-chip-row>${row}${chipSteps()}</div>`;
}

/** The whole picker: the tab row, then the panels, opening on the group that holds the face it starts from. */
export function slimePickerHTML(avatar: string | null | undefined, esc: (text: string) => string): string {
  const open = slimeGroupOf(avatar);
  return slimeTabsHTML(open) + `<div class="mb-slime-panels">${slimePanelsHTML(avatar, esc, open)}</div>`;
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
 * The keys of the picker (the popover gives them first): Left and Right move between the tabs and open the one they reach,
 * Home and End go to the first and the last, Down goes into the open group and Up comes back to its tab. The slimes keep the
 * popover's own keys otherwise (Up and Down step through them, Escape closes), now over the open group alone.
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
      selectSlimeTab(root, tabsHere[to]!.dataset.slimeTab!, true);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const pressed = grid.find(button => button.getAttribute("aria-pressed") === "true");
      (event.key === "ArrowDown" ? pressed ?? grid[0] : grid[grid.length - 1])?.focus();
      return true;
    }
    return false;
  }
  if (!grid.includes(target) || !chosen) return false;
  const ring = [chosen, ...grid], at = ring.indexOf(target);
  if (event.key === "ArrowDown") ring[(at + 1) % ring.length]!.focus();
  else if (event.key === "ArrowUp") ring[(at - 1 + ring.length) % ring.length]!.focus();
  else if (event.key === "Home") grid[0]!.focus();
  else if (event.key === "End") grid[grid.length - 1]!.focus();
  else return false;
  return true;
}
