// @vitest-environment happy-dom
// The slime picker of a member's face (owner, 2026-11-11: 「這個不要這樣放，這個要跟…Grokbot 他們的 UI 類似，就是上面會有一些
// tab、button 之類的，然後可以選擇」): a row of tabs for the groups, and only the open group's slimes under it, in a place whose
// size a press on a tab does not change.
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("./api", () => ({ core: vi.fn(), avatarPick: vi.fn(), avatarSave: vi.fn(), avatarClear: vi.fn(), avatarGet: vi.fn() }));

import { setLocale, t } from "./i18n";
import { openMemberAvatarMenu } from "./member-avatar-menu";
import { SLIME_GROUPS, slimeGroupOf } from "./slime";
import { closeMenu } from "./ui";
import type { Member, MemberPatch } from "./types";

const member = (avatar: string): Member => ({
  id: 3, name: "日文老師", role: "", instructions: "", avatar, group_id: null, model: "", tools: null, position: 3, created: 0, unread: false,
} as unknown as Member);

let update: ReturnType<typeof vi.fn<(id: number, patch: MemberPatch) => Promise<boolean>>>;

function open(avatar: string): HTMLElement {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  update = vi.fn(async () => true);
  openMemberAvatarMenu(anchor, member(avatar), update);
  return document.getElementById("app-popover")!;
}

const tabsOf = (picker: HTMLElement): HTMLElement[] => [...picker.querySelectorAll<HTMLElement>('[role="tab"]')];
const chosen = (picker: HTMLElement): string[] => tabsOf(picker).filter(tab => tab.getAttribute("aria-selected") === "true").map(tab => tab.dataset.slimeTab!);
const openPanel = (picker: HTMLElement): string[] => [...picker.querySelectorAll<HTMLElement>("[data-slime-group][data-active]")].map(panel => panel.dataset.slimeGroup!);
const key = (target: Element, name: string): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); };

beforeEach(() => {
  closeMenu();
  document.body.innerHTML = "";
  setLocale("zh-TW");
});

test("the groups are tabs in one row, in their order, in the app's pill tabs and its chip row", () => {
  const picker = open("slime:color:sky");
  const row = picker.querySelector<HTMLElement>("[data-chip-row] > [data-chip-scroll]")!;
  expect(row.getAttribute("role")).toBe("tablist");
  expect(row.classList.contains("tabs")).toBe(true);
  expect(tabsOf(picker).map(tab => tab.parentElement)).toEqual(tabsOf(picker).map(() => row));
  expect(tabsOf(picker).map(tab => tab.textContent)).toEqual(SLIME_GROUPS.map(group => t(`slime.group.${group}`)));
  expect(tabsOf(picker).every(tab => tab.classList.contains("tab"))).toBe(true);
  expect(tabsOf(picker).map(tab => tab.dataset.slimeTab)).toEqual([...SLIME_GROUPS]);
  // Exactly one is chosen, and it is the one that is the tab stop.
  expect(chosen(picker)).toHaveLength(1);
  expect(tabsOf(picker).filter(tab => tab.tabIndex === 0)).toEqual(tabsOf(picker).filter(tab => tab.getAttribute("aria-selected") === "true"));
  // Each tab controls the panel of its group, which it names, and no heading stands inside a panel.
  for (const tab of tabsOf(picker)) {
    const panel = picker.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  }
  expect(picker.querySelector("h1, h2, h3, h4")).toBeNull();
});

test.each([
  ["slime:color:sky", "colors"],
  ["slime:diablo", "characters"],
  ["slime:cherry-blossom", "seasonal"],
  ["slime:cloud", "nature"],
  ["slime:parcel", "objects"],
])("it opens on the group that holds the face now: %s is in %s, and the face is marked there", (avatar, group) => {
  expect(slimeGroupOf(avatar)).toBe(group);
  const picker = open(avatar);
  expect(chosen(picker)).toEqual([group]);
  expect(openPanel(picker)).toEqual([group]);
  const marked = [...picker.querySelectorAll<HTMLElement>('[aria-pressed="true"]')];
  expect(marked).toHaveLength(1);
  expect(marked[0]!.closest("[data-slime-group]")!.getAttribute("data-slime-group")).toBe(group);
});

test("a member without a face of its own opens on the group of its default colour; a face the picker does not list, on the first", () => {
  expect(chosen(open(""))).toEqual(["colors"]);
  expect(slimeGroupOf("preset:old")).toBe(SLIME_GROUPS[0]);
});

test("pressing a tab swaps the grid and leaves the picker's size, place and tab row as they were", () => {
  const picker = open("slime:color:sky");
  const before = { style: picker.getAttribute("style"), cls: picker.className, row: picker.querySelector(".mb-slime-tabs")!.outerHTML.replace(/aria-selected="\w+"|tabindex="-?\d"/g, ""), panels: picker.querySelectorAll("[data-slime-group]").length };
  const animals = tabsOf(picker).find(tab => tab.dataset.slimeTab === "animals")!;
  animals.click();
  expect(chosen(picker)).toEqual(["animals"]);
  expect(openPanel(picker)).toEqual(["animals"]);
  // The others are out of the keys' and the pointer's way, not removed: the place is still as big as the largest.
  expect([...picker.querySelectorAll("[data-slime-group]")].filter(panel => panel.hasAttribute("inert")).length).toBe(SLIME_GROUPS.length - 1);
  expect(picker.getAttribute("style")).toBe(before.style);
  expect(picker.className).toBe(before.cls);
  expect(picker.querySelector(".mb-slime-tabs")!.outerHTML.replace(/aria-selected="\w+"|tabindex="-?\d"/g, "")).toBe(before.row);
  expect(picker.querySelectorAll("[data-slime-group]").length).toBe(before.panels);
  // The menu is still the same one, open.
  expect(document.getElementById("app-popover")).toBe(picker);
  // Its slimes are what the group holds, and the face that is now is not marked in this group.
  expect(picker.querySelector("[data-slime-group][data-active] [aria-pressed='true']")).toBeNull();
  expect(picker.querySelector("[data-slime-group][data-active] [data-slime-character]")).not.toBeNull();
});

test("a pick still updates the face, and leaves the picker open on the group it was made in", () => {
  const picker = open("slime:color:sky");
  tabsOf(picker).find(tab => tab.dataset.slimeTab === "animals")!.click();
  const slime = picker.querySelector<HTMLElement>("[data-slime-group][data-active] [data-slime-character]")!;
  slime.click();
  expect(update).toHaveBeenCalledExactlyOnceWith(3, { avatar: `slime:${slime.dataset.slimeCharacter}` });
  expect(document.getElementById("app-popover")).toBe(picker);
  expect(slime.getAttribute("aria-pressed")).toBe("true");
  expect(picker.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  expect(chosen(picker)).toEqual(["animals"]);
});

test("Left and Right move between the tabs and open the one they reach; Escape closes", () => {
  const picker = open("slime:color:sky");
  const all = tabsOf(picker);
  const start = all.findIndex(tab => tab.getAttribute("aria-selected") === "true");
  expect(document.activeElement).toBe(all[start]);
  key(all[start]!, "ArrowLeft");
  expect(chosen(picker)).toEqual([SLIME_GROUPS[start - 1]!]);
  expect(document.activeElement).toBe(all[start - 1]);
  expect(openPanel(picker)).toEqual([SLIME_GROUPS[start - 1]!]);
  key(all[start - 1]!, "ArrowRight");
  key(all[start]!, "ArrowRight"); // past the last: round to the first
  expect(chosen(picker)).toEqual([SLIME_GROUPS[0]!]);
  key(all[0]!, "End");
  expect(chosen(picker)).toEqual([SLIME_GROUPS[SLIME_GROUPS.length - 1]!]);
  key(document.activeElement!, "Escape");
  expect(document.getElementById("app-popover")).toBeNull();
});

test("Down goes from the tab into the open group, Up and Down step over its slimes alone, and Up comes back to the tab", () => {
  const picker = open("slime:cherry-blossom");
  const tab = tabsOf(picker).find(item => item.getAttribute("aria-selected") === "true")!;
  const grid = [...picker.querySelectorAll<HTMLElement>("[data-slime-group][data-active] button")];
  expect(grid.length).toBe(6);
  key(tab, "ArrowDown");
  expect(document.activeElement).toBe(grid.find(button => button.getAttribute("aria-pressed") === "true"));
  key(document.activeElement!, "End");
  expect(document.activeElement).toBe(grid[grid.length - 1]);
  key(document.activeElement!, "ArrowDown"); // round: the tab, then the slimes again
  expect(document.activeElement).toBe(tab);
  key(tab, "ArrowDown");
  key(document.activeElement!, "Home");
  expect(document.activeElement).toBe(grid[0]);
  key(grid[0]!, "ArrowUp");
  expect(document.activeElement).toBe(tab);
});
