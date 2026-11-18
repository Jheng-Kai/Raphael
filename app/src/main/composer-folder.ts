// The folder a member writes to on the owner's computer, chosen where the owner writes to it (R-PC-05): a quiet button in the
// composer's row beside the permission, as the permission names how it acts. Its menu lists the member's folders, the output
// folder of Settings › General first (every member's default), then the ones added for the member; the checked one is where its
// files for the owner go. The menu ends with 加入資料夾. Each added folder is removed in the member's settings.
import * as api from "./api";
import { describeError } from "./format";
import { onLocaleChange, t } from "./i18n";
import type { BrainSettings, MainEvent } from "./types";
import { closeMenu, esc, ico, openPopover, toaster } from "./ui";

export const folderName = (folder: string): string => folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;

// The member's list (`member_write_folders`) keeps its chosen folder first; the output folder is written into it only while a
// folder added for the member follows it, so a list of the output folder alone is the empty list, the default.
const normal = (list: string[], output: string): string[] => (list.length === 1 && list[0] === output ? [] : list);
const base = (own: readonly string[], output: string): string[] => (own.length ? [...own] : output ? [output] : []);
/** The member's folders as the menus list them: the output folder first, then the ones added, in the order they were added. */
export const listedFolders = (own: readonly string[], output: string): string[] => [...new Set([output, ...own].filter(Boolean))];
/** The folder the member's files for the owner go to: the first of its list, else the output folder. */
export const chosenFolder = (own: readonly string[], output: string): string => own[0] ?? output;
/** The list after `folder` is chosen: it goes first. */
export const chooseFolder = (own: readonly string[], output: string, folder: string): string[] =>
  normal([folder, ...base(own, output).filter(item => item !== folder)], output);
/** The list after `folder` is added: it goes at the end, the chosen one staying chosen. A folder listed already changes nothing. */
export const addFolder = (own: readonly string[], output: string, folder: string): string[] =>
  listedFolders(own, output).includes(folder) ? [...own] : normal([...base(own, output), folder], output);
/** The list after `folder` is removed: the next one is chosen when it was the chosen one. */
export const removeFolder = (own: readonly string[], output: string, folder: string): string[] =>
  normal(own.filter(item => item !== folder), output);

export function mountComposerFolder(button: HTMLElement, member: () => number, host: { onEvent?(handler: (event: MainEvent) => void): void } = {}): { draw(): void; add(): void; shown(): boolean } {
  let own: Record<string, string[]> = {}, output = "", known = false, generation = 0;
  let menu: HTMLElement | null = null;
  const mine = (): string[] => own[String(member())] ?? [];

  function draw(): void {
    const folder = chosenFolder(mine(), output);
    button.hidden = !known;
    button.querySelector("span")!.textContent = folder ? folderName(folder) : t("output.pick");
    button.setAttribute("aria-label", folder ? t("composerFolder.label", { p0: folder }) : t("composerFolder.none"));
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

  // The same card as the permission and the model beside it: its title, each folder by its name with its whole path under
  // it (the owner's own words), the list scrolling as the @ menu's does, and 加入資料夾 at its foot.
  function cardHTML(): string {
    const folders = listedFolders(mine(), output), chosen = chosenFolder(mine(), output), title = esc(t("memberSettings.folders"));
    const rows = folders.map((folder, index) =>
      `<button type="button" role="radio" class="cb-row" data-folder="${index}" aria-checked="${folder === chosen}"><span class="cb-name"><b class="owner-data">${esc(folderName(folder))}</b><small class="owner-data">${esc(folder)}</small></span>` +
      `${folder === chosen ? `<span class="cb-check" aria-hidden="true">${ico("check")}</span>` : ""}</button>`).join("") ||
      `<p class="cb-empty">${esc(t("memberSettings.foldersNone"))}</p>`;
    const add = `<button type="button" role="menuitem" class="cb-row cb-action" data-folder-act="add"><span class="cb-icon" aria-hidden="true">${ico("plus")}</span><span class="cb-name"><b>${esc(t("writeFolders.add"))}</b></span></button>`;
    return `<div class="cb-card cb-folders"><header class="cb-head"><h3><span>${title}</span></h3></header><div class="cb-list" role="radiogroup" aria-label="${title}">${rows}</div><div class="cb-list cb-actions">${add}</div></div>`;
  }

  /** Adds a folder with the native picker and chooses it at once: the member writes there from now on and the button names
   *  it. A folder already listed is chosen; the chosen one or a cancelled picker changes nothing. The + menu's 加入資料夾 is this too. */
  function add(): void {
    const list = mine();
    void api.pickOutputFolder().then(path => {
      if (path !== null && path !== chosenFolder(list, output)) return save(chooseFolder(list, output, path));
    }).catch(error => toaster.info(describeError(error)));
  }

  button.addEventListener("click", event => {
    event.stopPropagation();
    if (menu?.isConnected) { closeMenu(); return; }
    menu = openPopover(button, cardHTML(), { className: "menu cb-menu", role: "dialog", label: t("memberSettings.folders"), placement: "start", onClose: () => { menu = null; } });
    menu.addEventListener("click", picked => {
      const target = picked.target as Element, row = target.closest<HTMLElement>("[data-folder]"), act = target.closest<HTMLElement>("[data-folder-act]")?.dataset.folderAct;
      const list = mine(), folders = listedFolders(list, output);
      if (row) {
        const folder = folders[Number(row.dataset.folder)];
        closeMenu(); button.focus({ preventScroll: true });
        if (folder !== undefined && folder !== chosenFolder(list, output)) void save(chooseFolder(list, output, folder));
      } else if (act === "add") {
        closeMenu(); add();
      }
    });
    menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  });
  host.onEvent?.(event => { if (event.type === "SettingsChanged") void read(); });
  onLocaleChange(draw);
  draw(); void read();
  return { draw, add, shown: () => !button.hidden };
}
