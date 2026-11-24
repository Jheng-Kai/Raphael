// @vitest-environment happy-dom
// The slime picker of a member's face: the open colour's slimes, and under them a row of colour swatches that choose the
// colour, in a place whose size a press on a swatch does not change.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api", () => ({ core: vi.fn(), avatarPick: vi.fn(), avatarSave: vi.fn(), avatarClear: vi.fn(), avatarGet: vi.fn() }));

import * as api from "./api";
import { setAvatar, type CustomAvatar } from "./avatar";
import { setLocale } from "./i18n";
import { openMemberAvatarMenu } from "./member-avatar-menu";
import { defaultSlimeAvatar, SLIME_GROUPS, slimeGroupName, slimeGroupOf, slimeGroupSwatch } from "./slime";
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

test("the colours are swatches in one tablist under the slimes, in their order, each named by its colour alone (R-SLIME-PICK-01)", () => {
  const picker = open("slime:color:sky");
  const row = picker.querySelector<HTMLElement>(".mb-slime-tabs > .mb-slime-tablist")!;
  expect(row.getAttribute("role")).toBe("tablist");
  expect(tabsOf(picker).map(tab => tab.parentElement)).toEqual(tabsOf(picker).map(() => row));
  // The slimes come first and the swatches under them, as a colour picker is laid out.
  const panels = picker.querySelector(".mb-slime-panels")!;
  expect(panels.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(tabsOf(picker).map(tab => tab.dataset.slimeTab)).toEqual([...SLIME_GROUPS]);
  expect(tabsOf(picker).map(tab => tab.getAttribute("aria-label"))).toEqual(SLIME_GROUPS.map(group => slimeGroupName(group)));
  // A swatch carries no words: its colour is its face, its name its tooltip.
  expect(tabsOf(picker).every(tab => tab.textContent === "" && tab.title === tab.getAttribute("aria-label"))).toBe(true);
  expect(tabsOf(picker).map(tab => tab.style.getPropertyValue("--family"))).toEqual(SLIME_GROUPS.map(group => slimeGroupSwatch(group)));
  // Exactly one is chosen, and it is the one that is the tab stop.
  expect(chosen(picker)).toHaveLength(1);
  expect(tabsOf(picker).filter(tab => tab.tabIndex === 0)).toEqual(tabsOf(picker).filter(tab => tab.getAttribute("aria-selected") === "true"));
  // Each swatch controls the panel of its colour, which it names, and no heading stands inside a panel.
  for (const tab of tabsOf(picker)) {
    const panel = picker.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  }
  expect(picker.querySelector("h1, h2, h3, h4")).toBeNull();
});

test.each([
  ["slime:color:sky", "blue"],
  ["slime:streaks-charcoal", "gray"],
  ["slime:oni-red", "red"],
  ["slime:phoenix-feather", "red"],
  ["slime:cherry-blossom", "pink"],
  ["slime:cloud", "teal"],
  ["slime:parcel", "yellow"],
])("it opens on the colour that holds the face now: %s is in %s", (avatar, group) => {
  expect(slimeGroupOf(avatar)).toBe(group);
  const picker = open(avatar);
  expect(chosen(picker)).toEqual([group]);
  expect(openPanel(picker)).toEqual([group]);
  // A character is marked where it stands; a plain colour is offered nowhere, so nothing is marked.
  const marked = [...picker.querySelectorAll<HTMLElement>('[aria-pressed="true"]')];
  expect(marked).toHaveLength(avatar.startsWith("slime:color:") ? 0 : 1);
  for (const one of marked) expect(one.closest("[data-slime-group]")!.getAttribute("data-slime-group")).toBe(group);
});

test("a member without a face of its own opens on the colour of its default face; a face the picker does not know, on the first", () => {
  expect(chosen(open(""))).toEqual([slimeGroupOf(defaultSlimeAvatar(3))]);
  expect(slimeGroupOf("preset:old")).toBe(SLIME_GROUPS[0]);
});

test("pressing a swatch swaps the slimes and leaves the picker's size, place and swatch row as they were", () => {
  const picker = open("slime:color:sky");
  const before = { style: picker.getAttribute("style"), cls: picker.className, row: picker.querySelector(".mb-slime-tabs")!.outerHTML.replace(/aria-selected="\w+"|tabindex="-?\d"/g, ""), panels: picker.querySelectorAll("[data-slime-group]").length };
  const green = tabsOf(picker).find(tab => tab.dataset.slimeTab === "green")!;
  green.click();
  expect(chosen(picker)).toEqual(["green"]);
  expect(openPanel(picker)).toEqual(["green"]);
  // The others are out of the keys' and the pointer's way, not removed: the place is still as big as before.
  expect([...picker.querySelectorAll("[data-slime-group]")].filter(panel => panel.hasAttribute("inert")).length).toBe(SLIME_GROUPS.length - 1);
  expect(picker.getAttribute("style")).toBe(before.style);
  expect(picker.className).toBe(before.cls);
  expect(picker.querySelector(".mb-slime-tabs")!.outerHTML.replace(/aria-selected="\w+"|tabindex="-?\d"/g, "")).toBe(before.row);
  expect(picker.querySelectorAll("[data-slime-group]").length).toBe(before.panels);
  // The menu is still the same one, open, and the colour shows its eight slimes.
  expect(document.getElementById("app-popover")).toBe(picker);
  expect(picker.querySelectorAll("[data-slime-group][data-active] [data-slime-character]")).toHaveLength(8);
  expect(picker.querySelector("[data-slime-group][data-active] [aria-pressed='true']")).toBeNull();
});

test("a pick still updates the face, and leaves the picker open on the colour it was made in", () => {
  const picker = open("slime:color:sky");
  tabsOf(picker).find(tab => tab.dataset.slimeTab === "green")!.click();
  const slime = picker.querySelector<HTMLElement>("[data-slime-group][data-active] [data-slime-character]")!;
  slime.click();
  expect(update).toHaveBeenCalledExactlyOnceWith(3, { avatar: `slime:${slime.dataset.slimeCharacter}` });
  expect(document.getElementById("app-popover")).toBe(picker);
  expect(slime.getAttribute("aria-pressed")).toBe("true");
  expect(picker.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  expect(chosen(picker)).toEqual(["green"]);
});

test("Left and Right move between the swatches and open the one they reach; Escape closes", () => {
  const picker = open("slime:color:sky");
  const all = tabsOf(picker);
  const start = all.findIndex(tab => tab.getAttribute("aria-selected") === "true");
  all[start]!.focus();
  key(all[start]!, "ArrowLeft");
  expect(chosen(picker)).toEqual([SLIME_GROUPS[start - 1]!]);
  expect(document.activeElement).toBe(all[start - 1]);
  expect(openPanel(picker)).toEqual([SLIME_GROUPS[start - 1]!]);
  key(all[start - 1]!, "ArrowRight");
  key(all[0]!, "Home");
  expect(chosen(picker)).toEqual([SLIME_GROUPS[0]!]);
  key(all[0]!, "ArrowLeft"); // before the first: round to the last
  expect(chosen(picker)).toEqual([SLIME_GROUPS[SLIME_GROUPS.length - 1]!]);
  key(document.activeElement!, "Escape");
  expect(document.getElementById("app-popover")).toBeNull();
});

test("Up goes from a swatch into the open colour, Up and Down step over its slimes and back to the swatch", () => {
  const picker = open("slime:cherry-blossom");
  const tab = tabsOf(picker).find(item => item.getAttribute("aria-selected") === "true")!;
  const grid = [...picker.querySelectorAll<HTMLElement>("[data-slime-group][data-active] button")];
  expect(grid.length).toBe(8);
  tab.focus();
  key(tab, "ArrowUp");
  expect(document.activeElement).toBe(grid.find(button => button.getAttribute("aria-pressed") === "true"));
  key(document.activeElement!, "End");
  expect(document.activeElement).toBe(grid[grid.length - 1]);
  key(document.activeElement!, "ArrowDown"); // round: the swatch, then the slimes again
  expect(document.activeElement).toBe(tab);
  key(tab, "ArrowDown");
  expect(document.activeElement).toBe(grid[0]);
  key(grid[0]!, "ArrowUp");
  expect(document.activeElement).toBe(tab);
});

describe("the first member's slime and the owner's picture", () => {
  const picture = (n: number): CustomAvatar => ({ url: `data:image/png;base64,${n}`, crop: { x: 0, y: 0, zoom: 1 } });
  const pick = (save: () => Promise<boolean>): void => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    update = vi.fn(save);
    openMemberAvatarMenu(anchor, { ...member("slime:blue-plain"), id: 0 }, update);
    document.getElementById("app-popover")!.querySelector<HTMLElement>("[data-slime-group][data-active] [data-slime-character]")!.click();
  };
  const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  beforeEach(() => {
    vi.mocked(api.avatarClear).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(api.avatarGet).mockReset().mockResolvedValue(null as never);
  });

  test("the slime is saved first and the picture goes only once it is", async () => {
    setAvatar(picture(1));
    pick(async () => true);
    await settle();
    expect(api.avatarClear).toHaveBeenCalledOnce();
  });

  test("a save that fails keeps the picture", async () => {
    setAvatar(picture(1));
    pick(async () => false);
    await settle();
    expect(api.avatarClear).not.toHaveBeenCalled();
  });

  test("a picture chosen while the slime was saving is the newer choice and stays", async () => {
    setAvatar(picture(1));
    let saved!: (ok: boolean) => void;
    pick(() => new Promise<boolean>(resolve => { saved = resolve; }));
    setAvatar(picture(2));
    saved(true);
    await settle();
    expect(api.avatarClear).not.toHaveBeenCalled();
    setAvatar(null);
  });
});
