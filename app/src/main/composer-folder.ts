import * as api from "./api";
import { describeError } from "./format";
import { onLocaleChange, t } from "./i18n";
import { branchLabel, chooseProject, editProjectFolders, folderName, readProjects, rememberProject } from "./project-folders";
import type { BrainSettings, FolderInfo, MainEvent } from "./types";
import { closeMenu, esc, ico, openPopover, patchHTML, toaster } from "./ui";

/** The core's own words for a switch it refused or could not finish (`SWITCH_SLOW`, `SWITCH_FILTERS` in folders.py). */
function switchFailure(message: string): string | null {
  if (message === "Git did not finish switching branches in time") return t("projectFolders.switchSlow");
  if (message === "This repository runs its own Git filters. Switch branches in your own terminal.") return t("projectFolders.switchFilters");
  return null;
}

export function mountComposerFolder(
  button: HTMLElement, branch: HTMLElement, member: () => { id: number; name: string },
  host: { onEvent?(handler: (event: MainEvent) => void): void } = {},
): { draw(): void; add(): void; shown(): boolean } {
  let settings: BrainSettings | null = null, generation = 0, menu: HTMLElement | null = null;
  let details = new Map<string, FolderInfo>();
  const switching = new Set<string>();
  const paths = (): string[] => settings?.project_folders ?? [];
  const selected = (): string | null => {
    const chosen = settings?.member_work_folder?.[member().id];
    return chosen && paths().includes(chosen) ? chosen : null;
  };

  function draw(): void {
    const path = selected(), info = path ? details.get(path) : undefined;
    // With no project the member works where it always does, a place the owner never needs to see: the button keeps its
    // short word (選擇資料夾) and no row names or shows that folder.
    const label = path ? info?.name ?? folderName(path) : t("composerFolder.pick");
    button.hidden = settings === null;
    button.querySelector("span")!.textContent = label;
    button.setAttribute("aria-label", path ? t("composerFolder.label", { p0: path }) : label);
    branch.hidden = !info?.git;
    branch.querySelector("span")!.textContent = info?.branch || t("projectFolders.detached");
    branch.setAttribute("aria-label", t("projectFolders.branchNamed", { p0: info?.branch || t("projectFolders.detached") }));
  }

  async function refreshProjects(): Promise<void> {
    const asked = ++generation;
    const result = await readProjects(paths());
    if (asked !== generation) return;
    // A read that failed (Git too slow for a moment) keeps what was known, so the branch button stays to try again.
    for (const path of paths()) if (!result.has(path) && details.has(path)) result.set(path, details.get(path)!);
    details = result; draw();
  }

  function take(next: BrainSettings): void {
    settings = next;
    draw();
    void refreshProjects();
  }

  function save(edit: (settings: BrainSettings) => Promise<BrainSettings>): void {
    void editProjectFolders(edit).then(take).catch(error => toaster.info(describeError(error)));
  }

  function add(): void {
    const id = member().id;
    void api.pickOutputFolder().then(path => {
      if (path !== null) save(async current => chooseProject(await rememberProject(current, path), id, path));
    }).catch(error => toaster.info(describeError(error)));
  }

  function card(title: string, rows: string, actions = ""): string {
    return `<div class="cb-card cb-folders"><header class="cb-head"><h3><span>${esc(title)}</span></h3></header><div class="cb-list" role="radiogroup" aria-label="${esc(title)}">${rows}</div>${actions}</div>`;
  }

  function pickRow(index: number, name: string, checked: boolean, path = "", info?: FolderInfo): string {
    return `<button type="button" role="radio" class="cb-row" data-project-pick="${index}" aria-checked="${checked}"><span class="cb-name"><b class="owner-data">${esc(name)}</b>` +
      (path ? `<small class="owner-data">${esc(path)}</small>` : "") + branchLabel(info) + "</span>" +
      (checked ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : "") + "</button>";
  }

  function open(anchor: HTMLElement, title: string, html: string, pick: (index: number) => void): HTMLElement {
    const popover = openPopover(anchor, html, { className: "menu cb-menu", role: "dialog", label: title, placement: "start",
      navigation: { restore: () => () => { if (anchor.isConnected && !anchor.closest("[hidden], [inert]")) anchor.click(); } },
      onClose: () => { menu = null; } });
    menu = popover;
    popover.addEventListener("click", event => {
      const row = (event.target as Element).closest<HTMLElement>("[data-project-pick]");
      if (!row) return;
      closeMenu();
      anchor.focus({ preventScroll: true });
      pick(Number(row.dataset.projectPick));
    });
    popover.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    return popover;
  }

  button.addEventListener("click", event => {
    event.stopPropagation();
    if (menu?.isConnected && button.getAttribute("aria-expanded") === "true") { closeMenu(); return; }
    const id = member().id, projects = paths();
    const title = t("projectFolders.title");
    const html = (): string => {
      const picked = selected();
      const rows = pickRow(0, t("composerFolder.none"), picked === null) + projects.map((path, index) =>
        pickRow(index + 1, details.get(path)?.name ?? folderName(path), path === picked, path, details.get(path))).join("");
      const addRow = `<div class="cb-list cb-actions"><button type="button" role="menuitem" class="cb-row cb-action" data-project-pick="-1"><span class="cb-icon" aria-hidden="true">${ico("plus")}</span><span class="cb-name"><b>${esc(t("writeFolders.add"))}</b></span></button></div>`;
      return card(title, rows, addRow);
    };
    const popover = open(button, title, html(), index => {
      if (index === -1) add();
      else save(current => chooseProject(current, id, projects[index - 1] ?? null));
    });
    void refreshProjects().then(() => {
      if (popover.isConnected && id === member().id) patchHTML(popover, html());
    });
  });

  branch.addEventListener("click", event => {
    event.stopPropagation();
    if (menu?.isConnected && branch.getAttribute("aria-expanded") === "true") { closeMenu(); return; }
    const path = selected();
    if (!path) return;
    const title = t("projectFolders.branches");
    let info = details.get(path);
    const html = (): string => card(title, info?.branches.map((name, index) => pickRow(index, name, name === info?.branch)).join("") ?? "");
    const popover = open(branch, title, html(), index => {
      const next = info?.branches[index];
      // One switch at a time per folder: a second press while Git still works would race the first.
      if (!next || next === info?.branch || switching.has(path)) return;
      switching.add(path);
      void api.switchBranch(path, next).then(result => { details.set(path, result); draw(); })
        .catch(error => {
          const message = (error instanceof Error ? error.message : String(error)).replace(/^\[-?\d+\] /, "");
          toaster.info(switchFailure(message) ?? (/^(error|fatal): /.test(message) ? message : describeError(error)));
          // Git may have switched before the answer failed: show the branch the folder is really on.
          void refreshProjects();
        })
        .finally(() => switching.delete(path));
    });
    void refreshProjects().then(() => {
      if (!popover.isConnected || path !== selected()) return;
      info = details.get(path);
      patchHTML(popover, html());
    });
  });

  async function read(): Promise<void> {
    try {
      const answer = await api.settingsGet();
      if (answer?.settings) take(answer.settings);
    } catch { /* Keep the last answer while the core reconnects. */ }
  }

  host.onEvent?.(event => { if (event.type === "SettingsChanged") void read(); });
  onLocaleChange(draw);
  draw();
  void read();
  return { draw, add, shown: () => !button.hidden };
}
