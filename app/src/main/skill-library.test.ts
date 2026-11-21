// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), membersList: vi.fn(), pickOutputFolder: vi.fn() }));
vi.mock("./api", () => api);
import { createSkillLibrary, failureText, skillLibraryHTML, type LibraryPackage } from "./skill-library";
import { closeMenu, toaster } from "./ui";
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
  const library = createSkillLibrary(root, () => { const at = root.scrollTop; root.innerHTML = skillLibraryHTML(library.view()); root.scrollTop = at; library.painted(); }, () => root);
  await library.load();
  return { root, library, state };
}
const press = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector)!.click();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const accessOf = (root: ParentNode, key: string) => root.querySelector(`.skl-pack[data-skl-pack="${key}"] .skl-access span`)?.textContent;

test("one row per package says who may use it, and its name opens its skills on a page of its own", async () => {
  const { root } = await setup();
  expect(root.querySelector(".skl")?.getAttribute("aria-label")).toBe("團隊技能");
  expect(root.querySelectorAll(".skl-pack")).toHaveLength(3);
  expect(root.querySelector('.skl-pack[data-skl-pack="set:1"] .skl-count')?.textContent).toBe("3 個技能");
  expect(root.querySelector('.skl-pack[data-skl-pack="skill:3"] .skl-count, .skl-pack[data-skl-pack="skill:3"] [data-skl="open"]')).toBeNull();
  expect(root.querySelector('.skl-pack[data-skl-pack="skill:3"] .skl-single .d')?.textContent).toBe("會議紀錄 的說明");
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
  expect(page.querySelector(".skl-page-name")?.textContent).toBe("研究工具");
  expect(document.activeElement).toBe(page.querySelector('[data-skl="back"]'));
  // Its access, switch and ⋯ as on its row.
  expect(accessOf(root, "pack:2")).toBe("小晴、小森");
  expect(page.querySelector('.skl-page-head [data-skl="toggle"][data-key="pack:2"]')).not.toBeNull();
  expect(page.querySelector('.skl-page-head [data-skl="more"][data-key="pack:2"]')).not.toBeNull();
  const rows = [...page.querySelectorAll(".skl-skill")];
  expect(rows.map(row => row.querySelector(".t")?.textContent)).toEqual(["來源核對", "每週摘要"]);
  expect(rows[1].querySelector(".tg")?.getAttribute("aria-checked")).toBe("false");
  // A skill's own switch, and the package's.
  press(root, '[data-skl="skill"][data-id="5"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "pack:2", skill: { id: 5, enabled: true } });
  press(root, '[data-skl="toggle"][data-key="pack:2"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "pack:2", enabled: false });
  expect(root.querySelector<HTMLButtonElement>('[data-skl="skill"][data-id="4"]')!.disabled).toBe(true);
  // A skill alone has no page: its row is all of it.
  press(root, '[data-skl="back"]');
  expect(root.querySelector('[data-skl="open"][data-key="skill:3"]')).toBeNull();
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
  press(root, '.skl-page-head [data-skl="more"][data-key="set:1"]');
  // 刪除 asks in its own place: the second press deletes.
  const remove = () => document.querySelector<HTMLElement>('[data-pick="delete"]')!;
  remove().click();
  remove().click();
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
