// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), membersList: vi.fn(), pickOutputFolder: vi.fn(), pickImportSource: vi.fn() }));
vi.mock("./api", () => api);
const platform = vi.hoisted(() => ({ mac: false }));
vi.mock("../shared/platform", () => ({ get IS_MAC() { return platform.mac; } }));
import { createSkillLibrary, failureText, gitHost, importButtonHTML, skillLibraryHTML, type LibraryPackage } from "./skill-library";
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
  const rows = [...menu.querySelectorAll<HTMLElement>("[data-access], [data-member]")];
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
const textarea = (_root?: ParentNode) => document.querySelector<HTMLTextAreaElement>("#skl-input")!;
const imported = (params: unknown) => expect(api.core).toHaveBeenCalledWith("skills.library.import", params);
const dropOn = (root: ParentNode, data: Record<string, unknown>) => {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [], getData: () => "", ...data } });
  root.querySelector(".skl-import")!.dispatchEvent(event);
  return event;
};

test("the page starts with its lists and has 匯入 in its header, and the importer is a dialog: one field, one way to choose files and one 匯入", async () => {
  const { root } = await setup();
  // Nothing of the importer stands in the tab: it begins with the plugins, then the skills, and 匯入 is beside the close.
  expect(root.querySelector(".skl-import, #skl-input, .skl-import-hint")).toBeNull();
  expect([...root.querySelector(".set-head")!.children].map(el => el.tagName === "H1" ? "title" : (el as HTMLElement).dataset.skl ?? "close")).toEqual(["title", "import-open", "close"]);
  expect(root.querySelector('[data-skl="import-open"]')?.textContent).toBe("匯入");
  expect(root.querySelector(".set-head")!.nextElementSibling?.className).toContain("skl");
  expect(root.querySelector(".skl")!.firstElementChild?.textContent).toContain("外掛");
  openBox(root);
  const dialog = document.querySelector(".skl-dlg")!;
  expect(dialog.getAttribute("role")).toBe("dialog");
  const card = dialog.querySelector(".skl-import")!;
  expect(card.querySelectorAll("textarea, input:not([type=file])")).toHaveLength(1);
  expect([...dialog.querySelectorAll<HTMLElement>("[data-skl]")].map(button => button.dataset.skl)).toEqual(["pick", "import-go"]);
  expect(card.querySelector('[data-skl="pick"]')?.textContent).toBe("選擇檔案");
  expect(card.querySelector(".skl-import-hint")).toBeNull();
  expect(textarea(document.body).placeholder).toBe("把檔案、資料夾或連結丟進來，或貼上文字");
  expect(textarea(document.body).getAttribute("rows")).toBe("2");
  expect(dialog.textContent).not.toMatch(/任何格式|\.zip|\.md|SKILL\.md|GitHub/);
  expect(card.querySelector<HTMLInputElement>("#skl-file")?.accept).toBe("");
  expect(card.querySelector<HTMLInputElement>("#skl-file")?.multiple).toBe(true);
});

test("Esc and the × close the importer, one step back, and what was typed stays for the next time", async () => {
  const { root } = await setupBox();
  textarea(root).value = "owner/half-typed";
  textarea(root).dispatchEvent(new Event("input", { bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(document.querySelector(".skl")).not.toBeNull();
  openBox(root);
  expect(textarea(root).value).toBe("owner/half-typed");
  press(root, '.skl-dlg [data-dlg="close"]');
  expect(document.querySelector(".skl-dlg")).toBeNull();
});

test("a pasted link or text goes to the core as it is, and the new package opens", async () => {
  const { root, info } = await setupBox();
  textarea(root).value = "owner/slides";
  textarea(root).dispatchEvent(new Event("input", { bubbles: true }));
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  imported({ text: "owner/slides" });
  // A package of several opens on its page, so whom it is for can be chosen at once.
  expect(root.querySelector('.skl-page[data-skl-page="pack:9"]')).not.toBeNull();
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(info).not.toHaveBeenCalled();
  press(root, '[data-skl="back"]');
  openBox(root);
  expect(textarea(root).value).toBe("");
  textarea(root).value = "---\nname: travel\n---\n";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  imported({ text: "---\nname: travel\n---\n" });
});

test("Enter sends one line, and text of several lines keeps its Enter until Ctrl+Enter", async () => {
  const { root } = await setupBox();
  const enter = (init: KeyboardEventInit) => textarea(root).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));
  textarea(root).value = "https://example.com/guide";
  expect(enter({})).toBe(false);
  await settle(); await settle();
  imported({ text: "https://example.com/guide" });
  press(root, '[data-skl="back"]');
  openBox(root);
  api.core.mockClear();
  textarea(root).value = "one\ntwo";
  expect(enter({})).toBe(true);
  expect(api.core).not.toHaveBeenCalledWith("skills.library.import", expect.anything());
  expect(enter({ ctrlKey: true })).toBe(false);
  await settle(); await settle();
  imported({ text: "one\ntwo" });
});

test("a file dropped or chosen is sent whole, whatever its kind", async () => {
  const { root } = await setupBox();
  dropOn(root, { files: [new File(["%PDF-1.4"], "guide.pdf")] });
  await settle(); await settle();
  imported({ file: { name: "guide.pdf", data: btoa("%PDF-1.4") } });
  press(root, '[data-skl="back"]');
  openBox(root);
  const input = root.querySelector<HTMLInputElement>("#skl-file")!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["# hi"], "skill.md")] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(); await settle();
  imported({ file: { name: "skill.md", data: btoa("# hi") } });
  press(root, '[data-skl="back"]');
  openBox(root);
  // Several files go as one tree, each under its own name.
  const again = root.querySelector<HTMLInputElement>("#skl-file")!;
  Object.defineProperty(again, "files", { configurable: true, value: [new File(["a"], "a.md"), new File(["b"], "b.txt")] });
  again.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(); await settle();
  imported({ files: [{ path: "a.md", data: btoa("a") }, { path: "b.txt", data: btoa("b") }] });
});

test("a folder dropped on the box goes as a tree with its paths, leaving node_modules and .git behind", async () => {
  const { root } = await setupBox();
  const file = (name: string, body: string) => ({ isFile: true, isDirectory: false, name, file: (ok: (file: File) => void) => ok(new File([body], name)) });
  const folder = (name: string, children: unknown[]) => ({ isFile: false, isDirectory: true, name,
    createReader: () => { let done = false; return { readEntries: (ok: (list: unknown[]) => void) => { ok(done ? [] : children); done = true; } }; } });
  const tree = folder("notes", [file("a.md", "A"), folder("sub", [file("b.md", "B")]), folder("node_modules", [file("junk.js", "x")]), folder(".git", [file("HEAD", "x")])]);
  dropOn(root, { items: [{ webkitGetAsEntry: () => tree }] });
  await settle(); await settle(); await settle();
  imported({ files: [{ path: "notes/a.md", data: btoa("A") }, { path: "notes/sub/b.md", data: btoa("B") }] });
});

test("the whole box is lit while files are dragged over it, and only then", async () => {
  const { root } = await setupBox();
  const card = root.querySelector(".skl-import")!;
  const over = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"] } });
  card.querySelector("#skl-input")!.dispatchEvent(over);
  expect(card.classList.contains("is-over")).toBe(true);
  const leave = new Event("dragleave", { bubbles: true });
  Object.defineProperty(leave, "relatedTarget", { value: null });
  card.dispatchEvent(leave);
  expect(card.classList.contains("is-over")).toBe(false);
  card.querySelector("#skl-input")!.dispatchEvent(over);
  dropOn(root, {});
  expect(card.classList.contains("is-over")).toBe(false);
});

test("a link dragged onto the box is sent as the text it is", async () => {
  const { root } = await setupBox();
  dropOn(root, { types: ["text/uri-list", "text/plain"], getData: (type: string) => type === "text/uri-list" ? "https://example.com/guide\n" : "" });
  await settle(); await settle();
  imported({ text: "https://example.com/guide" });
});

test("on Windows choosing opens one small menu: the file dialog with a zip plainly under it, and the folder dialog", async () => {
  const { root } = await setupBox();
  const click = vi.spyOn(root.querySelector<HTMLInputElement>("#skl-file")!, "click").mockImplementation(() => {});
  press(root, '[data-skl="pick"]');
  const menu = document.querySelector(".skl-pick-menu")!;
  expect([...menu.querySelectorAll("button")].map(button => button.textContent)).toEqual(["檔案（zip、SKILL.md…）", "資料夾"]);
  menu.querySelector<HTMLElement>('[data-pick="files"]')!.click();
  expect(click).toHaveBeenCalled();
  api.pickOutputFolder.mockResolvedValue("D:\\skills\\travel");
  press(root, '[data-skl="pick"]');
  document.querySelector<HTMLElement>('.skl-pick-menu [data-pick="folder"]')!.click();
  await settle(); await settle();
  imported({ source: "local:D:\\skills\\travel" });
});

test("on a Mac choosing opens the system's one panel that takes a file or a folder, with no menu in front of it", async () => {
  platform.mac = true;
  api.pickImportSource.mockResolvedValue("/Users/a/Downloads/skills.zip");
  const { root } = await setupBox();
  expect(root.querySelector('[data-skl="pick"]')?.getAttribute("aria-haspopup")).toBeNull();
  press(root, '[data-skl="pick"]');
  expect(document.querySelector(".skl-pick-menu")).toBeNull();
  await settle(); await settle();
  expect(api.pickImportSource).toHaveBeenCalledOnce();
  expect(api.pickOutputFolder).not.toHaveBeenCalled();
  imported({ source: "local:/Users/a/Downloads/skills.zip" });
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

test("what is no skill is no work of the dialog: it closes and Raphael's conversation gets the owner's words", async () => {
  const { root, state } = await handedOver({ kind: "link", label: "https://example.com/guide", address: "https://example.com/guide" });
  textarea(root).value = "https://example.com/guide";
  textarea(root).dispatchEvent(new Event("input", { bubbles: true }));
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(asked()).toEqual(["請幫我把這個網頁做成團隊技能：https://example.com/guide", []]);
  expect(document.querySelector(".skl-dlg")).toBeNull();
  // Nothing half-done is left behind in Team skills: no draft, no busy box, no error, no new package.
  expect(state.packages).toHaveLength(3);
  openBox(root);
  expect(textarea(root).value).toBe("");
  expect(document.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(false);
  expect(document.querySelector(".skl-error")).toBeNull();
  expect(document.querySelector(".skl-progress")?.textContent).toBe("");
});

test.each([
  ["text", { kind: "text", label: "pasted text" }, "Steps:\n1. Do it", "請幫我把下面這段內容做成團隊技能：\n\nSteps:\n1. Do it"],
  ["path", { kind: "path", label: "notes", path: "D:\\work\\notes" }, "D:\\work\\notes", "請幫我把電腦上這個位置的內容做成團隊技能：D:\\work\\notes"],
  ["repo", { kind: "folder", label: "handbook", address: "git@gitlab.example.com:group/handbook.git", path: "D:\\w\\skill-sources\\handbook-1a" },
    "git@gitlab.example.com:group/handbook.git", "請幫我把這個 Git 倉庫做成團隊技能：git@gitlab.example.com:group/handbook.git（已下載到 D:\\w\\skill-sources\\handbook-1a）"],
  ["folder", { kind: "folder", label: "scan.zip", path: "D:\\w\\skill-sources\\scan-2b" }, "scan.zip", "請幫我把這份資料做成團隊技能：scan.zip（檔案放在 D:\\w\\skill-sources\\scan-2b）"],
])("a hand-off of %s says its source as readable words", async (_kind, found, typed, words) => {
  const { root } = await handedOver(found);
  textarea(root).value = typed;
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(asked()).toEqual([words, []]);
});

test("a long pasted text goes as a file beside the message, and a dropped file is the message's attachment", async () => {
  const { root } = await handedOver({ kind: "text", label: "pasted text" });
  textarea(root).value = "line\n".repeat(400);
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  const [words, attachments] = asked();
  expect(words).toBe("請幫我把附上的文字做成團隊技能。");
  expect(attachments).toEqual([{ name: "pasted-text.md", mime: "text/markdown", data: btoa("line\n".repeat(400)) }]);
  handOff.mockClear();
  api.core.mockImplementation(async (method: string) => method === "skills.library.import" ? { handoff: { kind: "file", label: "guide.pdf" } } : { packages: packages(), members });
  openBox(root);
  dropOn(root, { files: [new File(["%PDF-1.4"], "guide.pdf", { type: "application/pdf" })] });
  await settle(); await settle(); await settle();
  imported({ file: { name: "guide.pdf", data: btoa("%PDF-1.4") } });
  expect(asked()).toEqual(["請幫我把這個檔案做成團隊技能：guide.pdf", [{ name: "guide.pdf", mime: "application/pdf", data: btoa("%PDF-1.4") }]]);
  expect(document.querySelector(".skl-dlg")).toBeNull();
});

test("a hand-off still being answered is not sent twice: the dialog stays and says so", async () => {
  handOff.mockReturnValueOnce(false);
  const { root } = await handedOver({ kind: "link", label: "https://example.com/a", address: "https://example.com/a" });
  textarea(root).value = "https://example.com/a";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(document.querySelector(".skl-dlg")).not.toBeNull();
  expect(document.querySelector(".skl-error")?.textContent).toBe("上一份還在處理中，等處理完再試一次。");
  expect(textarea(root).value).toBe("https://example.com/a");
  expect(document.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(false);
});

test("what follows the rules imports in the dialog with no hand-off, and the new package is the answer", async () => {
  const { root } = await setupBox();
  textarea(root).value = "owner/slides";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(handOff).not.toHaveBeenCalled();
  expect(document.querySelector(".skl-dlg")).toBeNull();
  expect(root.querySelector('[data-skl-page="pack:9"]')).not.toBeNull();
});

test.each([
  ["git@gitlab.example.com:group/repo.git", "gitlab.example.com"], ["git@gitlab.example.com: group/repo", "gitlab.example.com"],
  ["ssh://git@gitlab.example.com:2222/group/repo.git", "gitlab.example.com"], ["https://gitlab.example.com/group/repo.git", "gitlab.example.com"],
  ["https://user@git.example.org/team/tools", "git.example.org"],
  ["owner/repo", ""], ["https://github.com/owner/repo", ""], ["https://skills.sh/owner/repo", ""], ["C:\\Users\\a\\skills", ""], ["how to use git@host:a today", ""],
])("an address is said by its host while it is fetched: %s", (address, host) => {
  expect(gitHost(address)).toBe(host);
});

test("a fetch says in place what it is doing, in the row of 選擇檔案 where nothing moves, and a failure says what to do", async () => {
  let fail: (error: Error) => void = () => {};
  const { root } = await setupBox(method => method === "skills.library.import" ? new Promise((_, reject) => { fail = reject; }) : undefined);
  const row = () => root.querySelector(".skl-import-row")!;
  expect(row().querySelector(".skl-progress")?.textContent).toBe("");
  textarea(root).value = "git@gitlab.example.com:group/repo.git";
  press(root, '[data-skl="import-go"]');
  expect(row().querySelector('.skl-progress[role="status"]')?.textContent).toBe("正在從 gitlab.example.com 取得…");
  expect(root.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(true);
  expect(textarea(root).disabled).toBe(true);
  fail(new Error('[-32602] Invalid params: download: git could not [[{"reason":"git_network","host":"gitlab.example.com"}]]'));
  await settle(); await settle();
  expect(root.querySelector(".skl-error")?.textContent).toBe("連不上 gitlab.example.com。如果它是公司的伺服器，請先連上公司 VPN，再試一次。");
  expect(root.querySelector(".skl-progress")?.textContent).toBe("");
  expect(textarea(root).value).toBe("git@gitlab.example.com:group/repo.git");
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
  textarea(root).value = "nothing/here";
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
  textarea(root).value = "owner/new";
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

test("an import under way says so under the card, and a file over the window's limit is not sent", async () => {
  let finish: (value: unknown) => void = () => {};
  const { root } = await setup(method => method === "skills.library.import" ? new Promise(resolve => { finish = resolve; }) : {});
  openBox(root);
  textarea(root).value = "owner/skills";
  press(root, '[data-skl="import-go"]');
  expect(document.querySelector('.skl-import .skl-progress[role="status"]')?.textContent).toBe("匯入中…");
  expect(document.querySelector<HTMLButtonElement>('[data-skl="import-go"]')?.disabled).toBe(true);
  finish({ package: { ...packages()[2], key: "skill:9", name: "owner" } });
  await settle(); await settle();
  // What landed closes the dialog; opened again it is free.
  expect(document.querySelector(".skl-dlg")).toBeNull();
  openBox(root);
  expect(document.querySelector(".skl-progress")?.textContent).toBe("");
  const input = document.querySelector<HTMLInputElement>("#skl-file")!;
  Object.defineProperty(input, "files", { configurable: true, value: [{ name: "huge.zip", size: 129 * 1024 * 1024 }] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  expect(api.core).not.toHaveBeenCalledWith("skills.library.import", expect.objectContaining({ file: expect.anything() }));
  expect(document.querySelector(".skl-error")?.textContent).toBe("huge.zip 有 129.0 MB，視窗最多送出 128.0 MB。請改選它所在的資料夾。");
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
