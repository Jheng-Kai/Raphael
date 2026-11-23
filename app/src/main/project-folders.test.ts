import { beforeEach, expect, it, vi } from "vitest";
import { settingsSet } from "./api";
import { chooseProject, rememberProject } from "./project-folders";
import type { BrainSettings } from "./types";

vi.mock("./api", () => ({ settingsSet: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

const defaults: BrainSettings = {
  monthly_limit_usd: null,
  cleanup_model: "",
  languages: ["en-US"],
  history_retention_days: 30,
  stt_engine: "cloud",
  stt_cloud_model: "",
};

it("chooses the remembered Windows project when the picker returns a different spelling", async () => {
  const path = "C:\\Work\\Project";
  const settings = { ...defaults, project_folders: [path] };
  const selected = { ...settings, member_work_folder: { 3: path } };
  vi.mocked(settingsSet).mockResolvedValue({ settings: selected });
  const same = await rememberProject(settings, "c:/WORK/project/");
  expect(same).toBe(settings);
  expect(settingsSet).not.toHaveBeenCalled();
  expect(await chooseProject(same, 3, "c:/WORK/project/")).toEqual(selected);
  expect(settingsSet).toHaveBeenCalledWith("member_work_folder", { 3: path });
});

it("chooses the canonical path returned when a new project is added", async () => {
  const path = "C:\\Work\\New";
  const settings = { ...defaults, project_folders: [] };
  const remembered = { ...settings, project_folders: [path] };
  const selected = { ...remembered, member_work_folder: { 3: path } };
  vi.mocked(settingsSet).mockResolvedValueOnce({ settings: remembered }).mockResolvedValueOnce({ settings: selected });
  expect(await chooseProject(await rememberProject(settings, path + "\\"), 3, path + "\\")).toEqual(selected);
  expect(settingsSet).toHaveBeenNthCalledWith(1, "project_folders", [path + "\\"]);
  expect(settingsSet).toHaveBeenNthCalledWith(2, "member_work_folder", { 3: path });
});
