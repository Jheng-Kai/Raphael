// The folder a member writes to on the owner's computer, chosen where the owner writes to it (R-PC-05): a quiet button in the
// composer's row beside the permission, as the permission names how it acts. Its menu lists the member's own folders, the first
// being where its files for the owner go, adds one with the native picker and goes back to the output folder of Settings ›
// General. Each folder is removed in the member's settings (工具 › 可以寫入的資料夾).
import * as api from "./api";
import { describeError } from "./format";
import { onLocaleChange, t } from "./i18n";
import type { BrainSettings, MainEvent } from "./types";
import { closeMenu, esc, ico, openPopover, toaster } from "./ui";

const nameOf = (folder: string): string => folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;

export function mountComposerFolder(button: HTMLElement, member: () => number, host: { onEvent?(handler: (event: MainEvent) => void): void } = {}): { draw(): void } {
  let own: Record<string, string[]> = {}, output = "", known = false, generation = 0;
  let menu: HTMLElement | null = null;
  const mine = (): string[] => own[String(member())] ?? [];
  /** Where the member's files for the owner go now: its first folder, else the output folder, else nowhere yet. */
  const current = (): string => mine()[0] ?? output;

  function draw(): void {
    const folder = current();
    button.hidden = !known;
    button.querySelector("span")!.textContent = folder ? nameOf(folder) : t("output.pick");
    button.setAttribute("aria-label", folder ? t("composerFolder.label", { p0: folder }) : t("composerFolder.none"));
    button.dataset.default = String(!mine().length);
  }

  function take(settings: BrainSettings): void {
    own = settings.member_write_folders ?? {};
    output = settings.owner_output_folder ?? "";
    known = true;
  }

  async function read(): Promise<void> {
    const asked = ++generation;
    try {
      const answer = await api.settingsGet();
      if (asked === generation && answer?.settings) { take(answer.settings); draw(); }
    } catch { /* A reconnecting core keeps the last answer; choosing still requires the core. */ }
  }

  async function save(next: string[]): Promise<void> {
    const all = { ...own };
    if (next.length) all[String(member())] = next; else delete all[String(member())];
    try {
      const saved = await api.settingsSet("member_write_folders", all);
      take(saved.settings); draw();
    } catch (error) { toaster.info(describeError(error)); }
  }

  // The same card as the permission and the model beside it: its title, then each folder with its whole path.
  function cardHTML(): string {
    const folders = mine(), title = esc(t("memberSettings.folders"));
    // A folder's name and path are the owner's own words, never interface copy (`owner-data`).
    const row = (folder: string, index: number, checked: boolean, label?: string): string =>
      `<button type="button" role="radio" class="cb-row" data-folder="${index}" aria-checked="${checked}"><span class="cb-name"><b${label ? "" : ' class="owner-data"'}>${esc(label ?? nameOf(folder))}</b><small class="cb-path owner-data">${esc(folder)}</small></span>` +
      `${checked ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : ""}</button>`;
    const rows = folders.length ? folders.map((folder, index) => row(folder, index, index === 0)).join("")
      : output ? row(output, -1, true, t("composerFolder.output")) : `<p class="cb-empty">${esc(t("memberSettings.foldersNone"))}</p>`;
    const actions = `<button type="button" role="menuitem" class="cb-row cb-action" data-folder-act="add"><span class="cb-icon" aria-hidden="true">${ico("plus")}</span><span class="cb-name"><b>${esc(t("writeFolders.add"))}</b></span></button>` +
      (folders.length && output ? `<button type="button" role="menuitem" class="cb-row cb-action" data-folder-act="default"><span class="cb-icon" aria-hidden="true">${ico("folder")}</span><span class="cb-name"><b>${esc(t("composerFolder.useOutput"))}</b><small class="cb-path owner-data">${esc(output)}</small></span></button>` : "");
    return `<div class="cb-card cb-folders"><header class="cb-head"><h3><span>${title}</span></h3></header><div class="cb-list" role="radiogroup" aria-label="${title}">${rows}</div><div class="cb-list cb-actions">${actions}</div></div>`;
  }

  button.addEventListener("click", event => {
    event.stopPropagation();
    if (menu?.isConnected) { closeMenu(); return; }
    menu = openPopover(button, cardHTML(), { className: "menu cb-menu", role: "dialog", label: t("memberSettings.folders"), placement: "start", onClose: () => { menu = null; } });
    menu.addEventListener("click", picked => {
      const target = picked.target as Element, row = target.closest<HTMLElement>("[data-folder]"), act = target.closest<HTMLElement>("[data-folder-act]")?.dataset.folderAct;
      const folders = mine();
      if (row) {
        const index = Number(row.dataset.folder);
        closeMenu(); button.focus({ preventScroll: true });
        // The chosen folder goes first: the member's files for the owner go there from now on.
        if (index > 0) void save([folders[index], ...folders.filter((_, at) => at !== index)]);
      } else if (act === "add") {
        closeMenu();
        void api.pickOutputFolder().then(path => {
          if (path !== null) return save([path, ...folders.filter(folder => folder !== path)]);
        }).catch(error => toaster.info(describeError(error)));
      } else if (act === "default") {
        closeMenu(); button.focus({ preventScroll: true });
        void save([]);
      }
    });
    menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  });
  host.onEvent?.(event => { if (event.type === "SettingsChanged") void read(); });
  onLocaleChange(draw);
  draw(); void read();
  return { draw };
}
