// A memory is one living document, not a list of rows. 「共同記憶」 is the owner's USER.md, the same in each
// agent's panel, and 「<name> 的記憶」 the agent's own MEMORY.md; Raphael's tab of Settings and every agent's 記憶
// tab show the two, shared first. Each reads as the document it is, and 編輯 opens all of it in one box that
// grows with its text. What clears waits in the ⋯ of its row (R-UI-56), behind a second press.
//
// `memoryHTML` draws it from a snapshot (pure, so its rules can be tested without a browser);
// `createMemory` holds the state and does what the buttons say, through the core's `memory.*`
// methods. A memory's text is shown only here, and never logged.

import { core } from "./api";
import { describeError, formatDate } from "./format";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { actionRow, btn, esc, iconButton, note, openConfirmMenu, row, st, toaster } from "./ui";

/** A memory file as `memory.get` gives it. */
export interface MemoryDocument {
  text: string;
  /** A mark of the file as it is: an edit made from another copy is refused. */
  revision: string;
  chars: number;
  entries: number;
  limit: number;
  summary: { text: string; updated_at_ms: number } | null;
}

/** The document open in its box: what is being typed, and the copy it was made from. */
export interface MemoryEditor {
  draft: string;
  revision: string;
  saving: boolean;
  error: string | null;
}

/** Where a memory is kept: the file every agent shares, or the agent's own. */
export type MemorySpace = "shared" | "own";

export interface MemoryView {
  status: MemoryDocument | "loading" | "failed";
  space: MemorySpace;
  /** The section's title: 「共同記憶」 or 「<name> 的記憶」. */
  title: string;
  editing: MemoryEditor | null;
  busy: boolean;
}

export const emptyMemoryView = (): MemoryView => ({
  status: "loading", space: "own", title: t("mem.title"), editing: null, busy: false,
});

const tr = t as unknown as (key: MessageKey) => string;

/** The longest document (the core's and the shell's limit). */
export const MEMORY_MAX = 64_000;

/** The id of a document's box: one per space, as two may be open on one page. */
export const memoryFieldId = (space: MemorySpace): string => `mem-body-${space}`;

// The core's marks in an entry (`memory/store.py`): what came from outside and nobody confirmed, at its
// start, and at its end whom the owner told a shared entry to and when.
const UNCONFIRMED = /^(?:（待確認）|（未確認）|\(unconfirmed\) )/;
const TOLD = / — ([^\n—]{1,60}) · (\d{4}-\d{2}-\d{2})$/;

/** What a refused edit says to the owner. The core's reasons start with their kind. */
export function memoryError(err: unknown): string {
  const said = err instanceof Error ? err.message : String(err);
  if (/(^|\s)changed:/.test(said)) return t("mem.changed");
  if (/(^|\s)secret:/.test(said)) return t("mem.refusedSecret");
  if (/(^|\s)injection:/.test(said)) return t("mem.refusedInstructions");
  return describeError(err);
}

function entryHTML(entry: string): string {
  const mark = UNCONFIRMED.exec(entry)?.[0];
  let text = mark ? entry.slice(mark.length) : entry;
  const told = TOLD.exec(text);
  if (told) text = text.slice(0, told.index);
  return (
    `<p class="mem-entry">` +
    (mark ? `<span class="mem-tag">${esc(t("mem.unconfirmed"))}</span> ` : "") +
    esc(text) +
    (told ? ` <span class="mem-from">${esc(`${told[1]} · ${formatDate(told[2]!)}`)}</span>` : "") +
    `</p>`
  );
}

const entriesOf = (text: string): string[] => text.split(/\n[ \t]*(?:\n[ \t]*)+/).map((part) => part.trim()).filter(Boolean);

function countHTML(draft: string, limit: number): string {
  const used = draft.trim().length;
  const over = used > limit;
  return `<span class="mem-count${over ? " is-over" : ""}" aria-live="polite">${esc(over ? t("mem.over", { p0: (used - limit).toLocaleString() }) : t("mem.count", { p0: used.toLocaleString(), p1: limit.toLocaleString() }))}</span>`;
}

function editorHTML(v: MemoryView, doc: MemoryDocument): string {
  const e = v.editing!;
  const off = e.saving ? " disabled" : "";
  return (
    `<div class="mem-edit" data-mem-editor>` +
    `<textarea id="${memoryFieldId(v.space)}" class="mem-body" rows="6" spellcheck="false" aria-label="${esc(t("mem.body", { p0: v.title }))}"${off}>${esc(e.draft)}</textarea>` +
    (e.error ? note(st("err", esc(e.error)), ' role="alert"') : "") +
    `<div class="mem-edit-foot">${countHTML(e.draft, doc.limit)}` +
    actionRow({ cls: "mem-edit-actions", secondary: btn(esc(t("common.cancel")), "sm", ` data-mem="cancel"${off}`), primary: { label: esc(t("mem.save")), kind: "sm", attrs: ` data-mem="save"${off}` } }) +
    `</div></div>`
  );
}

/** The memory: its title with 編輯 and, with something to clear, a ⋯; then the document, and the summary's row. */
export function memoryHTML(v: MemoryView): string {
  const group = (rows: string[]): string =>
    `<section class="sgroup mem" data-mem-section data-mem-space="${v.space}" aria-label="${esc(v.title)}"><div class="slist">${rows.join("")}</div></section>`;
  if (v.status === "loading") {
    return group([row(esc(v.title), "", `<span class="spin" role="status" aria-label="${esc(t("common.loading"))}"></span>`, { cls: "mem-head" })]);
  }
  if (v.status === "failed") return group([row(esc(v.title), "", "", { cls: "mem-head" }), note(st("err", t("mem.loadFailed")), ' role="alert"')]);
  const doc = v.status;
  const entries = entriesOf(doc.text);
  const off = v.busy ? " disabled" : "";
  const edit = v.editing ? "" : btn(esc(t("mem.edit")), "sm", ` data-mem="edit" aria-label="${esc(t("mem.editLabel", { p0: v.title }))}"${off}`);
  const menu = entries.length ? iconButton("more", t("mem.more", { p0: v.title }), ` data-mem="section-more" aria-haspopup="menu" aria-expanded="false"${off}`) : "";
  const head = row(esc(v.title), "", edit + menu, { cls: "mem-head" });
  const body = v.editing
    ? editorHTML(v, doc)
    : entries.length
      ? `<div class="mem-doc">${entries.map(entryHTML).join("")}</div>`
      : `<div class="mem-doc"><p class="mem-none">${esc(t("mem.empty"))}</p></div>`;
  const summary = doc.summary
    ? [row(esc(t("mem.summary")), "", iconButton("more", t("mem.more", { p0: t("mem.summary") }), ` data-mem="summary-more" aria-haspopup="menu" aria-expanded="false"${off}`), { cls: "mem-summary" })]
    : [];
  return group([head, body, ...summary]);
}

// ---------- state ----------

export interface MemoryHost {
  visible(): boolean;
  redraw(): void;
  /** Whose memory: a member's id, sent to the core as `member_id`; 0, or none, is Raphael's. */
  memberId?: () => number;
  /** The space this document is: its calls say it. */
  space: MemorySpace;
  /** The agent's name, for 「<name> 的記憶」. */
  ownerName?: () => string;
}

export interface MemoryPanel {
  view(): MemoryView;
  load(): Promise<void>;
  click(target: Element): boolean;
  input(el: HTMLTextAreaElement | HTMLInputElement): boolean;
  key(e: KeyboardEvent): boolean;
  /** The panel is closed or leaves the tab: close the box and forget the presses. */
  reset(): void;
}

export function createMemory(host: MemoryHost): MemoryPanel {
  let status: MemoryView["status"] = "loading";
  const space = host.space;
  /** Calls the core's `method` with the space and, for an agent's own, its `member_id` (Raphael's is 0). */
  const call = <T>(method: string, params?: Record<string, unknown>): Promise<T> =>
    core<T>(method, space === "shared" ? { ...params, space } : { ...params, space, member_id: host.memberId?.() ?? 0 });
  let editing: MemoryEditor | null = null;
  let busy = false;
  let loads = 0;

  const redraw = (): void => {
    if (host.visible()) host.redraw();
  };
  const view = (): MemoryView => ({
    status, editing, busy, space,
    title: space === "shared" ? t("mem.shared") : t("mem.own", { p0: host.ownerName?.() ?? t("agent.title") }),
  });
  const bodyId = memoryFieldId(space);

  async function load(): Promise<void> {
    const mine = ++loads;
    try {
      const next = await call<MemoryDocument>("memory.get");
      if (mine !== loads) return;
      status = next;
    } catch {
      if (mine !== loads) return;
      if (typeof status !== "object") status = "failed";
    }
    redraw();
  }

  function open(): void {
    if (typeof status !== "object") return;
    editing = { draft: status.text.trimEnd(), revision: status.revision, saving: false, error: null };
    redraw();
    // The box takes the focus, so that the text can be changed at once.
    if (typeof document !== "undefined") document.getElementById(bodyId)?.focus();
  }

  async function save(): Promise<void> {
    const e = editing;
    if (!e || e.saving || typeof status !== "object") return;
    if (e.draft.trim() === status.text.trim() && e.revision === status.revision) {
      editing = null;
      redraw();
      return;
    }
    editing = { ...e, saving: true, error: null };
    redraw();
    try {
      status = await call<MemoryDocument>("memory.update", { text: e.draft, revision: e.revision });
      editing = null;
      toaster.info(t("mem.saved"));
      redraw();
    } catch (err) {
      const said = memoryError(err);
      if (said === t("mem.changed")) {
        // An agent wrote meanwhile. What was typed stays; the next 儲存 is made knowing that.
        try {
          const latest = await call<MemoryDocument>("memory.get");
          status = latest;
          if (editing) editing = { ...editing, revision: latest.revision, saving: false, error: said };
        } catch {
          if (editing) editing = { ...editing, saving: false, error: t("mem.loadFailed") };
        }
      } else if (editing) {
        editing = { ...editing, saving: false, error: said };
      }
      redraw();
    }
  }

  async function act(work: () => Promise<unknown>, done: MessageKey): Promise<void> {
    busy = true;
    redraw();
    try {
      await work();
      toaster.info(tr(done));
    } catch (err) {
      toaster.info(describeError(err));
    }
    busy = false;
    await load();
  }

  function click(target: Element): boolean {
    const button = target.closest<HTMLElement>("[data-mem]");
    if (!button) return false;
    // two documents on one page: each hears the clicks of its own section only
    if (button.closest<HTMLElement>("[data-mem-section]")?.dataset.memSpace !== space) return false;
    switch (button.dataset.mem) {
      case "edit":
        open();
        return true;
      case "cancel":
        editing = null;
        redraw();
        return true;
      case "save":
        void save();
        return true;
      case "section-more":
        openConfirmMenu(button, {
          label: t("mem.clearAll"),
          ask: t("mem.clearConfirm"),
          run: () => {
            editing = null;
            void act(() => call("memory.clear"), "mem.cleared");
          },
        });
        return true;
      case "summary-more":
        openConfirmMenu(button, {
          label: t("mem.summaryClear"),
          ask: t("mem.summaryConfirm"),
          run: () => void act(() => call("memory.summary_clear"), "mem.summaryCleared"),
        });
        return true;
    }
    return false;
  }

  function input(el: HTMLTextAreaElement | HTMLInputElement): boolean {
    if (el.id !== bodyId || !editing) return false;
    // Kept as it is typed, not drawn again: a redraw would take the caret out of the box.
    editing = { ...editing, draft: el.value, error: null };
    const editor = el.closest("[data-mem-editor]");
    editor?.querySelectorAll(".note[role=alert]").forEach((n) => n.remove());
    const count = editor?.querySelector(".mem-count");
    if (count && typeof status === "object") count.outerHTML = countHTML(el.value, status.limit);
    return true;
  }

  function key(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (target?.id !== bodyId || !editing) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      editing = null;
      redraw();
      return true;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
      return true;
    }
    return false;
  }

  function reset(): void {
    loads++; // A pending read belongs to the member or tab that was left.
    status = "loading";
    editing = null;
  }

  return { view, load, click, input, key, reset };
}
