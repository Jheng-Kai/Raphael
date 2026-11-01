import * as api from "./api";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { btn, esc, toaster } from "./ui";
import { describeError } from "./format";

function fileName(path: string): string {
  for (const [root, label] of [["/home/cua/team/", t("files.team")], ["/home/cua/workspace/", t("files.workspace")]]) {
    if (path === root.slice(0, -1)) return label;
    if (path.startsWith(root)) return `${label} / ${path.slice(root.length)}`;
  }
  return path;
}

function changedAt(value: number): string {
  const date = new Date(value), pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function diffHTML(diff: string): string {
  const lines = diff.split("\n").filter(line => !/^(--- before|\+\+\+ after|@@)/.test(line));
  if (!diff) return `<p class="foot">${esc(t("files.noPreview"))}</p>`;
  return `<pre><code>${lines.map(line => `<span class="checkpoint-line${line.startsWith("-") ? " is-removed" : line.startsWith("+") ? " is-added" : ""}">${esc(line.startsWith("-") ? `− ${line.slice(1)}` : line.startsWith("+") ? `+ ${line.slice(1)}` : line)}</span>`).join("\n")}</code></pre>`;
}

export function checkpointsHTML(checkpoints: api.FileCheckpoint[], busy = false, warning = false): string {
  const notices = (busy ? `<p class="foot" role="status">${esc(t("files.busy"))}</p>` : "") +
    (warning ? `<p class="foot" role="status">${esc(t("files.skipped"))}</p>` : "");
  if (!checkpoints.length) return notices + `<p class="foot">${esc(t("files.empty"))}</p>`;
  return notices + checkpoints.map(checkpoint => `<section class="checkpoint" data-checkpoint="${esc(checkpoint.id)}"><div class="checkpoint-heading"><span>${esc(t("files.changed", { p0: checkpoint.files.length, p1: changedAt(checkpoint.created) }))}</span>` +
    (checkpoint.state === "restored" ? `<span>${esc(t("files.restored"))}</span>` : checkpoint.files.length ? btn(esc(t("files.restore")), "sm", ` data-checkpoint-restore="${esc(checkpoint.id)}"${checkpoint.review_token ? ` data-checkpoint-review="${esc(checkpoint.review_token)}"` : ""}${busy ? " disabled" : ""}`) : "") +
    `</div>${checkpoint.partial ? `<p class="foot" role="status">${esc(t("files.partial"))}</p>${checkpoint.uncovered?.length ? `<ul class="checkpoint-uncovered">${checkpoint.uncovered.map(path => `<li>${esc(fileName(path))}</li>`).join("")}</ul>` : ""}` : ""}` +
    `${checkpoint.files.map(file => `<details><summary>${esc(fileName(file.path))}</summary>${diffHTML(file.diff)}</details>`).join("")}</section>`).join("");
}

export function confirmRestore(): Promise<boolean> {
  return new Promise(resolve => {
    let approved = false;
    openDialog({ title: t("files.confirm"), body: `<p>${esc(t("files.hint"))}</p>`, describedByBody: true, cls: "mb-confirm",
      actions: { secondary: btn(esc(t("common.cancel")), "", ' data-dlg="cancel"'), primary: { label: esc(t("files.restore")), attrs: ' data-dlg="restore"' } },
      onAct(action, _target, dialog) { approved = action === "restore"; dialog.close(); }, onClose: () => resolve(approved) });
  });
}

export function mountCheckpoints(panel: HTMLElement, member: () => number): { update(available: boolean): void } {
  const button = document.createElement("span");
  button.innerHTML = btn(esc(t("files.changes")), "sm", ' data-checkpoint-open');
  panel.querySelector(".desktop-actions")!.prepend(button.firstElementChild!);
  const open = panel.querySelector<HTMLButtonElement>("[data-checkpoint-open]")!;
  const review = document.createElement("div");
  review.className = "desktop-checkpoints"; review.hidden = true;
  panel.append(review);
  let current = member(), generation = 0, busy = false, confirmationRequired = true;
  let kept: string[] = [];
  async function load(): Promise<void> {
    const request = generation, owner = member();
    const result = await api.computerCheckpoints(owner);
    if (request === generation && owner === member()) {
      confirmationRequired = result.confirmation_required !== false;
      review.innerHTML = (kept.length ? `<p class="foot">${esc(t("files.kept"))}</p><ul class="checkpoint-uncovered">${kept.map(path => `<li>${esc(fileName(path))}</li>`).join("")}</ul>` : "") + checkpointsHTML(result.checkpoints, result.busy, result.coverage_warning);
    }
  }
  open.addEventListener("click", async () => {
    if (busy) return;
    review.hidden = !review.hidden;
    if (review.hidden) return;
    busy = open.disabled = true;
    try { await load(); } catch (error) { toaster.info(describeError(error)); }
    finally { busy = open.disabled = false; }
  });
  review.addEventListener("click", async event => {
    const restore = (event.target as Element).closest<HTMLButtonElement>("[data-checkpoint-restore]");
    if (!restore || busy) return;
    const owner = member(), request = generation, id = restore.dataset.checkpointRestore!;
    busy = restore.disabled = true;
    try {
      const latest = await api.computerCheckpoints(owner);
      confirmationRequired = latest.confirmation_required !== false;
      if (owner !== member() || request !== generation) return;
      if (confirmationRequired && !await confirmRestore()) return;
      if (owner !== member() || request !== generation) return;
      const token = restore.dataset.checkpointReview;
      const result = token ? await api.computerRestore(owner, id, confirmationRequired, token) : confirmationRequired ? await api.computerRestore(owner, id) : await api.computerRestore(owner, id, false);
      if (request === generation) { kept = result.skipped; toaster.info(t("files.saved", { p0: result.restored.length, p1: result.skipped.length })); await load(); }
    } catch (error) { toaster.info(describeError(error)); }
    finally { busy = restore.disabled = false; }
  });
  return { update(available) {
    if (current !== member()) { current = member(); generation++; kept = []; review.hidden = true; review.innerHTML = ""; }
    open.textContent = t("files.changes"); open.hidden = !available;
    if (!available) review.hidden = true;
  } };
}
