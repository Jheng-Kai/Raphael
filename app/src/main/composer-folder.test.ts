// @vitest-environment happy-dom
// The member's folder in the composer's row (composer-folder.ts, R-PC-05): it names where the member's files for the owner go,
// and its menu lists the output folder first, then the ones added, switches between them and adds one, saving the member's
// folders whole.
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: { owner_output_folder: "C:\\Owner\\Deliveries", member_write_folders: {} as Record<string, string[]> } }));
const api = vi.hoisted(() => ({
  settingsGet: vi.fn(async () => ({ settings: structuredClone(state.settings) })),
  settingsSet: vi.fn(async (_key: string, value: Record<string, string[]>) => {
    state.settings.member_write_folders = structuredClone(value);
    return { settings: structuredClone(state.settings) };
  }),
  pickOutputFolder: vi.fn(async (): Promise<string | null> => null),
}));
vi.mock("./api", () => api);
import { mountComposerFolder, removeFolder } from "./composer-folder";
import { setLocale, t } from "./i18n";
import type { MainEvent } from "./types";
import { closeMenu } from "./ui";

const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let member = 3, button: HTMLButtonElement, handlers: ((event: MainEvent) => void)[];

async function mount(): Promise<ReturnType<typeof mountComposerFolder>> {
  button = document.createElement("button");
  button.innerHTML = '<svg class="i"></svg><span></span>';
  document.body.append(button);
  handlers = [];
  const mounted = mountComposerFolder(button, () => member, { onEvent: handler => { handlers.push(handler); } });
  await flush();
  return mounted;
}
const word = (): string => button.querySelector("span")!.textContent ?? "";
const open = async (): Promise<HTMLElement> => { button.click(); await flush(); return document.querySelector<HTMLElement>("#app-popover .cb-folders")!; };
const press = async (selector: string): Promise<void> => { document.querySelector<HTMLElement>(`#app-popover ${selector}`)!.click(); await flush(); };

beforeEach(() => {
  closeMenu();
  document.body.innerHTML = "";
  setLocale("zh-TW");
  member = 3;
  state.settings = { owner_output_folder: "C:\\Owner\\Deliveries", member_write_folders: { "3": ["D:\\Work\\Notes", "E:\\Archive"] } };
  vi.clearAllMocks();
});

test("it waits hidden until the folders are read, then names the member's first folder with its whole path in its name", async () => {
  button = document.createElement("button");
  button.innerHTML = "<span></span>";
  let answer!: (value: { settings: typeof state.settings }) => void;
  api.settingsGet.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  mountComposerFolder(button, () => member);
  expect(button.hidden).toBe(true);
  answer({ settings: structuredClone(state.settings) }); await flush();
  expect(button.hidden).toBe(false);
  expect(button.querySelector("span")!.textContent).toBe("Notes");
  expect(button.getAttribute("aria-label")).toBe(t("composerFolder.label", { p0: "D:\\Work\\Notes" }));
});

test("a member with no folder of its own names the output folder, and with none at all asks for one", async () => {
  member = 4;
  const mounted = await mount();
  expect(word()).toBe("Deliveries");
  state.settings.owner_output_folder = "";
  handlers.forEach(handler => handler({ type: "SettingsChanged" } as MainEvent)); await flush();
  expect(word()).toBe(t("output.pick"));
  expect(button.getAttribute("aria-label")).toBe(t("composerFolder.none"));
  // Another member is drawn from what was read, without a read of its own.
  member = 3; mounted.draw();
  expect(word()).toBe("Notes");
});

test("its menu lists the output folder first and the added ones after it by name, and choosing one puts it first, keeping the other members' folders", async () => {
  state.settings.member_write_folders["9"] = ["F:\\Other"];
  await mount();
  const card = await open();
  const rows = [...card.querySelectorAll<HTMLElement>("[data-folder]")];
  expect(rows.map(row => row.textContent)).toEqual(["Deliveries", "Notes", "Archive"]);
  expect(rows.map(row => row.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  // The whole path waits under the pointer; the card holds no path and one action, 加入資料夾, at its foot.
  expect(rows[2].dataset.tooltip).toBe("E:\\Archive");
  expect(card.textContent).not.toContain("E:\\");
  expect([...card.querySelectorAll<HTMLElement>("[data-folder-act]")].map(act => act.dataset.folderAct)).toEqual(["add"]);
  expect(card.lastElementChild!.querySelector('[data-folder-act="add"]')!.textContent).toBe(t("writeFolders.add"));
  await press('[data-folder="2"]');
  expect(api.settingsSet).toHaveBeenCalledWith("member_write_folders", { "3": ["E:\\Archive", "D:\\Work\\Notes"], "9": ["F:\\Other"] });
  expect(word()).toBe("Archive");
  expect(document.querySelector("#app-popover .cb-folders")).toBeNull();
  // The order of the menu stays; the one already chosen saves nothing.
  const again = await open();
  expect([...again.querySelectorAll("[data-folder]")].map(row => row.textContent)).toEqual(["Deliveries", "Archive", "Notes"]);
  await press('[data-folder="1"]');
  expect(api.settingsSet).toHaveBeenCalledTimes(1);
});

test("choosing the output folder puts it first in the member's list, and a member with none has it checked", async () => {
  await mount();
  await open();
  await press('[data-folder="0"]');
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_write_folders", { "3": ["C:\\Owner\\Deliveries", "D:\\Work\\Notes", "E:\\Archive"] });
  expect(word()).toBe("Deliveries");
  member = 4;
  const card = await open();
  const rows = [...card.querySelectorAll<HTMLElement>("[data-folder]")];
  expect(rows.map(row => [row.textContent, row.getAttribute("aria-checked")])).toEqual([["Deliveries", "true"]]);
  await press('[data-folder="0"]');
  expect(api.settingsSet).toHaveBeenCalledTimes(1);
});

test("a folder added with the picker goes at the end, the chosen one staying chosen, once, and a cancelled picker changes nothing", async () => {
  await mount();
  await open();
  api.pickOutputFolder.mockResolvedValueOnce("F:\\New");
  await press('[data-folder-act="add"]');
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_write_folders", { "3": ["D:\\Work\\Notes", "E:\\Archive", "F:\\New"] });
  expect(word()).toBe("Notes");
  for (const picked of ["E:\\Archive", "C:\\Owner\\Deliveries", null]) {
    await open();
    api.pickOutputFolder.mockResolvedValueOnce(picked);
    await press('[data-folder-act="add"]');
  }
  expect(api.settingsSet).toHaveBeenCalledTimes(1);
  // A member with none keeps the output folder chosen, and it is written first so the added one follows it.
  member = 4;
  await open();
  api.pickOutputFolder.mockResolvedValueOnce("G:\\Drafts");
  await press('[data-folder-act="add"]');
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_write_folders", { "3": ["D:\\Work\\Notes", "E:\\Archive", "F:\\New"], "4": ["C:\\Owner\\Deliveries", "G:\\Drafts"] });
  expect(word()).toBe("Deliveries");
});

test("removing a folder chooses the next one, and the output folder left alone is the empty list, the default", () => {
  const output = "C:\\Owner\\Deliveries";
  expect(removeFolder(["D:\\Notes", output, "E:\\Archive"], output, "D:\\Notes")).toEqual([output, "E:\\Archive"]);
  expect(removeFolder([output, "D:\\Notes"], output, "D:\\Notes")).toEqual([]);
  expect(removeFolder(["D:\\Notes"], output, "D:\\Notes")).toEqual([]);
});

test("with no folder and no output folder the menu says the member cannot write, and the one added is chosen", async () => {
  state.settings = { owner_output_folder: "", member_write_folders: {} };
  await mount();
  const card = await open();
  expect(card.querySelector(".cb-empty")!.textContent).toBe(t("memberSettings.foldersNone"));
  api.pickOutputFolder.mockResolvedValueOnce("D:\\Work");
  await press('[data-folder-act="add"]');
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_write_folders", { "3": ["D:\\Work"] });
  expect(word()).toBe("Work");
});
