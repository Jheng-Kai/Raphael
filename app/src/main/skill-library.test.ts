// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn(), pickOutputFolder: vi.fn() }));
vi.mock("./api", () => api);
import { createSkillLibrary, failureText, skillLibraryHTML, type LibraryPackage } from "./skill-library";
import { closeMenu, toaster } from "./ui";

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

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.resetAllMocks(); });

async function setup(answer: (method: string, params: Record<string, unknown>) => unknown = () => ({})) {
  const state = { packages: packages() };
  api.core.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    if (method === "skills.library.list") return { packages: state.packages, members };
    return answer(method, params);
  });
  const root = document.createElement("div");
  document.body.append(root);
  const library = createSkillLibrary(root, () => { root.innerHTML = skillLibraryHTML(library.view()); });
  await library.load();
  return { root, library, state };
}
const press = (root: ParentNode, selector: string) => root.querySelector<HTMLElement>(selector)!.click();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const accessOf = (root: ParentNode, key: string) => root.querySelector(`.skl-pack[data-skl-pack="${key}"] .skl-access span`)?.textContent;

test("one row per package says who may use it, and its name opens its skills", async () => {
  const { root } = await setup();
  expect(root.querySelectorAll(".skl-pack")).toHaveLength(3);
  expect(root.querySelector('.skl-pack[data-skl-pack="set:1"] .skl-count')?.textContent).toBe("3 個技能");
  expect(root.querySelector('.skl-pack[data-skl-pack="skill:3"] .skl-count')).toBeNull();
  expect([accessOf(root, "set:1"), accessOf(root, "pack:2"), accessOf(root, "skill:3")]).toEqual(["還沒給任何人", "小晴、小森", "整個團隊"]);
  expect(root.querySelector(".skl-skill")).toBeNull();
  press(root, '[data-skl="open"][data-key="pack:2"]');
  const rows = [...root.querySelectorAll(".skl-skill")];
  expect(rows.map(row => row.querySelector(".t")?.textContent)).toEqual(["來源核對", "每週摘要"]);
  expect(rows[1].querySelector(".tg")?.getAttribute("aria-checked")).toBe("false");
  // A skill's own switch, and the package's.
  press(root, '[data-skl="skill"][data-id="5"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "pack:2", skill: { id: 5, enabled: true } });
  press(root, '[data-skl="toggle"][data-key="set:1"]');
  expect(api.core).toHaveBeenCalledWith("skills.library.update", { key: "set:1", enabled: false });
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

test("the importer sends a link, pasted text or a file to the core and opens the new package", async () => {
  const made: LibraryPackage = { key: "pack:9", name: "簡報工具", kind: "pack", source: "owner/slides", description: "", version: "", enabled: true, access: [], updatable: true,
    skills: [skill(7, "簡報大綱"), skill(8, "講稿")] };
  const info = vi.spyOn(toaster, "info").mockImplementation(() => {});
  const { root, state } = await setup((method, params) => {
    if (method !== "skills.library.import") return {};
    state.packages = [...state.packages, made];
    return { package: { ...made, source: String(params.source ?? "") } };
  });
  press(root, '[data-skl="import"]');
  root.querySelector<HTMLInputElement>("#skl-source")!.value = "owner/slides";
  press(root, '[data-skl="import-link"]');
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { source: "owner/slides" });
  expect(root.querySelector(".skl-import")).toBeNull();
  expect(root.querySelector('[data-skl="open"][data-key="pack:9"]')?.getAttribute("aria-expanded")).toBe("true");
  expect(info).toHaveBeenCalledWith("已匯入「簡報工具」");
  press(root, '[data-skl="import"]');
  press(root, '[data-skl="paste"]');
  root.querySelector<HTMLTextAreaElement>("#skl-text")!.value = "---\nname: travel\n---\n";
  press(root, '[data-skl="import-text"]');
  await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { text: "---\nname: travel\n---\n" });
  press(root, '[data-skl="import"]');
  const input = root.querySelector<HTMLInputElement>("#skl-file")!;
  expect(input.accept).toBe(".zip,.tar.gz,.tgz,.md");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["# hi"], "skill.md")] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { file: { name: "skill.md", data: btoa("# hi") } });
  // A folder comes from the system's own dialog, as a local path.
  api.pickOutputFolder.mockResolvedValue("D:\\skills\\travel");
  press(root, '[data-skl="import"]');
  press(root, '[data-skl="pick-folder"]');
  await settle(); await settle();
  expect(api.core).toHaveBeenCalledWith("skills.library.import", { source: "local:D:\\skills\\travel" });
});

test("a cause the core names leads its message and is said in words", async () => {
  expect(failureText(new Error("[-32602] Invalid params: not_found: no SKILL.md found in the package"))).toBe("裡面找不到 SKILL.md。");
  expect(failureText(new Error("[-32602] Invalid params: archive: invalid skill package"))).toBe("這個壓縮檔打不開，或裡面有不允許的檔案。");
  expect(failureText(new Error("[-32602] Invalid params: size: skill package exceeds the size or entry limit"))).toBe("檔案太大了。");
  expect(failureText(new Error("[-32602] Invalid params: taken: a skill named travel already exists"))).toBe("技能庫已經有「travel」了。");
  expect(failureText(new Error("the core is not running"))).toBe("沒有成功，請再試一次。");
  const { root } = await setup(method => { if (method === "skills.library.import") throw new Error("[-32602] Invalid params: not_found: no SKILL.md found"); return {}; });
  press(root, '[data-skl="import"]');
  root.querySelector<HTMLInputElement>("#skl-source")!.value = "nothing/here";
  press(root, '[data-skl="import-link"]');
  await settle(); await settle();
  expect(root.querySelector(".skl-error")?.textContent).toBe("裡面找不到 SKILL.md。");
  expect(root.querySelector(".skl-import")).not.toBeNull();
});
