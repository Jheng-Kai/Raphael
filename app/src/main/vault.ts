import { connectorsSetKey, connectorsStatus, core, membersList } from "./api";
import { composioKeyProblem } from "./connections";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { btn, esc, fieldHTML, ico, iconBtn, openMenu, sel, tabs } from "./ui";
import { openActions } from "./member-column";
import { faceHTML } from "./members";
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
  editing: VaultEntry | null; kind: EntryKind | null; access: "all" | "chosen";
  /** As the roster gives them, so each is drawn with its own face. */
  members: Parameters<typeof faceHTML>[0][]; preview: Preview | null;
  /** Apps are connected through Composio: a new Composio key says first that they must be connected again. */
  composioApps?: boolean;
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
  save: "vault.save", edit: "vault.edit", remove: "vault.remove", removeConfirm: "vault.removeConfirm", cancel: "vault.cancel",
  import: "vault.import", preview: "vault.preview", previewAbout: "vault.previewAbout", error: "vault.error", cardNotice: "vault.cardNotice", busy: "vault.busy",
  value: "vault.key",
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

export function vaultHTML(v: VaultView): string {
  const access = (current: "all" | number[] = "all"): string => `<div class="vault-access"><span>${esc(word("access"))}</span>${sel([{ value: "all", label: word("everyone") }, { value: "chosen", label: word("chosen") }], v.access, word("access"), ' data-k="vault-access"')}</div>` +
    (v.access === "chosen" ? membersHTML(v.members, id => current !== "all" && current.includes(id)) : "");
  // Every entry can be changed, its private values too: they are never shown, so an edit's fields
  // start empty and a field left empty keeps what is saved.
  const privateInputs = (kind: EntryKind, editing: boolean): string => privateFields[kind].map(field =>
    fieldHTML(editing ? t("vault.keepBlank", { p0: word(field) }) : word(field), "", { id: `vault-value-${field}`, type: "password", label: word(field) })).join("");
  const composioEditor = (): string => `<div class="vault-editor" data-trap data-vault-system="composio"><h3>${esc(word("edit"))} · Composio</h3>` +
    `<p class="dim">${esc(t("missing.composioGuide"))}</p>` +
    (v.composioApps ? `<p class="dim" data-k="vault-composio-note">${esc(t("conn.keyReplaceNote"))}</p>` : "") +
    fieldHTML(t("plugins.keyPrompt"), "", { id: "vault-value-value", type: "password" }) +
    `<div class="vault-actions">${action("cancel")}${action("save", "save", "pri")}</div></div>`;
  const editor = v.editing?.system === "composio" ? composioEditor() : v.kind ? `<div class="vault-editor" data-trap><h3>${esc(word(v.editing ? "edit" : v.kind))}</h3>` +
    fieldHTML(word("label"), v.editing?.label ?? "", { id: "vault-label" }) +
    fieldHTML(word("hint"), v.editing?.hint ?? "", { id: "vault-hint" }) +
    (!v.editing && v.kind === "login" ? fieldHTML(word("site"), "", { id: "vault-origin" }) : "") +
    (v.editing || v.kind !== "key" ? privateInputs(v.kind, !!v.editing) : "") +
    access(v.editing?.members) + (v.kind === "card" ? `<p class="dim">${esc(word("cardNotice"))}</p>` : "") +
    `<div class="vault-actions">${action("cancel")}${action("save", "save", "pri")}</div></div>` : "";
  // A key appears only once a member has asked for one.
  const filters: ("all" | EntryKind)[] = ["all", ...kinds, ...(v.entries.some(e => e.kind === "key") ? ["key" as const] : [])];
  const preview = v.preview ? `<div class="vault-editor" data-trap><h3>${esc(word("preview"))}</h3><p class="dim">${esc(word("previewAbout"))}</p>` +
    `<p>${esc(t("vault.rejected", { count: v.preview.rejected }))}</p><div class="vault-preview" role="group" aria-label="${esc(word("preview"))}">` + v.preview.entries.map(row =>
      pickRow("", `<strong>${esc(row.label)}</strong><small>${esc(row.origin)}</small>`, true, ` data-vault-import="${row.id}"`)).join("") +
    `</div>${access()}<div class="vault-actions">${action("cancel")}${action("confirm", "import", "pri")}</div></div>` : "";
  return `<section class="vault" aria-label="${esc(word("title"))}"><div class="vault-heading"><h2>${esc(word("title"))}</h2><div class="vault-actions">${action("import")}${action("new")}</div></div>` +
    `<p class="dim">${esc(word("about"))}</p><input type="file" id="vault-file" accept=".csv,text/csv" hidden>` +
    (v.error ? `<p role="alert" class="notice">${esc(v.error)}</p>` : "") + (v.busy ? `<p role="status">${esc(word("busy"))}</p>` : "") + editor + preview +
    tabs(filters.map(id => ({ id, label: word(id), count: v.entries.filter(e => id === "all" || e.kind === id).length, attrs: ` data-vault="filter" data-kind="${id}"` })), v.filter, { kind: "nav", label: word("title"), plain: true }) +
    `<div class="vault-list">${v.entries.filter(e => v.filter === "all" || e.kind === v.filter).map(e => `<div class="vault-row" data-vault-row="${esc(e.id)}"><div class="vault-copy"><strong>${esc(e.label)}</strong>` +
      (e.origin ? `<small>${esc(e.origin)}</small>` : "") + `<small>${esc(e.members === "all" ? word("everyone") : e.members.map(id => v.members.find(m => m.id === id)?.name ?? String(id)).join("、"))}</small>` +
      (e.hint ? `<p>${esc(e.hint)}</p>` : "") + `</div>${iconBtn("more", t("members.more", { p0: e.label }), ` data-vault="menu" data-id="${esc(e.id)}"`)}</div>`).join("") || `<p class="dim">${esc(v.loaded ? word("empty") : word("busy"))}</p>`}</div></section>`;
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
  const cancel = (): void => {
    root.querySelectorAll<HTMLInputElement>("[id^='vault-value-']").forEach(input => { input.value = ""; });
    if (state.preview) void core("vault.cancel", { token: state.preview.token }).catch(() => {});
    state.preview = null; state.kind = null; state.editing = null; state.error = ""; state.access = "all";
  };
  const selectedMembers = (): "all" | number[] => state.access === "all" ? "all" : Array.from(root.querySelectorAll<HTMLElement>('[data-vault-member][aria-pressed="true"]')).map(el => Number(el.dataset.vaultMember));
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    state.busy = true; state.error = "";
    try { await operation(); }
    catch { state.error = word("error"); }
    finally { state.busy = false; redraw(); }
  };
  const edit = (id: string): void => {
    cancel(); state.editing = state.entries.find(e => e.id === id) ?? null;
    state.kind = state.editing?.kind ?? null; state.access = state.editing?.members === "all" ? "all" : "chosen"; redraw();
    root.querySelector<HTMLInputElement>(state.editing?.system ? "#vault-value-value" : "#vault-label")?.focus();
  };
  const menu = (anchor: HTMLElement, id: string): void => {
    const composio = id === COMPOSIO;
    // 移除 asks in its own place and removes on the second press: no second menu. Removing the Composio key ends every app
    // connected through it, which its question says.
    openActions(anchor, [{ id: "edit", label: word("edit"), icon: "pencil" }, { id: "remove", label: word("remove"), icon: "trash", ask: composio ? t("vault.composioRemoveConfirm") : word("removeConfirm") }], picked => {
      if (picked === "edit") edit(id);
      else if (composio) void run(async () => { await connectorsSetKey(""); onComposioChanged(); await load(); });
      else void run(async () => { await core("vault.remove", { id }); await load(); });
    });
  };
  /** A new Composio key, checked by Composio before it is kept (`connectors.set_key`); its refusal is said in words. */
  const saveComposio = (): void => {
    const input = root.querySelector<HTMLInputElement>("#vault-value-value");
    const key = input?.value.trim() ?? "";
    if (input) input.value = "";
    if (!key) return;
    state.busy = true; state.error = ""; redraw();
    void connectorsSetKey(key)
      .then(async () => { cancel(); onComposioChanged(); await load(); })
      .catch(error => { state.error = composioKeyProblem(error instanceof Error ? error.message : ""); })
      .finally(() => { state.busy = false; redraw(); });
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
    } else if (name === "filter") { state.filter = target.dataset.kind!; redraw(); }
    else if (name === "new") openMenu(target, kinds.map(value => ({ value, label: word(value) })), "", value => { cancel(); state.kind = value as EntryKind; redraw(); root.querySelector<HTMLInputElement>("#vault-label")?.focus(); });
    else if (name === "cancel") { cancel(); redraw(); }
    else if (name === "menu") menu(target, target.dataset.id!);
    else if (name === "import") root.querySelector<HTMLInputElement>("#vault-file")?.click();
    else if (name === "save" && state.editing?.system === "composio") saveComposio();
    else if (name === "save" && state.kind) {
      const value = (id: string): string => root.querySelector<HTMLInputElement>(`#vault-${id}`)?.value ?? "";
      const typed = Object.fromEntries(privateFields[state.kind].map(field => [field, value(`value-${field}`)]));
      // An edit sends only the values typed anew: an empty field keeps what is saved.
      const changed = Object.fromEntries(Object.entries(typed).filter(([, text]) => text));
      const params = { kind: state.kind, label: value("label"), hint: value("hint"), origin: value("origin"), members: selectedMembers(),
        ...(state.editing ? { id: state.editing.id, ...(Object.keys(changed).length ? { values: changed } : {}) } : state.kind === "key" ? {} : { values: typed }) };
      root.querySelectorAll<HTMLInputElement>("[id^='vault-value-']").forEach(input => { input.value = ""; });
      void run(async () => { await core(state.editing ? "vault.update" : "vault.add", params); cancel(); await load(); });
    } else if (name === "confirm" && state.preview) {
      const params = { token: state.preview.token, members: selectedMembers(), ids: Array.from(root.querySelectorAll<HTMLElement>('[data-vault-import][aria-pressed="true"]')).map(row => Number(row.dataset.vaultImport)) };
      void run(async () => { const result = await core<{ saved: number; remaining: number }>("vault.import", params); cancel(); if (result.remaining) state.error = t("vault.partial", { count: result.saved }); await load(); });
    }
  });
  root.addEventListener("change", event => {
    const input = event.target as HTMLInputElement;
    if (input.id !== "vault-file" || !input.files?.[0]) return;
    const file = input.files[0];
    const request = epoch;
    input.value = "";
    cancel();
    void run(async () => {
      if (file.size > 2_000_000) throw new Error("csv_too_large");
      const preview = await core<Preview>("vault.preview", { csv: await file.text() });
      if (request === epoch) state.preview = preview;
      else await core("vault.cancel", { token: preview.token });
    });
  });
  return {
    view: (): VaultView => state, load, reset: (): void => { epoch++; cancel(); },
    /** Opens the Composio key's form (a card whose sign-in Composio refused leads here); nothing without a saved key. */
    editComposio: async (): Promise<void> => { await load(); if (state.entries.some(e => e.id === COMPOSIO)) edit(COMPOSIO); },
  };
}
