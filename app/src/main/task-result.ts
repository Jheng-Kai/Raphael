import * as api from "./api";
import { cardDisclosureHTML, cardFailure, cardHTML } from "./card";
import { confirmRestore, diffHTML, fileName } from "./checkpoint-view";
import { t } from "./i18n";
import { btn, esc, ico, toaster } from "./ui";

/** How many files the card lists before the rest fold under 「還有 N 個檔案」. */
export const SHOWN_FILES = 5;

type Change = "added" | "removed" | "changed";
interface ChangedFile { path: string; change: Change; added: number | null; removed: number | null; diff: string; restored: boolean }

/** The lines a diff added and removed, counted from its text (a checkpoint the core made before it counted keeps only the text). */
function diffCounts(diff: string): { added: number; removed: number } | null {
  if (!diff) return null;
  let added = 0, removed = 0, hunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) { hunk = true; continue; }
    if (hunk && line.startsWith("+")) added++;
    if (hunk && line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** A file's change, from the core's word for it, else from the hunk header: 「@@ -0,0 …」 is a file that was not there, 「… +0,0 @@」 one that is gone. */
function changeOf(file: api.CheckpointFile): Change {
  if (file.change) return file.change;
  const hunk = file.diff.split("\n").find(line => line.startsWith("@@")) ?? "";
  return /^@@ -0,0 /.test(hunk) ? "added" : / \+0,0 @@/.test(hunk) ? "removed" : "changed";
}

/** The files a turn changed, once each (a later checkpoint of the same turn wins), in the core's order. */
function changedFiles(turn: number, checkpoints: readonly api.FileCheckpoint[]): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  for (const checkpoint of checkpoints) {
    if (checkpoint.turn !== turn) continue;
    for (const file of checkpoint.files) {
      const counted = file.added != null && file.removed != null ? { added: file.added, removed: file.removed } : diffCounts(file.diff);
      files.set(file.path, { path: file.path, change: changeOf(file), added: counted?.added ?? null, removed: counted?.removed ?? null, diff: file.diff, restored: checkpoint.state === "restored" });
    }
  }
  return [...files.values()];
}

/** What a row says at its right: 「新增」 and 「刪除」 for a file that came or went, the lines for a text file that changed, and
 *  「已修改」 where there is no text to count (a picture, a large file): never 「+0 −0」. */
function rowState(file: ChangedFile): string {
  if (file.change === "added") return esc(t("cards.fileNew"));
  if (file.change === "removed") return esc(t("cards.fileGone"));
  const added = file.added ?? 0, removed = file.removed ?? 0;
  if (!added && !removed) return esc(t("cards.fileEdited"));
  return (added ? `<span class="tr-add">+${added}</span>` : "") + (added && removed ? " " : "") + (removed ? `<span class="tr-del">−${removed}</span>` : "");
}

function rowHTML(file: ChangedFile): string {
  const name = file.path.slice(file.path.lastIndexOf("/") + 1), folder = fileName(file.path.slice(0, Math.max(0, file.path.length - name.length - 1)));
  const line = `<span class="tr-chev" aria-hidden="true">${file.diff ? ico("right") : ""}</span><span class="tr-name">${esc(name)}</span><span class="tr-dir">${esc(folder)}</span><span class="tr-state">${rowState(file)}</span>`;
  // A file with text to read opens under its row; one without (a picture, a large file) is only named.
  return file.diff ? `<details class="tr-file" data-task-file><summary>${line}</summary>${diffHTML(file.diff)}</details>` : `<div class="tr-file tr-plain" data-task-file>${line}</div>`;
}

const wellHTML = (files: readonly ChangedFile[]): string => `<div class="card-well tr-files">${files.map(rowHTML).join("")}</div>`;

/** The card's own words: what happened, in the number of files it happened to. */
function titleOf(files: readonly ChangedFile[]): string {
  const key = files.every(file => file.restored) ? "cards.filesUndone"
    : files.every(file => file.change === "added") ? "cards.filesAdded"
    : files.every(file => file.change === "removed") ? "cards.filesRemoved" : "cards.files";
  return t(key, { p0: files.length });
}

/**
 * The card under a finished turn that changed files on the member's computer (owner, 2026-11-14: the card said 「工作結果」,
 * 「53 個檔案變更 +0 −0」 and a green 「完成」 and nobody could tell what it was for). It says what happened to which files,
 * lists them (the rest fold), and has two buttons that say what they do. A finished card has no status pill: Grok Bot's
 * outputs are named things with nothing after them, and a state is only for what is unfinished or failed.
 */
export function taskResultHTML(turn: number, checkpoints: readonly api.FileCheckpoint[]): string {
  const files = changedFiles(turn, checkpoints);
  if (!files.length) return "";
  const open = checkpoints.find(checkpoint => checkpoint.turn === turn && checkpoint.files.length && checkpoint.state !== "restored");
  const rest = files.slice(SHOWN_FILES);
  return cardHTML({ title: titleOf(files), status: "done", hideStatus: true,
    content: wellHTML(files.slice(0, SHOWN_FILES)) + (rest.length ? cardDisclosureHTML(`task-${turn}`, wellHTML(rest), t("cards.moreFiles", { p0: rest.length }), t("common.showLess")) : ""),
    actions: btn(esc(t("cards.openChanges")), "sm pri", " data-task-files") +
      (open ? btn(esc(t("files.restore")), "sm", ` data-task-restore="${esc(open.id)}"`) : ""),
    cls: `task-result${files.every(file => file.restored) ? " is-restored" : ""}`, attrs: ` data-task-result="${turn}"`,
  });
}

export function mountTaskResults(thread: HTMLElement, member: () => number, openFiles: () => void): { sync(): void } {
  let owner = member(), generation = 0, pending = false, queued = false;
  const rendered = new WeakMap<Element, string>();
  let checkpoints: api.FileCheckpoint[] = [];
  const known = new Set<string>();
  function draw(): void {
    for (const slot of thread.querySelectorAll<HTMLElement>("[data-task-result-slot]")) {
      const html = taskResultHTML(Number(slot.dataset.taskResultSlot), checkpoints);
      if (rendered.get(slot) === html) continue;
      slot.innerHTML = html; rendered.set(slot, html);
      const stateLine = slot.parentElement?.querySelector<HTMLElement>(":scope > .task-actions");
      if (stateLine) stateLine.hidden = !!html;
    }
  }
  async function load(): Promise<void> {
    if (pending) { queued = true; return; }
    pending = true; const mine = generation, id = owner;
    try {
      const result = await api.computerCheckpoints(id);
      if (mine !== generation || owner !== member()) return;
      checkpoints = result.checkpoints; draw();
    } catch { /* An unavailable checkpoint store must not turn prose into a claim of changed files. */ }
    finally { pending = false; if (queued) { queued = false; void load(); } }
  }
  thread.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-task-files],[data-task-restore]");
    if (!button || button.disabled) return;
    if (button.hasAttribute("data-task-files")) { openFiles(); return; }
    const id = button.dataset.taskRestore!, idOwner = member(), mine = generation;
    button.disabled = true;
    void (async () => {
      const result = await api.computerCheckpoints(idOwner);
      const checkpoint = result.checkpoints.find(item => item.id === id);
      if (!checkpoint || checkpoint.state === "restored" || mine !== generation || idOwner !== member()) return;
      // The owner is asked first (the dialog names the effect) unless the permission mode is 全部允許.
      const confirm = result.confirmation_required !== false;
      if (confirm && !await confirmRestore()) return;
      if (mine !== generation || idOwner !== member()) return;
      const done = await api.computerRestore(idOwner, id, confirm, checkpoint.review_token);
      // A file the owner changed after the work is kept, and the owner is told how many were kept.
      toaster.info(done.skipped.length ? t("files.saved", { p0: done.restored.length, p1: done.skipped.length }) : t("files.restored"));
      await load();
    })().catch(() => cardFailure(button.closest(".conversation-card"), () => button.click(), undefined, t("files.undoFailed"))).finally(() => { button.disabled = false; });
  });
  return { sync() {
    if (member() !== owner) { owner = member(); generation++; checkpoints = []; known.clear(); }
    const slots = [...thread.querySelectorAll<HTMLElement>("[data-task-result-slot]")];
    const fresh = slots.some(slot => !known.has(slot.dataset.taskResultSlot!));
    slots.forEach(slot => known.add(slot.dataset.taskResultSlot!)); draw();
    if (fresh) void load();
  } };
}
