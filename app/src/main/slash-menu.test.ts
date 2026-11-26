// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { membersCommandsList, membersSkillsList } from "./api";
import { RECALL } from "./composer-history";
import { matchingCommands, mountSlashMenu } from "./slash-menu";
import { closeMenu } from "./ui";
import { teamMentions } from "./team-mentions";
import type { MembersList } from "./types";
vi.mock("./api", () => ({ membersCommandsList: vi.fn(), membersSkillsList: vi.fn() }));
const commands = [{ id: 1, name: 'review', description: 'Review code', template: 'Secret expansion {input}' }, { id: 2, name: 'research', description: 'Find sources', template: '{input}' }];
const flush = async (): Promise<void> => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { closeMenu(); document.body.innerHTML = ''; vi.resetAllMocks(); vi.mocked(membersCommandsList).mockResolvedValue({ commands }); vi.mocked(membersSkillsList).mockResolvedValue({ skills: [] }); });
const setup = () => { const input = document.createElement('textarea'); document.body.append(input); input.focus(); let id = 7; const menu = mountSlashMenu(input, { memberId: () => id }); return { input, menu, selectMember: (next: number) => { id = next; } }; };
const type = (input: HTMLTextAreaElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };

test('slash and mention menus retain their own focus, keyboard and dismissal behavior', async () => {
  const { input, menu } = setup();
  const list = { members: [{ id: 0, name: 'Raphael' }, { id: 1, name: 'Alice' }], groups: [] } as unknown as MembersList;
  input.addEventListener('input', () => teamMentions(input, list));
  type(input, '/'); await flush();
  expect(document.querySelector('.slash-menu')).not.toBeNull();
  type(input, '@');
  expect(document.querySelector('#app-popover[data-team-mentions]')).not.toBeNull();
  expect(document.activeElement).toBe(input);
  document.querySelector<HTMLElement>('[data-value="Alice"]')!.click();
  expect(input.value).toBe('@Alice ');
  type(input, '');
  expect(document.querySelector('#app-popover')).toBeNull();
  type(input, '/'); await flush();
  expect(document.querySelector('.slash-menu')).not.toBeNull();
  menu.destroy();
});

test.each([undefined, 0, 2])('primary %s puts the chief first among the slimes and Raphael last, without changing roster identities or permitted recipients', primary_id => {
  const { input, menu } = setup();
  const members = [{ id: 0, name: 'Raphael' }, { id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
  const list = { members, groups: [], team_context: { primary_id, members } } as unknown as MembersList;
  input.value = '@'; input.setSelectionRange(1, 1); teamMentions(input, list);
  const names = [...document.querySelectorAll<HTMLElement>('#app-popover [data-value]')].map(row => row.dataset.value);
  expect(names).toEqual(primary_id === 2 ? ['Bob', 'Alice', 'Raphael'] : ['Alice', 'Bob', 'Raphael']);
  expect(members.map(m => m.id)).toEqual([0, 1, 2]);
  teamMentions(input, list, [0, 2]);
  expect([...document.querySelectorAll<HTMLElement>('#app-popover [data-value]')].map(row => row.dataset.value)).toEqual(['Bob', 'Raphael']);
  document.querySelector<HTMLElement>('[data-value="Raphael"]')!.click(); expect(input.value).toBe('@Raphael ');
  menu.destroy();
});

test('a recalled command is not typing: the slash menu stays shut and the arrow keys stay the history\'s', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  expect(document.querySelector('.slash-menu')).not.toBeNull();
  input.value = '/review'; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: RECALL }));
  expect(document.querySelector('.slash-menu')).toBeNull();
  menu.destroy();
});

test('command filtering follows a slash that begins a word and excludes arguments, words inside a word and addresses', () => {
  expect(matchingCommands(commands, '/REv').map(c => c.name)).toEqual(['review']);
  expect(matchingCommands(commands, 'please /REv').map(c => c.name)).toEqual(['review']);
  for (const text of ['hello /', ' /', '第一行\n/']) expect(matchingCommands(commands, text).map(c => c.name)).toEqual(['review', 'research']);
  for (const text of ['/review text', 'a/b', 'a/', 'https://x.com/y', 'see /usr/bin', '/usr/b', 'hello /review text']) expect(matchingCommands(commands, text)).toEqual([]);
});

const caretAt = (input: HTMLTextAreaElement, value: string, caret = value.length) => { input.value = value; input.setSelectionRange(caret, caret); input.dispatchEvent(new Event('input', { bubbles: true })); };

test.each(['please look at this /', '請幫我 /', '第一行\n/', '/review text /re'])('a slash that begins a word opens the menu after other words', async text => {
  const { input, menu } = setup(); caretAt(input, text); await flush();
  expect(document.querySelector('.slash-menu')).not.toBeNull();
  expect(membersCommandsList).toHaveBeenCalledWith(7);
  menu.destroy();
});

test.each(['a/b', 'a/', 'https://x.com/y', 'https://', 'see /usr/bin', 'C:/Users/me', 'and/or'])('a slash inside a word or an address never opens the menu', async text => {
  const { input, menu } = setup(); caretAt(input, text); await flush();
  expect(document.querySelector('#app-popover')).toBeNull();
  expect(membersCommandsList).not.toHaveBeenCalled();
  menu.destroy();
});

test('the menu narrows by the name typed after a slash in the middle of the words and closes when a space ends it', async () => {
  const { input, menu } = setup(); caretAt(input, 'please /res'); await flush();
  expect([...document.querySelectorAll<HTMLElement>('.slash-menu [data-value]')].map(row => row.dataset.value)).toEqual(['research']);
  caretAt(input, 'please /research '); expect(document.querySelector('#app-popover')).toBeNull();
  caretAt(input, 'please /xyz'); await flush(); expect(document.querySelector('#app-popover')).toBeNull();
  menu.destroy();
});

test('picking after words puts the name where the slash was and leaves the rest of the text as it was', async () => {
  const { input, menu } = setup(); caretAt(input, 'please /re'); await flush();
  document.querySelector<HTMLElement>('[data-slash="0"]')!.click();
  expect(input.value).toBe('please /review '); expect(input.selectionStart).toBe(input.value.length);
  expect(document.querySelector('#app-popover')).toBeNull();
  // The caret is in the middle of the words: what follows it stays, with the caret after the name.
  const text = 'first /re then more words\nand a second line';
  caretAt(input, text, 9); await flush();
  expect(document.querySelector('.slash-menu')).not.toBeNull();
  document.querySelector<HTMLElement>('[data-value="research"]')!.click();
  expect(input.value).toBe('first /research then more words\nand a second line');
  expect(input.selectionStart).toBe('first /research '.length);
  // A space already follows the slash: one space between the name and the next word, not two.
  caretAt(input, 'a / b', 3); await flush();
  document.querySelector<HTMLElement>('[data-value="review"]')!.click();
  expect(input.value).toBe('a /review b'); expect(input.selectionStart).toBe('a /review '.length);
  menu.destroy();
});

test('Escape and the arrow keys work for a slash after words as they do at the start', async () => {
  const { input, menu } = setup(); caretAt(input, 'please /'); await flush();
  const send = vi.fn(); input.addEventListener('keydown', send);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(input.value).toBe('please /research '); expect(send).not.toHaveBeenCalled();
  caretAt(input, 'please /research and /'); await flush();
  expect(document.querySelector('.slash-menu')).not.toBeNull();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('#app-popover')).toBeNull();
  menu.destroy();
});

test('a recalled message that holds a slash after words opens nothing', async () => {
  const { input, menu } = setup(); caretAt(input, 'ask'); await flush();
  input.value = 'ask /'; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: RECALL }));
  expect(document.querySelector('.slash-menu')).toBeNull();
  menu.destroy();
});

test('typing slash fetches that member commands and mouse selection preserves slash text', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  expect(membersCommandsList).toHaveBeenCalledWith(7);
  document.querySelector<HTMLElement>('[data-slash="0"]')!.click();
  expect(input.value).toBe('/review ');
  expect(input.value).not.toContain('Secret');
  expect(document.querySelector('#app-popover')).toBeNull();
  menu.destroy();
});

test('arrow and Enter select without letting the composer send; IME Enter remains untouched', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  const send = vi.fn(); input.addEventListener('keydown', send);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  expect(input.value).toBe('/'); expect(send).toHaveBeenCalledTimes(1);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(input.value).toBe('/research '); expect(send).toHaveBeenCalledTimes(1);
  menu.destroy();
});

test('stale command responses cannot appear in a different member conversation', async () => {
  let finish!: (answer: { commands: typeof commands }) => void;
  vi.mocked(membersCommandsList).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { input, menu, selectMember } = setup(); type(input, '/'); selectMember(8);
  finish({ commands }); await flush();
  expect(document.querySelector('#app-popover')).toBeNull(); menu.destroy();
});

test('Escape dismisses, arguments close, and destroy removes every input hook', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('#app-popover')).toBeNull();
  type(input, '/review something'); expect(document.querySelector('#app-popover')).toBeNull();
  menu.destroy(); type(input, '/'); expect(document.querySelector('#app-popover')).toBeNull();
});

test('leaving the composer closes its menu and invalidates a pending refresh', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  input.dispatchEvent(new Event('blur'));
  expect(document.querySelector('#app-popover')).toBeNull();
  let finish!: (answer: { commands: typeof commands }) => void;
  vi.mocked(membersCommandsList).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = menu.refresh();
  input.dispatchEvent(new Event('blur'));
  finish({ commands }); await pending;
  expect(document.querySelector('#app-popover')).toBeNull();
  menu.destroy();
});

test('menu placement is recalculated after applying the composer width on a narrow viewport', async () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const beforeViewport = innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 720 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return Number.parseFloat((this as HTMLElement).style.minWidth) || 0; } });
  const { input, menu } = setup();
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ x: 220, y: 800, top: 800, bottom: 840, left: 220, right: 700, width: 480, height: 40, toJSON() {} });
  try {
    type(input, '/'); await flush();
    const panel = document.querySelector<HTMLElement>('.slash-menu')!;
    expect(panel.style.minWidth).toBe('360px');
    expect(Number.parseFloat(panel.style.left) + 360).toBeLessThanOrEqual(712);
  } finally {
    menu.destroy();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: beforeViewport });
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  }
});

test('commands and enabled skills share grouped completion, plugin attribution and Tab selection', async () => {
  vi.mocked(membersSkillsList).mockResolvedValue({ skills: [
    { id: 10, name: 'review', description: 'Check sources', source: 'plugin:Field Notes', plugin: 'Field Notes', enabled: true, slash_name: 'field-notes:review' },
    { id: 11, name: 'outline', description: 'Prepare structure', source: 'owner', enabled: true, slash_name: 'outline' },
    { id: 12, name: 'hidden', description: 'Disabled guidance', source: 'owner', enabled: false },
  ] });
  const { input, menu } = setup(); type(input, '/'); await flush();
  expect([...document.querySelectorAll('.menu-head')].map(head => head.textContent)).toEqual(['指令', '技能']);
  expect(document.querySelector('.slash-menu')!.textContent).toContain('Field Notes');
  expect(document.querySelector('.slash-menu')!.textContent).not.toContain('hidden');
  type(input, '/field-notes:rev'); await flush();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(input.value).toBe('/field-notes:review ');
  expect(document.querySelector('#app-popover')).toBeNull();
  menu.destroy();
});

test('a member change reads nothing for a closed menu, and the next slash reads the skills it may have added', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  type(input, ''); input.dispatchEvent(new Event('blur'));
  vi.mocked(membersCommandsList).mockClear(); vi.mocked(membersSkillsList).mockClear();
  // A busy team announces its members many times a second.
  for (let i = 0; i < 20; i++) menu.invalidate();
  await flush();
  expect(membersCommandsList).not.toHaveBeenCalled(); expect(membersSkillsList).not.toHaveBeenCalled();
  vi.mocked(membersSkillsList).mockResolvedValue({ skills: [{ id: 10, name: 'brand-new', description: 'Added a moment ago', source: 'owner', enabled: true, slash_name: 'brand-new' }] });
  input.focus(); type(input, '/'); await flush();
  expect(membersSkillsList).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.slash-menu')!.textContent).toContain('brand-new');
  // Read, it is fresh: typing on does not read again.
  type(input, '/b'); await flush();
  expect(membersSkillsList).toHaveBeenCalledTimes(1);
  menu.destroy();
});

test('a member change while the menu is open reads again at once', async () => {
  const { input, menu } = setup(); type(input, '/'); await flush();
  vi.mocked(membersSkillsList).mockClear();
  vi.mocked(membersSkillsList).mockResolvedValue({ skills: [{ id: 10, name: 'just-added', description: 'x', source: 'owner', enabled: true, slash_name: 'just-added' }] });
  menu.invalidate(); await flush();
  expect(membersSkillsList).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.slash-menu')!.textContent).toContain('just-added');
  menu.destroy();
});

test('thirty skills are one list that scrolls, as the @ menu: no pages and no 下一頁 (issue 241)', async () => {
  vi.mocked(membersSkillsList).mockResolvedValue({ skills: Array.from({ length: 30 }, (_, index) => (
    { id: 100 + index, name: `skill-${index}`, description: `Does thing ${index}`, source: 'owner', enabled: true, slash_name: `skill-${index}` })) });
  const { input, menu } = setup(); type(input, '/'); await flush();
  const panel = document.querySelector('.slash-menu')!;
  expect(panel.classList.contains('menu-scroll')).toBe(true);
  expect(panel.querySelector('.menu-action, .menu-sep')).toBeNull();
  expect(panel.textContent).not.toMatch(/下一頁|上一頁/);
  expect(panel.querySelectorAll('[data-value^="skill-"]')).toHaveLength(30);
  for (let index = 0; index < 31; index++) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.querySelector('.slash-menu .is-active')?.getAttribute('data-value')).toBe('skill-29');
  type(input, '/skill'); await flush();
  expect(document.querySelectorAll('.slash-menu [data-value^="skill-"]')).toHaveLength(8);
  expect(document.querySelector('.slash-menu')!.textContent).not.toMatch(/下一頁|上一頁/);
  menu.destroy();
});

test("the app's own commands come first, a member's command of the same name gives way, and choosing one runs it with nothing sent", async () => {
  vi.mocked(membersCommandsList).mockResolvedValue({ commands: [...commands, { id: 3, name: 'usage', description: 'My own usage', template: '{input}' }] });
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  const ran: string[] = [];
  const menu = mountSlashMenu(input, { memberId: () => 7, appCommand: command => ran.push(command) });
  type(input, 'note /'); await flush();
  const rows = [...document.querySelectorAll<HTMLElement>('.slash-menu [data-value]')];
  expect(rows[0]!.dataset.value).toBe('app:usage');
  expect(rows[0]!.textContent).toContain('/usage');
  expect(rows[0]!.textContent).toContain('打開用量');
  expect(rows.filter(row => row.textContent?.includes('My own usage'))).toHaveLength(0);
  expect(rows.map(row => row.dataset.value)).toEqual(['app:usage', 'review', 'research']);
  type(input, 'note /usa'); await flush();
  document.querySelector<HTMLElement>('.slash-menu [data-value="app:usage"]')!.click();
  expect(ran).toEqual(['usage']);
  expect(input.value).toBe('note ');
  menu.destroy();
});

test("a menu with no app commands to run offers none", async () => {
  const { input, menu } = setup();
  type(input, '/'); await flush();
  expect(document.querySelector('.slash-menu [data-value^="app:"]')).toBeNull();
  menu.destroy();
});
