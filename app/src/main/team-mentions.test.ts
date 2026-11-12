// @vitest-environment happy-dom
import { beforeEach, expect, test, vi, type Mock } from "vitest";
import { RECALL } from "./composer-history";
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

test("a full-width at opens the menu during composition and completes without changing its prefix", () => {
  bindTeamMentions(input, () => ({ list }));
  compose("ask ＠小");
  expect(rows()).toEqual(["小森", "小晴"]);
  expect(blurred).not.toHaveBeenCalled();
  input.dispatchEvent(new Event("compositionend"));
  document.querySelector<HTMLElement>('#app-popover [data-value="小森"]')!.click();
  expect(input.value).toBe("ask ＠小森 ");
  expect(input.selectionStart).toBe(input.value.length);
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

test("a typo or swapped letters still find the app or member, the plain matches first", () => {
  const roster = { ...list, team_context: { apps: [{ name: "Gmail", state: "ready" }, { name: "Google Calendar", state: "ready" }, { name: "Notion", state: "ready" }] } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: roster }));
  for (const [typed, found] of [["@gamil", "Gmail"], ["@calender", "Google Calendar"], ["@notoin", "Notion"]] as const) {
    input.value = typed; input.setSelectionRange(typed.length, typed.length); input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rows()[0]).toBe(found);
  }
  input.value = "@no"; input.setSelectionRange(3, 3); input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(rows()).toEqual(["Notion"]); // two letters are typed right: no near misses
});

test("a recalled message ending in an @ is not typing: it opens no menu", () => {
  bindTeamMentions(input, () => ({ list }));
  input.value = "ask @小"; input.setSelectionRange(5, 5);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: RECALL }));
  expect(menu()).toBeNull();
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  expect(menu()).not.toBeNull();
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

test.each([['ready', null], ['needs_sign_in', '需要登入'], ['needs_secret', '需要金鑰']])("service state %s only tags sign-in or key requirements", (state, tag) => {
  const roster = { ...list, team_context: { apps: [{ name: 'Notion', state }] } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: roster }));
  input.value = '@'; input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input'));
  expect(menu()!.querySelector('[data-value="Notion"] .mtag')?.textContent ?? null).toBe(tag);
});

test.each(['disabled', 'duplicate', 'no_tools', 'error', 'unchecked', 'unknown'])("an app that is %s is not offered: only the apps a member can use or sign in are", state => {
  const roster = { ...list, team_context: { apps: [{ name: 'Notion', state }, { name: 'Gmail', state: 'ready' }] } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: roster }));
  input.value = '@'; input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input'));
  expect(rows()).toEqual(['拉斐爾', '小森', '小晴', 'Gmail']);
});

// Owner, 2026-11-13, with Grok Bot's picture: 「就是看一下 grokbot 它會顯示什麼。像這種分組的話，就不知道可以幹嘛。應該理論上是可以放其他的 bot 還有 plugins 而已」
test("the menu lists the other members, then the apps, each with what it is at the right, and no group, no everyone", () => {
  const roster = { ...list, team_context: { apps: [{ name: 'Gmail', state: 'ready' }, { name: 'Notion', state: 'needs_sign_in' }] } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: roster, self: 1 }));
  input.value = '@'; input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input'));
  expect(rows()).toEqual(['拉斐爾', '小晴', 'Gmail', 'Notion']);
  expect(menu()!.querySelector('.menu-head')).toBeNull();
  expect([...menu()!.querySelectorAll('.mtrail')].map(word => word.textContent)).toEqual(['成員', '成員', '應用程式', '應用程式']);
  expect([...menu()!.querySelectorAll('.mt')].map(name => name.textContent)).toEqual(['拉斐爾', '小晴', 'Gmail', 'Notion']);
  expect(menu()!.querySelector('[data-value="Notion"]')!.textContent).toBe('Notion需要登入應用程式');
  expect(menu()!.querySelector('[data-value="小森"]')).toBeNull();
  // What is typed by hand is still an address: the chip is drawn and the core reads it.
  const targets = mentionTargets(roster);
  expect(mentionRanges('@研究組 @小森', targets).map(range => range.target.kind)).toEqual(['group', 'member']);
});

test("an app that is not signed in opens the place to sign it in instead of becoming an address", () => {
  const connect = vi.fn();
  const roster = { ...list, team_context: { apps: [{ name: 'Gmail', state: 'ready' }, { name: 'Notion', state: 'needs_sign_in' }] } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: roster, connect }));
  input.value = '請用 @no'; input.setSelectionRange(6, 6); input.dispatchEvent(new Event('input'));
  expect(rows()).toEqual(['Notion']);
  document.querySelector<HTMLElement>('#app-popover [data-value="Notion"]')!.click();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(input.value).toBe('請用 ');
  expect(menu()).toBeNull();
  // A signed-in app is an address as before.
  input.value = '請用 @gm'; input.setSelectionRange(6, 6); input.dispatchEvent(new Event('input'));
  document.querySelector<HTMLElement>('#app-popover [data-value="Gmail"]')!.click();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(input.value).toBe('請用 @Gmail ');
});

test("five recent ready services and an in-place expansion, with no headings", () => {
  const apps = Array.from({ length: 30 }, (_, index) => ({ id: `service-${index}`, name: `Service ${index}`, state: index === 0 ? 'needs_sign_in' : 'ready', last_used_at: index }));
  const many = { ...list, team_context: { apps } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: many }));
  input.value = '@'; input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input'));
  expect(menu()!.querySelector('.menu-head')).toBeNull();
  expect(rows().filter(name => !name.startsWith('Service'))).toEqual(['拉斐爾', '小森', '小晴']);
  expect(rows().filter(name => name.startsWith('Service'))).toEqual(['Service 29', 'Service 28', 'Service 27', 'Service 26', 'Service 25']);
  expect(menu()!.querySelector('[data-value^="Service"] .mtag')).toBeNull();
  const all = [...menu()!.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.includes('顯示全部 30 個'))!;
  expect(all).toBeDefined(); all.click();
  expect(input.value).toBe('@');
  expect(rows()).toContain('Service 24');
  expect(menu()!.querySelector('[data-value^="Service"] .mtag')).toBeNull();
  expect(menu()!.querySelector('.menu-head[role="option"]')).toBeNull();
});

test("filtered mentions rank aliases within sections, cap results and honor group recipients", () => {
  const many = { ...list, team_context: { apps: Array.from({ length: 30 }, (_, index) => ({ name: `Service ${index}`, state: 'ready', aliases: ['notes'] })) } } as unknown as MembersList;
  bindTeamMentions(input, () => ({ list: many, allowed: [1] }));
  input.value = '@notes'; input.setSelectionRange(6, 6); input.dispatchEvent(new Event('input'));
  expect(rows()).toHaveLength(8);
  expect(menu()!.querySelector('.mtag')).toBeNull();
  expect(rows()).not.toContain('研究組');
  input.value = '@Raphael'; input.setSelectionRange(8, 8); input.dispatchEvent(new Event('input'));
  expect(menu()).toBeNull();
});

test("Arrow keys walk the rows and Tab picks without sending or interrupting an input method", () => {
  bindTeamMentions(input, () => ({ list }));
  input.value = '@'; input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input'));
  const send = vi.fn(); input.addEventListener('keydown', send);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true, cancelable: true }));
  expect(input.value).toBe('@'); expect(send).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 3; index++) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toContain('Notion');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(input.value).toBe('@Notion '); expect(menu()).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
});

test("a roster larger than the available height remains reachable in bounded pages", () => {
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.id === 'app-popover' ? this.querySelectorAll('button').length * 34 + 60 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 220; } });
  try {
    const many = { ...list, members: Array.from({length:30},(_,id)=>({id,name:`Member ${id}`})) } as unknown as MembersList;
    bindTeamMentions(input, () => ({ list: many }));
    input.value = '@'; input.setSelectionRange(1, 1); input.dispatchEvent(new Event('input'));
    expect(rows().length).toBeLessThan(8);
    const next = [...document.querySelectorAll<HTMLButtonElement>('#app-popover .menu-action')].find(button=>button.textContent?.includes('下一頁'))!;
    expect(next).toBeDefined(); next.click();
    input.value = ''; input.dispatchEvent(new Event('input'));
    expect(document.querySelector('#app-popover')).toBeNull();
  } finally {
    for (const [key, descriptor] of [['scrollHeight',scroll],['clientHeight',client]] as const) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype,key,descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string,unknown>)[key];
    }
  }
});
