import { connectorsSetKey, connectorsStatus, core, membersList } from "./api";
import { composioKeyProblem } from "./connections";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { backButton, btn, esc, fieldHTML, ico, iconBtn, iconButton, openMenu, sel, tabs } from "./ui";
import { faceHTML } from "./members";
import { confirmDelete, openDialog } from "./member-dialogs";
import { bindNavLayer } from "./nav-layers";
// The rows to choose from are the group dialog's (`.room-row`, automations.css).
import "./automations.css";
import "./vault.css";

export type EntryKind = "login" | "contact" | "card" | "key";
/** `system: "composio"`: the Composio API key that Connect apps uses, kept by the core's connectors and shown here as a key
 *  the owner can replace or remove (#320); it has no name, hint or access of its own to edit. */
export interface VaultEntry { id: string; kind: EntryKind; label: string; hint: string; origin: string; members: "all" | number[]; system?: "composio" }
interface Preview { token: string; entries: { id: number; label: string; origin: string }[]; rejected: number }
export interface VaultView {
  entries: VaultEntry[]; filter: string; loaded: boolean; error: string; busy: boolean;
  /** The entry whose page is open, or with `kind` alone a new entry's page. */
  editing: VaultEntry | null; kind: EntryKind | null; access: "all" | "chosen";
  /** As the roster gives them, so each is drawn with its own face. */
  members: Parameters<typeof faceHTML>[0][]; preview: Preview | null;
  /** Apps are connected through Composio: a new Composio key says first that they must be connected again. */
  composioApps?: boolean;
  /** The open entry's private values as saved (masked until their eye is pressed); null while they are read. */
  values?: Record<string, string> | null;
  /** The private fields whose eye is pressed: drawn as text. */
  revealed?: string[];
  /** What the page's fields hold now, kept so that a redraw (an error) never loses what was typed; null: as saved. */
  draft?: Record<string, string> | null;
}
export const emptyVaultView = (): VaultView => ({ entries: [], members: [], filter: "all", loaded: false, error: "", busy: false, editing: null, kind: null, access: "all", preview: null });
/** The kinds the owner adds here by hand: a key is saved only from the card a member shows (`request_secret`), and listed, edited and removed here. */
const kinds = ["login", "contact", "card"] as const;
const privateFields = { login: ["username", "password"], contact: ["name", "address", "phone", "email"], card: ["name", "number", "expiry", "cvc"], key: ["value"] } as const;
/** The Composio key's row: always for the whole team, since Raphael's connections are the team's. */
const COMPOSIO = "composio";
const composioEntry = (): VaultEntry => ({ id: COMPOSIO, kind: "key", label: "Composio", hint: t("vault.composioHint"), origin: "", members: "all", system: "composio" });
const words = {
  title: "vault.title", about: "vault.about", all: "vault.all", login: "vault.login", contact: "vault.contact", card: "vault.card", key: "vault.key",
  new: "vault.new", empty: "vault.empty", label: "vault.label", hint: "vault.hint", site: "vault.site",
  everyone: "vault.everyone", chosen: "vault.chosen", access: "vault.access", username: "vault.username", password: "vault.password",
  name: "vault.name", address: "vault.address", phone: "vault.phone", email: "vault.email", number: "vault.number", expiry: "vault.expiry", cvc: "vault.cvc",
  save: "vault.save", edit: "vault.edit", remove: "vault.remove", cancel: "vault.cancel",
  import: "vault.import", preview: "vault.preview", previewAbout: "vault.previewAbout", error: "vault.error", cardNotice: "vault.cardNotice", busy: "vault.busy",
  value: "vault.key", show: "vault.showValue", hide: "vault.hideValue", back: "chooser.back",
} as const satisfies Record<string, MessageKey>;
const word = (key: keyof typeof words): string => t(words[key]);
const action = (name: keyof typeof words | "confirm", label: keyof typeof words = name === "confirm" ? "import" : name, kind = ""): string => btn(word(label), kind, ` data-vault="${name}"`);
/**
 * A row to choose or leave out, with no box (R-UI-174): the whole row is one button, what it names on its left (a member's
 * face and name, or an entry's label over its site) and the group dialog's round check at its right; a chosen row takes the
 * selected fill.
 */
const pickRow = (lead: string, text: string, on: boolean, attrs: string): string =>
  btn(`${lead}<span class="room-row-name">${text}</span><span class="room-row-mark" data-check aria-hidden="true">${on ? ico("check") : ""}</span>`,
    "room-row", ` data-vault="pick" aria-pressed="${on}"${attrs}`);
const membersHTML = (members: VaultView["members"], chosen: (id: number) => boolean): string =>
  `<div class="vault-members" role="group" aria-label="${esc(word("chosen"))}">${members.map(m => pickRow(faceHTML(m, 28), esc(m.name), chosen(m.id), ` data-vault-member="${m.id}"`)).join("")}</div>`;
/**
 * A private value: masked as saved, with an eye at its right that shows it and hides it again (the owner reads what is saved,
 * deletes it and types the new one). Its label stands above it, so an empty field still says what it is.
 */
const secretHTML = (field: string, label: string, value: string, shown: boolean): string =>
  `<div class="vault-secret"><span class="vault-field-label">${esc(label)}</span><span class="field vault-secret-field">` +
  `<input id="vault-value-${field}" type="${shown ? "text" : "password"}" value="${esc(value)}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false">` +
  iconButton(shown ? "eyeOff" : "eye", word(shown ? "hide" : "show"), ` data-vault="reveal" data-field="${field}" aria-pressed="${shown}"`, "vault-eye") + `</span></div>`;
const labelledHTML = (label: string, value: string, id: string): string =>
  `<div class="vault-secret"><span class="vault-field-label">${esc(label)}</span>${fieldHTML(label, value, { id })}</div>`;

/** The page of one entry, or of a new one, in the place of Safety (Settings › 安全): its own header with the way back, its
 *  title, its 移除 and the dialog's close; every value as saved, masked behind its eye; who may use it; 儲存. */
function pageHTML(v: VaultView, close: string): string {
  const editing = v.editing, kind = v.kind!, composio = editing?.system === "composio";
  // What the fields hold: what was typed since (kept across a redraw), else what is saved.
  const draft = v.draft ?? null, values = { ...(v.values ?? {}), ...(draft ?? {}) }, shown = new Set(v.revealed ?? []);
  const title = composio ? "Composio" : editing ? editing.label : `${word("new")} · ${word(kind)}`;
  const remove = editing ? iconButton("trash", word("remove"), ' data-vault="remove"') : "";
  // 儲存 stands in the page's header, which stays in sight as the page scrolls (as Team skills' controls do), never under
  // a long list of members.
  const head = `<header class="set-head vault-page-head"><span class="back-title" data-vault="cancel">${backButton(word("back"), ' data-vault="cancel" data-k="vault-back"', "back-link")}` +
    `<h1 class="vault-page-name" id="set-title" tabindex="-1" data-title-back>${esc(title)}</h1></span><span class="sp"></span>${remove}` +
    btn(esc(word("save")), "sm pri vault-save", ' data-vault="save" data-k="vault-save"') + `${close}</header>`;
  const access = (): string => `<div class="vault-access"><span>${esc(word("access"))}</span>${sel([{ value: "all", label: word("everyone") }, { value: "chosen", label: word("chosen") }], v.access, word("access"), ' data-k="vault-access"')}</div>` +
    (v.access === "chosen" ? membersHTML(v.members, id => editing?.members !== "all" && !!editing?.members.includes(id)) : "");
  const status = (v.error ? `<p role="alert" class="notice">${esc(v.error)}</p>` : "") + (v.busy ? `<p role="status">${esc(word("busy"))}</p>` : "");
  if (editing && v.values === null) return `<section class="vault vault-page" aria-labelledby="set-title">${head}${status}<p class="dim">${esc(word("busy"))}</p></section>`;
  const body = composio
    ? `<p class="dim">${esc(t("missing.composioGuide"))}</p>` +
      (v.composioApps ? `<p class="dim" data-k="vault-composio-note">${esc(t("conn.keyReplaceNote"))}</p>` : "") +
      secretHTML("value", t("plugins.keyPrompt"), values.value ?? "", shown.has("value"))
    : labelledHTML(word("label"), draft?.label ?? editing?.label ?? "", "vault-label") + labelledHTML(word("hint"), draft?.hint ?? editing?.hint ?? "", "vault-hint") +
      (kind === "login" ? (editing ? (editing.origin ? `<div class="vault-secret"><span class="vault-field-label">${esc(word("site"))}</span><p class="vault-site">${esc(editing.origin)}</p></div>` : "")
        : labelledHTML(word("site"), draft?.origin ?? "", "vault-origin")) : "") +
      (editing || kind !== "key" ? privateFields[kind].map(field => secretHTML(field, word(field), values[field] ?? "", shown.has(field))).join("") : "") +
      access() + (kind === "card" ? `<p class="dim">${esc(word("cardNotice"))}</p>` : "");
  return `<section class="vault vault-page" aria-labelledby="set-title"${composio ? ' data-vault-system="composio"' : ""}>${head}${status}<div class="vault-form" data-trap>${body}</div></section>`;
}

/** Safety's vault: the list of entries, each with its pencil; or, while one is open, that entry's page (`close` is the
 *  dialog's close, which the page's header carries as Settings' other pages do). */
export function vaultHTML(v: VaultView, close = ""): string {
  if (v.kind) return pageHTML(v, close);
  // A key appears only once a member has asked for one.
  const filters: ("all" | EntryKind)[] = ["all", ...kinds, ...(v.entries.some(e => e.kind === "key") ? ["key" as const] : [])];
  const preview = v.preview ? `<div class="vault-editor" data-trap><h3>${esc(word("preview"))}</h3><p class="dim">${esc(word("previewAbout"))}</p>` +
    `<p>${esc(t("vault.rejected", { count: v.preview.rejected }))}</p><div class="vault-preview" role="group" aria-label="${esc(word("preview"))}">` + v.preview.entries.map(row =>
      pickRow("", `<strong>${esc(row.label)}</strong><small>${esc(row.origin)}</small>`, true, ` data-vault-import="${row.id}"`)).join("") +
    `</div><div class="vault-access"><span>${esc(word("access"))}</span>${sel([{ value: "all", label: word("everyone") }, { value: "chosen", label: word("chosen") }], v.access, word("access"), ' data-k="vault-access"')}</div>` +
    (v.access === "chosen" ? membersHTML(v.members, () => false) : "") +
    `<div class="vault-actions">${action("cancel")}${action("confirm", "import", "pri")}</div></div>` : "";
  return `<section class="vault" aria-label="${esc(word("title"))}"><div class="vault-heading"><h2>${esc(word("title"))}</h2><div class="vault-actions">${action("import")}${action("new")}</div></div>` +
    `<p class="dim">${esc(word("about"))}</p><input type="file" id="vault-file" accept=".csv,text/csv" hidden>` +
    (v.error ? `<p role="alert" class="notice">${esc(v.error)}</p>` : "") + (v.busy ? `<p role="status">${esc(word("busy"))}</p>` : "") + preview +
    tabs(filters.map(id => ({ id, label: word(id), count: v.entries.filter(e => id === "all" || e.kind === id).length, attrs: ` data-vault="filter" data-kind="${id}"` })), v.filter, { kind: "nav", label: word("title"), plain: true }) +
    `<div class="vault-list">${v.entries.filter(e => v.filter === "all" || e.kind === v.filter).map(e => `<div class="vault-row" data-vault-row="${esc(e.id)}"><div class="vault-copy"><strong>${esc(e.label)}</strong>` +
      (e.origin ? `<small>${esc(e.origin)}</small>` : "") + `<small>${esc(e.members === "all" ? word("everyone") : e.members.map(id => v.members.find(m => m.id === id)?.name ?? String(id)).join("、"))}</small>` +
      (e.hint ? `<p>${esc(e.hint)}</p>` : "") + `</div>${iconBtn("pencil", word("edit"), ` data-vault="edit" data-id="${esc(e.id)}"`)}</div>`).join("") || `<p class="dim">${esc(v.loaded ? word("empty") : word("busy"))}</p>`}</div></section>`;
}

export function createVault(root: HTMLElement, redraw: () => void, onComposioChanged: () => void = () => {}) {
  const state = emptyVaultView();
  let epoch = 0;
  const load = async (): Promise<void> => {
    const request = ++epoch;
    try {
      // The Composio key is the connectors' own; without them (an older core, a read that fails) the rest still shows.
      const [result, team, composio] = await Promise.all([core<{ entries: VaultEntry[] }>("vault.list"), membersList(), connectorsStatus().catch(() => null)]);
      if (request !== epoch) return;
      state.entries = composio?.composio_configured ? [composioEntry(), ...result.entries] : result.entries;
      state.composioApps = !!composio?.connectors.some(c => c.kind === "composio");
      state.members = team.members;
      if (!state.members.some(m => m.id === 0)) state.members = [{ id: 0, name: "Raphael" }, ...state.members];
      state.loaded = true;
    } catch { if (request === epoch) state.error = word("error"); }
    if (request === epoch) redraw();
  };
  /** Back to the list: nothing typed or read stays in the page or the view. */
  const close = (): void => {
    root.querySelectorAll<HTMLInputElement>("[id^='vault-value-']").forEach(input => { input.value = ""; });
    if (state.preview) void core("vault.cancel", { token: state.preview.token }).catch(() => {});
    state.preview = null; state.kind = null; state.editing = null; state.error = ""; state.access = "all";
    state.values = undefined; state.revealed = []; state.draft = null;
  };
  const selectedMembers = (): "all" | number[] => state.access === "all" ? "all" : Array.from(root.querySelectorAll<HTMLElement>('[data-vault-member][aria-pressed="true"]')).map(el => Number(el.dataset.vaultMember));
  const typed = (id: string): string => root.querySelector<HTMLInputElement>(`#vault-${id}`)?.value ?? "";
  const fieldsOf = (): readonly string[] => !state.kind ? [] : state.editing?.system ? ["value"] : privateFields[state.kind];
  /** What the page's fields hold now. */
  const current = (): Record<string, string> => Object.fromEntries(fieldsOf().map(field => [field, typed(`value-${field}`)]));
  /** Keeps what is typed in the view, so that a redraw (an error, another part of Settings drawn again) never loses it; only
   *  from a page whose fields are drawn, never from the list or the moment before them. */
  const keepTyped = (): void => {
    if (!state.kind || state.values === null || !root.querySelector(".vault-form")) return;
    state.draft = { ...current(), ...(state.editing?.system ? {} : { label: typed("label"), hint: typed("hint"), origin: typed("origin") }) };
  };
  /** Whether the page holds a change that is not saved: a value, the name, the hint, the site or who may use it. */
  const dirty = (): boolean => {
    if (!state.kind || state.values === null || !root.querySelector(".vault-form")) return false;
    const entry = state.editing, before = state.values ?? {}, now = current();
    if (fieldsOf().some(field => (now[field] ?? "") !== (before[field] ?? ""))) return true;
    if (entry?.system) return false;
    if (typed("label") !== (entry?.label ?? "") || typed("hint") !== (entry?.hint ?? "") || (!entry && typed("origin") !== "")) return true;
    const was = entry?.members ?? "all", chosen = selectedMembers();
    const key = (members: "all" | number[]): string => members === "all" ? "all" : [...members].sort((a, b) => a - b).join(",");
    return key(was) !== key(chosen);
  };
  const run = async (operation: () => Promise<unknown>): Promise<boolean> => {
    state.busy = true; state.error = "";
    let done = false;
    try { await operation(); done = true; }
    catch { state.error = word("error"); }
    finally { state.busy = false; redraw(); }
    return done;
  };
  /** Opens an entry's page with its values as saved (masked); the Composio key is read from the connectors. */
  const open = async (id: string): Promise<void> => {
    close();
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return;
    state.editing = entry; state.kind = entry.kind; state.access = entry.members === "all" ? "all" : "chosen"; state.values = null;
    redraw();
    try {
      state.values = entry.system === "composio"
        ? { value: (await core<{ key: string }>("connectors.reveal_key")).key ?? "" }
        : (await core<{ values: Record<string, string> }>("vault.reveal", { id })).values;
    } catch { state.values = {}; state.error = word("error"); }
    if (state.editing !== entry) return;
    redraw();
    root.querySelector<HTMLElement>(entry.system ? "#vault-value-value" : "#vault-label")?.focus();
  };
  /** A new Composio key, checked by Composio before it is kept (`connectors.set_key`); its refusal is said in words. */
  const saveComposio = async (): Promise<boolean> => {
    const key = typed("value-value").trim();
    keepTyped();
    if (!key) { root.querySelector<HTMLInputElement>("#vault-value-value")?.focus(); return false; }
    if (key === (state.values?.value ?? "")) { close(); redraw(); return true; }
    state.busy = true; state.error = ""; redraw();
    try {
      await connectorsSetKey(key);
      close(); onComposioChanged(); await load();
      return true;
    } catch (error) {
      state.error = composioKeyProblem(error instanceof Error ? error.message : "");
      return false;
    } finally { state.busy = false; redraw(); }
  };
  /** Saves the page and goes back to the list; false when it was refused (the page stays, with what was typed). */
  const save = async (): Promise<boolean> => {
    if (!state.kind) return false;
    if (state.editing?.system === "composio") return saveComposio();
    const kind = state.kind, before = state.values ?? {}, values = current();
    keepTyped();
    const changed = privateFields[kind].some(field => (values[field] ?? "") !== (before[field] ?? ""));
    const params = { kind, label: typed("label"), hint: typed("hint"), origin: typed("origin"), members: selectedMembers(),
      // An edit sends the whole of its values, exactly as they now stand, and only when one changed.
      ...(state.editing ? { id: state.editing.id, ...(changed ? { values, exact: true } : {}) } : kind === "key" ? {} : { values }) };
    return run(async () => { await core(state.editing ? "vault.update" : "vault.add", params); close(); await load(); });
  };
  /**
   * Leaves the page: at once when nothing changed; else a dialog asks whether to save first (儲存 / 不儲存), and its ×
   * stays on the page. `then` runs once the page is left.
   */
  const leave = (then: () => void = () => {}): void => {
    if (!dirty()) { close(); redraw(); then(); return; }
    openDialog({
      title: t("vault.unsavedTitle"), body: `<p>${esc(t("vault.unsavedHint"))}</p>`, describedByBody: true, cls: "mb-confirm vault-unsaved",
      actions: { secondary: btn(esc(t("vault.discard")), "", ' data-dlg="discard"'), primary: { label: esc(word("save")), attrs: ' data-dlg="save"' } },
      onAct(act, _target, dialog) {
        dialog.close();
        if (act === "discard") { close(); redraw(); then(); }
        else if (act === "save") void save().then(saved => { if (saved) then(); });
      },
    });
  };
  /** The trash: the red dialog that deleting a member uses asks first; only its red button removes. */
  const remove = (): void => {
    const entry = state.editing;
    if (!entry) return;
    keepTyped();
    const composio = entry.system === "composio";
    void confirmDelete(entry.label, { words: { title: t("vault.removeTitle", { p0: entry.label }), hint: t(composio ? "vault.composioRemoveHint" : "vault.removeHint"), action: word("remove") } }).then(yes => {
      if (!yes || state.editing !== entry) return;
      if (composio) void run(async () => { await connectorsSetKey(""); close(); onComposioChanged(); await load(); });
      else void run(async () => { await core("vault.remove", { id: entry.id }); close(); await load(); });
    });
  };
  root.addEventListener("click", event => {
    const target = (event.target as Element).closest<HTMLElement>("[data-vault], [data-k='vault-access']");
    if (!target || state.busy) return;
    const name = target.dataset.vault;
    if (target.dataset.k === "vault-access") {
      // Keep typed private fields in the DOM while the shared menu is open.
      openMenu(target, [{ value: "all", label: word("everyone") }, { value: "chosen", label: word("chosen") }], state.access, value => {
        state.access = value === "all" ? "all" : "chosen";
        const area = target.closest(".vault-access")!;
        area.querySelector("button span")!.textContent = word(state.access === "all" ? "everyone" : "chosen");
        area.nextElementSibling?.classList.contains("vault-members") && area.nextElementSibling.remove();
        if (state.access === "chosen") area.insertAdjacentHTML("afterend", membersHTML(state.members, () => false));
      });
    } else if (name === "pick") {
      // Chosen or left out where it stands: a redraw would clear the private fields typed above.
      const on = target.getAttribute("aria-pressed") !== "true";
      target.setAttribute("aria-pressed", String(on));
      target.querySelector("[data-check]")!.innerHTML = on ? ico("check") : "";
    } else if (name === "reveal") {
      // The eye shows the value and hides it again where it stands, keeping what is typed.
      const field = target.dataset.field!, input = root.querySelector<HTMLInputElement>(`#vault-value-${field}`);
      const shown = target.getAttribute("aria-pressed") !== "true";
      if (input) input.type = shown ? "text" : "password";
      target.setAttribute("aria-pressed", String(shown));
      target.setAttribute("aria-label", word(shown ? "hide" : "show")); target.setAttribute("title", word(shown ? "hide" : "show"));
      target.innerHTML = ico(shown ? "eyeOff" : "eye");
      state.revealed = shown ? [...new Set([...(state.revealed ?? []), field])] : (state.revealed ?? []).filter(f => f !== field);
    } else if (name === "filter") { state.filter = target.dataset.kind!; redraw(); }
    else if (name === "new") openMenu(target, kinds.map(value => ({ value, label: word(value) })), "", value => {
      close(); state.kind = value as EntryKind; state.values = {}; redraw(); root.querySelector<HTMLInputElement>("#vault-label")?.focus();
    });
    else if (name === "cancel") leave();
    else if (name === "edit") void open(target.dataset.id!);
    else if (name === "remove") remove();
    else if (name === "import") root.querySelector<HTMLInputElement>("#vault-file")?.click();
    else if (name === "save") void save();
    else if (name === "confirm" && state.preview) {
      const params = { token: state.preview.token, members: selectedMembers(), ids: Array.from(root.querySelectorAll<HTMLElement>('[data-vault-import][aria-pressed="true"]')).map(row => Number(row.dataset.vaultImport)) };
      void run(async () => { const result = await core<{ saved: number; remaining: number }>("vault.import", params); close(); if (result.remaining) state.error = t("vault.partial", { count: result.saved }); await load(); });
    }
  });
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.id !== "vault-file" || !input.files?.[0]) return;
    const file = input.files[0];
    const request = epoch;
    input.value = "";
    close();
    void run(async () => {
      if (file.size > 2_000_000) throw new Error("csv_too_large");
      const preview = await core<Preview>("vault.preview", { csv: await file.text() });
      if (request === epoch) state.preview = preview;
      else await core("vault.cancel", { token: preview.token });
    });
  });
  return {
    view: (): VaultView => state, load, reset: (): void => { epoch++; close(); },
    /** Whether the open page holds a change that is not saved. */
    dirty,
    /** Keeps what the open page's fields hold before Settings is drawn again for another reason. */
    keep: keepTyped,
    /** Leaves the open page, asking first whether to save a change (Settings' close, Escape and other panes come here). */
    leave,
    /** After each drawing: an entry's page is a step of its own, so a step back (a side button, Alt+Left) leaves it, asking first
     *  about a change; while it saves, the step waits. */
    painted(): void {
      const page = root.querySelector<HTMLElement>(".vault-page");
      if (page) bindNavLayer(page, () => leave(), { step: direction => {
        if (direction !== "back") return false;
        if (state.busy) return true;
        if (!dirty()) return false;
        leave();
        return true;
      } });
    },
    /** Whether an entry's page is open: Safety then shows that page alone. */
    paged: (): boolean => state.kind !== null,
    /** Opens the Composio key's page (a card whose sign-in Composio refused leads here); nothing without a saved key. */
    editComposio: async (): Promise<void> => { await load(); if (state.entries.some(e => e.id === COMPOSIO)) await open(COMPOSIO); },
  };
}
