// @vitest-environment happy-dom
import { beforeEach, expect, test, vi, type Mock } from "vitest";
import { mentionRanges } from "./mention-text";
import { bindComposerMentions, bindTeamMentions, mentionTargets } from "./team-mentions";
import type { MembersList } from "./types";
import { closeMenu } from "./ui";

const list = { members: [{ id: 0, name: "拉斐爾" }, { id: 1, name: "小森" }, { id: 2, name: "小晴" }], groups: [{ id: 5, name: "研究組", position: 0 }],
  team_context: { apps: [{ name: "Notion", state: "ready" }] } } as unknown as MembersList;
let input: HTMLTextAreaElement, blurred: Mock<(event: FocusEvent) => void>;
const menu = (): HTMLElement | null => document.querySelector("#app-popover[data-team-mentions]");
const rows = (): string[] => [...document.querySelectorAll<HTMLElement>("#app-popover [data-value]")].map(row => row.dataset.value!);
/** What an input method hands the page: composing input with isComposing, then the commit. */
const compose = (value: string): void => {
  input.value = value; input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(Object.assign(new Event("input", { bubbles: true }), { isComposing: true }));
};

beforeEach(() => {
  closeMenu(); document.body.innerHTML = "";
  input = document.createElement("textarea"); document.body.append(input); input.focus();
  blurred = vi.fn<(event: FocusEvent) => void>(); input.addEventListener("blur", blurred);
});

// A Chinese input method that composed the @ typed it twice: the menu opened on the composing input and took the focus, a focus
// change ends a composition, and the commit that came after found nothing to replace (look scene mention-ime-at, in a real browser).
test("an input method composing the @ keeps the focus while the menu is drawn, and the commit lands once", () => {
  bindTeamMentions(input, () => ({ list }));
  input.dispatchEvent(new Event("compositionstart"));
  compose("@");
  expect(menu()).not.toBeNull();
  expect(blurred).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  input.dispatchEvent(new Event("compositionend"));
  expect(menu()).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("@");
});

test("a syllable composed after the @ never moves the focus, and the menu narrows to what is committed", () => {
  bindTeamMentions(input, () => ({ list }));
  compose("@");
  expect(rows()).toEqual(expect.arrayContaining(["小森", "小晴", "Notion"]));
  blurred.mockClear();
  compose("@ㄒ");
  expect(blurred).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  input.value = "@小"; input.setSelectionRange(2, 2);
  input.dispatchEvent(new Event("compositionend"));
  expect(rows()).toEqual(["小森", "小晴"]);
});
test("without an input method the menu follows every keystroke as before", () => {
  bindTeamMentions(input, () => ({ list }));
  input.value = "@"; input.setSelectionRange(1, 1); input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(menu()).not.toBeNull();
  input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(menu()).toBeNull();
});

test("the team is addressed by the names the menu writes and the names the core takes in every language", () => {
  const targets = mentionTargets(list);
  expect(targets.map(target => [target.kind, target.name])).toEqual([["everyone", expect.any(String)], ["member", "拉斐爾"], ["member", "小森"], ["member", "小晴"], ["group", "研究組"], ["app", "Notion"]]);
  const named = (text: string, among = targets): string[] => mentionRanges(text, among).map(range => range.target.name);
  expect(named("@Raphael @拉斐爾 @ラファエル")).toEqual(["拉斐爾", "拉斐爾", "拉斐爾"]);
  expect(named("@所有人 @研究組 @Notion ")).toEqual([targets[0].name, "研究組", "Notion"]);
  // A room offers its own members and the apps, never the groups.
  expect(named("@小森 @小晴 @研究組 @Notion ", mentionTargets(list, [0, 1]))).toEqual(["小森", "Notion"]);
});

test("a composer's field gets the menu and the chips together", () => {
  document.body.innerHTML = `<div class="cmp-field"><textarea class="cmp-input"></textarea><div class="cmp-mirror"></div></div>`;
  const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
  const mentions = bindComposerMentions(field, () => ({ list }));
  field.value = "請 @小森 看看";
  expect(document.querySelectorAll(".cmp-mirror .mention-chip")).toHaveLength(1);
  mentions.refresh();
});
