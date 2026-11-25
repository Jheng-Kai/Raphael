// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), membersList: vi.fn(), pickOutputFolder: vi.fn() }));
vi.mock("./api", () => api);
import { createSkillLibrary, failureText, skillLibraryHTML, type LibraryPackage } from "./skill-library";
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

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.resetAllMocks(); });

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
      listHeader: `<header class="set-head"><h1 id="set-title">團隊技能</h1>${headerCloseButton("Close")}</header>`,
      pageClose: headerCloseButton("Close"),
    });
    root.scrollTop = at;
    library.painted();
  }, () => root);
  await library.load();
  return { root, library, state };
}
const press = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector)!.click();
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
  expect(root.querySelector<HTMLButtonElement>('[data-skl-pack="pack:2"] [data-skl="more"]')?.disabled).toBe(false);
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
  // Who may use it, the update button and the switch; the ⋯ is not drawn (a right click presses it).
  const controls = [...page.querySelectorAll<HTMLElement>(".skl-page-actions .ctl > button")];
  expect(controls.map(control => control.dataset.skl)).toEqual(["access", "refresh", "more", "toggle"]);
  expect(controls.every(control => control.dataset.key === "pack:2")).toBe(true);
  expect(page.querySelector<HTMLElement>('[data-skl="more"]')!.hidden).toBe(true);
  const rows = [...page.querySelectorAll(".skl-skill")];
  expect(rows.map(row => row.querySelector(".t")?.textContent)).toEqual(["來源核對", "每週摘要"]);
  expect(rows[1].querySelector(".tg")?.getAttribute("aria-checked")).toBe("false");
  for (const row of rows) {
    // A skill's own ⋯ (刪除) is not drawn: a right click on its row presses it.
    expect([...row.querySelectorAll<HTMLElement>(".ctl > button")].map(control => control.dataset.skl)).toEqual(["skill-more", "skill"]);
    expect(row.querySelector<HTMLElement>('[data-skl="skill-more"]')!.hidden).toBe(true);
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
  expect([...root.querySelectorAll<HTMLElement>(".skl-doc-page .skl-page-actions .ctl > button")].map(control => control.dataset.skl)).toEqual(["skill-more", "skill"]);
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
  expect([...root.querySelectorAll<HTMLElement>(".skl-doc-page .skl-page-actions .ctl > button")].map(control => control.dataset.skl)).toEqual(["access", "more", "toggle"]);
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
  expect(root.querySelector(".skl-import")).not.toBeNull();
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
  press(root, '.skl-page-actions [data-skl="more"][data-key="set:1"]');
  // 刪除 asks in the red dialog naming the package: Cancel deletes nothing, its red button does.
  const remove = () => document.querySelector<HTMLElement>('[data-pick="delete"]')!;
  remove().click();
  expect(document.getElementById("app-popover")).toBeNull();
  expect(document.querySelector(".mb-delete h2")?.textContent).toBe("移除「pstack」？");
  expect(document.querySelector(".mb-delete .mb-dlg-body")?.textContent).toBe("移除後就不能再用它，也無法復原。");
  expect(document.querySelector('.mb-delete [data-dlg="delete"]')?.textContent).toBe("刪除");
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="cancel"]')!.click();
  await settle();
  expect(api.core).not.toHaveBeenCalledWith("skills.library.delete", expect.anything());
  press(root, '.skl-page-actions [data-skl="more"][data-key="set:1"]');
  remove().click();
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="delete"]')!.click();
  await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.delete", { key: "set:1" });
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.querySelector(".skl-import")).not.toBeNull();
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
  // The whole team is drawn as the sidebar draws it: its first faces in one square, Raphael first.
  expect([...all.querySelectorAll(".mlead > .room-avatar > .av")].map(face => face.getAttribute("data-presence-member"))).toEqual(["0", "1", "2", "3"]);
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
  expect(menu.querySelector('[data-access="all"] .mlead > .room-avatar')?.getAttribute("data-faces")).toBe("4");
});

test("the importer sends a link, pasted text or a file to the core and opens the new package", async () => {
  const made: LibraryPackage = { key: "pack:9", name: "簡報工具", kind: "pack", source: "owner/slides", description: "", version: "", enabled: true, access: [], updatable: true,
    skills: [skill(7, "簡報大綱"), skill(8, "講稿")] };
  const info = vi.spyOn(toaster, "info").mockImplementation(() => {});
  const { root, state } = await setup((method, params) => {
    if (method !== "skills.library.import") return {};
    state.packages = [...state.packages, made];
    return { package: { ...made, source: String(params.source ?? "") } };
  });
  // The importer is the tab's first card, with one 匯入.
  expect(root.querySelectorAll('[data-skl="import-go"]')).toHaveLength(1);
  root.querySelector<HTMLInputElement>("#skl-source")!.value = "owner/slides";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { source: "owner/slides" });
  // A package of several opens on its page, so whom it is for can be chosen at once.
  expect(root.querySelector('.skl-page[data-skl-page="pack:9"]')).not.toBeNull();
  expect(info).not.toHaveBeenCalled();
  press(root, '[data-skl="back"]');
  expect(root.querySelector<HTMLInputElement>("#skl-source")!.value).toBe("");
  // Pasted text takes the link's place, and the same 匯入 sends it.
  press(root, '[data-skl="paste"]');
  expect(root.querySelector("#skl-source")).toBeNull();
  root.querySelector<HTMLTextAreaElement>("#skl-text")!.value = "---\nname: travel\n---\n";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { text: "---\nname: travel\n---\n" });
  press(root, '[data-skl="back"]');
  const input = root.querySelector<HTMLInputElement>("#skl-file")!;
  expect(input.accept).toBe(".zip,.tar.gz,.tgz,.md");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["# hi"], "skill.md")] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { file: { name: "skill.md", data: btoa("# hi") } });
  press(root, '[data-skl="back"]');
  // A folder comes from the system's own dialog, as a local path.
  api.pickOutputFolder.mockResolvedValue("D:\\skills\\travel");
  press(root, '[data-skl="pick-folder"]');
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { source: "local:D:\\skills\\travel" });
});

test("a cause the core names leads its message and is said in words", async () => {
  expect(failureText(new Error("[-32602] Invalid params: not_found: no SKILL.md found in the package"))).toBe("裡面找不到 SKILL.md。");
  expect(failureText(new Error("[-32602] Invalid params: archive: invalid skill package"))).toBe("這個壓縮檔打不開，或裡面有不允許的檔案。");
  expect(failureText(new Error("[-32602] Invalid params: size: skill package exceeds the size or entry limit"))).toBe("檔案太大了。");
  expect(failureText(new Error("[-32602] Invalid params: taken: a skill named travel already exists"))).toBe("團隊技能中已有「travel」。");
  expect(failureText(new Error("the core is not running"))).toBe("沒有成功，請再試一次。");
  const { root } = await setup(method => { if (method === "skills.library.import") throw new Error("[-32602] Invalid params: not_found: no SKILL.md found"); return {}; });
  root.querySelector<HTMLInputElement>("#skl-source")!.value = "nothing/here";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  expect(root.querySelector(".skl-import .skl-error")?.textContent).toBe("裡面找不到 SKILL.md。");
  expect(root.querySelector(".skl-import")).not.toBeNull();
});

const removeSkill = async (name: string): Promise<void> => {
  // 刪除 asks in the red dialog: only its red button deletes.
  document.querySelector<HTMLElement>('[data-pick="delete"]')!.click();
  expect(document.querySelector(".mb-delete h2")?.textContent).toBe(`移除「${name}」？`);
  document.querySelector<HTMLElement>('.mb-delete [data-dlg="delete"]')!.click();
  await settle();
};

test("one skill of a plugin is deleted alone, asked as a whole package's delete is, and the plugin stays", async () => {
  const left: LibraryPackage = { ...packages()[0], skills: [skill(1, "verify"), skill(3, "judge")] };
  const { root } = await setup(method => method === "skills.library.delete" ? { deleted: true, package: left } : {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  press(root, '.skl-skill[data-library-skill="2"] [data-skl="skill-more"]');
  await removeSkill("look");
  expect(api.core).toHaveBeenCalledWith("skills.library.delete", { key: "set:1", skill: 2 });
  expect(api.core).not.toHaveBeenCalledWith("skills.library.delete", { key: "set:1" });
  expect(root.querySelector('.skl-page[data-skl-page="set:1"]')).not.toBeNull();
  expect([...root.querySelectorAll(".skl-skill .t")].map(row => row.textContent)).toEqual(["verify", "judge"]);
});

test("a skill deleted from its own page returns to its plugin, and the last skill takes the package with it", async () => {
  let answer: unknown = { deleted: true, package: { ...packages()[0], skills: [skill(1, "verify"), skill(2, "look")] } };
  const { root } = await setup(method => method === "skills.library.delete" ? answer : {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  press(root, '[data-skl="open-skill"][data-id="3"]');
  press(root, '.skl-doc-page [data-skl="skill-more"][data-id="3"]');
  await removeSkill("judge");
  expect(api.core).toHaveBeenCalledWith("skills.library.delete", { key: "set:1", skill: 3 });
  expect(root.querySelector(".skl-doc-page")).toBeNull();
  expect(root.querySelector('.skl-page[data-skl-page="set:1"]')).not.toBeNull();
  // The core answers without a package when the skill was its package's last: the package is gone from the list.
  answer = { deleted: true };
  press(root, '.skl-skill[data-library-skill="2"] [data-skl="skill-more"]');
  await removeSkill("look");
  expect(root.querySelector(".skl-page")).toBeNull();
  expect(root.querySelector('.skl-pack[data-skl-pack="set:1"]')).toBeNull();
});

test("a refused delete of one skill says why and reloads the library", async () => {
  const { root } = await setup(method => { if (method === "skills.library.delete") throw new Error("[-32602] Invalid params: not_found: no such skill in this package"); return {}; });
  const info = vi.spyOn(toaster, "info").mockImplementation(() => {});
  press(root, '[data-skl="open"][data-key="set:1"]');
  press(root, '.skl-skill[data-library-skill="1"] [data-skl="skill-more"]');
  await removeSkill("verify");
  expect(info).toHaveBeenCalledWith("裡面找不到 SKILL.md。");
  expect(root.querySelectorAll(".skl-skill")).toHaveLength(3);
});

test("a name that is taken says which package holds it, and an import that left skills out lists them with their holders", async () => {
  expect(failureText(new Error('[-32602] Invalid params: taken: a skill named tdd already exists in the package "pstack" (switched off)')))
    .toBe("「pstack」裡已有同名的「tdd」（可能已停用）。請先在團隊技能中把它刪除。");
  expect(failureText(new Error('[-32602] Invalid params: taken: a skill named tdd already exists in the package "my "own" pack"')))
    .toContain("my \"own\" pack");
  const made = { ...packages()[1], key: "pack:9", name: "新套件", skills: [skill(9, "lint")] };
  const { root } = await setup(method => method === "skills.library.import"
    ? { package: made, skipped: [{ name: "tdd", held_by: "pstack" }, { name: "plan", held_by: "" }] } : {});
  root.querySelector<HTMLInputElement>("#skl-source")!.value = "owner/new";
  press(root, '[data-skl="import-go"]');
  await settle(); await settle();
  const note = root.querySelector(".skl-skipped")!;
  expect(note.getAttribute("role")).toBe("status");
  expect(note.querySelector("p")?.textContent).toBe("有 2 個技能的名稱已被占用，沒有匯入：");
  expect([...note.querySelectorAll("li")].map(item => item.textContent)).toEqual(["tdd（已在「pstack」）", "plan"]);
});
