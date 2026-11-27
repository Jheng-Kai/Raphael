// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), membersList: vi.fn(), pickOutputFolder: vi.fn(), pickImportSource: vi.fn() }));
vi.mock("./api", () => api);
const platform = vi.hoisted(() => ({ mac: false }));
vi.mock("../shared/platform", () => ({ get IS_MAC() { return platform.mac; } }));
import { createSkillLibrary, failureText, gitHost, importButtonHTML, skillLibraryHTML, sourceName, type LibraryPackage } from "./skill-library";
import { closeMenu, headerCloseButton, toaster } from "./ui";
import { navInputs, pressLayer } from "./test-support/nav-layer-input";

const skill = (id: number, name: string, enabled = true) => ({ id, name, description: `${name} 的說明`, enabled });
const packages = (): LibraryPackage[] => [
  { key: "set:1", name: "pstack", kind: "plugin", source: "jheng-kai/pstack", description: "", version: "1.4.0", enabled: true, access: [], updatable: true,
    skills: [skill(1, "verify"), skill(2, "look"), skill(3, "judge")] },
  { key: "pack:2", name: "研究工具", kind: "pack", source: "example/research", description: "", version: "", enabled: true, access: [1, 2], updatable: true,
    skills: [skill(4, "來源核對"), skill(5, "每週摘要", false)] },
  { key: "skill:3", name: "會議紀錄", kind: "single", source: "會議紀錄.md", description: "", version: "", enabled: true, access: "all", updatable: false,
    skills: [skill(6, "會議紀錄")] },
];
const members = [{ id: 1, name: "小晴" }, { id: 2, name: "小森" }, { id: 3, name: "小葵" }];
/** 小森's generated picture, as the roster carries it: the face the window draws for it everywhere. */
const PICTURE = "data:image/png;base64,AAAA";
const roster = { members: [{ id: 0, name: "Raphael" }, { id: 1, name: "小晴" }, { id: 2, name: "小森", avatar: "file:2.png", avatar_url: PICTURE }, { id: 3, name: "小葵" }] };

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.resetAllMocks(); platform.mac = false; handOff.mockImplementation(() => true); });

/** What the window gives to Raphael's conversation: the owner's words and the files beside them. */
const handOff = vi.fn((_words: string, _attachments: unknown[]) => true);

async function setup(answer: (method: string, params: Record<string, unknown>) => unknown = () => ({})) {
  const state = { packages: packages() };
  api.membersList.mockResolvedValue(roster);
  api.core.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    if (method === "skills.library.list") return { packages: state.packages, members };
    return answer(method, params);
  });
  const root = document.createElement("div");
  document.body.append(root);
  // As Settings draws it: the tab scrolls, and a drawing keeps where it was scrolled.
  const library = createSkillLibrary(root, () => {
    const at = root.scrollTop;
    root.innerHTML = skillLibraryHTML(library.view(), {
      listHeader: `<header class="set-head"><h1 id="set-title">團隊技能</h1>${importButtonHTML()}${headerCloseButton("Close")}</header>`,
      pageClose: headerCloseButton("Close"),
    });
    root.scrollTop = at;
    library.painted();
  }, () => root, handOff);
  await library.load();
  return { root, library, state };
}
const press = (root: ParentNode, selector: string) => (root.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector))!.click();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const accessOf = (root: ParentNode, key: string) => root.querySelector(`.skl-pack[data-skl-pack="${key}"] .skl-access span`)?.textContent;

test.each([true, false])("update progress stays visible until the package RPC completes (success: %s)", async success => {
  let finish: (value: { package: LibraryPackage }) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const pending = new Promise<{ package: LibraryPackage }>((resolve, reject) => { finish = resolve; fail = reject; });
  const { root } = await setup(() => pending);
  press(root, '[data-skl="open"][data-key="set:1"]');
  press(root, '[data-skl="refresh"][data-key="set:1"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "set:1", refresh: true });
  expect(root.querySelector('[role="status"].skl-refresh-status')).not.toBeNull();
  expect(root.querySelector<HTMLButtonElement>('[data-skl="skill"]')?.disabled).toBe(true);
  press(root, '[data-skl="back"]');
  expect(root.querySelector('[data-skl-pack="set:1"] .skl-refresh-status')).not.toBeNull();
  expect(root.querySelector<HTMLButtonElement>('[data-skl-pack="pack:2"] [data-skl="toggle"]')?.disabled).toBe(false);
  if (success) finish({ package: { ...packages()[0], name: "Updated package" } });
  else fail(new Error("update failed"));
  await settle();
  expect(root.querySelector(".skl-refresh-status")).toBeNull();
  expect(root.querySelector('[data-skl-pack="set:1"] .skl-name')?.textContent).toBe(success ? "Updated package" : "pstack");
});

test("one row per package says who may use it, and its name opens its skills on a page of its own", async () => {
  const { root } = await setup((method, params) => method === "members.skills.read"
    ? { text: `---\nname: skill\ndescription: 說明\n---\n# 怎麼用\n\n第 ${params.id} 個技能的內容` } : {});
  expect(root.querySelector("h1#set-title")?.textContent).toBe("團隊技能");
  expect(root.querySelector(".set-head .close-button")).not.toBeNull();
  expect(root.querySelector(".skl")?.getAttribute("aria-label")).toBe("團隊技能");
  expect(root.querySelectorAll(".skl-pack")).toHaveLength(3);
  expect([...root.querySelectorAll(".skl-section > h2")].map(heading => heading.textContent)).toEqual(["外掛", "技能"]);
  expect(root.querySelector('[data-skl-section="plugins"] [data-skl-pack="pack:2"]')).not.toBeNull();
  expect(root.querySelector('[data-skl-section="skills"] [data-skl-pack="skill:3"]')).not.toBeNull();
  expect(root.querySelector('.skl-pack[data-skl-pack="set:1"] .skl-count')?.textContent).toBe("3 個技能");
  expect(root.querySelector('.skl-pack[data-skl-pack="skill:3"] .skl-count, .skl-pack[data-skl-pack="skill:3"] [data-skl="open"]')).toBeNull();
  expect(root.querySelector('.skl-pack[data-skl-pack="skill:3"] [data-skl="open-skill"] .d')?.textContent).toBe("會議紀錄 的說明");
  expect([accessOf(root, "set:1"), accessOf(root, "pack:2"), accessOf(root, "skill:3")]).toEqual(["還沒給任何人", "小晴、小森", "整個團隊"]);
  expect(root.querySelector(".skl-skill")).toBeNull();
  // No row folds open any more: the row is a way to its page, with no expanded state.
  expect(root.querySelector('[data-skl="open"]')?.hasAttribute("aria-expanded")).toBe(false);
  press(root, '[data-skl="open"][data-key="pack:2"]');
  // The page takes the list's place: the importer and the other packages are gone from it.
  const page = root.querySelector<HTMLElement>('.skl-page[data-skl-page="pack:2"]')!;
  expect(page).not.toBeNull();
  expect(root.querySelector(".skl-import, .skl-list")).toBeNull();
  expect(root.querySelectorAll(".skl-pack")).toHaveLength(1);
  expect([...root.querySelectorAll("h1")].map(heading => heading.textContent)).toEqual(["研究工具"]);
  expect(page.querySelector(".skl-page-head h1#set-title")?.textContent).toBe("研究工具");
  expect(page.querySelector(".skl-page-head .skl-count")).toBeNull();
  // Where it came from stands in the quote under the title.
  expect(page.querySelector(".skl-about > .skl-source")?.textContent).toBe("example/research");
  expect(page.querySelector(".skl-page-head .close-button")).not.toBeNull();
  expect(document.activeElement).toBe(page.querySelector('[data-skl="back"]'));
  expect(accessOf(root, "pack:2")).toBe("小晴、小森");
  // Who may use it, the update button, its trash and the switch; no ⋯ at all (Settings has no right click to reach one).
  const controls = [...page.querySelectorAll<HTMLElement>(".skl-page-actions .ctl > button")];
  expect(controls.map(control => control.dataset.skl)).toEqual(["access", "refresh", "remove", "toggle"]);
  expect(controls.every(control => control.dataset.key === "pack:2")).toBe(true);
  expect(page.querySelector<HTMLElement>('[data-skl="remove"]')!.getAttribute("aria-label")).toBe("刪除");
  expect(root.querySelector("[data-overflow], [data-skl='more'], [data-skl='skill-more']")).toBeNull();
  const rows = [...page.querySelectorAll(".skl-skill")];
  expect(rows.map(row => row.querySelector(".t")?.textContent)).toEqual(["來源核對", "每週摘要"]);
  expect(rows[1].querySelector(".tg")?.getAttribute("aria-checked")).toBe("false");
  for (const row of rows) {
    // A skill's row has its switch alone: its trash is on its own page.
    expect([...row.querySelectorAll<HTMLElement>(".ctl > button")].map(control => control.dataset.skl)).toEqual(["skill"]);
    expect(row.querySelector('[data-skl="open-skill"]')).not.toBeNull();
  }
  // A skill opens on its own page, which reads and shows its document without its front matter.
  press(root, '[data-skl="open-skill"][data-id="4"]');
  expect(api.core).toHaveBeenCalledWith("members.skills.read", { member_id: 0, shared: true, id: 4 });
  expect(root.querySelector(".skl-doc-page h1#set-title")?.textContent).toBe("來源核對");
  await settle();
  const doc = root.querySelector(".skl-doc")!;
  expect(doc.textContent).toContain("第 4 個技能的內容");
  expect(doc.textContent).not.toContain("description:");
  expect(root.querySelector(".skl-doc-page .skl-about p")?.textContent).toBe("來源核對 的說明");
  // A skill of a pack carries its pencil, trash and switch.
  expect([...root.querySelectorAll<HTMLElement>(".skl-doc-page .skl-page-actions .ctl > button")].map(control => control.dataset.skl)).toEqual(["skill-rename", "skill-remove", "skill"]);
  press(root, '[data-skl="back"]');
  expect(root.querySelector('.skl-page[data-skl-page="pack:2"]:not(.skl-doc-page)')).not.toBeNull();
  expect(document.activeElement).toBe(root.querySelector('[data-skl="open-skill"][data-id="4"]'));
  // A skill's own switch, and the package's.
  press(root, '[data-skl="skill"][data-id="5"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "pack:2", skill: { id: 5, enabled: true } });
  press(root, '[data-skl="toggle"][data-key="pack:2"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "pack:2", enabled: false });
  expect(root.querySelector<HTMLButtonElement>('[data-skl="skill"][data-id="4"]')!.disabled).toBe(true);
  // A skill alone opens on its page too, with its package's controls, and goes back to the list.
  press(root, '[data-skl="back"]');
  expect(root.querySelector('[data-skl="open"][data-key="skill:3"]')).toBeNull();
  press(root, '[data-skl="open-skill"][data-key="skill:3"]');
  await settle();
  expect(root.querySelector(".skl-doc-page h1#set-title")?.textContent).toBe("會議紀錄");
  expect(root.querySelector(".skl-doc")?.textContent).toContain("第 6 個技能的內容");
  expect([...root.querySelectorAll<HTMLElement>(".skl-doc-page .skl-page-actions .ctl > button")].map(control => control.dataset.skl)).toEqual(["access", "remove", "toggle"]);
  press(root, '[data-skl="back"]');
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(document.activeElement).toBe(root.querySelector('[data-skl="open-skill"][data-key="skill:3"]'));
});

test.each(navInputs)("a step back with %s returns from a package's page to the list", async input => {
  const { root } = await setup();
  root.scrollTop = 90;
  press(root, '[data-skl="open"][data-key="set:1"]');
  expect(root.querySelector(".skl-page")).not.toBeNull();
  pressLayer(input);
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.scrollTop).toBe(90);
});

test("every page of Team skills keeps its close in a header the shared sticky rule holds at the top (R-UI-182)", async () => {
  // A plugin's skill page drew its header straight in the page, which the shared rule did not name: its header and close
  // scrolled away with a long document and the dialog could not be closed. Each page is drawn as Settings draws it.
  const rule = /\.modal-scrim \.modal-body :is\(([^)]*)\)\s*\{\s*position:\s*sticky/.exec(readFileSync(join(__dirname, "styles.css"), "utf8"));
  const sticky = rule![1]!.split(",").map(part => `.modal-scrim .modal-body ${part.trim()}`);
  const { root } = await setup((method, params) => method === "members.skills.read" ? { text: `# ${params.id}` } : {});
  root.className = "set-content";
  const scrim = document.createElement("div"), body = document.createElement("div");
  scrim.className = "modal-scrim";
  body.className = "modal-body";
  scrim.append(body);
  document.body.append(scrim);
  body.append(root);
  const held = (): string => {
    const closes = root.querySelectorAll(".close-button");
    expect(closes).toHaveLength(1);
    for (let node = closes[0]!.parentElement; node && node !== body; node = node.parentElement) if (sticky.some(selector => node!.matches(selector))) return node.className;
    return "";
  };
  expect(held(), "the list").not.toBe("");
  press(root, '[data-skl="open"][data-key="pack:2"]');
  expect(held(), "a package's page").not.toBe("");
  press(root, '[data-skl="open-skill"][data-id="4"]');
  await settle();
  expect(root.querySelector(".skl-doc-page")).not.toBeNull();
  expect(held(), "a plugin's skill page").not.toBe("");
  press(root, '[data-skl="back"]');
  press(root, '[data-skl="back"]');
  press(root, '[data-skl="open-skill"][data-key="skill:3"]');
  await settle();
  expect(root.querySelector(".skl-doc-page h1#set-title")?.textContent).toBe("會議紀錄");
  expect(held(), "a skill alone").not.toBe("");
});

test("the back arrow and Esc return to the list where it was left, with the focus on the package's row", async () => {
  const { root } = await setup();
  root.scrollTop = 180;
  press(root, '[data-skl="open"][data-key="set:1"]');
  expect(root.querySelector(".skl-page")).not.toBeNull();
  expect(root.scrollTop).toBe(0);
  press(root, '[data-skl="back"]');
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.querySelector('[data-skl="import-open"]')).not.toBeNull();
  expect(root.scrollTop).toBe(180);
  expect(document.activeElement).toBe(root.querySelector('[data-skl="open"][data-key="set:1"]'));
  // Esc does the same, and is taken: Settings stays open.
  root.scrollTop = 120;
  press(root, '[data-skl="open"][data-key="pack:2"]');
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  root.querySelector<HTMLElement>('[data-skl="back"]')!.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.scrollTop).toBe(120);
  expect(document.activeElement).toBe(root.querySelector('[data-skl="open"][data-key="pack:2"]'));
  // On the list, Esc is left to Settings.
  const closing = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  root.querySelector<HTMLElement>('[data-skl="open"]')!.dispatchEvent(closing);
  expect(closing.defaultPrevented).toBe(false);
});

test("a package deleted from its own page leaves for the list, and a reset starts on the list", async () => {
  const { root, library } = await setup(() => ({ deleted: true }));
  press(root, '[data-skl="open"][data-key="set:1"]');
  // The page's trash asks in the red dialog naming the package, with no menu first: Cancel deletes nothing, its red button does.
  press(root, '.skl-page-actions [data-skl="remove"][data-key="set:1"]');
  expect(document.getElementById("app-popover")).toBeNull();
  expect(document.querySelector(".mb-delete h2")?.textContent).toBe("移除「pstack」？");
  expect(document.querySelector(".mb-delete .mb-dlg-body")?.textContent).toBe("移除後就不能再用它，也無法復原。");
  expect(document.querySelector('.mb-delete [data-dlg="delete"]')?.textContent).toBe("刪除");
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="cancel"]')!.click();
  await settle();
  expect(api.core).not.toHaveBeenCalledWith("skills.library.delete", expect.anything());
  press(root, '.skl-page-actions [data-skl="remove"][data-key="set:1"]');
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="delete"]')!.click();
  await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.delete", { key: "set:1" });
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.querySelector('[data-skl="import-open"]')).not.toBeNull();
  expect(root.querySelector('.skl-pack[data-skl-pack="set:1"]')).toBeNull();
  press(root, '[data-skl="open"][data-key="pack:2"]');
  library.reset();
  root.innerHTML = skillLibraryHTML(library.view());
  expect(root.querySelector(".skl-page")).toBeNull();
});

test("the access menu ticks characters one by one and turns into the whole team when all are ticked", async () => {
  const { root } = await setup((method, params) => method === "skills.library.update" ? { package: { ...packages()[0], ...params } } : {});
  press(root, '[data-skl="access"][data-key="set:1"]');
  const menu = document.querySelector(".skl-access-menu")!;
  expect([...menu.querySelectorAll("[data-member]")].map(item => item.getAttribute("aria-checked"))).toEqual(["false", "false", "false"]);
  (menu.querySelector('[data-member="1"]') as HTMLElement).click();
  expect(api.core).toHaveBeenLastCalledWith("skills.library.update", { key: "set:1", access: [1] });
  // The menu stays open while names are ticked, and says what is ticked.
  expect(document.querySelector(".skl-access-menu [data-member=\"1\"]")?.getAttribute("aria-checked")).toBe("true");
  (document.querySelector('.skl-access-menu [data-member="2"]') as HTMLElement).click();
  (document.querySelector('.skl-access-menu [data-member="3"]') as HTMLElement).click();
  expect(api.core).toHaveBeenLastCalledWith("skills.library.update", { key: "set:1", access: "all" });
  await settle();
  expect(accessOf(root, "set:1")).toBe("整個團隊");
});

test("each row of the access menu leads with who it names, a face or the team's own picture, and its check stands at the right", async () => {
  const { root } = await setup();
  press(root, '[data-skl="access"][data-key="pack:2"]');
  const menu = document.querySelector(".skl-access-menu")!;
  const rows = [...menu.querySelectorAll<HTMLElement>('[data-access="all"], [data-member]')];
  // No check on the left any more: the face, the name, then the check's place at the right edge, on every row.
  expect(rows.map(row => [...row.children].map(part => part.className))).toEqual(rows.map(() => ["mlead", "mt", "ck"]));
  const all = menu.querySelector('[data-access="all"]')!;
  // The whole team is drawn as the sidebar draws it: its first faces in one square (slimes only, Raphael is not among them).
  expect([...all.querySelectorAll(".mlead > .room-avatar > .av")].map(face => face.getAttribute("data-presence-member"))).toEqual(["1", "2", "3"]);
  // Each character's own face, from the roster: 小森's picture, the others their slimes.
  expect([...menu.querySelectorAll("[data-member] .mlead > .av")].map(face => face.getAttribute("data-presence-member"))).toEqual(["1", "2", "3"]);
  expect(menu.querySelector('[data-member="2"] .mlead .mb-av-pic img')?.getAttribute("src")).toBe(PICTURE);
  // 小晴 and 小森 may use 研究工具: their checks stand at the right, and 小葵 and the whole team keep only the check's place.
  expect([...menu.querySelectorAll("[data-member]")].map(row => !!row.querySelector(".ck:last-child svg"))).toEqual([true, true, false]);
  expect(all.querySelector(".ck svg")).toBeNull();
});

/** A library whose team has `count` characters, so that the access menu has many rows. */
async function setupTeam(count: number) {
  const team = Array.from({ length: count }, (_, at) => ({ id: at + 1, name: at < 3 ? ["小晴", "小森", "小葵"][at]! : `角色${at + 1}` }));
  api.membersList.mockResolvedValue({ members: [{ id: 0, name: "Raphael" }, ...team] });
  const state = { packages: packages() };
  api.core.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    if (method === "skills.library.list") return { packages: state.packages, members: team };
    if (method === "skills.library.update") return { package: { ...state.packages[1], ...params } };
    return {};
  });
  const root = document.createElement("div");
  document.body.append(root);
  const library = createSkillLibrary(root, () => { root.innerHTML = skillLibraryHTML(library.view()); });
  await library.load();
  press(root, '[data-skl="access"][data-key="pack:2"]');
  return { root, menu: document.querySelector<HTMLElement>(".skl-access-menu")!, team };
}

test("the access menu is short however many characters there are: the whole team, a search once there are many, a list that scrolls, and 移除所有人 at the foot", async () => {
  const few = await setupTeam(6);
  // Six characters or fewer need no search.
  expect(few.menu.querySelector("[data-skl-search]")).toBeNull();
  expect([...few.menu.children].map(part => part.className.replace("menu-sep", "sep"))).toEqual(["skl-access-top", "sep", "skl-access-list", "sep", "skl-access-foot"]);
  closeMenu();
  document.body.replaceChildren();
  const many = await setupTeam(25);
  expect([...many.menu.children].map(part => part.className.replace("menu-sep", "sep"))).toEqual(["skl-access-top", "sep", "lang-search skl-access-search", "skl-access-list", "sep", "skl-access-foot"]);
  expect(many.menu.querySelector<HTMLInputElement>("[data-skl-search]")?.placeholder).toBe("搜尋角色");
  expect(many.menu.querySelectorAll(".skl-access-list [data-member]")).toHaveLength(25);
  expect(many.menu.querySelector('.skl-access-foot [data-access="none"]')?.textContent).toBe("移除所有人");
  // The list is the only thing that scrolls, and it is capped at six rows.
  const css = readFileSync(join(__dirname, "skill-library.css"), "utf8");
  expect(css).toMatch(/\.skl-access-list \{[^}]*max-height: calc\(6 \* var\(--h-menu\)\)[^}]*overflow-y: auto/);
});

test("the menu's search keeps what is ticked, and finds a character by its name", async () => {
  const { menu } = await setupTeam(25);
  const search = menu.querySelector<HTMLInputElement>("[data-skl-search]")!;
  search.value = "角色25";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const names = [...menu.querySelectorAll(".skl-access-list [data-member]")].map(row => row.textContent);
  expect(names.length).toBeGreaterThan(0);
  expect(names.length).toBeLessThan(25);
  expect(names).toContain("角色25");
  expect(names).not.toContain("小晴");
  // What was typed stays in the field while a name is ticked, and the other names are still ticked as they were.
  (menu.querySelector('[data-member="25"]') as HTMLElement | null)?.click();
  expect(search.value).toBe("角色25");
  search.value = "沒有這個人";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(menu.querySelector(".skl-access-list")?.textContent).toBe("找不到這個角色");
  search.value = "";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(menu.querySelectorAll(".skl-access-list [data-member]")).toHaveLength(25);
  expect(menu.querySelector('[data-member="1"]')?.getAttribute("aria-checked")).toBe("true");
});

test("移除所有人 sets the package to nobody, keeps the menu open, and never touches a character", async () => {
  const { root, menu } = await setupTeam(25);
  const none = menu.querySelector<HTMLElement>('[data-access="none"]')!;
  expect(none.getAttribute("aria-disabled")).toBe("false");
  none.click();
  expect(api.core).toHaveBeenLastCalledWith("skills.library.update", { key: "pack:2", access: [] });
  expect(document.querySelector(".skl-access-menu")).not.toBeNull();
  expect([...document.querySelectorAll(".skl-access-menu [data-member]")].every(row => row.getAttribute("aria-checked") === "false")).toBe(true);
  expect(document.querySelector('.skl-access-menu [data-access="all"]')?.getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector('.skl-access-menu [data-access="none"]')?.getAttribute("aria-disabled")).toBe("true");
  expect(accessOf(root, "pack:2")).toBe("還沒給任何人");
  // Nothing more to remove: pressing it again asks nothing of the core.
  api.core.mockClear();
  (document.querySelector('.skl-access-menu [data-access="none"]') as HTMLElement).click();
  expect(api.core).not.toHaveBeenCalled();
  // Only access moved: no call touched a member.
  expect(api.core.mock.calls.length).toBe(0);
});

test("the access menu still opens with a face on every row when the roster cannot be read", async () => {
  api.membersList.mockRejectedValue(new Error("offline"));
  api.core.mockImplementation(async (method: string) => method === "skills.library.list" ? { packages: packages(), members } : {});
  const root = document.createElement("div");
  document.body.append(root);
  const library = createSkillLibrary(root, () => { root.innerHTML = skillLibraryHTML(library.view()); });
  await library.load();
  press(root, '[data-skl="access"][data-key="pack:2"]');
  const menu = document.querySelector(".skl-access-menu")!;
  expect(menu.querySelectorAll("[data-member] .mlead > .av")).toHaveLength(3);
  expect(menu.querySelector('[data-access="all"] .mlead > .room-avatar')?.getAttribute("data-faces")).toBe("3");
});

const made: LibraryPackage = { key: "pack:9", name: "簡報工具", kind: "pack", source: "owner/slides", description: "", version: "", enabled: true, access: [], updatable: true,
  skills: [skill(7, "簡報大綱"), skill(8, "講稿")] };
/** The one box, with a core that imports whatever it is sent as `made`. */
async function setupBox(extra: (method: string, params: Record<string, unknown>) => unknown = () => undefined) {
  const info = vi.spyOn(toaster, "info").mockImplementation(() => {});
  const box = await setup((method, params) => {
    const other = extra(method, params);
    if (other !== undefined) return other;
    if (method !== "skills.library.import") return {};
    box.state.packages = [...box.state.packages, made];
    return { package: made };
  });
  openBox(box.root);
  // The dialog is over the window, not in the tab: what the tests look at is the whole document.
  return { ...box, root: document.body as HTMLElement, info };
}
/** 匯入 in the page's header: the importer's dialog opens. */
const openBox = (root: ParentNode) => root.querySelector<HTMLElement>('[data-skl="import-open"]')!.click();
const line = (_root?: ParentNode) => document.querySelector<HTMLInputElement>("#skl-input")!;
/** What the owner types in the line: the arrow of the dialog waits for it. */
const typeLine = (value: string) => { line().value = value; line().dispatchEvent(new Event("input", { bubbles: true })); };
/** An import is asked of the core under an id of its own, which its steps and its cancel carry. */
const imported = (params: Record<string, unknown>) => expect(api.core).toHaveBeenCalledWith("skills.library.import", { ...params, import_id: expect.any(String) });
const importId = (): string => (api.core.mock.calls.filter(call => call[0] === "skills.library.import").pop()![1] as { import_id: string }).import_id;
const dropOn = (root: ParentNode, data: Record<string, unknown>) => {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [], getData: () => "", ...data } });
  root.querySelector(".skl-import")!.dispatchEvent(event);
  return event;
};
const pasteInto = (text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  line().dispatchEvent(event);
  return event;
};

test("the page starts with its lists and has 匯入 in its header, and the importer is a dialog: a drop zone with ONE button and one line for an address", async () => {
  const { root } = await setup();
  // Nothing of the importer stands in the tab: it begins with the plugins, then the skills, and 匯入 is beside the close.
  expect(root.querySelector(".skl-import, #skl-input, .skl-zone")).toBeNull();
  expect([...root.querySelector(".set-head")!.children].map(el => el.tagName === "H1" ? "title" : (el as HTMLElement).dataset.skl ?? "close")).toEqual(["title", "import-open", "close"]);
  expect(root.querySelector('[data-skl="import-open"]')?.textContent).toBe("匯入");
  expect(root.querySelector(".set-head")!.nextElementSibling?.className).toContain("skl");
  expect(root.querySelector(".skl")!.firstElementChild?.textContent).toContain("外掛");
  openBox(root);
  const dialog = document.querySelector(".skl-dlg")!;
  expect(dialog.getAttribute("role")).toBe("dialog");
  expect(dialog.querySelector("h2")?.textContent).toBe("匯入技能");
  const zone = dialog.querySelector(".skl-zone")!;
  expect(zone.querySelector(".skl-zone-icon svg")).not.toBeNull();
  expect(zone.querySelector(".skl-zone-words")?.textContent).toBe("拖到這裡，或");
  // ONE button in the zone, one single-line field under it with its small action: no rule line, no footer, no lone button.
  expect([...zone.querySelectorAll("button")].map(button => button.textContent)).toEqual(["選擇檔案"]);
  expect(dialog.querySelectorAll("textarea, input")).toHaveLength(1);
  expect(line().type).toBe("text");
  expect(line().placeholder).toBe("或貼上網址");
  expect([...dialog.querySelectorAll<HTMLElement>("[data-skl]")].map(button => button.dataset.skl)).toEqual(["pick", "import-go"]);
  expect(dialog.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(true);
  expect(dialog.querySelector(".mb-dlg-act, .action-row, hr")).toBeNull();
  expect(dialog.textContent).not.toMatch(/拉斐爾|\.zip|\.md|SKILL\.md|GitHub/);
  expect(dialog.querySelector("input[type=file]")).toBeNull();
});

test("Esc and the × close the idle importer, one step back, and what was typed stays for the next time", async () => {
  const { root } = await setupBox();
  typeLine("owner/half-typed");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(document.querySelector(".skl")).not.toBeNull();
  openBox(root);
  expect(line().value).toBe("owner/half-typed");
  expect(document.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(false);
  press(root, '.skl-dlg [data-dlg="close"]');
  expect(document.querySelector(".skl-dlg")).toBeNull();
});

test("an address goes to the core as it is, by Enter or by its small arrow, and the new package opens", async () => {
  const { root, info } = await setupBox();
  typeLine("owner/slides");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  imported({ text: "owner/slides" });
  // A package of several opens on its page, so whom it is for can be chosen at once; the dialog closes and nothing is toasted.
  expect(root.querySelector('.skl-page[data-skl-page="pack:9"]')).not.toBeNull();
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(info).not.toHaveBeenCalled();
  press(root, '[data-skl="back"]');
  openBox(root);
  expect(line().value).toBe("");
  const enter = (init: KeyboardEventInit = {}) => line().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));
  typeLine("https://example.com/guide");
  expect(enter()).toBe(false);
  await settle(); await settle();
  imported({ text: "https://example.com/guide" });
  // Nothing to send, nothing sent.
  press(root, '[data-skl="back"]');
  openBox(root);
  api.core.mockClear();
  enter();
  expect(api.core).not.toHaveBeenCalledWith("skills.library.import", expect.anything());
});

test("text of several lines pasted into the line is imported as it comes, since a line cannot hold it", async () => {
  const { root } = await setupBox();
  expect(pasteInto("https://example.com/guide").defaultPrevented).toBe(false);
  expect(api.core).not.toHaveBeenCalledWith("skills.library.import", expect.anything());
  expect(pasteInto("---\nname: travel\n---\nBody").defaultPrevented).toBe(true);
  await settle(); await settle();
  imported({ text: "---\nname: travel\n---\nBody" });
  expect(root.querySelector('.skl-page[data-skl-page="pack:9"]')).not.toBeNull();
});

test("a file dropped on the importer is sent whole, whatever its kind", async () => {
  const { root } = await setupBox();
  dropOn(root, { files: [new File(["%PDF-1.4"], "guide.pdf")] });
  await settle(); await settle();
  imported({ file: { name: "guide.pdf", data: btoa("%PDF-1.4") } });
  press(root, '[data-skl="back"]');
  openBox(root);
  // Several files go as one tree, each under its own name.
  dropOn(root, { files: [new File(["a"], "a.md"), new File(["b"], "b.txt")] });
  await settle(); await settle();
  imported({ files: [{ path: "a.md", data: btoa("a") }, { path: "b.txt", data: btoa("b") }] });
});

test("a folder dropped on the importer goes as a tree with its paths, leaving node_modules and .git behind", async () => {
  const { root } = await setupBox();
  const file = (name: string, body: string) => ({ isFile: true, isDirectory: false, name, file: (ok: (file: File) => void) => ok(new File([body], name)) });
  const folder = (name: string, children: unknown[]) => ({ isFile: false, isDirectory: true, name,
    createReader: () => { let done = false; return { readEntries: (ok: (list: unknown[]) => void) => { ok(done ? [] : children); done = true; } }; } });
  const tree = folder("notes", [file("a.md", "A"), folder("sub", [file("b.md", "B")]), folder("node_modules", [file("junk.js", "x")]), folder(".git", [file("HEAD", "x")])]);
  dropOn(root, { items: [{ webkitGetAsEntry: () => tree }] });
  await settle(); await settle(); await settle();
  imported({ files: [{ path: "notes/a.md", data: btoa("A") }, { path: "notes/sub/b.md", data: btoa("B") }] });
});

test("the drop zone is lit while files are dragged over it, and only then", async () => {
  const { root } = await setupBox();
  const zone = root.querySelector(".skl-zone")!;
  const over = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"] } });
  zone.dispatchEvent(over);
  expect(zone.classList.contains("is-over")).toBe(true);
  const leave = new Event("dragleave", { bubbles: true });
  Object.defineProperty(leave, "relatedTarget", { value: null });
  zone.dispatchEvent(leave);
  expect(zone.classList.contains("is-over")).toBe(false);
  zone.dispatchEvent(over);
  dropOn(root, {});
  expect(root.querySelector(".skl-zone")?.classList.contains("is-over") ?? false).toBe(false);
});

test("a link dragged onto the importer is sent as the text it is", async () => {
  const { root } = await setupBox();
  dropOn(root, { types: ["text/uri-list", "text/plain"], getData: (type: string) => type === "text/uri-list" ? "https://example.com/guide\n" : "" });
  await settle(); await settle();
  imported({ text: "https://example.com/guide" });
});

test.each([[false, "D:\\skills\\travel\\SKILL.md"], [true, "/Users/a/Downloads/skills.zip"]])(
  "選擇檔案 is one button that opens the system's one panel, with no menu in front of it (a Mac: %s), and what it gives goes to the core as it is", async (mac, picked) => {
    platform.mac = mac;
    api.pickImportSource.mockResolvedValue(picked);
    const { root } = await setupBox();
    expect(root.querySelector('[data-skl="pick"]')?.getAttribute("aria-haspopup")).toBeNull();
    press(root, '[data-skl="pick"]');
    expect(document.querySelector(".skl-pick-menu, [role=menu]")).toBeNull();
    await settle(); await settle();
    expect(api.pickImportSource).toHaveBeenCalledOnce();
    expect(api.pickOutputFolder).not.toHaveBeenCalled();
    // The core says what the path is: a SKILL.md stands for its folder, a ZIP is opened, a folder is read.
    imported({ source: `local:${picked}` });
    api.core.mockClear();
    press(root, '[data-skl="back"]');
    openBox(root);
    api.pickImportSource.mockResolvedValue(null);
    press(root, '[data-skl="pick"]');
    await settle(); await settle();
    expect(api.core).not.toHaveBeenCalledWith("skills.library.import", expect.anything());
  });

const asked = (): [string, { name: string; mime: string; data: string }[]] => {
  const [words, attachments] = handOff.mock.calls[handOff.mock.calls.length - 1]!;
  return [words, attachments as { name: string; mime: string; data: string }[]];
};
/** A box whose core says that what was put in is no skill, with the facts of the hand-off. */
const handedOver = (found: Record<string, unknown>) => setupBox(method => method === "skills.library.import" ? { handoff: found } : undefined);

test("what is no skill is no work of the dialog until asked: it says what it is, with 換一個 and 請拉斐爾做, and only the second goes to Raphael", async () => {
  const { root, state } = await handedOver({ kind: "link", label: "https://example.com/guide", address: "https://example.com/guide" });
  typeLine("https://example.com/guide");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  // The dialog says it in one plain sentence, and nothing went to Raphael.
  expect(document.querySelector(".skl-notice")?.textContent).toBe("這是一個網頁，不是技能。拉斐爾可以讀完後幫你做成技能。");
  expect([...document.querySelectorAll<HTMLElement>(".skl-dlg button:not(.close-button)")].map(button => [button.dataset.skl, button.textContent, button.classList.contains("pri")]))
    .toEqual([["import-another", "換一個", false], ["import-ask", "請拉斐爾做", true]]);
  expect(document.querySelector("#skl-input, .skl-zone")).toBeNull();
  expect(handOff).not.toHaveBeenCalled();
  // 換一個 gives the importer back, the address as it was.
  press(root, '[data-skl="import-another"]');
  expect(document.querySelector(".skl-notice")).toBeNull();
  expect(line().value).toBe("https://example.com/guide");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  // 請拉斐爾做 closes the dialog and gives Raphael's conversation the owner's words.
  press(root, '[data-skl="import-ask"]');
  await settle();
  expect(asked()).toEqual(["請幫我把這個網頁做成團隊技能：https://example.com/guide", []]);
  expect(document.querySelector(".skl-dlg")).toBeNull();
  // Nothing half-done is left behind in Team skills: no draft, no busy box, no error, no new package.
  expect(state.packages).toHaveLength(3);
  openBox(root);
  expect(line().value).toBe("");
  expect(document.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(true);
  expect(document.querySelector(".skl-error, .skl-bar, .skl-notice")).toBeNull();
});

test.each([
  ["text", { kind: "text", label: "pasted text" }, "Steps:\n1. Do it", "請幫我把下面這段內容做成團隊技能：\n\nSteps:\n1. Do it", "這段文字不是技能。拉斐爾可以讀完後幫你做成技能。"],
  ["path", { kind: "path", label: "notes", path: "D:\\work\\notes" }, "D:\\work\\notes", "請幫我把電腦上這個位置的內容做成團隊技能：D:\\work\\notes", "這是一份文件，不是技能。拉斐爾可以讀完後幫你做成技能。"],
  ["repo", { kind: "folder", label: "handbook", address: "git@gitlab.example.com:group/handbook.git", path: "D:\\w\\skill-sources\\handbook-1a" },
    "git@gitlab.example.com:group/handbook.git", "請幫我把這個 Git 倉庫做成團隊技能：git@gitlab.example.com:group/handbook.git（已下載到 D:\\w\\skill-sources\\handbook-1a）", "這裡面沒有技能。拉斐爾可以讀完後幫你做成技能。"],
  ["folder", { kind: "folder", label: "scan.zip", path: "D:\\w\\skill-sources\\scan-2b" }, "scan.zip", "請幫我把這份資料做成團隊技能：scan.zip（檔案放在 D:\\w\\skill-sources\\scan-2b）", "這裡面沒有技能。拉斐爾可以讀完後幫你做成技能。"],
])("a hand-off of %s says what it is, and says its source as readable words when asked", async (_kind, found, typed, words, said) => {
  const { root } = await handedOver(found);
  if (found.kind === "text") pasteInto(typed); else { typeLine(typed); press(root, '[data-skl="import-go"]'); }
  await settle(); await settle();
  expect(document.querySelector(".skl-notice")?.textContent).toBe(said);
  press(root, '[data-skl="import-ask"]');
  await settle();
  expect(asked()).toEqual([words, []]);
});

test("a long pasted text goes as a file beside the message, and a dropped file is the message's attachment", async () => {
  const { root } = await handedOver({ kind: "text", label: "pasted text" });
  pasteInto("line\n".repeat(400));
  await settle(); await settle();
  press(root, '[data-skl="import-ask"]');
  await settle();
  const [words, attachments] = asked();
  expect(words).toBe("請幫我把附上的文字做成團隊技能。");
  expect(attachments).toEqual([{ name: "pasted-text.md", mime: "text/markdown", data: btoa("line\n".repeat(400)) }]);
  handOff.mockClear();
  api.core.mockImplementation(async (method: string) => method === "skills.library.import" ? { handoff: { kind: "file", label: "guide.pdf" } } : { packages: packages(), members });
  openBox(root);
  dropOn(root, { files: [new File(["%PDF-1.4"], "guide.pdf", { type: "application/pdf" })] });
  await settle(); await settle(); await settle();
  imported({ file: { name: "guide.pdf", data: btoa("%PDF-1.4") } });
  expect(document.querySelector(".skl-notice")?.textContent).toBe("這是一份文件，不是技能。拉斐爾可以讀完後幫你做成技能。");
  press(root, '[data-skl="import-ask"]');
  await settle();
  expect(asked()).toEqual(["請幫我把這個檔案做成團隊技能：guide.pdf", [{ name: "guide.pdf", mime: "application/pdf", data: btoa("%PDF-1.4") }]]);
  expect(document.querySelector(".skl-dlg")).toBeNull();
});

test("a hand-off still being answered is not sent twice: the dialog stays and says so", async () => {
  handOff.mockReturnValueOnce(false);
  const { root } = await handedOver({ kind: "link", label: "https://example.com/a", address: "https://example.com/a" });
  typeLine("https://example.com/a");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  press(root, '[data-skl="import-ask"]');
  await settle();
  expect(document.querySelector(".skl-dlg")).not.toBeNull();
  expect(document.querySelector(".skl-error")?.textContent).toBe("上一份還在處理中，等處理完再試一次。");
  expect(line().value).toBe("https://example.com/a");
});

test("what follows the rules imports in the dialog with no hand-off, and the new package is the answer", async () => {
  const { root } = await setupBox();
  typeLine("owner/slides");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(handOff).not.toHaveBeenCalled();
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(root.querySelector('[data-skl-page="pack:9"]')).not.toBeNull();
});

test.each([
  [{ source: "local:C:\\Users\\a\\skills\\pstack\\SKILL.md" }, "pstack"], [{ source: "local:/Users/a/skills/pstack" }, "pstack"],
  [{ text: "owner/repo" }, "repo"], [{ text: "https://github.com/owner/desk-kit/tree/main/skills" }, "desk-kit"], [{ text: "https://skills.sh/owner/repo/skill" }, "repo"],
  [{ text: "git@gitlab.example.com:group/handbook.git" }, "handbook"], [{ text: "https://gitlab.example.com/group/handbook" }, "handbook"],
  [{ text: "---\nname: travel\ndescription: x\n---\nBody" }, "travel"], [{ text: "---\ndescription: x\n---\nBody" }, ""],
  [{ file: { name: "pstack.zip", data: "" } }, "pstack.zip"], [{ files: [{ path: "notes/a.md" }, { path: "notes/b.md" }] }, "notes"], [{ files: [{ path: "a.md" }, { path: "b.md" }] }, ""],
])("the dialog names what is imported by its own name: %j", (params, name) => {
  expect(sourceName(params)).toBe(name);
});

test("an import under way turns the dialog into progress: the title names the source, a bar and one step line, and 取消 is the only way out", async () => {
  let finish: (value: unknown) => void = () => {};
  const { root, library } = await setupBox(method => method === "skills.library.import" ? new Promise(resolve => { finish = resolve; }) : undefined);
  typeLine("https://github.com/owner/slow-import");
  press(root, '[data-skl="import-go"]');
  const dialog = document.querySelector(".skl-dlg")!;
  expect(dialog.querySelector("h2")?.textContent).toBe("正在匯入 slow-import");
  expect(dialog.querySelector(".skl-bar")?.getAttribute("role")).toBe("progressbar");
  expect(dialog.querySelector(".skl-step")?.textContent).toBe("取得檔案");
  expect(dialog.querySelector("#skl-input, .skl-zone, .skl-error")).toBeNull();
  // The core says where it is, by this import's id: the bar moves and the line says the skill it reads.
  library.follow({ type: "SkillImportProgress", import_id: importId(), step: "read", done: 3, total: 7 });
  expect(dialog.querySelector(".skl-step")?.textContent).toBe("讀取技能 3 / 7");
  expect(dialog.querySelector(".skl-bar")?.getAttribute("aria-valuenow")).toBe("47");
  library.follow({ type: "SkillImportProgress", import_id: "another-import", step: "install", done: null, total: null });
  expect(dialog.querySelector(".skl-step")?.textContent).toBe("讀取技能 3 / 7");
  // Nothing leaves the dialog but 取消: the × is gone, and Esc and the backdrop do nothing.
  expect(dialog.classList.contains("is-working")).toBe(true);
  expect([...dialog.querySelectorAll<HTMLElement>("button")].map(button => button.dataset.skl ?? button.dataset.dlg)).toEqual(["close", "import-cancel"]);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  press(root, '.skl-dlg [data-dlg="close"]');
  expect(document.querySelector(".skl-dlg")).not.toBeNull();
  // The library's last step cannot be stopped.
  library.follow({ type: "SkillImportProgress", import_id: importId(), step: "install", done: null, total: null });
  expect(dialog.querySelector(".skl-step")?.textContent).toBe("安裝");
  expect(dialog.querySelector<HTMLButtonElement>('[data-skl="import-cancel"]')?.disabled).toBe(true);
  finish({ package: { ...packages()[2], key: "skill:9", name: "owner" } });
  await settle(); await settle();
  // What landed closes the dialog; opened again it is the importer.
  expect(document.querySelector(".skl-dlg")).toBeNull();
  openBox(root);
  expect(document.querySelector(".skl-bar")).toBeNull();
  expect(document.querySelector(".skl-zone")).not.toBeNull();
});

test("取消 stops the import: the core is asked by its id, and the dialog is the importer again with the address kept", async () => {
  let fail: (error: Error) => void = () => {};
  const { root, info } = await setupBox((method, params) => {
    if (method === "skills.library.import") return new Promise((_, reject) => { fail = reject; });
    if (method === "skills.library.cancel_import") { fail(new Error("[-32602] Invalid params: cancelled: the import was stopped")); return { cancelled: true, ...params }; }
    return undefined;
  });
  typeLine("owner/slow-import");
  press(root, '[data-skl="import-go"]');
  const id = importId();
  press(root, '[data-skl="import-cancel"]');
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.cancel_import", { import_id: id });
  expect(document.querySelector(".skl-bar")).toBeNull();
  expect(document.querySelector(".skl-dlg h2")?.textContent).toBe("匯入技能");
  expect(line().value).toBe("owner/slow-import");
  // It is not a failure: nothing is said of it, and the × is back.
  expect(document.querySelector(".skl-error")).toBeNull();
  expect(info).not.toHaveBeenCalled();
  press(root, '.skl-dlg [data-dlg="close"]');
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(root.querySelectorAll(".skl-pack")).toHaveLength(3);
});

test("a cancel that comes too late for the core leaves the import to land as it would have", async () => {
  let finish: (value: unknown) => void = () => {};
  const { root, state } = await setupBox(method => {
    if (method === "skills.library.import") return new Promise(resolve => { finish = resolve; });
    if (method === "skills.library.cancel_import") return { cancelled: false };
    return undefined;
  });
  typeLine("owner/slides");
  press(root, '[data-skl="import-go"]');
  press(root, '[data-skl="import-cancel"]');
  await settle(); await settle();
  expect(document.querySelector(".skl-bar")).not.toBeNull();
  state.packages = [...state.packages, made];
  finish({ package: made });
  await settle(); await settle();
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(root.querySelector('.skl-page[data-skl-page="pack:9"]')).not.toBeNull();
});

test("a skill pasted as text that names other files says so, asks for its folder, and may still be imported as the text it is", async () => {
  const text = "---\nname: lazy-mode\ndescription: x\n---\nRead [how](actions/how.md).";
  const needs = new Error(`[-32602] Invalid params: source: this text names other files [[${JSON.stringify({ reason: "needs_files", file: "actions/how.md", files: ["actions/how.md"] })}]]`);
  let again = false;
  const { root } = await setupBox((method, params) => {
    if (method !== "skills.library.import") return undefined;
    if (params.alone) { again = true; return undefined; }
    throw needs;
  });
  pasteInto(text);
  await settle(); await settle();
  expect(document.querySelector(".skl-error")?.textContent).toContain("這份技能提到了別的檔案（actions/how.md），只貼文字帶不進來。請改選技能所在的資料夾。");
  expect(document.querySelector(".skl-zone")).not.toBeNull();
  press(root, '[data-skl="import-alone"]');
  await settle(); await settle();
  expect(again).toBe(true);
  imported({ text, alone: true });
  expect(document.querySelector(".skl-dlg")).toBeNull();
});

test.each([
  ["git@gitlab.example.com:group/repo.git", "gitlab.example.com"], ["git@gitlab.example.com: group/repo", "gitlab.example.com"],
  ["ssh://git@gitlab.example.com:2222/group/repo.git", "gitlab.example.com"], ["https://gitlab.example.com/group/repo.git", "gitlab.example.com"],
  ["https://user@git.example.org/team/tools", "git.example.org"],
  ["owner/repo", ""], ["https://github.com/owner/repo", ""], ["https://skills.sh/owner/repo", ""], ["C:\\Users\\a\\skills", ""], ["how to use git@host:a today", ""],
])("an address is said by its host while it is fetched: %s", (address, host) => {
  expect(gitHost(address)).toBe(host);
});

test.each([
  ["source", "git_missing", {}, "這台電腦沒有安裝 Git。請先安裝 Git，再匯入一次。"],
  ["source", "git_sign_in", { host: "gitlab.example.com" }, "gitlab.example.com 沒有讓這台電腦進去。請確認你的 SSH 金鑰已加到那裡（或先用 Git 登入一次），再試一次。"],
  ["source", "git_host_key", { host: "gitlab.example.com" }, "這台電腦還不認得 gitlab.example.com。請在終端機執行一次「ssh gitlab.example.com」並接受它的金鑰，再試一次。"],
  ["download", "git_network", { host: "gitlab.example.com" }, "連不上 gitlab.example.com。如果它是公司的伺服器，請先連上公司 VPN，再試一次。"],
  ["source", "git_credentials", { host: "gitlab.example.com" }, "請不要把密碼或權杖寫在位址裡。Git 會用這台電腦上已儲存的憑證登入。"],
  ["download", "git_failed", { host: "gitlab.example.com", why: "SSL certificate problem" }, "Git 抓不到這個位址：SSL certificate problem"],
])("a Git address that cannot be fetched says what is wrong and what to do: %s %s", (kind, reason, detail, said) => {
  expect(failureText(new Error(`[-32602] Invalid params: ${kind}: x [[${JSON.stringify({ reason, ...detail })}]]`))).toBe(said);
});

test("a cause the core names leads its message and is said in words", async () => {
  expect(failureText(new Error("[-32602] Invalid params: not_found: no SKILL.md found in the package"))).toBe("裡面找不到 SKILL.md。");
  expect(failureText(new Error("[-32602] Invalid params: archive: invalid skill package"))).toBe("這個壓縮檔打不開，或裡面有不允許的檔案。");
  expect(failureText(new Error("[-32602] Invalid params: size: skill package exceeds the size or entry limit"))).toBe("檔案太大了。");
  expect(failureText(new Error("[-32602] Invalid params: taken: a skill named travel already exists"))).toBe("團隊技能中已有「travel」。");
  expect(failureText(new Error("the core is not running"))).toBe("沒有成功，請再試一次。");
  const { root } = await setup(method => { if (method === "skills.library.import") throw new Error("[-32602] Invalid params: not_found: no SKILL.md found"); return {}; });
  openBox(root);
  typeLine("nothing/here");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(document.querySelector(".skl-import .skl-error")?.textContent).toBe("裡面找不到 SKILL.md。");
  expect(document.querySelector(".skl-import")).not.toBeNull();
});

/** Opens a plugin's skill's page and presses its trash: the red dialog asks, and only its red button deletes. */
const removeSkill = async (root: ParentNode, id: number, name: string): Promise<void> => {
  if (!root.querySelector(`.skl-doc-page[data-skl-doc="${id}"]`)) press(root, `[data-skl="open-skill"][data-id="${id}"]`);
  press(root, `.skl-doc-page [data-skl="skill-remove"][data-id="${id}"]`);
  expect(document.querySelector(".mb-delete h2")?.textContent).toBe(`移除「${name}」？`);
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="delete"]')!.click();
  await settle();
};

test("one skill of a plugin is deleted alone, asked as a whole package's delete is, and the plugin stays", async () => {
  const left: LibraryPackage = { ...packages()[0], skills: [skill(1, "verify"), skill(3, "judge")] };
  const { root } = await setup(method => method === "skills.library.delete" ? { deleted: true, package: left } : {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  await removeSkill(root, 2, "look");
  expect(api.core).toHaveBeenCalledWith("skills.library.delete", { key: "set:1", skill: 2 });
  expect(api.core).not.toHaveBeenCalledWith("skills.library.delete", { key: "set:1" });
  expect(root.querySelector('.skl-page[data-skl-page="set:1"]')).not.toBeNull();
  expect([...root.querySelectorAll(".skl-skill .t")].map(row => row.textContent)).toEqual(["verify", "judge"]);
});

test("a skill deleted from its own page returns to its plugin, and the last skill takes the package with it", async () => {
  let answer: unknown = { deleted: true, package: { ...packages()[0], skills: [skill(1, "verify"), skill(2, "look")] } };
  const { root } = await setup(method => method === "skills.library.delete" ? answer : {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  await removeSkill(root, 3, "judge");
  expect(api.core).toHaveBeenCalledWith("skills.library.delete", { key: "set:1", skill: 3 });
  expect(root.querySelector(".skl-doc-page")).toBeNull();
  expect(root.querySelector('.skl-page[data-skl-page="set:1"]')).not.toBeNull();
  // The core answers without a package when the skill was its package's last: the package is gone from the list.
  answer = { deleted: true };
  await removeSkill(root, 2, "look");
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.querySelector('.skl-pack[data-skl-pack="set:1"]')).toBeNull();
});

test("a refused delete of one skill says why and reloads the library", async () => {
  const { root } = await setup(method => { if (method === "skills.library.delete") throw new Error("[-32602] Invalid params: not_found: no such skill in this package"); return {}; });
  const info = vi.spyOn(toaster, "info").mockImplementation(() => {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  await removeSkill(root, 1, "verify");
  expect(info).toHaveBeenCalledWith("裡面找不到 SKILL.md。");
  // The skill stays, its page open; its plugin still holds all three.
  await settle();
  expect(root.querySelector('.skl-doc-page[data-skl-doc="1"]')).not.toBeNull();
  press(root, '[data-skl="back"]');
  expect(root.querySelectorAll(".skl-skill")).toHaveLength(3);
});

test("a name that is taken says which package holds it, and an import that left skills out lists them with their holders", async () => {
  expect(failureText(new Error('[-32602] Invalid params: taken: a skill named tdd already exists in the package "pstack" (switched off)')))
    .toBe("「pstack」裡已有同名的「tdd」（可能已停用）。請先在團隊技能中重新命名或刪除那個技能。");
  expect(failureText(new Error('[-32602] Invalid params: taken: a skill named tdd already exists in the package "my "own" pack"')))
    .toContain("my \"own\" pack");
  const made = { ...packages()[1], key: "pack:9", name: "新套件", skills: [skill(9, "lint")] };
  const { root } = await setup(method => method === "skills.library.import"
    ? { package: made, skipped: [{ name: "tdd", held_by: "pstack" }, { name: "plan", held_by: "" }] } : {});
  openBox(root);
  typeLine("owner/new");
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  const note = root.querySelector(".skl-skipped")!;
  expect(note.getAttribute("role")).toBe("status");
  expect(note.querySelector("p")?.textContent).toBe("有 2 個技能的名稱已被占用，沒有匯入：");
  expect([...note.querySelectorAll("li")].map(item => item.textContent)).toEqual(["tdd（已在「pstack」）", "plan"]);
});

const refused = (kind: string, reason: string, detail: Record<string, unknown> = {}): Error =>
  new Error(`[-32602] Invalid params: ${kind}: the core's own english words [[${JSON.stringify({ reason, ...detail })}]]`);

test.each([
  [refused("size", "file", { file: "skills/big/SKILL.md", size: 300 * 1024, limit: 128 * 1024 }), "skills/big/SKILL.md 有 300.0 KB，超過技能文件 128.0 KB 的上限。"],
  [refused("size", "package", { file: "assets/movie.mp4", size: 300 * 1024 * 1024, limit: 256 * 1024 * 1024 }), "這次匯入的檔案合計超過 256.0 MB，在 assets/movie.mp4 超出。請匯入較小的資料夾。"],
  [refused("size", "files", { limit: 100000 }), "這次匯入的檔案超過 100000 個。"],
  [refused("size", "upload", { file: "big.zip", size: 200 * 1024 * 1024, limit: 128 * 1024 * 1024 }), "big.zip 有 200.0 MB，視窗最多送出 128.0 MB。請改選它所在的資料夾。"],
  [refused("size", "listing"), "這個來源太大，無法搜尋。請改貼或選擇放技能的資料夾。"],
  [refused("download", "network"), "連不上 GitHub。請檢查網路後再試。"],
  [refused("download", "timeout"), "GitHub 沒有及時回應，請再試一次。"],
  [refused("download", "rate_limit"), "GitHub 暫時限制了請求次數，請稍後再試。"],
  [refused("download", "status", { status: 503 }), "GitHub 回應 503，請稍後再試。"],
  [refused("download", "changed", { file: "a.md" }), "a.md 在讀取時被改動，請重新匯入。"],
  [refused("not_found", "repo", { repo: "owner/missing" }), "GitHub 上找不到儲存庫「owner/missing」，或它是私人的。"],
  [refused("not_found", "no_skill"), "裡面找不到 SKILL.md。"],
  [refused("not_found", "skill", { name: "ghost" }), "找不到 ghost。"],
  [refused("not_found", "source", { file: "D:\\gone" }), "找不到 D:\\gone。"],
  [refused("skill", "front_matter", { file: "skills/bad/SKILL.md", line: 4 }), "skills/bad/SKILL.md 第 4 行：文件開頭要有兩條 --- 之間的名稱與說明。"],
  [refused("skill", "encoding", { file: "SKILL.md" }), "SKILL.md 不是 UTF-8 的 Markdown。"],
  [refused("archive", "path", { file: "../x" }), "無法取用 ../x：技能內不允許它的名稱或類型。"],
  [refused("archive", "unreadable"), "這個壓縮檔打不開，或裡面有不允許的檔案。"],
  [refused("source", "host", { host: "example.com" }), "example.com 不是可用的來源。請用 GitHub 或 skills.sh 連結、owner/repo、資料夾，或 .zip、.tar.gz、.md 檔。"],
  [refused("source", "linked", { file: "D:\\skills\\link" }), "D:\\skills\\link 是連結，系統不會跟著連結走。"],
  [refused("io", "disk", { file: "SKILL.md", why: "disk full" }), "無法讀取或寫入 SKILL.md。"],
  [refused("source", "insecure"), "不支援這個來源。"],
])("an import that fails says its own cause: %#", (error, words) => {
  expect(failureText(error)).toBe(words);
});

test("a clash names the skill and the package on both sides", () => {
  expect(failureText(refused("taken", "clash", { skill: "tdd", held_by: "tools.zip", off: true, incoming: "" })))
    .toBe("「tools.zip」裡已有同名的「tdd」（可能已停用）。請先在團隊技能中重新命名或刪除那個技能。");
  expect(failureText(refused("taken", "clash", { skill: "tdd", held_by: "tools.zip", off: false, incoming: "more.zip" })))
    .toBe("「tools.zip」裡已有名為「tdd」的技能，「more.zip」也帶來一個同名的。請在團隊技能中重新命名或刪除其中一個。");
});

/** A pack's skill's page, where its title can become a field. */
const openPackSkill = (root: ParentNode, id: number): void => {
  press(root, '[data-skl="open"][data-key="pack:2"]');
  press(root, `[data-skl="open-skill"][data-id="${id}"]`);
};

test("a skill of a pack is renamed from its page, and a plugin's skill is not", async () => {
  const renamed: LibraryPackage = { ...packages()[1], skills: [skill(4, "my-source-check"), skill(5, "每週摘要", false)] };
  const { root } = await setup(method => method === "skills.library.update" ? { package: renamed } : {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  press(root, '[data-skl="open-skill"][data-id="1"]');
  expect(root.querySelector('[data-skl="skill-rename"]')).toBeNull();
  press(root, '[data-skl="back"]'); press(root, '[data-skl="back"]');
  openPackSkill(root, 4);
  press(root, '[data-skl="skill-rename"][data-id="4"]');
  const field = root.querySelector<HTMLInputElement>("#skl-rename")!;
  expect(field.value).toBe("來源核對");
  field.value = "my-source-check";
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "pack:2", rename: { id: 4, name: "my-source-check" } });
  expect(root.querySelector("#skl-rename")).toBeNull();
  expect(root.querySelector("h1.skl-page-name")?.textContent).toBe("my-source-check");
});

test("a rename that is taken says who holds the name, and Esc or leaving the field drops the edit", async () => {
  const { root } = await setup(method => {
    if (method === "skills.library.update") throw refused("taken", "clash", { skill: "review", held_by: "tools.zip", off: false, incoming: "" });
    return {};
  });
  const info = vi.spyOn(toaster, "info").mockImplementation(() => {});
  openPackSkill(root, 4);
  press(root, '[data-skl="skill-rename"][data-id="4"]');
  root.querySelector<HTMLInputElement>("#skl-rename")!.value = "review";
  root.querySelector<HTMLInputElement>("#skl-rename")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await settle(); await settle();
  expect(info).toHaveBeenCalledWith("「tools.zip」裡已有同名的「review」（可能已停用）。請先在團隊技能中重新命名或刪除那個技能。");
  press(root, '[data-skl="skill-rename"][data-id="4"]');
  root.querySelector("#skl-rename")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(root.querySelector("#skl-rename")).toBeNull();
  expect(root.querySelector(".skl-doc-page")).not.toBeNull();
  press(root, '[data-skl="skill-rename"][data-id="4"]');
  root.querySelector("#skl-rename")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  expect(root.querySelector("#skl-rename")).toBeNull();
});
