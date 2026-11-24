// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import type { BrainSettings, FolderInfo } from "./types";

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(), settingsSet: vi.fn(), folderInfo: vi.fn(), memberFolder: vi.fn(),
  switchBranch: vi.fn(), pickOutputFolder: vi.fn(),
}));
vi.mock("./api", () => api);

import { mountComposerFolder } from "./composer-folder";
import { setLocale } from "./i18n";
import { closeMenu } from "./ui";

const repo = "C:\\Work\\Repo", plain = "D:\\Notes", own = "C:\\Raphael\\members\\3", added = "F:\\New";
const info = (path: string, branch = "main"): FolderInfo => ({
  path, name: path.split("\\").pop()!, exists: true, git: path === repo,
  branch: path === repo ? branch : "", branches: path === repo ? ["draft", "main"] : [],
});
let settings: Partial<BrainSettings>;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const find = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const rows = () => [...document.querySelectorAll<HTMLElement>("#app-popover [role=radio]")];
const choose = async (index: number) => { rows()[index].click(); await flush(); };

async function mount() {
  document.body.innerHTML = '<button id="folder" aria-expanded="false"><span></span></button><button id="branch" aria-expanded="false"><span></span></button>';
  mountComposerFolder(find("#folder"), find("#branch"), () => ({ id: 3, name: "日文老師" }));
  await flush();
}

beforeEach(() => {
  closeMenu();
  setLocale("zh-TW");
  vi.resetAllMocks();
  settings = { project_folders: [repo, plain], member_work_folder: { "7": plain } };
  api.settingsGet.mockImplementation(async () => ({ settings }));
  api.settingsSet.mockImplementation(async (key, value) => {
    settings = { ...settings, [key]: value };
    return { settings };
  });
  api.folderInfo.mockImplementation(async path => info(path));
  api.memberFolder.mockResolvedValue({ path: own });
  api.pickOutputFolder.mockResolvedValue(null);
});

test("the composer offers only projects with their branches, and no project keeps the member where it always works", async () => {
  await mount();
  // With no project the button keeps its short word, and nothing names or shows the member's own folder.
  expect(find("#folder").textContent).toBe("選擇資料夾");
  expect(find("#folder").getAttribute("aria-label")).toBe("選擇資料夾");
  expect(find("#branch").hidden).toBe(true);
  find("#folder").click(); await flush();
  expect(rows().map(row => row.querySelector("b")!.textContent)).toEqual(["不指定資料夾", "Repo", "Notes"]);
  expect(document.querySelector("#app-popover")!.textContent).not.toContain(own);
  expect(document.querySelector("#app-popover")!.textContent).not.toContain("日文老師");
  expect(rows()[0].querySelector("small")).toBeNull();
  expect(api.memberFolder).not.toHaveBeenCalled();
  expect(rows()[0].getAttribute("aria-checked")).toBe("true");
  expect(rows()[1].querySelector(".project-branch")!.textContent).toBe("main");
  expect(rows()[2].querySelector(".project-branch")).toBeNull();
  await choose(1);
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_work_folder", { "3": repo, "7": plain });
  expect(find("#branch").hidden).toBe(false);
  expect(find("#branch").textContent).toBe("main");
  find("#folder").click(); await flush(); await choose(0);
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_work_folder", { "7": plain });
  expect(find("#branch").hidden).toBe(true);
});

test("the branch card switches local branches and shows Git's refusal", async () => {
  settings.member_work_folder = { "3": repo };
  await mount();
  find("#branch").click(); await flush();
  expect(rows().map(row => [row.textContent, row.getAttribute("aria-checked")])).toEqual([["draft", "false"], ["main", "true"]]);
  api.switchBranch.mockRejectedValueOnce(new Error("error: Your local changes would be overwritten"));
  await choose(0);
  expect(document.querySelector(".toast")?.textContent).toContain("error: Your local changes would be overwritten");
  api.switchBranch.mockResolvedValueOnce(info(repo, "draft"));
  find("#branch").click(); await flush(); await choose(0);
  expect(api.switchBranch).toHaveBeenLastCalledWith(repo, "draft");
  expect(find("#branch").textContent).toBe("draft");
});

test("without the Git CLI the composer shows the branch with no choices", async () => {
  settings.member_work_folder = { "3": repo };
  api.folderInfo.mockImplementation(async path => ({ ...info(path), branches: [] }));
  await mount();
  expect(find("#branch").textContent).toBe("main");
  find("#branch").click(); await flush();
  expect(rows()).toEqual([]);
});

test("a picked project is added and selected immediately and cancellation writes nothing", async () => {
  await mount();
  find("#folder").click();
  find('[data-project-pick="-1"]').click(); await flush();
  expect(api.settingsSet).not.toHaveBeenCalled();
  api.pickOutputFolder.mockResolvedValue(added);
  find("#folder").click();
  find('[data-project-pick="-1"]').click(); await flush();
  expect(api.settingsSet.mock.calls).toEqual([
    ["project_folders", [repo, plain, added]],
    ["member_work_folder", { "3": added, "7": plain }],
  ]);
  expect(find("#folder").textContent).toBe("New");
});
