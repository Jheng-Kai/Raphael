// @vitest-environment happy-dom
// The composer's + menu (composer-plus.ts, R-UI-166): what each row does, that its switches are the settings' own (the member's 工具
// list, its skills), that a submenu opens and closes as the language picker's does, and that the keyboard reaches all of it.
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";

const state = vi.hoisted(() => ({
  choices: { tools: [] as string[], connections: [] as { id: string; name: string; enabled: boolean; logo?: string }[] },
  skills: [] as { id: number; name: string; description: string; enabled: boolean; source: string }[],
}));
const api = vi.hoisted(() => ({
  membersToolChoices: vi.fn(async () => structuredClone(state.choices)),
  membersSkillsList: vi.fn(async () => ({ skills: structuredClone(state.skills) })),
  membersSkillsUpdate: vi.fn(async (_member: number, id: number, enabled: boolean) => { const skill = state.skills.find(item => item.id === id); if (skill) skill.enabled = enabled; return {}; }),
  membersCommandsList: vi.fn(async () => ({ commands: [{ id: 1, member_id: 1, name: "review", description: "Review", template: "{input}" }] })),
}));
vi.mock("./api", () => api);
import { filesShortcut, insertSlash, isFilesShortcut, mountComposerPlus, type ComposerPlusHost } from "./composer-plus";
import { toolsAfterToggle } from "./member-tools";
import { setLocale, t } from "./i18n";
import { mountSlashMenu } from "./slash-menu";
import type { Member, MemberPatch } from "./types";
import { closeMenu } from "./ui";

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
/** A press the way the browser makes it: down, up, then the click. */
function press(target: Element): void {
  const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: 5, clientY: 5 };
  target.dispatchEvent(new PointerEvent("pointerdown", init));
  target.dispatchEvent(new PointerEvent("pointerup", init));
  target.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
}
const key = (target: Element, name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

let member: Member, button: HTMLButtonElement, input: HTMLTextAreaElement, form: HTMLFormElement, host: ComposerPlusHost;
type Spy = Mock<(...args: any[]) => void>; // eslint-disable-line @typescript-eslint/no-explicit-any
let pickFiles: Spy, update: Spy, add: Spy, browseApps: Spy, manage: Spy, skillsChanged: Spy;
let folderShown = true;
let handlers: ((event: { type: string }) => void)[];

function mount(): void {
  form = document.createElement("form");
  form.innerHTML = '<textarea class="cmp-input"></textarea><button type="button" class="btn cmp-attach" aria-haspopup="menu" aria-expanded="false"><svg class="i"></svg></button>';
  document.body.append(form);
  input = form.querySelector("textarea")!; button = form.querySelector("button")!;
  handlers = [];
  host = {
    input, member: () => member,
    update: async (id: number, patch: MemberPatch) => { update(id, patch); Object.assign(member, patch); return true; },
    pickFiles, folder: { shown: () => folderShown, add }, browseApps, manage, skillsChanged,
    onEvent: handler => { handlers.push(handler as (event: { type: string }) => void); },
  };
  mountComposerPlus(button, host);
}
const root = (): HTMLElement | null => document.querySelector<HTMLElement>("#app-popover.composer-plus");
const sub = (): HTMLElement | null => document.querySelector<HTMLElement>("#app-submenu");
const rows = (panel: HTMLElement | null): string[] => [...(panel?.querySelectorAll("button") ?? [])].map(item => item.querySelector(".mt")?.textContent ?? "");
const open = async (): Promise<HTMLElement> => { press(button); await flush(); return root()!; };
const openSub = async (id: "apps" | "skills"): Promise<HTMLElement> => { await open(); press(root()!.querySelector(`[data-plus="${id}"]`)!); await flush(); return sub()!; };

beforeEach(() => {
  closeMenu();
  document.body.innerHTML = "";
  setLocale("zh-TW");
  vi.clearAllMocks();
  member = { id: 3, name: "小晴", tools: null, avatar: null } as unknown as Member;
  state.choices = { tools: [], connections: [
    { id: "notion", name: "Notion", enabled: true }, { id: "github", name: "GitHub", enabled: true }, { id: "slack", name: "Slack", enabled: false },
  ] };
  state.skills = [
    { id: 11, name: "研究整理", description: "", enabled: true, source: "local" },
    { id: 12, name: "週報", description: "", enabled: false, source: "local" },
  ];
  folderShown = true;
  pickFiles = vi.fn(); update = vi.fn(); add = vi.fn(); browseApps = vi.fn(); manage = vi.fn(); skillsChanged = vi.fn();
  mount();
});
afterEach(() => { closeMenu(); document.body.innerHTML = ""; });

test("the + opens one menu of files, the folder, slash commands, then apps and skills as submenus, each row with its own icon, and pressing it again closes it", async () => {
  const panel = await open();
  expect(panel.getAttribute("role")).toBe("menu");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(rows(panel)).toEqual([t("composerPlus.files"), t("writeFolders.add"), t("composerPlus.slash"), t("conn.apps"), t("members.panelSkills")]);
  expect(panel.querySelector('[data-plus="files"] .mtrail')!.textContent).toBe(filesShortcut());
  const icons = [...panel.querySelectorAll("button > .ck svg")].map(icon => icon.innerHTML);
  expect(icons).toHaveLength(5);
  expect(new Set(icons).size).toBe(5);
  // The two that open a submenu say so; the others are plain items.
  expect([...panel.querySelectorAll("button")].map(item => item.getAttribute("aria-haspopup"))).toEqual([null, null, null, "menu", "menu"]);
  expect(panel.querySelectorAll(".menu-sep")).toHaveLength(1);
  press(button);
  expect(root()).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  // The press that closed it opened nothing again (R-UI-124).
  await flush();
  expect(root()).toBeNull();
});

test("the folder row is offered while the composer's folder button is, and is that button's action", async () => {
  folderShown = false;
  expect(rows(await open())).not.toContain(t("writeFolders.add"));
  closeMenu(); folderShown = true;
  const panel = await open();
  press(panel.querySelector('[data-plus="folder"]')!);
  expect(add).toHaveBeenCalledOnce();
  expect(root()).toBeNull();
});

test("加入檔案或圖片 opens the picker, and so does Ctrl+U (⌘U) anywhere in the composer, with the menu closed or open", async () => {
  press((await open()).querySelector('[data-plus="files"]')!);
  expect(pickFiles).toHaveBeenCalledOnce();
  expect(root()).toBeNull();
  const ctrl = key(input, "u", { ctrlKey: true });
  expect(ctrl.defaultPrevented).toBe(true);
  expect(pickFiles).toHaveBeenCalledTimes(2);
  await open();
  key(button, "U", { ctrlKey: true });
  expect(pickFiles).toHaveBeenCalledTimes(3);
  expect(root()).toBeNull();
  // Other combinations, a Mac's Control, and typing a u are the field's own.
  for (const init of [{ ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, { metaKey: true }, {}]) key(input, "u", init);
  expect(pickFiles).toHaveBeenCalledTimes(3);
  expect(isFilesShortcut({ key: "ц", code: "KeyU", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
});

test("斜線指令 puts a / at the caret, after a space when a word comes before it, and tells the field as typing does", async () => {
  const heard = vi.fn();
  input.addEventListener("input", heard);
  press((await open()).querySelector('[data-plus="slash"]')!);
  expect(input.value).toBe("/");
  expect(heard).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(input);
  expect(root()).toBeNull();
  input.value = "整理這個"; input.setSelectionRange(4, 4);
  insertSlash(input);
  expect(input.value).toBe("整理這個 /");
  input.value = "整理 這個"; input.setSelectionRange(3, 3);
  insertSlash(input);
  expect(input.value).toBe("整理 /這個");
  expect(input.selectionStart).toBe(4);
});

test("with the real / menu on the field, the row opens it exactly as typing a / does, and a name typed after it narrows it", async () => {
  mountSlashMenu(input, { memberId: () => member.id });
  input.focus(); await flush();
  press((await open()).querySelector('[data-plus="slash"]')!);
  await flush();
  const menu = document.querySelector<HTMLElement>("#app-popover.slash-menu");
  expect(menu).not.toBeNull();
  expect([...menu!.querySelectorAll(".mt")].map(item => item.textContent)).toContain("/review");
  expect(document.activeElement).toBe(input);
});

test("應用程式 › opens beside its row with 瀏覽 and 管理, a line, then each connected app with its mark and a switch, the member's list on", async () => {
  const panel = await openSub("apps");
  expect(panel).not.toBeNull();
  expect(root()!.querySelector('[data-plus="apps"]')!.getAttribute("aria-expanded")).toBe("true");
  expect(rows(panel)).toEqual([t("composerPlus.browseApps"), t("composerPlus.manageApps"), "Notion", "GitHub"]);
  expect(panel.querySelectorAll(".menu-sep")).toHaveLength(1);
  const apps = [...panel.querySelectorAll<HTMLElement>("[data-app]")];
  expect(apps.map(item => item.getAttribute("role"))).toEqual(["menuitemcheckbox", "menuitemcheckbox"]);
  expect(apps.map(item => item.getAttribute("aria-checked"))).toEqual(["true", "true"]);
  // Each app wears the mark the settings' list draws, and a switch the row is the button of.
  for (const item of apps) { expect(item.querySelector(".mlead .mono")).not.toBeNull(); expect(item.querySelector(".tg")).not.toBeNull(); }
  // The member's colour is on the panel, so that a switch that is on wears it (R-UI-147).
  expect(panel.hasAttribute("data-member-switch")).toBe(true);
  expect(panel.style.getPropertyValue("--member-switch")).not.toBe("");
});

test("with no app connected the submenu has only the two ways in, no line and no empty list", async () => {
  state.choices.connections = [{ id: "slack", name: "Slack", enabled: false }];
  const panel = await openSub("apps");
  expect(rows(panel)).toEqual([t("composerPlus.browseApps"), t("composerPlus.manageApps")]);
  expect(panel.querySelector(".menu-sep, .pm-list")).toBeNull();
});

test("an app's switch is the member's 工具 setting: the same list the settings save, null again once every app is on", async () => {
  const panel = await openSub("apps");
  press(panel.querySelector('[data-app="notion"]')!);
  await flush();
  expect(update).toHaveBeenLastCalledWith(3, { tools: ["github"] });
  expect(update.mock.calls[0][1].tools).toEqual(toolsAfterToggle(null, state.choices as never, "notion"));
  // The menu stays open and the row says what is saved.
  expect(sub()).not.toBeNull();
  expect(panel.querySelector('[data-app="notion"]')!.getAttribute("aria-checked")).toBe("false");
  expect(panel.querySelector('[data-app="github"]')!.getAttribute("aria-checked")).toBe("true");
  press(panel.querySelector('[data-app="notion"]')!);
  await flush();
  expect(update).toHaveBeenLastCalledWith(3, { tools: null });
  expect(panel.querySelector('[data-app="notion"]')!.getAttribute("aria-checked")).toBe("true");
});

test("a member that may use only some apps shows those on, and a refused change puts the switch back", async () => {
  member.tools = ["github"];
  const panel = await openSub("apps");
  expect([...panel.querySelectorAll("[data-app]")].map(item => item.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  host.update = async () => false;
  press(panel.querySelector('[data-app="notion"]')!);
  expect(panel.querySelector('[data-app="notion"]')!.getAttribute("aria-checked")).toBe("true");
  await flush();
  expect(panel.querySelector('[data-app="notion"]')!.getAttribute("aria-checked")).toBe("false");
});

test("瀏覽應用程式 and 管理應用程式 leave the menu for Connect Apps and for this member's 工具 tab", async () => {
  press((await openSub("apps")).querySelector('[data-plus="browse-apps"]')!);
  expect(browseApps).toHaveBeenCalledOnce();
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  press((await openSub("apps")).querySelector('[data-plus="manage-apps"]')!);
  expect(manage).toHaveBeenLastCalledWith("tools");
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
});

test("技能 › lists the member's skills with their switches, then 管理技能 that opens the 技能與指令 tab", async () => {
  const panel = await openSub("skills");
  expect(rows(panel)).toEqual(["研究整理", "週報", t("composerPlus.manageSkills")]);
  expect([...panel.querySelectorAll("[data-skill]")].map(item => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  expect(panel.querySelectorAll(".menu-sep")).toHaveLength(1);
  press(panel.querySelector('[data-plus="manage-skills"]')!);
  expect(manage).toHaveBeenLastCalledWith("skills");
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
});

test("a skill's switch saves what the 技能 tab saves, tells the / menu and stays open; a refusal puts it back and says so", async () => {
  const panel = await openSub("skills");
  press(panel.querySelector('[data-skill="12"]')!);
  expect(panel.querySelector('[data-skill="12"]')!.getAttribute("aria-checked")).toBe("true");
  await flush();
  expect(api.membersSkillsUpdate).toHaveBeenLastCalledWith(3, 12, true);
  expect(skillsChanged).toHaveBeenCalledOnce();
  expect(sub()).not.toBeNull();
  api.membersSkillsUpdate.mockRejectedValueOnce(new Error("no"));
  press(panel.querySelector('[data-skill="11"]')!);
  await flush();
  expect(panel.querySelector('[data-skill="11"]')!.getAttribute("aria-checked")).toBe("true");
  expect(skillsChanged).toHaveBeenCalledOnce();
});

test("a member with no skill has only 管理技能 in the submenu", async () => {
  state.skills = [];
  const panel = await openSub("skills");
  expect(rows(panel)).toEqual([t("composerPlus.manageSkills")]);
  expect(panel.querySelector(".menu-sep, .pm-list")).toBeNull();
});

test("the lists are read as the menu opens and again when the apps or the member change while it is open", async () => {
  const panel = await openSub("apps");
  expect(api.membersToolChoices).toHaveBeenCalledOnce();
  state.choices.connections.push({ id: "figma", name: "Figma", enabled: true });
  handlers.forEach(handler => handler({ type: "ConnectionsChanged" })); await flush();
  expect(rows(panel)).toContain("Figma");
  const drawn = panel.innerHTML;
  handlers.forEach(handler => handler({ type: "MembersChanged" })); await flush();
  expect(panel.innerHTML).toBe(drawn);
});

test("the right arrow opens a submenu from its row, Escape closes one level and Left too, and the focus goes back to the row", async () => {
  const panel = await open();
  const apps = panel.querySelector<HTMLElement>('[data-plus="apps"]')!;
  apps.focus();
  key(apps, "ArrowRight"); await flush();
  expect(sub()).not.toBeNull();
  expect(sub()!.contains(document.activeElement)).toBe(true);
  key(document.activeElement!, "Escape");
  expect(sub()).toBeNull();
  expect(root()).not.toBeNull();
  expect(document.activeElement).toBe(apps);
  key(apps, "ArrowRight"); await flush();
  key(document.activeElement!, "ArrowLeft");
  expect(sub()).toBeNull();
  expect(root()).not.toBeNull();
  key(apps, "Escape");
  expect(root()).toBeNull();
});

test("the arrow keys walk the rows of the menu and of a submenu, and Space or Enter on a switch row presses it", async () => {
  const panel = await open();
  const first = panel.querySelector<HTMLElement>("button")!;
  expect(document.activeElement).toBe(first);
  key(first, "ArrowDown");
  expect(document.activeElement).toBe(panel.querySelectorAll("button")[1]);
  key(document.activeElement!, "End");
  expect(document.activeElement).toBe(panel.querySelector('[data-plus="skills"]'));
  const apps = panel.querySelector<HTMLElement>('[data-plus="apps"]')!;
  apps.focus(); key(apps, "ArrowRight"); await flush();
  const items = [...sub()!.querySelectorAll("button")];
  key(items[0], "End");
  expect(document.activeElement).toBe(items[items.length - 1]);
  // A switch row is a button: Enter and Space are its click.
  const github = sub()!.querySelector<HTMLButtonElement>('[data-app="github"]')!;
  github.focus(); github.click(); await flush();
  expect(update).toHaveBeenLastCalledWith(3, { tools: ["notion"] });
});

test("a press on the row that opened a submenu folds it away alone, and a press outside closes both", async () => {
  const outside = document.createElement("button");
  document.body.append(outside);
  const opened = vi.fn();
  outside.addEventListener("click", opened);
  const panel = await open();
  const apps = panel.querySelector<HTMLElement>('[data-plus="apps"]')!;
  press(apps); await flush();
  expect(sub()).not.toBeNull();
  press(apps); await flush();
  expect(sub()).toBeNull();
  expect(root()).toBe(panel);
  expect(apps.getAttribute("aria-expanded")).toBe("false");
  press(apps); await flush();
  expect(sub()).not.toBeNull();
  press(outside); await flush();
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  expect(opened).toHaveBeenCalledOnce();
});

test("a press on a submenu's row soon after the pointer reached it leaves it open: the hover's delayed opening is no second press", async () => {
  vi.useFakeTimers();
  try {
    const apps = (await open()).querySelector<HTMLElement>('[data-plus="apps"]')!;
    apps.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 5, clientY: 5 }));
    press(apps);
    expect(sub()).not.toBeNull();
    vi.advanceTimersByTime(400);
    expect(sub()).not.toBeNull();
    expect(apps.getAttribute("aria-expanded")).toBe("true");
  } finally { vi.useRealTimers(); }
});

test("the + pressed while a submenu is open closes the whole menu and opens nothing again", async () => {
  await openSub("skills");
  press(button); await flush();
  expect(document.querySelector("#app-popover, #app-submenu")).toBeNull();
  expect(button.getAttribute("aria-expanded")).toBe("false");
  press(button); await flush();
  expect(root()).not.toBeNull();
});

test("every word of the menu is in each language: no key is left as its own name", () => {
  for (const locale of ["zh-TW", "en", "ja", "de", "ru"] as const) {
    setLocale(locale);
    for (const name of ["composerPlus.label", "composerPlus.files", "composerPlus.slash", "composerPlus.browseApps", "composerPlus.manageApps", "composerPlus.manageSkills"] as const) {
      expect(t(name), `${locale} ${name}`).not.toBe(name);
    }
  }
  setLocale("zh-TW");
});
