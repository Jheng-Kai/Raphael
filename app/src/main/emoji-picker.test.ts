// @vitest-environment happy-dom
// Reactions as Grok Bot gives them: the quick bar, and every emoji in one card with a search, sections and a footer.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { NEWER, emojiSections, searchEmoji, sectionsOf } from "./emoji-data";
import { openEmojiPicker, openReactionBar } from "./emoji-picker";
import { setLocale } from "./i18n";
import { closeMenu } from "./ui";

beforeEach(() => { closeMenu(); document.body.innerHTML = ""; setLocale("zh-TW"); });

const json = (path: string) => JSON.parse(readFileSync(resolve("node_modules/emojibase-data", path), "utf8"));

test("the emoji a Windows font may not draw yet are exactly those newer than Emoji 15.1 in the pinned data", () => {
  const newer = json("en/data.json").filter((e: { group?: number; version: number }) => e.group !== undefined && e.group !== 2 && e.version >= 16).map((e: { hexcode: string }) => e.hexcode);
  expect([...NEWER].sort()).toEqual(newer.sort());
});

test("the sections follow Unicode's order, leave out skin-tone parts and variants, and are named in the app's language", async () => {
  const sections = await emojiSections("zh-TW");
  expect(sections[0].name).toBe("笑臉和情緒");
  expect(sections.map(s => s.name)).not.toContain("元件");
  const all = sections.flatMap(s => s.emoji.map(e => e.char));
  expect(all.length).toBeGreaterThan(1800);
  expect(all).toContain("👍");
  expect(all).not.toContain("👍🏽");
  expect(all.indexOf("😀")).toBe(0);
  expect(sectionsOf([{ hexcode: "1F44D", label: "讚", unicode: "👍", group: 1, order: 2 }, { hexcode: "1F600", label: "笑", unicode: "😀", group: 0, order: 1 }],
    { groups: [{ message: "笑臉", order: 0 }, { message: "人物", order: 1 }, { message: "元件", order: 2 }] }).map(s => [s.name, s.emoji[0].char])).toEqual([["笑臉", "😀"], ["人物", "👍"]]);
});

test("search finds emoji by their name or keywords in the app's language", async () => {
  const sections = await emojiSections("zh-TW");
  expect(searchEmoji(sections, "愛心").map(e => e.char)).toContain("❤️");
  expect(searchEmoji(sections, "  ")).toEqual([]);
  expect(searchEmoji(await emojiSections("en"), "party").map(e => e.char)).toContain("🎉");
});

test("the quick bar's last slot opens every emoji, search filters in place, a click chooses and closes, and Esc leaves it", async () => {
  const anchor = document.createElement("button"); document.body.append(anchor);
  const picked = vi.fn();
  openReactionBar(anchor, [], picked);
  document.querySelector<HTMLElement>('#app-popover [data-quick="+"]')!.click();
  const card = document.querySelector<HTMLElement>("#app-popover.emoji-picker")!;
  expect(card.getAttribute("role")).toBe("dialog");
  const input = card.querySelector<HTMLInputElement>("input")!;
  expect(document.activeElement).toBe(input);
  await vi.waitFor(() => expect(card.querySelectorAll(".emoji-cell").length).toBeGreaterThan(1800));
  expect(card.querySelector(".emoji-sec h4")!.textContent).toBe("笑臉和情緒");
  expect(card.querySelector(".emoji-foot-name")!.textContent).not.toBe("");
  input.value = "愛心"; input.dispatchEvent(new Event("input"));
  expect(card.querySelector(".emoji-sec")).toBeNull();
  const heart = card.querySelector<HTMLElement>('.emoji-cell[data-emoji="❤️"]')!;
  heart.dispatchEvent(new Event("pointerover", { bubbles: true }));
  expect(card.querySelector(".emoji-foot-name")!.textContent).toBe("愛心");
  heart.click();
  expect(picked).toHaveBeenCalledExactlyOnceWith("❤️");
  expect(document.querySelector("#app-popover")).toBeNull();
  openEmojiPicker(anchor, ["🎉"], picked);
  await vi.waitFor(() => expect(document.querySelector('.emoji-cell[data-emoji="🎉"]')?.getAttribute("aria-selected")).toBe("true"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector("#app-popover")).toBeNull();
  expect(picked).toHaveBeenCalledOnce();
});

test("from the field Down enters the grid, the arrows walk it by cell and by row, and Enter in the field takes the first found", async () => {
  const anchor = document.createElement("button"); document.body.append(anchor);
  const picked = vi.fn();
  openEmojiPicker(anchor, [], picked);
  const card = document.querySelector<HTMLElement>("#app-popover.emoji-picker")!;
  await vi.waitFor(() => expect(card.querySelectorAll(".emoji-cell").length).toBeGreaterThan(100));
  const cells = [...card.querySelectorAll<HTMLElement>(".emoji-cell")];
  const key = (k: string) => (document.activeElement ?? document).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  key("ArrowDown"); expect(document.activeElement).toBe(cells[0]);
  key("ArrowRight"); expect(document.activeElement).toBe(cells[1]);
  key("ArrowDown"); expect(document.activeElement).toBe(cells[9]);
  key("ArrowUp"); key("ArrowUp"); expect(document.activeElement).toBe(card.querySelector("input"));
  const input = card.querySelector<HTMLInputElement>("input")!;
  input.value = "愛心"; input.dispatchEvent(new Event("input"));
  input.focus();
  key("Enter");
  expect(picked).toHaveBeenCalledExactlyOnceWith(card.ownerDocument.defaultView ? searchEmoji(await emojiSections("zh-TW"), "愛心")[0].char : "");
});
