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
  if (rememberedPath(projects, path)) return settings;
  return (await api.settingsSet("project_folders", [...projects, path])).settings;
}

function rememberedPath(projects: readonly string[], path: string): string | undefined {
  function key(value: string): string {
    const trimmed = value.trim();
    if (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(trimmed)) {
      return trimmed.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
    }
    return trimmed.replace(/\/+$/, "");
  }
  const requested = key(path);
  return projects.find(project => key(project) === requested);
}

export async function chooseProject(settings: BrainSettings, member: number, path: string | null): Promise<BrainSettings> {
  const choices = { ...settings.member_work_folder };
  const remembered = path === null ? null : rememberedPath(settings.project_folders ?? [], path);
  if (remembered === undefined || (choices[member] ?? null) === remembered) return settings;
  if (remembered === null) delete choices[member];
  else choices[member] = remembered;
  return (await api.settingsSet("member_work_folder", choices)).settings;
}
