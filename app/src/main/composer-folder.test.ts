// @vitest-environment happy-dom
// The member's folder in the composer's row (composer-folder.ts, R-PC-05): it names where the member's files for the owner go,
// and its menu switches, adds and goes back to the output folder, saving the member's folders whole.
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
import { mountComposerFolder } from "./composer-folder";
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
  expect(button.dataset.default).toBe("false");
});

test("a member with no folder of its own names the output folder, and with none at all asks for one", async () => {
  member = 4;
  const mounted = await mount();
  expect(word()).toBe("Deliveries");
  expect(button.dataset.default).toBe("true");
  state.settings.owner_output_folder = "";
  handlers.forEach(handler => handler({ type: "SettingsChanged" } as MainEvent)); await flush();
  expect(word()).toBe(t("output.pick"));
  expect(button.getAttribute("aria-label")).toBe(t("composerFolder.none"));
  // Another member is drawn from what was read, without a read of its own.
  member = 3; mounted.draw();
  expect(word()).toBe("Notes");
});

test("its menu checks the first folder, and choosing another puts it first, keeping the other members' folders", async () => {
  state.settings.member_write_folders["9"] = ["F:\\Other"];
  await mount();
  const card = await open();
  const rows = [...card.querySelectorAll<HTMLElement>("[data-folder]")];
  expect(rows.map(row => row.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  expect(rows[1].querySelector(".cb-path")!.textContent).toBe("E:\\Archive");
  await press('[data-folder="1"]');
  expect(api.settingsSet).toHaveBeenCalledWith("member_write_folders", { "3": ["E:\\Archive", "D:\\Work\\Notes"], "9": ["F:\\Other"] });
  expect(word()).toBe("Archive");
  expect(document.querySelector("#app-popover .cb-folders")).toBeNull();
  // The one already first saves nothing.
  await open(); await press('[data-folder="0"]');
  expect(api.settingsSet).toHaveBeenCalledTimes(1);
});

test("a folder added with the picker goes first, once, and a cancelled picker changes nothing", async () => {
  await mount();
  await open();
  api.pickOutputFolder.mockResolvedValueOnce("E:\\Archive");
  await press('[data-folder-act="add"]');
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_write_folders", { "3": ["E:\\Archive", "D:\\Work\\Notes"] });
  await open();
  api.pickOutputFolder.mockResolvedValueOnce(null);
  await press('[data-folder-act="add"]');
  expect(api.settingsSet).toHaveBeenCalledTimes(1);
});

test("going back to the output folder clears the member's own folders, and with none the output folder is the one checked row", async () => {
  await mount();
  await open();
  expect(document.querySelector('#app-popover [data-folder-act="default"] .cb-path')!.textContent).toBe("C:\\Owner\\Deliveries");
  await press('[data-folder-act="default"]');
  expect(api.settingsSet).toHaveBeenLastCalledWith("member_write_folders", {});
  expect(word()).toBe("Deliveries");
  const card = await open();
  const rows = [...card.querySelectorAll<HTMLElement>("[data-folder]")];
  expect(rows).toHaveLength(1);
  expect(rows[0].getAttribute("aria-checked")).toBe("true");
  expect(rows[0].querySelector("b")!.textContent).toBe(t("composerFolder.output"));
  expect(card.querySelector('[data-folder-act="default"]')).toBeNull();
});

test("with no folder and no output folder the menu says the member cannot write, and still offers to add one", async () => {
  state.settings = { owner_output_folder: "", member_write_folders: {} };
  await mount();
  const card = await open();
  expect(card.querySelector(".cb-empty")!.textContent).toBe(t("memberSettings.foldersNone"));
  expect(card.querySelector('[data-folder-act="add"]')).not.toBeNull();
});
