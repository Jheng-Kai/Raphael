import * as api from "./api";
import { cardDisclosureHTML, cardFailure, cardHTML } from "./card";
import { confirmRestore, checkpointsHTML } from "./checkpoint-view";
import { t } from "./i18n";
import { btn, esc } from "./ui";

export function taskResultHTML(turn: number, checkpoints: readonly api.FileCheckpoint[]): string {
  const changed = checkpoints.filter(checkpoint => checkpoint.turn === turn && checkpoint.files.length);
  if (!changed.length) return "";
  const paths = new Set(changed.flatMap(checkpoint => checkpoint.files.map(file => file.path)));
  let added = 0, removed = 0;
  for (const checkpoint of changed) for (const file of checkpoint.files) {
    let hunk = false;
    for (const line of file.diff.split("\n")) {
      if (line.startsWith("@@")) { hunk = true; continue; }
      if (hunk && line.startsWith("+")) added++;
      if (hunk && line.startsWith("-")) removed++;
    }
  }
  return cardHTML({ title: t("cards.task"), status: "done", body: `${t("cards.files", { p0: paths.size })} +${added} −${removed}`,
    content: cardDisclosureHTML(`task-${turn}`, checkpointsHTML([...changed])),
    actions: btn(esc(t("cards.view")), "sm pri", " data-task-files") +
      (changed.some(checkpoint => checkpoint.state !== "restored") ? btn(esc(t("files.restore")), "sm", ` data-task-restore="${esc(changed.find(checkpoint => checkpoint.state !== "restored")!.id)}"`) : ""),
    cls: "task-result", attrs: ` data-task-result="${turn}"`,
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
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-task-files],[data-task-restore],[data-checkpoint-restore]");
    if (!button || button.disabled) return;
    if (button.hasAttribute("data-task-files")) { openFiles(); return; }
    const id = (button.dataset.taskRestore ?? button.dataset.checkpointRestore)!, idOwner = member(), mine = generation;
    button.disabled = true;
    void (async () => {
      const result = await api.computerCheckpoints(idOwner);
      const checkpoint = result.checkpoints.find(item => item.id === id);
      if (!checkpoint || checkpoint.state === "restored" || mine !== generation || idOwner !== member()) return;
      const confirm = result.confirmation_required !== false;
      if (confirm && !await confirmRestore()) return;
      if (mine !== generation || idOwner !== member()) return;
      await api.computerRestore(idOwner, id, confirm, checkpoint.review_token);
      await load();
    })().catch(() => cardFailure(button.closest(".conversation-card"), () => button.click())).finally(() => { button.disabled = false; });
  });
  return { sync() {
    if (member() !== owner) { owner = member(); generation++; checkpoints = []; known.clear(); }
    const slots = [...thread.querySelectorAll<HTMLElement>("[data-task-result-slot]")];
    const fresh = slots.some(slot => !known.has(slot.dataset.taskResultSlot!));
    slots.forEach(slot => known.add(slot.dataset.taskResultSlot!)); draw();
    if (fresh) void load();
  } };
}
