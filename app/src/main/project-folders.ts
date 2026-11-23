import * as api from "./api";
import type { BrainSettings, FolderInfo } from "./types";
import { esc, ico } from "./ui";

export const folderName = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export function branchLabel(info?: FolderInfo): string {
  return info?.git && info.branch ? `<small class="project-branch owner-data">${ico("gitBranch")}${esc(info.branch)}</small>` : "";
}

export async function readProjects(paths: readonly string[]): Promise<Map<string, FolderInfo>> {
  const results = await Promise.allSettled(paths.map(path => Promise.resolve().then(() => api.folderInfo(path))));
  const found = new Map<string, FolderInfo>();
  results.forEach((result, index) => { if (result.status === "fulfilled" && result.value) found.set(paths[index], result.value); });
  return found;
}

let writes = Promise.resolve();
export function editProjectFolders(edit: (settings: BrainSettings) => Promise<BrainSettings>): Promise<BrainSettings> {
  const result = writes.then(async () => edit((await api.settingsGet()).settings));
  writes = result.then(() => {}, () => {});
  return result;
}

export async function rememberProject(settings: BrainSettings, path: string): Promise<BrainSettings> {
  const projects = settings.project_folders ?? [];
  if (projects.includes(path)) return settings;
  return (await api.settingsSet("project_folders", [...projects, path])).settings;
}

export async function chooseProject(settings: BrainSettings, member: number, path: string | null): Promise<BrainSettings> {
  const choices = { ...settings.member_work_folder };
  if ((choices[member] ?? null) === path) return settings;
  if (path === null) delete choices[member];
  else if (settings.project_folders?.includes(path)) choices[member] = path;
  else return settings;
  return (await api.settingsSet("member_work_folder", choices)).settings;
}
