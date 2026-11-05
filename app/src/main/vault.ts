import { core, membersList } from "./api";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { btn, esc, fieldHTML, iconBtn, openConfirmMenu, openMenu, sel, tabs } from "./ui";
import { openActions } from "./member-column";
import "./vault.css";

export type EntryKind = "login" | "contact" | "card";
export interface VaultEntry { id: string; kind: EntryKind; label: string; hint: string; origin: string; members: "all" | number[] }
interface Preview { token: string; entries: { id: number; label: string; origin: string }[]; rejected: number }
export interface VaultView {
  entries: VaultEntry[]; filter: string; loaded: boolean; error: string; busy: boolean;
  editing: VaultEntry | null; kind: EntryKind | null; access: "all" | "chosen";
  members: { id: number; name: string }[]; preview: Preview | null;
}
export const emptyVaultView = (): VaultView => ({ entries: [], members: [], filter: "all", loaded: false, error: "", busy: false, editing: null, kind: null, access: "all", preview: null });
const kinds: EntryKind[] = ["login", "contact", "card"];
const privateFields = { login: ["username", "password"], contact: ["name", "address", "phone", "email"], card: ["name", "number", "expiry", "cvc"] } as const;
const words = {
  title: "vault.title", about: "vault.about", all: "vault.all", login: "vault.login", contact: "vault.contact", card: "vault.card",
  new: "vault.new", empty: "vault.empty", label: "vault.label", hint: "vault.hint", site: "vault.site",
  everyone: "vault.everyone", chosen: "vault.chosen", access: "vault.access", username: "vault.username", password: "vault.password",
  name: "vault.name", address: "vault.address", phone: "vault.phone", email: "vault.email", number: "vault.number", expiry: "vault.expiry", cvc: "vault.cvc",
  save: "vault.save", edit: "vault.edit", remove: "vault.remove", removeConfirm: "vault.removeConfirm", cancel: "vault.cancel",
  import: "vault.import", preview: "vault.preview", previewAbout: "vault.previewAbout", error: "vault.error", cardNotice: "vault.cardNotice", busy: "vault.busy",
} as const satisfies Record<string, MessageKey>;
const word = (key: keyof typeof words): string => t(words[key]);
const action = (name: keyof typeof words | "confirm", label: keyof typeof words = name === "confirm" ? "import" : name, kind = ""): string => btn(word(label), kind, ` data-vault="${name}"`);

export function vaultHTML(v: VaultView): string {
  const access = (current: "all" | number[] = "all"): string => `<div class="vault-access"><span>${esc(word("access"))}</span>${sel([{ value: "all", label: word("everyone") }, { value: "chosen", label: word("chosen") }], v.access, word("access"), ' data-k="vault-access"')}</div>` +
    (v.access === "chosen" ? `<div class="vault-members">${v.members.map(m => `<label><input type="checkbox" data-vault-member="${m.id}"${current !== "all" && current.includes(m.id) ? " checked" : ""}>${esc(m.name)}</label>`).join("")}</div>` : "");
  const editor = v.kind ? `<div class="vault-editor" data-trap><h3>${esc(word(v.editing ? "edit" : v.kind))}</h3>` +
    fieldHTML(word("label"), v.editing?.label ?? "", { id: "vault-label" }) +
    fieldHTML(word("hint"), v.editing?.hint ?? "", { id: "vault-hint" }) +
    (!v.editing ? (v.kind === "login" ? fieldHTML(word("site"), "", { id: "vault-origin" }) : "") +
      privateFields[v.kind].map(field => fieldHTML(word(field), "", { id: `vault-value-${field}`, type: "password" })).join("") : "") +
    access(v.editing?.members) + (v.kind === "card" ? `<p class="dim">${esc(word("cardNotice"))}</p>` : "") +
    `<div class="vault-actions">${action("cancel")}${action("save", "save", "pri")}</div></div>` : "";
  const preview = v.preview ? `<div class="vault-editor" data-trap><h3>${esc(word("preview"))}</h3><p class="dim">${esc(word("previewAbout"))}</p>` +
    `<p>${esc(t("vault.rejected", { count: v.preview.rejected }))}</p><div class="vault-preview">` + v.preview.entries.map(row =>
      `<label><input type="checkbox" data-vault-import="${row.id}" checked><span><strong>${esc(row.label)}</strong><small>${esc(row.origin)}</small></span></label>`).join("") +
    `</div>${access()}<div class="vault-actions">${action("cancel")}${action("confirm", "import", "pri")}</div></div>` : "";
  return `<section class="vault" aria-label="${esc(word("title"))}"><div class="vault-heading"><h2>${esc(word("title"))}</h2><div class="vault-actions">${action("import")}${action("new")}</div></div>` +
    `<p class="dim">${esc(word("about"))}</p><input type="file" id="vault-file" accept=".csv,text/csv" hidden>` +
    (v.error ? `<p role="alert" class="notice">${esc(v.error)}</p>` : "") + (v.busy ? `<p role="status">${esc(word("busy"))}</p>` : "") + editor + preview +
    tabs((["all", ...kinds] as const).map(id => ({ id, label: word(id), count: v.entries.filter(e => id === "all" || e.kind === id).length, attrs: ` data-vault="filter" data-kind="${id}"` })), v.filter, { kind: "nav", label: word("title"), plain: true }) +
    `<div class="vault-list">${v.entries.filter(e => v.filter === "all" || e.kind === v.filter).map(e => `<div class="vault-row" data-vault-row="${esc(e.id)}"><div class="vault-copy"><strong>${esc(e.label)}</strong>` +
      (e.origin ? `<small>${esc(e.origin)}</small>` : "") + `<small>${esc(e.members === "all" ? word("everyone") : e.members.map(id => v.members.find(m => m.id === id)?.name ?? String(id)).join("、"))}</small>` +
      (e.hint ? `<p>${esc(e.hint)}</p>` : "") + `</div>${iconBtn("more", t("members.more", { p0: e.label }), ` data-vault="menu" data-id="${esc(e.id)}"`)}</div>`).join("") || `<p class="dim">${esc(v.loaded ? word("empty") : word("busy"))}</p>`}</div></section>`;
}

export function createVault(root: HTMLElement, redraw: () => void) {
  const state = emptyVaultView();
  let epoch = 0;
  const load = async (): Promise<void> => {
    const request = ++epoch;
    try {
      const [result, team] = await Promise.all([core<{ entries: VaultEntry[] }>("vault.list"), membersList()]);
      if (request !== epoch) return;
      state.entries = result.entries;
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
  const selectedMembers = (): "all" | number[] => state.access === "all" ? "all" : Array.from(root.querySelectorAll<HTMLInputElement>("[data-vault-member]:checked")).map(el => Number(el.dataset.vaultMember));
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    state.busy = true; state.error = "";
    try { await operation(); }
    catch { state.error = word("error"); }
    finally { state.busy = false; redraw(); }
  };
  const menu = (anchor: HTMLElement, id: string): void => {
    openActions(anchor, [{ id: "edit", label: word("edit"), icon: "pencil" }, { id: "remove", label: word("remove"), icon: "trash" }], picked => {
      if (picked === "edit") {
        cancel(); state.editing = state.entries.find(e => e.id === id) ?? null;
        state.kind = state.editing?.kind ?? null; state.access = state.editing?.members === "all" ? "all" : "chosen"; redraw();
      } else openConfirmMenu(anchor, { label: word("remove"), ask: word("removeConfirm"), run: () => { void run(async () => { await core("vault.remove", { id }); await load(); }); } });
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
        if (state.access === "chosen") area.insertAdjacentHTML("afterend", `<div class="vault-members">${state.members.map(m => `<label><input type="checkbox" data-vault-member="${m.id}">${esc(m.name)}</label>`).join("")}</div>`);
      });
    } else if (name === "filter") { state.filter = target.dataset.kind!; redraw(); }
    else if (name === "new") openMenu(target, kinds.map(value => ({ value, label: word(value) })), "", value => { cancel(); state.kind = value as EntryKind; redraw(); root.querySelector<HTMLInputElement>("#vault-label")?.focus(); });
    else if (name === "cancel") { cancel(); redraw(); }
    else if (name === "menu") menu(target, target.dataset.id!);
    else if (name === "import") root.querySelector<HTMLInputElement>("#vault-file")?.click();
    else if (name === "save" && state.kind) {
      const value = (id: string): string => root.querySelector<HTMLInputElement>(`#vault-${id}`)?.value ?? "";
      const params = { kind: state.kind, label: value("label"), hint: value("hint"), origin: value("origin"), members: selectedMembers(),
        ...(state.editing ? { id: state.editing.id } : { values: Object.fromEntries(privateFields[state.kind].map(field => [field, value(`value-${field}`)])) }) };
      root.querySelectorAll<HTMLInputElement>("[id^='vault-value-']").forEach(input => { input.value = ""; });
      void run(async () => { await core(state.editing ? "vault.update" : "vault.add", params); cancel(); await load(); });
    } else if (name === "confirm" && state.preview) {
      const params = { token: state.preview.token, members: selectedMembers(), ids: Array.from(root.querySelectorAll<HTMLInputElement>("[data-vault-import]:checked")).map(input => Number(input.dataset.vaultImport)) };
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
  return { view: (): VaultView => state, load, reset: (): void => { epoch++; cancel(); } };
}
